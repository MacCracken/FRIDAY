//! Trading proxy routes — market data (AlphaVantage/Finnhub) and BullShift.
//!
//! Env: ALPHAVANTAGE_API_KEY or FINNHUB_API_KEY, BULLSHIFT_API_URL.

use axum::extract::Query;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/trading/quote", get(quote))
        .route("/api/v1/trading/history", get(history))
        .route("/api/v1/trading/search", get(search))
        .route("/api/v1/trading/bullshift/positions", get(bs_positions))
        .route("/api/v1/trading/bullshift/account", get(bs_account))
        .route("/api/v1/trading/bullshift/health", get(bs_health))
}

enum MarketProvider {
    AlphaVantage(String),
    Finnhub(String),
}

fn get_market_provider() -> Option<MarketProvider> {
    if let Ok(key) = std::env::var("ALPHAVANTAGE_API_KEY") {
        return Some(MarketProvider::AlphaVantage(key));
    }
    if let Ok(key) = std::env::var("FINNHUB_API_KEY") {
        return Some(MarketProvider::Finnhub(key));
    }
    None
}

fn bullshift_url() -> String {
    std::env::var("BULLSHIFT_API_URL").unwrap_or_else(|_| "http://localhost:8787".to_string())
}

async fn market_fetch(
    provider: &MarketProvider,
    params: &[(&str, &str)],
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let req = match provider {
        MarketProvider::AlphaVantage(key) => {
            let mut url = reqwest::Url::parse("https://www.alphavantage.co/query").unwrap();
            url.query_pairs_mut().append_pair("apikey", key);
            for (k, v) in params {
                url.query_pairs_mut().append_pair(k, v);
            }
            client.get(url)
        }
        MarketProvider::Finnhub(key) => {
            let mut url = reqwest::Url::parse("https://finnhub.io/api/v1/quote").unwrap();
            for (k, v) in params {
                url.query_pairs_mut().append_pair(k, v);
            }
            client.get(url).header("X-Finnhub-Token", key.as_str())
        }
    };
    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Market API error: HTTP {}", res.status()));
    }
    res.json().await.map_err(|e| e.to_string())
}

async fn bullshift_fetch(path: &str) -> impl IntoResponse {
    let url = format!("{}{path}", bullshift_url());
    match reqwest::get(&url).await {
        Ok(res) if res.status().is_success() => {
            let body: serde_json::Value = res.json().await.unwrap_or(serde_json::json!(null));
            (StatusCode::OK, Json(body)).into_response()
        }
        Ok(res) => {
            let s = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            (
                StatusCode::from_u16(s).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": body})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct SymbolQuery {
    symbol: Option<String>,
}

async fn quote(Query(q): Query<SymbolQuery>) -> impl IntoResponse {
    let Some(symbol) = q.symbol else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Missing symbol"})),
        )
            .into_response();
    };
    let Some(provider) = get_market_provider() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "No market data API key configured"})),
        )
            .into_response();
    };
    let params = match &provider {
        MarketProvider::AlphaVantage(_) => {
            vec![("function", "GLOBAL_QUOTE"), ("symbol", symbol.as_str())]
        }
        MarketProvider::Finnhub(_) => vec![("symbol", symbol.as_str())],
    };
    match market_fetch(&provider, &params).await {
        Ok(data) => Json(data).into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": e})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct HistoryQuery {
    symbol: Option<String>,
    days: Option<String>,
}

async fn history(Query(q): Query<HistoryQuery>) -> impl IntoResponse {
    let Some(symbol) = q.symbol else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Missing symbol"})),
        )
            .into_response();
    };
    let Some(provider) = get_market_provider() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "No market data API key configured"})),
        )
            .into_response();
    };
    let params = match &provider {
        MarketProvider::AlphaVantage(_) => vec![
            ("function", "TIME_SERIES_DAILY"),
            ("symbol", symbol.as_str()),
            ("outputsize", "compact"),
        ],
        MarketProvider::Finnhub(_) => vec![("symbol", symbol.as_str())],
    };
    match market_fetch(&provider, &params).await {
        Ok(data) => Json(data).into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": e})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct SearchQuery {
    keywords: Option<String>,
}

async fn search(Query(q): Query<SearchQuery>) -> impl IntoResponse {
    let Some(keywords) = q.keywords else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Missing keywords"})),
        )
            .into_response();
    };
    let Some(provider) = get_market_provider() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "No market data API key configured"})),
        )
            .into_response();
    };
    let params = match &provider {
        MarketProvider::AlphaVantage(_) => vec![
            ("function", "SYMBOL_SEARCH"),
            ("keywords", keywords.as_str()),
        ],
        MarketProvider::Finnhub(_) => vec![("q", keywords.as_str())],
    };
    match market_fetch(&provider, &params).await {
        Ok(data) => Json(data).into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": e})),
        )
            .into_response(),
    }
}

async fn bs_positions() -> impl IntoResponse {
    bullshift_fetch("/api/positions").await
}
async fn bs_account() -> impl IntoResponse {
    bullshift_fetch("/api/account").await
}
async fn bs_health() -> impl IntoResponse {
    bullshift_fetch("/api/health").await
}
