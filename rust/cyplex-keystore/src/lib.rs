//! # cyplex-keystore
//!
//! Encrypted secret storage engine for Agent v0.
//!
//! Secrets are encrypted at rest with AES-256-GCM and the master key is derived
//! from a password via Argon2id.

pub mod crypto;
pub mod error;
pub mod keystore;
pub mod master_key;

pub use error::KeystoreError;
pub use keystore::{KeyEntry, KeyStore};
pub use master_key::MasterKey;

use std::path::Path;

/// Open (load) an existing keystore from disk.
///
/// The master key must have been derived with the same salt stored in the file.
pub fn open(path: &Path, master_key: &MasterKey) -> Result<KeyStore, KeystoreError> {
    KeyStore::load(path, master_key)
}

/// Get a secret value from a keystore by name.
///
/// Returns `None` if the key does not exist.
pub fn get(store: &KeyStore, name: &str) -> Option<Vec<u8>> {
    store.get(name).map(|e| e.value.clone())
}

/// Set (insert or update) a secret in the keystore.
pub fn set(store: &mut KeyStore, name: &str, value: &[u8]) {
    store.set(name, value);
}

/// Rotate a secret: updates its value and marks `rotated_at`.
///
/// This is semantically identical to `set` but makes the intent explicit.
/// Returns an error if the key does not already exist.
pub fn rotate(store: &mut KeyStore, name: &str, new_value: &[u8]) -> Result<(), KeystoreError> {
    if store.get(name).is_none() {
        return Err(KeystoreError::KeyNotFound(name.to_string()));
    }
    store.set(name, new_value);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_api_workflow() {
        let (_master_key, salt) = MasterKey::derive("pw").unwrap();
        let mut store = KeyStore::new(salt);

        set(&mut store, "token", b"abc123");
        assert_eq!(get(&store, "token").unwrap(), b"abc123");

        rotate(&mut store, "token", b"xyz789").unwrap();
        assert_eq!(get(&store, "token").unwrap(), b"xyz789");

        assert!(rotate(&mut store, "nonexistent", b"val").is_err());
    }

    #[test]
    fn open_save_roundtrip() {
        let (master_key, salt) = MasterKey::derive("roundtrip-pw").unwrap();
        let mut store = KeyStore::new(salt.clone());
        set(&mut store, "secret", b"data");

        let dir = std::env::temp_dir().join("cyplex-ks-lib-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("store.keystore");
        store.save(&path, &master_key).unwrap();

        let mk2 = MasterKey::derive_with_salt("roundtrip-pw", &salt).unwrap();
        let loaded = open(&path, &mk2).unwrap();
        assert_eq!(get(&loaded, "secret").unwrap(), b"data");

        std::fs::remove_dir_all(&dir).ok();
    }
}
