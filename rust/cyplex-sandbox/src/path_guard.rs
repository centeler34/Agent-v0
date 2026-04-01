use std::path::{Path, PathBuf};

use crate::error::SandboxError;

/// Enforces that all file-system access stays within a designated workspace root.
#[derive(Debug, Clone)]
pub struct PathGuard {
    /// The canonicalized workspace root directory.
    workspace_root: PathBuf,
}

impl PathGuard {
    /// Create a new `PathGuard` for the given workspace root.
    ///
    /// The root path is canonicalized at construction time so that later
    /// comparisons are reliable even when symlinks are involved.
    pub fn new(workspace_root: impl Into<PathBuf>) -> Result<Self, SandboxError> {
        let raw: PathBuf = workspace_root.into();
        let canonical = raw.canonicalize().map_err(|e| {
            SandboxError::IoError(std::io::Error::new(
                e.kind(),
                format!("failed to canonicalize workspace root {}: {e}", raw.display()),
            ))
        })?;
        Ok(Self {
            workspace_root: canonical,
        })
    }

    /// Return the canonicalized workspace root.
    pub fn workspace_root(&self) -> &Path {
        &self.workspace_root
    }

    /// Canonicalize `requested` and verify it falls within the workspace root.
    ///
    /// Returns the canonicalized path on success or a `PathViolation` error if
    /// the path escapes the workspace boundary.
    pub fn validate_path(&self, requested: &Path) -> Result<PathBuf, SandboxError> {
        let canonical = requested.canonicalize().map_err(SandboxError::IoError)?;

        if canonical.starts_with(&self.workspace_root) {
            Ok(canonical)
        } else {
            Err(SandboxError::PathViolation {
                path: canonical,
                workspace_root: self.workspace_root.clone(),
            })
        }
    }

    /// Check whether `path` is within the workspace root without returning the
    /// canonical form.
    pub fn is_within_workspace(&self, path: &Path) -> bool {
        match path.canonicalize() {
            Ok(canonical) => canonical.starts_with(&self.workspace_root),
            Err(_) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn valid_path_inside_workspace() {
        let dir = std::env::temp_dir().join("agent_v0_pg_test"); // Already correct from previous change
        let _ = fs::create_dir_all(&dir);

        let inner = dir.join("subdir");
        let _ = fs::create_dir_all(&inner);

        let guard = PathGuard::new(&dir).unwrap();
        assert!(guard.validate_path(&inner).is_ok());
        assert!(guard.is_within_workspace(&inner));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn path_outside_workspace_rejected() {
        let dir = std::env::temp_dir().join("agent_v0_pg_test2"); // Already correct from previous change
        let _ = fs::create_dir_all(&dir);

        let guard = PathGuard::new(&dir).unwrap();
        // /tmp itself is outside the workspace subdirectory
        let outside = std::env::temp_dir();
        if outside != dir {
            assert!(guard.validate_path(&outside).is_err());
            assert!(!guard.is_within_workspace(&outside));
        }

        let _ = fs::remove_dir_all(&dir);
    }
}
