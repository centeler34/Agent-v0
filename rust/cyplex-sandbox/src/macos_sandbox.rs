//! macOS sandbox support via `sandbox-exec` (Sandbox.framework).
//!
//! On macOS, each agent process is launched inside an Apple Sandbox profile
//! that restricts file-system access to the agent's workspace directory,
//! optionally denies network access, and blocks dangerous syscalls.
//!
//! The sandbox profile is a Scheme-like DSL understood by `sandbox-exec(1)`.

use std::path::{Path, PathBuf};
use std::process::{Child, Command};

use serde::{Deserialize, Serialize};

use crate::error::SandboxError;

/// Configuration for the macOS `sandbox-exec` sandbox.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacSandboxConfig {
    /// The workspace directory the agent is permitted to read and write.
    pub workspace_root: PathBuf,
    /// Whether the sandboxed process may access the network.
    pub network_access: bool,
    /// Additional paths to allow read-only access to.
    pub readonly_paths: Vec<PathBuf>,
    /// Paths to executables that are permitted inside the sandbox.
    pub allowed_binaries: Vec<PathBuf>,
}

impl Default for MacSandboxConfig {
    fn default() -> Self {
        Self {
            workspace_root: PathBuf::from("/tmp/agent-v0-workspace"),
            network_access: false,
            readonly_paths: vec![
                PathBuf::from("/usr/lib"),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/usr/sbin"),
                PathBuf::from("/usr/share"),
                PathBuf::from("/bin"),
                PathBuf::from("/sbin"),
                PathBuf::from("/Library/Frameworks"),
                PathBuf::from("/System/Library/Frameworks"),
                PathBuf::from("/private/var/db"),
            ],
            allowed_binaries: Vec::new(),
        }
    }
}

/// Generate an Apple Sandbox profile (SBPL) for the given configuration.
///
/// The profile uses deny-by-default with explicit allows for the workspace
/// and system paths the agent needs to function.
pub fn generate_sandbox_profile(config: &MacSandboxConfig) -> String {
    let workspace = config.workspace_root.display();

    let mut profile = String::from(
        r#"(version 1)

;; Deny everything by default
(deny default)

;; Allow basic process operations
(allow process-exec)
(allow process-fork)
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup)
(allow mach-register)
(allow ipc-posix-shm-read-data)
(allow ipc-posix-shm-write-data)

;; Allow reading system libraries and frameworks
(allow file-read*
  (subpath "/usr/lib")
  (subpath "/usr/share")
  (subpath "/System/Library")
  (subpath "/Library/Frameworks")
  (subpath "/private/var/db/dyld")
  (subpath "/dev")
  (literal "/etc")
  (literal "/tmp")
  (literal "/var")
  (literal "/private/etc/localtime")
  (literal "/private/etc/resolv.conf")
)

;; Allow executing system binaries
(allow file-read* file-execute
  (subpath "/usr/bin")
  (subpath "/usr/sbin")
  (subpath "/bin")
  (subpath "/sbin")
)

"#,
    );

    // Allow read/write access to the workspace
    profile.push_str(&format!(
        ";; Agent workspace (read-write)\n(allow file-read* file-write*\n  (subpath \"{}\")\n)\n\n",
        workspace
    ));

    // Allow read-only access to additional paths
    for ro_path in &config.readonly_paths {
        let p = ro_path.display();
        // Skip paths already covered by the defaults above
        if !p.to_string().starts_with("/usr/lib")
            && !p.to_string().starts_with("/usr/bin")
            && !p.to_string().starts_with("/System/Library")
        {
            profile.push_str(&format!(
                "(allow file-read* (subpath \"{}\"))\n",
                p
            ));
        }
    }

    // Allow executing specific binaries
    for bin in &config.allowed_binaries {
        profile.push_str(&format!(
            "(allow file-read* file-execute (literal \"{}\"))\n",
            bin.display()
        ));
    }

    // Homebrew paths (common on macOS)
    profile.push_str(
        r#"
;; Homebrew (Apple Silicon)
(allow file-read*
  (subpath "/opt/homebrew/Cellar")
  (subpath "/opt/homebrew/lib")
  (subpath "/opt/homebrew/bin")
)
(allow file-read* file-execute
  (subpath "/opt/homebrew/bin")
)

;; Temp files
(allow file-read* file-write*
  (subpath "/private/tmp")
  (subpath "/tmp")
  (regex #"^/private/var/folders/")
)
"#,
    );

    // Network access
    if config.network_access {
        profile.push_str(
            r#"
;; Network access allowed
(allow network*)
"#,
        );
    } else {
        profile.push_str(
            r#"
;; Network access denied
(deny network*)
;; Allow loopback for local IPC
(allow network* (remote ip "localhost:*"))
(allow network* (remote unix-socket))
"#,
        );
    }

    profile
}

/// Build a `Command` that will invoke `sandbox-exec` with the given configuration.
#[cfg(target_os = "macos")]
pub fn build_sandbox_exec_command(
    config: &MacSandboxConfig,
    command: &str,
    args: &[&str],
) -> Command {
    let profile = generate_sandbox_profile(config);

    let mut cmd = Command::new("sandbox-exec");
    cmd.arg("-p").arg(&profile);
    cmd.arg(command);
    for arg in args {
        cmd.arg(arg);
    }

    // Set the working directory inside the sandbox
    cmd.current_dir(&config.workspace_root);

    tracing::debug!(
        ?config,
        command,
        ?args,
        "built sandbox-exec command"
    );

    cmd
}

/// Spawn a sandboxed process using macOS `sandbox-exec`.
#[cfg(target_os = "macos")]
pub fn spawn_sandbox_exec(
    config: &MacSandboxConfig,
    command: &str,
    args: &[&str],
) -> Result<Child, SandboxError> {
    let mut cmd = build_sandbox_exec_command(config, command, args);

    tracing::info!(command, "spawning sandboxed process via sandbox-exec");

    let child = cmd.spawn().map_err(|e| {
        SandboxError::SandboxExecFailed(format!(
            "failed to spawn sandbox-exec process: {e}"
        ))
    })?;

    Ok(child)
}

/// Stub for non-macOS platforms.
#[cfg(not(target_os = "macos"))]
pub fn build_sandbox_exec_command(
    _config: &MacSandboxConfig,
    _command: &str,
    _args: &[&str],
) -> Command {
    // Return a dummy command — this should never be called on non-macOS.
    Command::new("false")
}

/// Stub for non-macOS platforms.
#[cfg(not(target_os = "macos"))]
pub fn spawn_sandbox_exec(
    _config: &MacSandboxConfig,
    _command: &str,
    _args: &[&str],
) -> Result<Child, SandboxError> {
    Err(SandboxError::UnsupportedPlatform(
        "sandbox-exec is only available on macOS".into(),
    ))
}

/// Write a standalone .sb profile to disk for debugging or manual testing.
pub fn write_profile_to_file(config: &MacSandboxConfig, output: &Path) -> Result<(), SandboxError> {
    let profile = generate_sandbox_profile(config);
    std::fs::write(output, profile).map_err(SandboxError::IoError)?;
    tracing::info!(path = %output.display(), "sandbox profile written to disk");
    Ok(())
}
