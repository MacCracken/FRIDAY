//! OIDC (OpenID Connect) Authorization Code + PKCE flow.
//!
//! A single env-configured identity provider:
//! - `OIDC_ISSUER_URL`    — bare issuer (e.g. `https://accounts.google.com`)
//! - `OIDC_CLIENT_ID`
//! - `OIDC_CLIENT_SECRET`
//! - `OIDC_REDIRECT_URI`  — must match the provider registration exactly
//!
//! The HTTP client follows the crate's SSRF guidance: redirects are disabled.
//! Provider metadata (endpoints + JWKS) is discovered lazily and cached with a
//! TTL so key rotation is still honored. We bring our own `reqwest` 0.13 client
//! via oauth2's blanket `AsyncHttpClient` impl for closures.

use std::time::{Duration, Instant};

use openidconnect::core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata};
use openidconnect::{
    AuthorizationCode, ClientId, ClientSecret, CsrfToken, IssuerUrl, Nonce, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, Scope, TokenResponse,
};
use tokio::sync::Mutex;

/// Re-discover provider metadata at most this often (honors key rotation).
const METADATA_TTL: Duration = Duration::from_secs(3600);

/// Static configuration for the OIDC provider, read from the environment.
#[derive(Clone)]
pub struct OidcConfig {
    pub issuer: String,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
}

impl OidcConfig {
    /// Build from env. Returns `None` unless all four variables are present.
    pub fn from_env() -> Option<Self> {
        let issuer = std::env::var("OIDC_ISSUER_URL")
            .ok()
            .filter(|s| !s.is_empty())?;
        let client_id = std::env::var("OIDC_CLIENT_ID")
            .ok()
            .filter(|s| !s.is_empty())?;
        let client_secret = std::env::var("OIDC_CLIENT_SECRET")
            .ok()
            .filter(|s| !s.is_empty())?;
        let redirect_uri = std::env::var("OIDC_REDIRECT_URI")
            .ok()
            .filter(|s| !s.is_empty())?;
        Some(Self {
            issuer,
            client_id,
            client_secret,
            redirect_uri,
        })
    }
}

/// Verified identity returned by the callback exchange.
pub struct OidcIdentity {
    /// The issuer the token was verified against (namespaces `subject`, which is
    /// only unique per-issuer).
    pub issuer: String,
    pub subject: String,
    /// Only `Some` when the IdP asserted the email AND `email_verified` is true.
    pub email: Option<String>,
}

/// Runtime OIDC state: config, a redirect-disabled HTTP client, and cached
/// provider metadata.
pub struct OidcRuntime {
    config: OidcConfig,
    http: reqwest::Client,
    metadata: Mutex<Option<(CoreProviderMetadata, Instant)>>,
}

impl OidcRuntime {
    /// Construct from config. The HTTP client disables redirects (SSRF-safe).
    pub fn new(config: OidcConfig) -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none()) // SSRF-safe: never follow redirects
            .timeout(Duration::from_secs(15)) // bound external IdP calls
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| format!("OIDC HTTP client build failed: {e}"))?;
        Ok(Self {
            config,
            http,
            metadata: Mutex::new(None),
        })
    }

    /// Lazily discover (and TTL-cache) the provider metadata. Only the metadata
    /// is cached/returned because the *configured* client has an unnameable
    /// endpoint typestate — it is rebuilt inline by each caller.
    async fn metadata(&self) -> Result<CoreProviderMetadata, String> {
        let issuer = IssuerUrl::new(self.config.issuer.clone())
            .map_err(|e| format!("invalid OIDC_ISSUER_URL: {e}"))?;
        let mut guard = self.metadata.lock().await;
        let fresh = guard
            .as_ref()
            .is_some_and(|(_, at)| at.elapsed() < METADATA_TTL);
        if !fresh {
            let md = CoreProviderMetadata::discover_async(issuer, &self.http_client())
                .await
                .map_err(|e| format!("OIDC discovery failed: {e}"))?;
            *guard = Some((md, Instant::now()));
        }
        Ok(guard
            .as_ref()
            .map(|(md, _)| md.clone())
            .expect("metadata set above"))
    }

    fn redirect_url(&self) -> Result<RedirectUrl, String> {
        RedirectUrl::new(self.config.redirect_uri.clone())
            .map_err(|e| format!("invalid OIDC_REDIRECT_URI: {e}"))
    }

    /// An `AsyncHttpClient` (a closure over our reqwest 0.13 client). Cloned per
    /// request so the returned future is `'static`.
    fn http_client(
        &self,
    ) -> impl Fn(
        openidconnect::HttpRequest,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<Output = Result<openidconnect::HttpResponse, HttpClientError>>
                + Send,
        >,
    > {
        let client = self.http.clone();
        move |req| {
            let client = client.clone();
            Box::pin(async move { execute(client, req).await })
        }
    }

    /// Build the authorization-request URL. Returns the URL plus the transient
    /// values the callback needs (CSRF state, PKCE verifier, nonce) — persist
    /// these server-side keyed by `state`.
    pub async fn authorize_url(&self) -> Result<AuthRequest, String> {
        // Build the configured client inline (its endpoint typestate is unnameable).
        let client = CoreClient::from_provider_metadata(
            self.metadata().await?,
            ClientId::new(self.config.client_id.clone()),
            Some(ClientSecret::new(self.config.client_secret.clone())),
        )
        .set_redirect_uri(self.redirect_url()?);
        let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        let (url, csrf, nonce) = client
            .authorize_url(
                CoreAuthenticationFlow::AuthorizationCode,
                CsrfToken::new_random,
                Nonce::new_random,
            )
            .add_scope(Scope::new("openid".to_string()))
            .add_scope(Scope::new("email".to_string()))
            .add_scope(Scope::new("profile".to_string()))
            .set_pkce_challenge(challenge)
            .url();
        Ok(AuthRequest {
            url: url.to_string(),
            state: csrf.secret().to_string(),
            pkce_verifier: verifier.secret().to_string(),
            nonce: nonce.secret().to_string(),
        })
    }

    /// Exchange an authorization `code` for tokens, verifying the ID token
    /// (signature, issuer, audience, expiry, and nonce). Returns the subject/email.
    pub async fn exchange(
        &self,
        code: String,
        pkce_verifier: String,
        nonce: String,
    ) -> Result<OidcIdentity, String> {
        let client = CoreClient::from_provider_metadata(
            self.metadata().await?,
            ClientId::new(self.config.client_id.clone()),
            Some(ClientSecret::new(self.config.client_secret.clone())),
        )
        .set_redirect_uri(self.redirect_url()?);
        let token_response = client
            .exchange_code(AuthorizationCode::new(code))
            .map_err(|e| format!("OIDC exchange setup failed: {e}"))?
            .set_pkce_verifier(PkceCodeVerifier::new(pkce_verifier))
            .request_async(&self.http_client())
            .await
            .map_err(|e| format!("OIDC token exchange failed: {e}"))?;

        let id_token = token_response
            .id_token()
            .ok_or_else(|| "provider did not return an ID token".to_string())?;

        let nonce = Nonce::new(nonce);
        let claims = id_token
            .claims(&client.id_token_verifier(), &nonce)
            .map_err(|e| format!("ID token verification failed: {e}"))?;

        // Only trust the email if the IdP asserted it as verified; otherwise it is
        // attacker-settable and must not be surfaced as an identity attribute.
        let email = if claims.email_verified() == Some(true) {
            claims.email().map(|e| e.as_str().to_string())
        } else {
            None
        };

        Ok(OidcIdentity {
            issuer: self.config.issuer.clone(),
            subject: claims.subject().as_str().to_string(),
            email,
        })
    }
}

/// The transient values produced by [`OidcRuntime::authorize_url`].
pub struct AuthRequest {
    pub url: String,
    pub state: String,
    pub pkce_verifier: String,
    pub nonce: String,
}

/// A concrete error for the openidconnect HTTP client glue (the `AsyncHttpClient`
/// blanket impl requires a `Sized` error type, so we avoid `Box<dyn Error>`).
#[derive(Debug)]
pub struct HttpClientError(String);

impl std::fmt::Display for HttpClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "OIDC HTTP error: {}", self.0)
    }
}

impl std::error::Error for HttpClientError {}

/// Maximum OIDC response body we will buffer (discovery/JWKS/token are tiny;
/// this guards against a hostile/compromised IdP returning a huge body).
const MAX_OIDC_BODY: usize = 4 * 1024 * 1024;

/// Run a single HTTP request for openidconnect through our reqwest 0.13 client.
async fn execute(
    client: reqwest::Client,
    req: openidconnect::HttpRequest,
) -> Result<openidconnect::HttpResponse, HttpClientError> {
    let reqwest_req =
        reqwest::Request::try_from(req).map_err(|e| HttpClientError(e.to_string()))?;
    let mut resp = client
        .execute(reqwest_req)
        .await
        .map_err(|e| HttpClientError(e.to_string()))?;
    let status = resp.status();
    let headers = resp.headers().clone();

    // Fast reject on a declared oversize body, then stream with a hard cap so a
    // lying/absent Content-Length cannot cause an unbounded allocation.
    if resp
        .content_length()
        .is_some_and(|len| len > MAX_OIDC_BODY as u64)
    {
        return Err(HttpClientError("response body too large".to_string()));
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| HttpClientError(e.to_string()))?
    {
        if body.len() + chunk.len() > MAX_OIDC_BODY {
            return Err(HttpClientError("response body too large".to_string()));
        }
        body.extend_from_slice(&chunk);
    }

    let mut builder = http::Response::builder().status(status);
    if let Some(h) = builder.headers_mut() {
        *h = headers;
    }
    builder
        .body(body)
        .map_err(|e| HttpClientError(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_client_error_displays() {
        let e = HttpClientError("boom".to_string());
        assert!(e.to_string().contains("boom"));
        // Implements std::error::Error.
        let _: &dyn std::error::Error = &e;
    }

    #[test]
    fn runtime_builds_with_redirect_disabled() {
        // A runtime can be constructed from config without contacting the IdP
        // (discovery is lazy). This also exercises the SSRF-safe client build.
        let rt = OidcRuntime::new(OidcConfig {
            issuer: "https://issuer.example.com".to_string(),
            client_id: "cid".to_string(),
            client_secret: "secret".to_string(),
            redirect_uri: "https://app.example.com/callback".to_string(),
        });
        assert!(rt.is_ok());
    }
}
