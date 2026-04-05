use std::path::PathBuf;

/// Errors that can occur during sandbox operations.
#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    #[error("namespace setup failed: {0}")]
    NamespaceSetupFailed(String),

    #[error("seccomp filter application failed: {0}")]
    SeccompFailed(String),

    #[error("path violation: {path} is outside workspace root {workspace_root}")]
    PathViolation {
        path: PathBuf,
        workspace_root: PathBuf,
    },

    #[error("bubblewrap execution failed: {0}")]
    BubblewrapFailed(String),

    #[error("sandbox-exec (macOS) execution failed: {0}")]
    SandboxExecFailed(String),

    #[error("unsupported platform: {0}")]
    UnsupportedPlatform(String),

    #[error("I/O error: {0}")]
    IoError(#[from] std::io::Error),
}
