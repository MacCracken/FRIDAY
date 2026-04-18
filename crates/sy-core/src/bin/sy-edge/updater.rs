//! OTA self-update — checks parent for new edge binaries.

use std::time::Duration;

const CHECK_INTERVAL: Duration = Duration::from_secs(3600); // 1 hour

pub async fn update_loop(parent_url: &str, arch: &str) {
    loop {
        tokio::time::sleep(CHECK_INTERVAL).await;

        match check_update(parent_url, arch).await {
            Ok(Some(new_version)) => {
                tracing::info!(
                    current = crate::VERSION,
                    available = %new_version,
                    "Update available"
                );
                // TODO: download, verify SHA-256 + Ed25519 signature, atomic replace
            }
            Ok(None) => {
                tracing::debug!("No update available");
            }
            Err(e) => {
                tracing::warn!(error = %e, "Update check failed");
            }
        }
    }
}

async fn check_update(parent_url: &str, arch: &str) -> Result<Option<String>, String> {
    let os = std::env::consts::OS;
    let url = format!(
        "{parent_url}/api/v1/edge/updates/check?version={}&arch={arch}&os={os}",
        crate::VERSION
    );

    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let data: serde_json::Value = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;

    if data.get("update_available").and_then(|v| v.as_bool()) == Some(true) {
        Ok(data
            .get("version")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()))
    } else {
        Ok(None)
    }
}
