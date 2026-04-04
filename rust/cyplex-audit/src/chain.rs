use crate::error::AuditError;
use crate::log_entry::LogEntry;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

/// Build the chain hash that links `entry` to its predecessor.
///
/// This hashes the concatenation of `prev_hash` and the entry's own
/// `compute_hash()` value, producing the value that should be stored in
/// `entry.entry_hash`.
pub fn build_chain_hash(prev_hash: &str, entry: &LogEntry) -> String {
    let inner = entry.compute_hash();
    let combined = format!("{}{}", prev_hash, inner);
    let digest = Sha256::digest(combined.as_bytes());
    hex_encode(&digest)
}

/// Verify an entire chain of log entries.
///
/// Returns `Ok(true)` when every entry's `prev_hash` matches the preceding
/// entry's `entry_hash` **and** every `entry_hash` is correct.
///
/// The first entry in the chain must have `prev_hash` equal to 64 zero
/// characters (the genesis sentinel) or the hash of the preceding entry
/// that is outside the supplied slice.
pub fn verify_chain(entries: &[LogEntry]) -> Result<bool, AuditError> {
    if entries.is_empty() {
        return Ok(true);
    }

    // Verify the first entry's own hash.
    if !verify_single(&entries[0]) {
        return Err(AuditError::CorruptedLog {
            reason: format!(
                "entry 0 (log_id={}) has an invalid entry_hash",
                entries[0].log_id
            ),
        });
    }

    for i in 1..entries.len() {
        // Each entry's prev_hash must equal the prior entry's entry_hash.
        if entries[i].prev_hash != entries[i - 1].entry_hash {
            return Err(AuditError::ChainIntegrityViolation {
                index: i,
                expected: entries[i - 1].entry_hash.clone(),
                actual: entries[i].prev_hash.clone(),
            });
        }

        if !verify_single(&entries[i]) {
            return Err(AuditError::CorruptedLog {
                reason: format!(
                    "entry {} (log_id={}) has an invalid entry_hash",
                    i, entries[i].log_id
                ),
            });
        }
    }

    Ok(true)
}

/// Check whether a single entry's `entry_hash` matches its recomputed hash.
/// Uses constant-time comparison to prevent timing side-channel attacks.
pub fn verify_single(entry: &LogEntry) -> bool {
    let expected = build_chain_hash(&entry.prev_hash, entry);
    expected.as_bytes().ct_eq(entry.entry_hash.as_bytes()).into()
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut s, b| {
        use std::fmt::Write;
        let _ = write!(s, "{:02x}", b);
        s
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::log_entry::{Outcome, SourceChannel};

    fn make_entry(log_id: &str, prev_hash: &str) -> LogEntry {
        let mut entry = LogEntry {
            log_id: log_id.into(),
            prev_hash: prev_hash.into(),
            timestamp: "2026-01-01T00:00:00Z".into(),
            session_id: "s1".into(),
            agent_id: "a1".into(),
            action_type: "test".into(),
            action_detail: serde_json::json!(null),
            permissions_checked: vec![],
            outcome: Outcome::Success,
            user_id: None,
            source_channel: SourceChannel::Api,
            entry_hash: String::new(),
        };
        entry.entry_hash = build_chain_hash(prev_hash, &entry);
        entry
    }

    #[test]
    fn single_entry_verifies() {
        let genesis = "0".repeat(64);
        let e = make_entry("1", &genesis);
        assert!(verify_single(&e));
    }

    #[test]
    fn chain_of_two_verifies() {
        let genesis = "0".repeat(64);
        let e0 = make_entry("0", &genesis);
        let e1 = make_entry("1", &e0.entry_hash);
        assert!(verify_chain(&[e0, e1]).unwrap());
    }

    #[test]
    fn tampered_entry_fails() {
        let genesis = "0".repeat(64);
        let e0 = make_entry("0", &genesis);
        let mut e1 = make_entry("1", &e0.entry_hash);
        e1.action_type = "tampered".into(); // change without recomputing hash
        assert!(verify_chain(&[e0, e1]).is_err());
    }
}
