//! Cryptographically secure random number generation.

use rand::rngs::OsRng;
use rand::Rng;

/// Generate `len` cryptographically secure random bytes.
/// Uses OsRng (OS-level CSPRNG) for all security-sensitive randomness.
pub fn generate_random_bytes(len: usize) -> Vec<u8> {
    let mut buf = vec![0u8; len];
    OsRng.fill(&mut buf[..]);
    buf
}

/// Generate a UUID v4 string (random-based).
///
/// Format: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`
/// where `y` is one of `8`, `9`, `a`, `b`.
pub fn generate_uuid_v4() -> String {
    let mut rng = OsRng;
    let mut bytes = [0u8; 16];
    rng.fill(&mut bytes);

    // Set version (4) and variant (RFC 4122) bits.
    bytes[6] = (bytes[6] & 0x0F) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3F) | 0x80; // variant 10

    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
        u16::from_be_bytes([bytes[4], bytes[5]]),
        u16::from_be_bytes([bytes[6], bytes[7]]),
        u16::from_be_bytes([bytes[8], bytes[9]]),
        // Last 6 bytes as a u64 (only lower 48 bits used)
        u64::from_be_bytes([0, 0, bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]]),
    )
}

/// Generate a session token: 32 random bytes, hex-encoded (64 hex chars).
pub fn generate_session_token() -> String {
    let bytes = generate_random_bytes(32);
    hex_encode(&bytes)
}

/// Encode bytes as lowercase hexadecimal.
fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_bytes_length() {
        assert_eq!(generate_random_bytes(0).len(), 0);
        assert_eq!(generate_random_bytes(16).len(), 16);
        assert_eq!(generate_random_bytes(64).len(), 64);
    }

    #[test]
    fn random_bytes_not_all_zero() {
        // Vanishingly small chance of 32 random bytes all being zero.
        let bytes = generate_random_bytes(32);
        assert!(bytes.iter().any(|&b| b != 0));
    }

    #[test]
    fn uuid_v4_format() {
        let uuid = generate_uuid_v4();
        assert_eq!(uuid.len(), 36);
        let parts: Vec<&str> = uuid.split('-').collect();
        assert_eq!(parts.len(), 5);
        assert_eq!(parts[0].len(), 8);
        assert_eq!(parts[1].len(), 4);
        assert_eq!(parts[2].len(), 4);
        assert_eq!(parts[3].len(), 4);
        assert_eq!(parts[4].len(), 12);
        // Version nibble must be '4'.
        assert_eq!(parts[2].chars().next().unwrap(), '4');
        // Variant nibble must be 8, 9, a, or b.
        let variant = parts[3].chars().next().unwrap();
        assert!(
            variant == '8' || variant == '9' || variant == 'a' || variant == 'b',
            "variant nibble was '{}'",
            variant
        );
    }

    #[test]
    fn session_token_format() {
        let token = generate_session_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn session_tokens_are_unique() {
        let t1 = generate_session_token();
        let t2 = generate_session_token();
        assert_ne!(t1, t2);
    }
}
