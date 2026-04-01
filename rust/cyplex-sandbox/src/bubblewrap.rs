use std::path::PathBuf;
use std::process::{Child, Command};

use serde::{Deserialize, Serialize};

use crate::error::SandboxError;

/// Configuration for spawning a process inside a bubblewrap (bwrap) sandbox.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BubblewrapConfig {
    /// The workspace directory that will be bind-mounted read-write.
    pub workspace_root: PathBuf,
    /// Paths to executables that are permitted inside the sandbox.
    pub allowed_binaries: Vec<PathBuf>,
    /// Whether the sandboxed process may access the network.
    pub network_access: bool,
    /// Additional paths to bind-mount as read-only.
    pub readonly_paths: Vec<PathBuf>,
}

impl Default for BubblewrapConfig {
    fn default() -> Self {
        Self { // Already correct from previous change
            workspace_root: PathBuf::from("/tmp/agent-v0-workspace"),
            allowed_binaries: Vec::new(),
            network_access: false,
            readonly_paths: vec![
                PathBuf::from("/usr"),
                PathBuf::from("/lib"),
                PathBuf::from("/lib64"),
                PathBuf::from("/bin"),
                PathBuf::from("/sbin"),
            ],
        }
    }
}

/// Build a `Command` that will invoke `bwrap` with the given configuration.
///
/// The returned `Command` is ready to be spawned but has not been started yet,
/// allowing the caller to customize environment variables or stdio before launch.
pub fn build_bwrap_command(
    config: &BubblewrapConfig,
    command: &str,
    args: &[&str],
) -> Command {
    let mut cmd = Command::new("bwrap");

    // Create a new PID namespace and mount a private /proc.
    cmd.arg("--unshare-pid");

    // Optionally isolate the network.
    if !config.network_access {
        cmd.arg("--unshare-net");
    }

    // Bind-mount read-only paths.
    for ro_path in &config.readonly_paths {
        cmd.arg("--ro-bind")
            .arg(ro_path)
            .arg(ro_path);
    }

    // Bind-mount the workspace read-write.
    cmd.arg("--bind")
        .arg(&config.workspace_root)
        .arg(&config.workspace_root);

    // Mount a private /proc.
    cmd.arg("--proc").arg("/proc");

    // Mount a private /dev.
    cmd.arg("--dev").arg("/dev");

    // Bind-mount each allowed binary read-only.
    for bin in &config.allowed_binaries {
        cmd.arg("--ro-bind").arg(bin).arg(bin);
    }

    // Set the working directory inside the sandbox.
    cmd.arg("--chdir").arg(&config.workspace_root);

    // Die when the parent process exits.
    cmd.arg("--die-with-parent");

    // The actual command to run inside the sandbox.
    cmd.arg("--").arg(command);
    for arg in args {
        cmd.arg(arg);
    }

    tracing::debug!(
        ?config,
        command,
        ?args,
        "built bwrap command"
    );

    cmd
}

/// Spawn a sandboxed process using bubblewrap.
///
/// Returns the `Child` handle on success so the caller can wait on or signal
/// the sandboxed process.
pub fn spawn_bwrap(
    config: &BubblewrapConfig,
    command: &str,
    args: &[&str],
) -> Result<Child, SandboxError> {
    let mut cmd = build_bwrap_command(config, command, args);

    tracing::info!(command, "spawning sandboxed process via bwrap");

    let child = cmd.spawn().map_err(|e| {
        SandboxError::BubblewrapFailed(format!(
            "failed to spawn bwrap process: {e}"
        ))
    })?;

    Ok(child)
}
