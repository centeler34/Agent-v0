//! HMAC-SHA256 functions for bot webhook verification.

use ::hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Error returned when HMAC operations fail.
#[derive(Debug)]
pub enum HmacError {
    InvalidKey(String),
}

impl std::fmt::Display for HmacError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HmacError::InvalidKey(msg) => write!(f, "HMAC key error: {}", msg),
        }
    }
}

impl std::error::Error for HmacError {}

/// Compute the HMAC-SHA256 of `message` using the given `key`.
///
/// Returns the raw MAC bytes as a `Vec<u8>`, or an error if key initialization fails.
pub fn compute_hmac_sha256(key: &[u8], message: &[u8]) -> Result<Vec<u8>, HmacError> {
    let mut mac = HmacSha256::new_from_slice(key)
        .map_err(|e| HmacError::InvalidKey(e.to_string()))?;
    mac.update(message);
    Ok(mac.finalize().into_bytes().to_vec())
}

/// Verify that `signature` is the correct HMAC-SHA256 of `message` under `key`.
///
/// Uses constant-time comparison to prevent timing attacks.
pub fn verify_hmac_sha256(key: &[u8], message: &[u8], signature: &[u8]) -> Result<bool, HmacError> {
    let mut mac = HmacSha256::new_from_slice(key)
        .map_err(|e| HmacError::InvalidKey(e.to_string()))?;
    mac.update(message);
    Ok(mac.verify_slice(signature).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let key = b"secret-key";
        let message = b"hello world";
        let mac = compute_hmac_sha256(key, message).unwrap();
        assert!(verify_hmac_sha256(key, message, &mac).unwrap());
    }

    #[test]
    fn wrong_signature_rejected() {
        let key = b"secret-key";
        let message = b"hello world";
        let bad_sig = vec![0u8; 32];
        assert!(!verify_hmac_sha256(key, message, &bad_sig).unwrap());
    }

    #[test]
    fn wrong_key_rejected() {
        let key = b"secret-key";
        let message = b"hello world";
        let mac = compute_hmac_sha256(key, message).unwrap();
        assert!(!verify_hmac_sha256(b"wrong-key", message, &mac).unwrap());
    }
}
