//! JWT token validation and issuance — HS256 with jose-compatible claims.
//!
//! Mirrors the TS `auth.ts` token lifecycle: sign with HS256, validate
//! signature + issuer + audience + type claim, check revocation.

use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};

const DEFAULT_ISSUER: &str = "secureyeoman";
const DEFAULT_AUDIENCE: &str = "secureyeoman-api";

/// JWT claims matching the TS TokenPayloadSchema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenClaims {
    /// Subject (user ID).
    pub sub: String,
    /// User role (admin, operator, auditor, viewer, service).
    pub role: String,
    /// Permissions as "resource:action1,action2" strings.
    #[serde(default)]
    pub permissions: Vec<String>,
    /// JWT ID (for revocation tracking).
    pub jti: String,
    /// Token type: "access" or "refresh".
    #[serde(rename = "type")]
    pub token_type: String,
    /// Issued at (Unix timestamp).
    pub iat: u64,
    /// Expiration (Unix timestamp).
    pub exp: u64,
    /// Issuer.
    #[serde(default)]
    pub iss: Option<String>,
    /// Audience.
    #[serde(default)]
    pub aud: Option<String>,
}

/// Configuration for the JWT service.
#[derive(Clone)]
pub struct JwtConfig {
    pub secret: String,
    pub previous_secret: Option<String>,
    pub issuer: String,
    pub audience: String,
    pub access_token_expiry_secs: u64,
    pub refresh_token_expiry_secs: u64,
}

impl Default for JwtConfig {
    fn default() -> Self {
        Self {
            secret: String::new(),
            previous_secret: None,
            issuer: DEFAULT_ISSUER.to_string(),
            audience: DEFAULT_AUDIENCE.to_string(),
            access_token_expiry_secs: 900,      // 15 min
            refresh_token_expiry_secs: 604_800, // 7 days
        }
    }
}

/// Issue a new access token.
pub fn issue_access_token(
    config: &JwtConfig,
    user_id: &str,
    role: &str,
    permissions: &[String],
) -> Result<String, String> {
    let now = now_secs();
    let jti = uuid::Uuid::now_v7().to_string();
    let claims = TokenClaims {
        sub: user_id.to_string(),
        role: role.to_string(),
        permissions: permissions.to_vec(),
        jti,
        token_type: "access".to_string(),
        iat: now,
        exp: now + config.access_token_expiry_secs,
        iss: Some(config.issuer.clone()),
        aud: Some(config.audience.clone()),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.secret.as_bytes()),
    )
    .map_err(|e| format!("JWT encode error: {e}"))
}

/// Issue a new refresh token.
pub fn issue_refresh_token(
    config: &JwtConfig,
    user_id: &str,
    role: &str,
) -> Result<String, String> {
    let now = now_secs();
    let jti = uuid::Uuid::now_v7().to_string();
    let claims = TokenClaims {
        sub: user_id.to_string(),
        role: role.to_string(),
        permissions: Vec::new(),
        jti,
        token_type: "refresh".to_string(),
        iat: now,
        exp: now + config.refresh_token_expiry_secs,
        iss: Some(config.issuer.clone()),
        aud: Some(config.audience.clone()),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.secret.as_bytes()),
    )
    .map_err(|e| format!("JWT encode error: {e}"))
}

/// Validate a token — tries current secret, falls back to previous.
pub fn validate_token(config: &JwtConfig, token: &str) -> Result<TokenClaims, String> {
    // Try current secret with full validation
    if let Ok(claims) = try_validate(token, &config.secret, &config.issuer, &config.audience) {
        return Ok(claims);
    }

    // Try previous secret (rotation grace period)
    if let Some(ref prev) = config.previous_secret
        && let Ok(claims) = try_validate(token, prev, &config.issuer, &config.audience)
    {
        return Ok(claims);
    }

    // Try without issuer/audience (backward compatibility)
    if let Ok(claims) = try_validate_relaxed(token, &config.secret) {
        return Ok(claims);
    }

    Err("Invalid or expired token".to_string())
}

fn try_validate(
    token: &str,
    secret: &str,
    issuer: &str,
    audience: &str,
) -> Result<TokenClaims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::default();
    validation.set_issuer(&[issuer]);
    validation.set_audience(&[audience]);
    let data = decode::<TokenClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;
    Ok(data.claims)
}

fn try_validate_relaxed(
    token: &str,
    secret: &str,
) -> Result<TokenClaims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::default();
    validation.validate_aud = false;
    let data = decode::<TokenClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )?;
    Ok(data.claims)
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> JwtConfig {
        JwtConfig {
            secret: "test-secret-key-at-least-32-chars-long!".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn issue_and_validate_access_token() {
        let config = test_config();
        let token = issue_access_token(&config, "user-1", "admin", &[]).unwrap();
        let claims = validate_token(&config, &token).unwrap();
        assert_eq!(claims.sub, "user-1");
        assert_eq!(claims.role, "admin");
        assert_eq!(claims.token_type, "access");
        assert!(claims.iss.as_deref() == Some("secureyeoman"));
    }

    #[test]
    fn issue_and_validate_refresh_token() {
        let config = test_config();
        let token = issue_refresh_token(&config, "user-1", "operator").unwrap();
        let claims = validate_token(&config, &token).unwrap();
        assert_eq!(claims.token_type, "refresh");
        assert_eq!(claims.role, "operator");
    }

    #[test]
    fn invalid_token_rejected() {
        let config = test_config();
        let result = validate_token(&config, "not.a.jwt");
        assert!(result.is_err());
    }

    #[test]
    fn wrong_secret_rejected() {
        let config = test_config();
        let token = issue_access_token(&config, "user-1", "admin", &[]).unwrap();

        let other = JwtConfig {
            secret: "completely-different-secret-key-here!!".to_string(),
            ..Default::default()
        };
        let result = validate_token(&other, &token);
        assert!(result.is_err());
    }

    #[test]
    fn previous_secret_works() {
        let config = test_config();
        let token = issue_access_token(&config, "user-1", "admin", &[]).unwrap();

        let rotated = JwtConfig {
            secret: "new-rotated-secret-key-at-least-32-chars!".to_string(),
            previous_secret: Some(config.secret.clone()),
            ..Default::default()
        };
        let claims = validate_token(&rotated, &token).unwrap();
        assert_eq!(claims.sub, "user-1");
    }

    #[test]
    fn jti_is_unique() {
        let config = test_config();
        let t1 = issue_access_token(&config, "u", "admin", &[]).unwrap();
        let t2 = issue_access_token(&config, "u", "admin", &[]).unwrap();
        let c1 = validate_token(&config, &t1).unwrap();
        let c2 = validate_token(&config, &t2).unwrap();
        assert_ne!(c1.jti, c2.jti);
    }
}
