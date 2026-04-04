use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, AeadCore, Nonce};
use rand::rngs::OsRng;
use argon2::{Algorithm, Argon2, Params, Version};

use crate::error::KeystoreError;

/// Encrypt plaintext with AES-256-GCM. Returns nonce (12 bytes) prepended to ciphertext.
pub fn encrypt_aes256gcm(plaintext: &[u8], key: &[u8]) -> Result<Vec<u8>, KeystoreError> {
    if key.len() != 32 {
        return Err(KeystoreError::EncryptionFailed(
            "key must be 32 bytes".into(),
        ));
    }

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| KeystoreError::EncryptionFailed(e.to_string()))?;

    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| KeystoreError::EncryptionFailed(e.to_string()))?;

    let mut output = Vec::with_capacity(12 + ciphertext.len());
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

/// Decrypt ciphertext produced by `encrypt_aes256gcm`. Expects nonce prepended to ciphertext.
pub fn decrypt_aes256gcm(ciphertext: &[u8], key: &[u8]) -> Result<Vec<u8>, KeystoreError> {
    if key.len() != 32 {
        return Err(KeystoreError::DecryptionFailed(
            "key must be 32 bytes".into(),
        ));
    }
    if ciphertext.len() < 12 {
        return Err(KeystoreError::DecryptionFailed(
            "ciphertext too short to contain nonce".into(),
        ));
    }

    let (nonce_bytes, ct) = ciphertext.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| KeystoreError::DecryptionFailed(e.to_string()))?;

    cipher
        .decrypt(nonce, ct)
        .map_err(|e| KeystoreError::DecryptionFailed(e.to_string()))
}

/// Derive a 32-byte key from a password and salt using Argon2id.
///
/// Parameters: memory 64 MB, iterations 3, parallelism 4.
pub fn derive_key_argon2id(password: &[u8], salt: &[u8]) -> Result<[u8; 32], KeystoreError> {
    let params = Params::new(
        64 * 1024, // 64 MB in KiB
        3,         // iterations
        4,         // parallelism
        Some(32),  // output length
    )
    .map_err(|e| KeystoreError::KeyDerivationFailed(e.to_string()))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut output = [0u8; 32];
    argon2
        .hash_password_into(password, salt, &mut output)
        .map_err(|e| KeystoreError::KeyDerivationFailed(e.to_string()))?;

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::OsRng;
    use rand::Rng;

    fn generate_test_key() -> [u8; 32] {
        let mut key = [0u8; 32];
        OsRng.fill(&mut key);
        key
    }

    #[test]
    fn roundtrip_encrypt_decrypt() {
        let key = generate_test_key();
        let plaintext = b"hello, cyplex keystore";
        let encrypted = encrypt_aes256gcm(plaintext, &key).unwrap();
        let decrypted = decrypt_aes256gcm(&encrypted, &key).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn derive_key_deterministic() {
        let password = b"test-password";
        let salt = b"sixteen-byte-sal"; // 16 bytes
        let k1 = derive_key_argon2id(password, salt).unwrap();
        let k2 = derive_key_argon2id(password, salt).unwrap();
        assert_eq!(k1, k2);
    }

    #[test]
    fn wrong_key_fails() {
        let key = generate_test_key();
        let wrong_key = generate_test_key();
        let encrypted = encrypt_aes256gcm(b"secret", &key).unwrap();
        assert!(decrypt_aes256gcm(&encrypted, &wrong_key).is_err());
    }
}
