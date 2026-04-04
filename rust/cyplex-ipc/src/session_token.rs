use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;

/// A session token used to authenticate CLI connections to the daemon.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionToken {
    pub token: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub user_id: String,
}

impl SessionToken {
    /// Generate a new session token for the given user with the specified TTL
    /// in hours.
    pub fn generate(user_id: &str, ttl_hours: u64) -> Self {
        let now = Utc::now();
        let expires_at = now + Duration::hours(ttl_hours as i64);

        Self {
            token: uuid::Uuid::new_v4().to_string(),
            created_at: now,
            expires_at,
            user_id: user_id.to_string(),
        }
    }

    /// Returns `true` if the token has not yet expired.
    pub fn is_valid(&self) -> bool {
        Utc::now() < self.expires_at
    }

    /// Validate a raw token string against a stored `SessionToken`.
    ///
    /// Returns `true` if the strings match and the token has not expired.
    /// Uses constant-time comparison to prevent timing attacks.
    pub fn validate(token_str: &str, stored: &SessionToken) -> bool {
        let token_match = stored.token.as_bytes().ct_eq(token_str.as_bytes()).into();
        token_match && stored.is_valid()
    }
}
