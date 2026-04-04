use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Outcome of the audited action.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Outcome {
    Success,
    Denied,
    Error,
}

/// Channel from which the action originated.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SourceChannel {
    Cli,
    Telegram,
    Discord,
    Whatsapp,
    Api,
}

/// A single audit-log entry.
///
/// Every field except `entry_hash` is covered by the SHA-256 digest stored in
/// `entry_hash`.  The `prev_hash` field links this entry to its predecessor,
/// forming a hash chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub log_id: String,
    pub prev_hash: String,
    pub timestamp: String,
    pub session_id: String,
    pub agent_id: String,
    pub action_type: String,
    pub action_detail: serde_json::Value,
    pub permissions_checked: Vec<String>,
    pub outcome: Outcome,
    pub user_id: Option<String>,
    pub source_channel: SourceChannel,
    pub entry_hash: String,
}

impl LogEntry {
    /// Compute the SHA-256 hash over every field **except** `entry_hash`.
    ///
    /// The hash is returned as a lowercase hex string. Falls back to hashing a
    /// concatenation of field values if JSON serialization fails unexpectedly.
    pub fn compute_hash(&self) -> String {
        // Build a canonical representation that excludes entry_hash.
        let canonical = serde_json::json!({
            "log_id": self.log_id,
            "prev_hash": self.prev_hash,
            "timestamp": self.timestamp,
            "session_id": self.session_id,
            "agent_id": self.agent_id,
            "action_type": self.action_type,
            "action_detail": self.action_detail,
            "permissions_checked": self.permissions_checked,
            "outcome": self.outcome,
            "user_id": self.user_id,
            "source_channel": self.source_channel,
        });

        let serialized = match serde_json::to_string(&canonical) {
            Ok(s) => s,
            Err(_) => {
                // Fallback: concatenate fields directly for hashing.
                format!(
                    "{}:{}:{}:{}:{}:{}:{:?}:{:?}:{:?}:{:?}:{:?}",
                    self.log_id, self.prev_hash, self.timestamp,
                    self.session_id, self.agent_id, self.action_type,
                    self.action_detail, self.permissions_checked,
                    self.outcome, self.user_id, self.source_channel,
                )
            }
        };

        let digest = Sha256::digest(serialized.as_bytes());
        hex::encode(digest)
    }
}

/// Tiny vendored hex-encode so we avoid pulling in another crate.
mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes
            .as_ref()
            .iter()
            .fold(String::new(), |mut s, b| {
                use std::fmt::Write;
                let _ = write!(s, "{:02x}", b);
                s
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_entry() -> LogEntry {
        LogEntry {
            log_id: "00000000-0000-0000-0000-000000000001".into(),
            prev_hash: "0".repeat(64),
            timestamp: "2026-01-01T00:00:00Z".into(),
            session_id: "sess-1".into(),
            agent_id: "agent-1".into(),
            action_type: "test.ping".into(),
            action_detail: serde_json::json!({"msg": "hello"}),
            permissions_checked: vec!["read".into()],
            outcome: Outcome::Success,
            user_id: Some("user-42".into()),
            source_channel: SourceChannel::Cli,
            entry_hash: String::new(),
        }
    }

    #[test]
    fn hash_is_deterministic() {
        let e = sample_entry();
        assert_eq!(e.compute_hash(), e.compute_hash());
    }

    #[test]
    fn hash_ignores_entry_hash_field() {
        let mut a = sample_entry();
        let mut b = sample_entry();
        a.entry_hash = "aaa".into();
        b.entry_hash = "bbb".into();
        assert_eq!(a.compute_hash(), b.compute_hash());
    }
}
