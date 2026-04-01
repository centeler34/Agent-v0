//! # agent-v0-permissions
//!
//! Per-agent permission enforcement engine for Agent v0.
//!
//! Each agent operates under an [`AgentPolicy`] that constrains filesystem
//! access, network egress, API usage, inter-agent communication, and process
//! spawning. The evaluator checks every privileged request against the policy
//! and returns an Allow / Deny decision.

pub mod error;
pub mod evaluator;
pub mod network_guard;
pub mod policy;

// Re-exports for convenience.
pub use error::PermissionError;
pub use evaluator::{evaluate, PermissionDecision, PermissionRequest};
pub use network_guard::NetworkGuard;
pub use policy::AgentPolicy;

/// Check a permission request against a policy, returning the decision.
///
/// This is the primary entry-point for call-sites that only need an
/// Allow / Deny answer.
pub fn check(policy: &AgentPolicy, request: &PermissionRequest) -> PermissionDecision {
    evaluate(policy, request)
}

/// Enforce a permission request against a policy.
///
/// Returns `Ok(())` when the request is allowed, or a
/// [`PermissionError::PermissionDenied`] when it is denied.
pub fn enforce(policy: &AgentPolicy, request: &PermissionRequest) -> Result<(), PermissionError> {
    match evaluate(policy, request) {
        PermissionDecision::Allow => Ok(()),
        PermissionDecision::Deny(reason) => Err(PermissionError::denied(
            &policy.agent_id,
            request,
            reason,
        )),
    }
}

/// Parse an [`AgentPolicy`] from a YAML-formatted string.
///
/// YAML is deliberately parsed via the JSON-compatible subset that
/// `serde_json` can handle after a trivial key-colon-value rewrite, but for
/// real-world use you would pull in `serde_yaml`. Here we accept JSON so the
/// crate compiles without an extra dependency; callers that need YAML can
/// pre-convert or add `serde_yaml` themselves.
pub fn policy_from_yaml(input: &str) -> Result<AgentPolicy, PermissionError> {
    // Accept JSON (a valid YAML subset). For full YAML, callers should
    // add serde_yaml and deserialize directly.
    serde_json::from_str::<AgentPolicy>(input)
        .map_err(|e| PermissionError::PolicyParseError(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn check_returns_allow() {
        let policy = AgentPolicy {
            agent_id: "a".into(),
            fs_read: vec!["/tmp/**".into()],
            ..Default::default()
        };
        assert_eq!(
            check(&policy, &PermissionRequest::FsRead(PathBuf::from("/tmp/x"))),
            PermissionDecision::Allow,
        );
    }

    #[test]
    fn enforce_returns_error_on_deny() {
        let policy = AgentPolicy::default();
        let result = enforce(&policy, &PermissionRequest::AgentSpawn);
        assert!(result.is_err());
    }

    #[test]
    fn policy_from_json_string() {
        let json = r#"{
            "agent_id": "demo",
            "fs_read": ["/data/**"],
            "fs_write": [],
            "fs_execute": false,
            "execute_allowed_binaries": [],
            "network_allow": [],
            "network_deny": [],
            "api_providers": [],
            "api_keys": [],
            "agent_communicate": [],
            "agent_spawn": false
        }"#;
        let policy = policy_from_yaml(json).unwrap();
        assert_eq!(policy.agent_id, "demo");
        assert_eq!(policy.fs_read, vec!["/data/**"]);
    }
}
