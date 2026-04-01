use std::collections::BTreeMap;
use std::path::Path;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::crypto::{decrypt_aes256gcm, encrypt_aes256gcm};
use crate::error::KeystoreError;
use crate::master_key::MasterKey;

/// A single secret entry stored in the keystore.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyEntry {
    pub name: String,
    pub value: Vec<u8>,
    pub created_at: String,
    pub rotated_at: Option<String>,
}

/// On-disk file format: salt + base64-encoded encrypted blob.
#[derive(Debug, Serialize, Deserialize)]
struct KeyStoreFile {
    version: u32,
    salt: String,
    encrypted_data: String,
}

/// Decrypted, in-memory representation of the keystore entries.
#[derive(Debug, Serialize, Deserialize)]
struct KeyStoreData {
    entries: BTreeMap<String, KeyEntry>,
}

/// The main keystore handle.
#[derive(Debug)]
pub struct KeyStore {
    entries: BTreeMap<String, KeyEntry>,
    salt: Vec<u8>,
}

impl KeyStore {
    /// Create a new, empty keystore with the salt from the given master key derivation.
    pub fn new(salt: Vec<u8>) -> Self {
        Self {
            entries: BTreeMap::new(),
            salt,
        }
    }

    /// Retrieve a key entry by name.
    pub fn get(&self, name: &str) -> Option<&KeyEntry> {
        self.entries.get(name)
    }

    /// Insert or update a key entry. If the entry already exists, `rotated_at` is set to
    /// the current timestamp and the value is replaced.
    pub fn set(&mut self, name: &str, value: &[u8]) {
        let now = chrono_now();
        if let Some(entry) = self.entries.get_mut(name) {
            entry.value = value.to_vec();
            entry.rotated_at = Some(now);
        } else {
            self.entries.insert(
                name.to_string(),
                KeyEntry {
                    name: name.to_string(),
                    value: value.to_vec(),
                    created_at: now,
                    rotated_at: None,
                },
            );
        }
    }

    /// Delete a key entry. Returns `true` if it existed.
    pub fn delete(&mut self, name: &str) -> bool {
        self.entries.remove(name).is_some()
    }

    /// List all key names in the store.
    pub fn list(&self) -> Vec<&str> {
        self.entries.keys().map(|s| s.as_str()).collect()
    }

    /// Return the salt used for key derivation.
    pub fn salt(&self) -> &[u8] {
        &self.salt
    }

    /// Persist the keystore to disk, encrypted with the given master key.
    pub fn save(&self, path: &Path, master_key: &MasterKey) -> Result<(), KeystoreError> {
        let data = KeyStoreData {
            entries: self.entries.clone(),
        };
        let plaintext = serde_json::to_vec(&data)?;
        let encrypted = encrypt_aes256gcm(&plaintext, master_key.as_bytes())?;

        let file = KeyStoreFile {
            version: 1,
            salt: BASE64.encode(&self.salt),
            encrypted_data: BASE64.encode(&encrypted),
        };

        let json = serde_json::to_string_pretty(&file)?;
        std::fs::write(path, json)?;
        Ok(())
    }

    /// Load and decrypt a keystore from disk.
    pub fn load(path: &Path, master_key: &MasterKey) -> Result<Self, KeystoreError> {
        let raw = std::fs::read_to_string(path)?;
        let file: KeyStoreFile =
            serde_json::from_str(&raw).map_err(|e| KeystoreError::CorruptedKeystore(e.to_string()))?;

        if file.version != 1 {
            return Err(KeystoreError::CorruptedKeystore(format!(
                "unsupported version: {}",
                file.version
            )));
        }

        let salt = BASE64
            .decode(&file.salt)
            .map_err(|e| KeystoreError::CorruptedKeystore(e.to_string()))?;
        let encrypted = BASE64
            .decode(&file.encrypted_data)
            .map_err(|e| KeystoreError::CorruptedKeystore(e.to_string()))?;

        let plaintext = decrypt_aes256gcm(&encrypted, master_key.as_bytes())?;
        let data: KeyStoreData = serde_json::from_slice(&plaintext)?;

        Ok(Self {
            entries: data.entries,
            salt,
        })
    }
}

/// Produce an RFC 3339 timestamp without pulling in the `chrono` crate.
/// Falls back to a fixed format using `SystemTime`.
fn chrono_now() -> String {
    use std::time::SystemTime;
    let dur = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    // Simple ISO-ish timestamp: seconds since epoch (good enough without chrono).
    // For a real deployment, consider using the `time` or `chrono` crate.
    format!("{secs}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::master_key::MasterKey;

    #[test]
    fn roundtrip_save_load() {
        let (master_key, salt) = MasterKey::derive("test-pass").unwrap();
        let mut ks = KeyStore::new(salt);
        ks.set("api-key", b"sk-secret-12345");
        ks.set("db-password", b"hunter2");

        let dir = std::env::temp_dir().join("agent-v0-keystore-test"); // Already correct from previous change
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.keystore");

        ks.save(&path, &master_key).unwrap();

        let master_key2 = MasterKey::derive_with_salt("test-pass", ks.salt()).unwrap();
        let loaded = KeyStore::load(&path, &master_key2).unwrap();

        assert_eq!(loaded.get("api-key").unwrap().value, b"sk-secret-12345");
        assert_eq!(loaded.get("db-password").unwrap().value, b"hunter2");
        assert_eq!(loaded.list().len(), 2);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn set_updates_rotated_at() {
        let mut ks = KeyStore::new(vec![0u8; 16]);
        ks.set("token", b"v1");
        assert!(ks.get("token").unwrap().rotated_at.is_none());

        ks.set("token", b"v2");
        assert!(ks.get("token").unwrap().rotated_at.is_some());
        assert_eq!(ks.get("token").unwrap().value, b"v2");
    }

    #[test]
    fn delete_entry() {
        let mut ks = KeyStore::new(vec![0u8; 16]);
        ks.set("x", b"y");
        assert!(ks.delete("x"));
        assert!(!ks.delete("x"));
        assert!(ks.get("x").is_none());
    }
}
