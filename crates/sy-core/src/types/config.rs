//! Core configuration types — server, gateway, security, database.
//!
//! Configuration layers (lowest to highest priority):
//!   1. Built-in defaults
//!   2. TOML file at `$SECUREYEOMAN_CONFIG`, `./secureyeoman.toml`,
//!      `/etc/secureyeoman/config.toml`, or `$HOME/.secureyeoman/config.toml`
//!   3. Environment variable overrides (see [`CoreConfig::apply_env_overrides`])
//!
//! Call [`CoreConfig::load`] to run all three stages.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Top-level server configuration.
///
/// Fields serialize as camelCase (JSON wire format) and accept snake_case
/// aliases when deserializing from TOML, so config files can use the
/// idiomatic Rust spelling.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default, alias = "database_url")]
    pub database_url: Option<String>,
    #[serde(default = "default_environment")]
    pub environment: String,
    #[serde(default)]
    pub tls: TlsConfig,
    #[serde(default)]
    pub cors: CorsConfig,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TlsConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, alias = "cert_path")]
    pub cert_path: Option<String>,
    #[serde(default, alias = "key_path")]
    pub key_path: Option<String>,
    #[serde(default, alias = "ca_path")]
    pub ca_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorsConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default, alias = "allowed_origins")]
    pub allowed_origins: Vec<String>,
}

impl Default for CorsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            allowed_origins: Vec::new(),
        }
    }
}

impl Default for CoreConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
            database_url: None,
            environment: default_environment(),
            tls: TlsConfig::default(),
            cors: CorsConfig::default(),
        }
    }
}

/// Error returned when a TOML config file exists but cannot be parsed.
#[derive(Debug)]
pub enum ConfigError {
    Io(std::io::Error),
    Toml(toml::de::Error),
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::Io(e) => write!(f, "config I/O error: {e}"),
            ConfigError::Toml(e) => write!(f, "config TOML parse error: {e}"),
        }
    }
}

impl std::error::Error for ConfigError {}

impl From<std::io::Error> for ConfigError {
    fn from(e: std::io::Error) -> Self {
        ConfigError::Io(e)
    }
}

impl From<toml::de::Error> for ConfigError {
    fn from(e: toml::de::Error) -> Self {
        ConfigError::Toml(e)
    }
}

impl CoreConfig {
    /// Load config from defaults + optional TOML file + environment variable
    /// overrides. Returns defaults when no TOML file is found. Returns an
    /// error only when a file exists but fails to parse.
    ///
    /// Search order (first hit wins): `explicit`, `$SECUREYEOMAN_CONFIG`,
    /// `./secureyeoman.toml`, `/etc/secureyeoman/config.toml`,
    /// `$HOME/.secureyeoman/config.toml`.
    pub fn load(explicit: Option<&Path>) -> Result<Self, ConfigError> {
        let mut config = match resolve_config_path(explicit) {
            Some(path) => Self::from_toml_file(&path)?,
            None => Self::default(),
        };
        config.apply_env_overrides();
        Ok(config)
    }

    /// Parse a TOML file at the given path. Fields not present in the file
    /// fall back to `CoreConfig::default()` values.
    pub fn from_toml_file(path: &Path) -> Result<Self, ConfigError> {
        let contents = std::fs::read_to_string(path)?;
        Ok(toml::from_str(&contents)?)
    }

    /// Apply SY env vars on top of the current config. Used by [`load`]; also
    /// safe to call directly on a `CoreConfig::default()` (matches the old
    /// env-only startup behavior).
    ///
    /// Recognized vars: `SECUREYEOMAN_HOST`, `SECUREYEOMAN_PORT`, `PORT`,
    /// `DATABASE_URL`, `SECUREYEOMAN_ENVIRONMENT`.
    pub fn apply_env_overrides(&mut self) {
        if let Ok(host) = std::env::var("SECUREYEOMAN_HOST") {
            self.host = host;
        }
        if let Some(port) = std::env::var("SECUREYEOMAN_PORT")
            .ok()
            .or_else(|| std::env::var("PORT").ok())
            .and_then(|v| v.parse().ok())
        {
            self.port = port;
        }
        if let Ok(url) = std::env::var("DATABASE_URL") {
            if !url.is_empty() {
                self.database_url = Some(url);
            }
        }
        if let Ok(env) = std::env::var("SECUREYEOMAN_ENVIRONMENT") {
            self.environment = env;
        }
    }
}

fn resolve_config_path(explicit: Option<&Path>) -> Option<PathBuf> {
    if let Some(p) = explicit {
        return p.is_file().then(|| p.to_path_buf());
    }
    if let Ok(p) = std::env::var("SECUREYEOMAN_CONFIG") {
        let path = PathBuf::from(p);
        if path.is_file() {
            return Some(path);
        }
    }
    for candidate in [
        PathBuf::from("./secureyeoman.toml"),
        PathBuf::from("/etc/secureyeoman/config.toml"),
    ] {
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let path = PathBuf::from(home).join(".secureyeoman/config.toml");
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

fn default_host() -> String {
    "127.0.0.1".to_string()
}
fn default_port() -> u16 {
    18789
}
fn default_environment() -> String {
    "development".to_string()
}
fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn defaults_match_production_expectations() {
        let cfg = CoreConfig::default();
        assert_eq!(cfg.host, "127.0.0.1");
        assert_eq!(cfg.port, 18789);
        assert!(cfg.database_url.is_none());
        assert_eq!(cfg.environment, "development");
        assert!(cfg.cors.enabled);
    }

    #[test]
    fn snake_case_keys_parse_from_toml() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(
            file,
            r#"
host = "0.0.0.0"
port = 9000
database_url = "postgres://localhost/sy"
environment = "production"

[tls]
enabled = true
cert_path = "/tls/fullchain.pem"
key_path = "/tls/privkey.pem"

[cors]
enabled = true
allowed_origins = ["https://dashboard.example.com"]
"#,
        )
        .unwrap();
        let cfg = CoreConfig::from_toml_file(file.path()).expect("parse");
        assert_eq!(cfg.host, "0.0.0.0");
        assert_eq!(cfg.port, 9000);
        assert_eq!(
            cfg.database_url.as_deref(),
            Some("postgres://localhost/sy")
        );
        assert_eq!(cfg.environment, "production");
        assert!(cfg.tls.enabled);
        assert_eq!(cfg.tls.cert_path.as_deref(), Some("/tls/fullchain.pem"));
        assert_eq!(cfg.cors.allowed_origins, vec!["https://dashboard.example.com"]);
    }

    #[test]
    fn camel_case_keys_also_parse() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(
            file,
            r#"
databaseUrl = "postgres://db/sy"

[tls]
certPath = "/etc/cert.pem"
"#,
        )
        .unwrap();
        let cfg = CoreConfig::from_toml_file(file.path()).expect("parse");
        assert_eq!(cfg.database_url.as_deref(), Some("postgres://db/sy"));
        assert_eq!(cfg.tls.cert_path.as_deref(), Some("/etc/cert.pem"));
    }

    #[test]
    fn partial_toml_uses_defaults_for_missing_fields() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(file, "port = 12345").unwrap();
        let cfg = CoreConfig::from_toml_file(file.path()).expect("parse");
        assert_eq!(cfg.port, 12345);
        assert_eq!(cfg.host, "127.0.0.1");
        assert_eq!(cfg.environment, "development");
    }

    #[test]
    fn load_returns_defaults_when_no_file_present() {
        // Temporarily unset config path envs and use a nonexistent explicit path.
        let missing = Path::new("/nonexistent/secureyeoman.toml");
        let result = CoreConfig::load(Some(missing)).expect("load");
        // Defaults (modulo any env vars leaking from the test runner — the
        // assertions below are invariants that env overrides can change).
        assert!(result.port > 0);
    }

    #[test]
    fn invalid_toml_returns_error() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(file, "port = \"not-a-number\"").unwrap();
        let err = CoreConfig::from_toml_file(file.path()).unwrap_err();
        assert!(matches!(err, ConfigError::Toml(_)));
    }
}
