use crate::evaluator::PermissionDecision;

/// Enforces outbound network access against an allow-list / deny-list pair.
#[derive(Debug, Clone)]
pub struct NetworkGuard {
    allow_list: Vec<String>,
    deny_list: Vec<String>,
}

impl NetworkGuard {
    /// Create a new guard from allow and deny pattern lists.
    pub fn new(allow: Vec<String>, deny: Vec<String>) -> Self {
        Self {
            allow_list: allow,
            deny_list: deny,
        }
    }

    /// Check whether `host` is permitted.
    ///
    /// The deny list is evaluated first — if any deny pattern matches, the host
    /// is rejected regardless of the allow list. Then the allow list is checked;
    /// the host must match at least one allow pattern to be permitted. An empty
    /// allow list means nothing is allowed.
    pub fn check_host(&self, host: &str) -> PermissionDecision {
        // Deny list takes precedence.
        for pattern in &self.deny_list {
            if matches_pattern(pattern, host) {
                return PermissionDecision::Deny(format!(
                    "host {host} matches deny pattern {pattern}"
                ));
            }
        }

        // Allow list — must match at least one entry.
        if self.allow_list.is_empty() {
            return PermissionDecision::Deny(
                "network allow list is empty; all hosts denied".into(),
            );
        }

        for pattern in &self.allow_list {
            if matches_pattern(pattern, host) {
                return PermissionDecision::Allow;
            }
        }

        PermissionDecision::Deny(format!(
            "host {host} does not match any allowed pattern"
        ))
    }
}

/// Match a host against a pattern that may begin with `*.` to denote a wildcard
/// subdomain match (e.g. `*.example.com` matches `foo.example.com` and
/// `bar.baz.example.com` but not `example.com` itself).
///
/// An exact string match is also supported.
pub fn matches_pattern(pattern: &str, host: &str) -> bool {
    if pattern == "*" {
        return true;
    }

    let host_lower = host.to_ascii_lowercase();

    if let Some(suffix) = pattern.strip_prefix("*.") {
        // Wildcard: host must end with `.suffix` (i.e. be a subdomain).
        // Case-insensitive for domain names (RFC 4343).
        let suffix_lower = suffix.to_ascii_lowercase();
        host_lower.ends_with(&format!(".{suffix_lower}")) || host_lower == suffix_lower
    } else {
        // Exact match (case-insensitive for domain names).
        pattern.eq_ignore_ascii_case(host)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_allow() {
        let guard = NetworkGuard::new(vec!["api.openai.com".into()], vec![]);
        assert!(matches!(guard.check_host("api.openai.com"), PermissionDecision::Allow));
        assert!(matches!(guard.check_host("evil.com"), PermissionDecision::Deny(_)));
    }

    #[test]
    fn wildcard_allow() {
        let guard = NetworkGuard::new(vec!["*.example.com".into()], vec![]);
        assert!(matches!(guard.check_host("foo.example.com"), PermissionDecision::Allow));
        assert!(matches!(guard.check_host("a.b.example.com"), PermissionDecision::Allow));
        assert!(matches!(guard.check_host("example.com"), PermissionDecision::Allow));
        assert!(matches!(guard.check_host("notexample.com"), PermissionDecision::Deny(_)));
    }

    #[test]
    fn deny_overrides_allow() {
        let guard = NetworkGuard::new(
            vec!["*.example.com".into()],
            vec!["evil.example.com".into()],
        );
        assert!(matches!(guard.check_host("evil.example.com"), PermissionDecision::Deny(_)));
        assert!(matches!(guard.check_host("good.example.com"), PermissionDecision::Allow));
    }

    #[test]
    fn empty_allow_denies_all() {
        let guard = NetworkGuard::new(vec![], vec![]);
        assert!(matches!(guard.check_host("anything.com"), PermissionDecision::Deny(_)));
    }
}
