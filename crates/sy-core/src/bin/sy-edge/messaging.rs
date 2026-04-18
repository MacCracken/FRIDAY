//! Webhook messaging — Slack, Discord, Telegram, generic webhooks.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct MessageTarget {
    pub name: String,
    pub platform: String,
    /// URL is redacted in API responses
    pub configured: bool,
}

#[derive(Clone)]
struct Target {
    name: String,
    platform: String,
    url: String,
    /// For Telegram: bot token + chat ID
    extra: Option<(String, String)>,
}

#[derive(Clone)]
pub struct Messenger {
    targets: Vec<Target>,
    http: reqwest::Client,
}

impl Messenger {
    pub fn from_env() -> Self {
        let mut targets = Vec::new();

        if let Ok(url) = std::env::var("SLACK_WEBHOOK_URL") {
            targets.push(Target {
                name: "slack".into(),
                platform: "slack".into(),
                url,
                extra: None,
            });
        }

        if let Ok(url) = std::env::var("DISCORD_WEBHOOK_URL") {
            targets.push(Target {
                name: "discord".into(),
                platform: "discord".into(),
                url,
                extra: None,
            });
        }

        if let (Ok(token), Ok(chat_id)) = (
            std::env::var("TELEGRAM_BOT_TOKEN"),
            std::env::var("TELEGRAM_CHAT_ID"),
        ) {
            targets.push(Target {
                name: "telegram".into(),
                platform: "telegram".into(),
                url: format!("https://api.telegram.org/bot{token}/sendMessage"),
                extra: Some((token, chat_id)),
            });
        }

        Self {
            targets,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap_or_default(),
        }
    }

    pub async fn send(&self, target_name: &str, text: &str) -> Result<(), String> {
        let target = self
            .targets
            .iter()
            .find(|t| t.name == target_name)
            .ok_or_else(|| format!("Target not found: {target_name}"))?;

        self.send_to_target(target, text).await
    }

    pub async fn broadcast(&self, text: &str) -> Result<usize, String> {
        let mut sent = 0;
        for target in &self.targets {
            if self.send_to_target(target, text).await.is_ok() {
                sent += 1;
            }
        }
        Ok(sent)
    }

    async fn send_to_target(&self, target: &Target, text: &str) -> Result<(), String> {
        let body = match target.platform.as_str() {
            "slack" => serde_json::json!({ "text": text }),
            "discord" => serde_json::json!({ "content": text }),
            "telegram" => {
                let chat_id = target
                    .extra
                    .as_ref()
                    .map(|(_, id)| id.as_str())
                    .unwrap_or("");
                serde_json::json!({ "chat_id": chat_id, "text": text })
            }
            _ => serde_json::json!({ "text": text }),
        };

        let resp = self
            .http
            .post(&target.url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Send failed: {e}"))?;

        if resp.status().is_success() {
            Ok(())
        } else {
            Err(format!("Send failed: HTTP {}", resp.status()))
        }
    }

    #[allow(dead_code)]
    pub fn target_count(&self) -> usize {
        self.targets.len()
    }

    pub fn list_targets(&self) -> Vec<MessageTarget> {
        self.targets
            .iter()
            .map(|t| MessageTarget {
                name: t.name.clone(),
                platform: t.platform.clone(),
                configured: true,
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_targets_returns_vec() {
        // Just verify from_env doesn't panic and returns valid targets
        let m = Messenger::from_env();
        let targets = m.list_targets();
        for t in &targets {
            assert!(!t.name.is_empty());
            assert!(t.configured);
        }
    }

    #[test]
    fn from_env_with_slack() {
        unsafe { std::env::set_var("SLACK_WEBHOOK_URL", "https://hooks.slack.com/test") };
        let m = Messenger::from_env();
        assert!(m.target_count() >= 1);
        let targets = m.list_targets();
        assert!(targets.iter().any(|t| t.platform == "slack"));
        unsafe { std::env::remove_var("SLACK_WEBHOOK_URL") };
    }

    #[test]
    fn target_info_redacted() {
        unsafe {
            std::env::set_var(
                "DISCORD_WEBHOOK_URL",
                "https://discord.com/api/webhooks/secret",
            )
        };
        let m = Messenger::from_env();
        let targets = m.list_targets();
        // URL is not in the public struct
        for t in &targets {
            assert!(t.configured);
            assert!(!t.name.is_empty());
            assert!(!t.platform.is_empty());
        }
        unsafe { std::env::remove_var("DISCORD_WEBHOOK_URL") };
    }

    #[test]
    fn message_target_serialization() {
        let t = MessageTarget {
            name: "slack".into(),
            platform: "slack".into(),
            configured: true,
        };
        let json = serde_json::to_string(&t).unwrap();
        assert!(json.contains("\"name\":\"slack\""));
        assert!(json.contains("\"configured\":true"));
    }
}
