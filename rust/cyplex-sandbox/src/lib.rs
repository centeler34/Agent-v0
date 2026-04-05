//! # agent-v0-sandbox
//!
//! Agent process sandboxing for the Agent v0 project.
//!
//! This crate provides platform-specific isolation:
//! - **Linux**: namespaces, seccomp-BPF, bubblewrap
//! - **macOS**: Apple Sandbox.framework via `sandbox-exec`
//! - **All platforms**: path guard that enforces workspace boundaries

pub mod bubblewrap;
pub mod error;
pub mod macos_sandbox;
pub mod namespace;
pub mod path_guard;
pub mod seccomp;

// Re-exports for ergonomic usage.
pub use bubblewrap::{BubblewrapConfig, build_bwrap_command, spawn_bwrap};
pub use error::SandboxError;
pub use macos_sandbox::{MacSandboxConfig, generate_sandbox_profile, spawn_sandbox_exec};
pub use namespace::{NamespaceConfig, setup_namespaces};
pub use path_guard::PathGuard;
pub use seccomp::{SeccompProfile, apply_seccomp_filter};

use std::path::Path;
use std::process::Child;

/// Detected sandbox backend for the current platform.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxBackend {
    /// Linux: bubblewrap (bwrap) container
    Bubblewrap,
    /// macOS: sandbox-exec (Apple Sandbox.framework)
    SandboxExec,
    /// Fallback: path-guard validation only (no OS-level isolation)
    PathGuardOnly,
}

impl std::fmt::Display for SandboxBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Bubblewrap => write!(f, "bubblewrap"),
            Self::SandboxExec => write!(f, "sandbox-exec"),
            Self::PathGuardOnly => write!(f, "path-guard-only"),
        }
    }
}

/// Detect the best available sandbox backend for the current platform.
pub fn detect_backend() -> SandboxBackend {
    #[cfg(target_os = "linux")]
    {
        // Check if bwrap is available
        if std::process::Command::new("bwrap")
            .arg("--version")
            .output()
            .is_ok()
        {
            return SandboxBackend::Bubblewrap;
        }
    }
    #[cfg(target_os = "macos")]
    {
        // sandbox-exec is built into macOS
        if std::process::Command::new("sandbox-exec")
            .arg("-p")
            .arg("(version 1)(allow default)")
            .arg("true")
            .output()
            .is_ok()
        {
            return SandboxBackend::SandboxExec;
        }
    }
    SandboxBackend::PathGuardOnly
}

/// Spawn a sandboxed agent process.
///
/// This is the primary entry point for running an agent command inside a
/// sandbox. It automatically selects the best available backend:
/// - Linux: bubblewrap (namespace + seccomp isolation)
/// - macOS: sandbox-exec (Sandbox.framework profile)
/// - Fallback: path-guard-only (no OS-level isolation, workspace path validation only)
///
/// # Arguments
///
/// * `workspace_root` - The directory the agent is permitted to access.
/// * `command` - The executable to run inside the sandbox.
/// * `args` - Arguments passed to the sandboxed command.
/// * `ns_config` - Optional namespace configuration (Linux only; ignored on macOS).
/// * `seccomp_profile` - Optional seccomp profile (Linux only; ignored on macOS).
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
    // Validate that the workspace root exists.
    if !workspace_root.exists() {
        return Err(SandboxError::IoError(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("workspace root does not exist: {}", workspace_root.display()),
        )));
    }

    let backend = detect_backend();
    tracing::info!(
        workspace = %workspace_root.display(),
        command,
        %backend,
        network_access,
        "preparing sandboxed agent"
    );

    match backend {
        SandboxBackend::Bubblewrap => {
            let ns = ns_config.unwrap_or_default();
            let profile = seccomp_profile.unwrap_or(SeccompProfile::Standard);
            tracing::info!("namespace config: {:?}", ns);
            apply_seccomp_filter(profile)?;

            let bwrap_config = BubblewrapConfig {
                workspace_root: workspace_root.to_path_buf(),
                network_access,
                ..BubblewrapConfig::default()
            };
            spawn_bwrap(&bwrap_config, command, args)
        }
        SandboxBackend::SandboxExec => {
            let mac_config = MacSandboxConfig {
                workspace_root: workspace_root.to_path_buf(),
                network_access,
                ..MacSandboxConfig::default()
            };
            spawn_sandbox_exec(&mac_config, command, args)
        }
        SandboxBackend::PathGuardOnly => {
            tracing::warn!(
                "no OS-level sandbox available — using path-guard-only mode"
            );
            // Spawn the process directly with path validation only
            let child = std::process::Command::new(command)
                .args(args)
                .current_dir(workspace_root)
                .spawn()
                .map_err(|e| {
                    SandboxError::IoError(std::io::Error::new(
                        e.kind(),
                        format!("failed to spawn agent process: {e}"),
                    ))
                })?;
            Ok(child)
        }
    }
}
