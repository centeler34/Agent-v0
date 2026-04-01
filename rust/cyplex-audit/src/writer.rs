use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write as IoWrite};
use std::path::Path;

use crate::chain::build_chain_hash;
use crate::error::AuditError;
use crate::log_entry::LogEntry;

/// Append-only audit log writer.
///
/// Maintains the hash of the last written entry so new entries can be chained.
pub struct AuditWriter {
    file: File,
    last_hash: String,
}

/// The genesis sentinel — 64 hex zeros — used as `prev_hash` for the very
/// first entry in a log file.
const GENESIS_HASH: &str =
    "0000000000000000000000000000000000000000000000000000000000000000";

impl AuditWriter {
    /// Open (or create) an audit log file at `path`.
    ///
    /// If the file already contains entries the writer reads the last line to
    /// recover `last_hash` so new entries are chained correctly.
    pub fn open(path: &Path) -> Result<Self, AuditError> {
        // Ensure the file exists so we can read it first.
        if !path.exists() {
            File::create(path)?;
        }

        // Scan for the last valid entry to recover last_hash.
        let last_hash = {
            let reader = BufReader::new(File::open(path)?);
            let mut last = None;
            for line in reader.lines() {
                let line = line?;
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                last = Some(trimmed.to_string());
            }
            match last {
                Some(json_line) => {
                    let entry: LogEntry = serde_json::from_str(&json_line)
                        .map_err(|_| AuditError::CorruptedLog {
                            reason: "last line is not valid JSON".into(),
                        })?;
                    entry.entry_hash
                }
                None => GENESIS_HASH.to_string(),
            }
        };

        let file = OpenOptions::new().append(true).open(path)?;

        Ok(Self { file, last_hash })
    }

    /// Append a log entry to the file.
    ///
    /// The caller supplies a `LogEntry` with all domain fields populated;
    /// `prev_hash` and `entry_hash` are set by the writer to maintain the
    /// hash chain.  After writing the JSON line the file is fsynced.
    pub fn write(&mut self, mut entry: LogEntry) -> Result<(), AuditError> {
        entry.prev_hash = self.last_hash.clone();
        entry.entry_hash = build_chain_hash(&entry.prev_hash, &entry);

        let mut json = serde_json::to_string(&entry)?;
        json.push('\n');

        self.file.write_all(json.as_bytes())?;
        self.file.flush()?;
        self.file.sync_all()?;

        self.last_hash = entry.entry_hash;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chain::verify_chain;
    use crate::log_entry::{Outcome, SourceChannel};
    use std::io::BufRead;

    fn blank_entry() -> LogEntry {
        LogEntry {
            log_id: uuid::Uuid::new_v4().to_string(),
            prev_hash: String::new(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            session_id: "sess".into(),
            agent_id: "agent".into(),
            action_type: "test.write".into(),
            action_detail: serde_json::json!({"x": 1}),
            permissions_checked: vec!["write".into()],
            outcome: Outcome::Success,
            user_id: None,
            source_channel: SourceChannel::Cli,
            entry_hash: String::new(),
        }
    }

    #[test]
    fn write_and_verify_round_trip() {
        let dir = std::env::temp_dir().join("agent_v0_audit_test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("test.jsonl");
        let _ = std::fs::remove_file(&path);

        {
            let mut w = AuditWriter::open(&path).unwrap();
            w.write(blank_entry()).unwrap();
            w.write(blank_entry()).unwrap();
            w.write(blank_entry()).unwrap();
        }

        // Re-open and append one more.
        {
            let mut w = AuditWriter::open(&path).unwrap();
            w.write(blank_entry()).unwrap();
        }

        // Read all entries and verify the chain.
        let file = File::open(&path).unwrap();
        let entries: Vec<LogEntry> = BufReader::new(file)
            .lines()
            .map(|l| serde_json::from_str(&l.unwrap()).unwrap())
            .collect();

        assert_eq!(entries.len(), 4);
        assert!(verify_chain(&entries).unwrap());

        let _ = std::fs::remove_file(&path);
    }
}
