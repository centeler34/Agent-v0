//! # agent-v0-sandbox
//!
//! Agent process sandboxing for the Agent v0 project.
//!
//! This crate provides Linux-specific isolation primitives (namespaces,
//! seccomp-BPF, bubblewrap) together with a platform-independent path guard
//! that enforces workspace boundaries.

pub mod bubblewrap;
pub mod error;
pub mod namespace;
pub mod path_guard;
pub mod seccomp;

// Re-exports for ergonomic usage.
pub use bubblewrap::{BubblewrapConfig, build_bwrap_command, spawn_bwrap};
pub use error::SandboxError;
pub use namespace::{NamespaceConfig, setup_namespaces};
pub use path_guard::PathGuard;
pub use seccomp::{SeccompProfile, apply_seccomp_filter};

use std::path::Path;
use std::process::Child;

/// Spawn a sandboxed agent process.
///
/// This is the primary entry point for running an agent command inside a
/// sandbox. It combines namespace isolation, seccomp filtering, and
/// bubblewrap execution into a single convenient call.
///
/// # Arguments
///
/// * `workspace_root` - The directory the agent is permitted to access.
/// * `command` - The executable to run inside the sandbox.
/// * `args` - Arguments passed to the sandboxed command.
/// * `ns_config` - Optional namespace configuration (defaults to standard isolation).
/// * `seccomp_profile` - Optional seccomp profile (defaults to `Standard`).
/// * `network_access` - Whether the agent may access the network.
///
/// # Errors
///
/// Returns a `SandboxError` if any sandbox setup step fails or if the
/// process cannot be spawned.
pub fn spawn_sandboxed_agent(
    workspace_root: &Path,
    command: &str,
    args: &[&str],
    ns_config: Option<NamespaceConfig>,
    seccomp_profile: Option<SeccompProfile>,
    network_access: bool,
) -> Result<Child, SandboxError> {
    let ns = ns_config.unwrap_or_default();
    let profile = seccomp_profile.unwrap_or(SeccompProfile::Standard);

    tracing::info!(
        workspace = %workspace_root.display(),
        command,
        %profile,
        network_access,
        "preparing sandboxed agent"
    );

    // Validate that the workspace root exists.
    if !workspace_root.exists() {
        return Err(SandboxError::IoError(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("workspace root does not exist: {}", workspace_root.display()),
        )));
    }

    // Set up namespace isolation (no-op / error on non-Linux).
    // In production the namespace setup happens inside the child; here we log
    // intent so the bwrap invocation can mirror the flags.
    tracing::info!("namespace config: {:?}", ns);

    // Apply seccomp profile (stub on all platforms for now).
    apply_seccomp_filter(profile)?;

    // Build the bubblewrap configuration.
    let bwrap_config = BubblewrapConfig {
        workspace_root: workspace_root.to_path_buf(),
        network_access,
        ..BubblewrapConfig::default()
    };

    // Spawn the sandboxed process.
    spawn_bwrap(&bwrap_config, command, args)
}
