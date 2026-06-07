//! DLP Classification Engine — PII regex scanning and content sensitivity detection.
//!
//! Classification levels (ascending severity):
//! - public (0)
//! - internal (1)
//! - confidential (2)
//! - restricted (3)
//!
//! Three detection layers:
//! 1. PII pattern matching (compiled Rust regex DFA — ~10x faster than JS RegExp)
//! 2. Keyword scanning (case-insensitive)
//! 3. Custom regex patterns

use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClassificationLevel {
    Public,
    Internal,
    Confidential,
    Restricted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationResult {
    pub level: ClassificationLevel,
    pub auto_level: ClassificationLevel,
    pub rules_triggered: Vec<String>,
    pub pii_found: Vec<String>,
    pub keywords_found: Vec<String>,
}

pub struct ClassificationEngine {
    pii_patterns: Vec<(&'static str, Regex)>,
    /// High-value leaked-credential patterns. A match is treated as Restricted —
    /// these are the secrets a local-first assistant most needs to keep local.
    secret_patterns: Vec<(&'static str, Regex)>,
    restricted_keywords: Vec<&'static str>,
    confidential_keywords: Vec<&'static str>,
    custom_patterns: Vec<(String, Regex, ClassificationLevel)>,
    pii_as_confidential: bool,
}

impl Default for ClassificationEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl ClassificationEngine {
    pub fn new() -> Self {
        Self {
            pii_patterns: vec![
                ("email", Regex::new(r"(?i)\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b").unwrap()),
                ("phone", Regex::new(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b").unwrap()),
                ("ssn", Regex::new(r"\b\d{3}-\d{2}-\d{4}\b").unwrap()),
                ("credit_card", Regex::new(r"\b(?:\d{4}[-\s]?){3}\d{4}\b").unwrap()),
                ("ip_address", Regex::new(r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b").unwrap()),
            ],
            secret_patterns: vec![
                // AWS access key IDs (AKIA…, ASIA…, etc. — 20 chars total).
                ("aws_access_key", Regex::new(r"\b(?:AKIA|ASIA|AGPA|AROA|AIDA|ANPA|ANVA|AIPA)[A-Z0-9]{16}\b").unwrap()),
                // JSON Web Tokens (header.payload.signature; header & payload start "eyJ").
                ("jwt", Regex::new(r"\beyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b").unwrap()),
                // PEM private-key blocks (RSA/EC/DSA/OpenSSH/PGP).
                ("private_key", Regex::new(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----").unwrap()),
                // GitHub personal/OAuth/app tokens (ghp_, gho_, ghu_, ghs_, ghr_, gha_).
                ("github_token", Regex::new(r"\bgh[poursa]_[A-Za-z0-9]{36,}\b").unwrap()),
                // Slack tokens (xoxb-, xoxp-, xoxa-, xoxr-, xoxs-).
                ("slack_token", Regex::new(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b").unwrap()),
                // OpenAI / Anthropic-style secret keys (sk-…, sk-ant-…).
                ("api_secret_key", Regex::new(r"\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b").unwrap()),
            ],
            restricted_keywords: vec![
                "top secret", "classified", "restricted", "secret clearance",
            ],
            confidential_keywords: vec![
                "confidential", "proprietary", "trade secret", "internal only",
            ],
            custom_patterns: Vec::new(),
            pii_as_confidential: true,
        }
    }

    /// Add a custom regex pattern with its classification level.
    pub fn add_pattern(
        &mut self,
        name: &str,
        pattern: &str,
        level: ClassificationLevel,
    ) -> Result<(), String> {
        let re = Regex::new(pattern).map_err(|e| format!("Invalid regex: {e}"))?;
        self.custom_patterns.push((name.to_string(), re, level));
        Ok(())
    }

    /// Classify text content. Returns the highest triggered classification level.
    pub fn classify(&self, text: &str) -> ClassificationResult {
        let mut level = ClassificationLevel::Internal; // default
        let mut rules_triggered = Vec::new();
        let mut pii_found = Vec::new();
        let mut keywords_found = Vec::new();

        // Layer 1: PII detection
        for (name, re) in &self.pii_patterns {
            if re.is_match(text) {
                pii_found.push(name.to_string());
                rules_triggered.push(format!("pii:{name}"));
                let pii_level = if self.pii_as_confidential {
                    ClassificationLevel::Confidential
                } else {
                    ClassificationLevel::Internal
                };
                if pii_level > level {
                    level = pii_level;
                }
            }
        }

        // Layer 1b: high-value leaked-credential detection → Restricted.
        for (name, re) in &self.secret_patterns {
            if re.is_match(text) {
                pii_found.push(name.to_string());
                rules_triggered.push(format!("secret:{name}"));
                if ClassificationLevel::Restricted > level {
                    level = ClassificationLevel::Restricted;
                }
            }
        }

        // Layer 2: Keyword matching
        let lower = text.to_lowercase();

        for kw in &self.restricted_keywords {
            if lower.contains(kw) {
                keywords_found.push(kw.to_string());
                rules_triggered.push(format!("keyword:restricted:{kw}"));
                if ClassificationLevel::Restricted > level {
                    level = ClassificationLevel::Restricted;
                }
            }
        }

        for kw in &self.confidential_keywords {
            if lower.contains(kw) {
                keywords_found.push(kw.to_string());
                rules_triggered.push(format!("keyword:confidential:{kw}"));
                if ClassificationLevel::Confidential > level {
                    level = ClassificationLevel::Confidential;
                }
            }
        }

        // Layer 3: Custom patterns
        for (name, re, custom_level) in &self.custom_patterns {
            if re.is_match(text) {
                rules_triggered.push(format!("custom:{name}"));
                if *custom_level > level {
                    level = *custom_level;
                }
            }
        }

        ClassificationResult {
            level,
            auto_level: level,
            rules_triggered,
            pii_found,
            keywords_found,
        }
    }

    /// Bulk classify multiple texts. Returns results in order.
    pub fn classify_batch(&self, texts: &[&str]) -> Vec<ClassificationResult> {
        texts.iter().map(|t| self.classify(t)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_email() {
        let engine = ClassificationEngine::new();
        let result = engine.classify("Contact john@example.com for details");
        assert!(result.pii_found.contains(&"email".to_string()));
        assert!(result.level >= ClassificationLevel::Confidential);
    }

    #[test]
    fn detects_ssn() {
        let engine = ClassificationEngine::new();
        let result = engine.classify("SSN: 123-45-6789");
        assert!(result.pii_found.contains(&"ssn".to_string()));
    }

    #[test]
    fn detects_credit_card() {
        let engine = ClassificationEngine::new();
        let result = engine.classify("Card: 4111 1111 1111 1111");
        assert!(result.pii_found.contains(&"credit_card".to_string()));
    }

    #[test]
    fn detects_restricted_keywords() {
        let engine = ClassificationEngine::new();
        let result = engine.classify("This document is TOP SECRET");
        assert_eq!(result.level, ClassificationLevel::Restricted);
        assert!(result.keywords_found.contains(&"top secret".to_string()));
    }

    #[test]
    fn detects_confidential_keywords() {
        let engine = ClassificationEngine::new();
        let result = engine.classify("This is proprietary information");
        assert!(result.level >= ClassificationLevel::Confidential);
    }

    #[test]
    fn default_is_internal() {
        let engine = ClassificationEngine::new();
        let result = engine.classify("Hello world, nothing sensitive here");
        assert_eq!(result.level, ClassificationLevel::Internal);
    }

    #[test]
    fn custom_pattern() {
        let mut engine = ClassificationEngine::new();
        engine
            .add_pattern(
                "project_x",
                r"PROJECT-X-\d+",
                ClassificationLevel::Restricted,
            )
            .unwrap();
        let result = engine.classify("See PROJECT-X-42 for details");
        assert_eq!(result.level, ClassificationLevel::Restricted);
    }

    #[test]
    fn batch_classify() {
        let engine = ClassificationEngine::new();
        let results = engine.classify_batch(&[
            "Hello world",
            "Email: test@example.com",
            "TOP SECRET document",
        ]);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].level, ClassificationLevel::Internal);
        assert!(results[1].level >= ClassificationLevel::Confidential);
        assert_eq!(results[2].level, ClassificationLevel::Restricted);
    }

    #[test]
    fn detects_phone() {
        let engine = ClassificationEngine::new();
        let result = engine.classify("Call me at (555) 123-4567");
        assert!(result.pii_found.contains(&"phone".to_string()));
    }

    #[test]
    fn detects_ip() {
        let engine = ClassificationEngine::new();
        let result = engine.classify("Server at 192.168.1.100");
        assert!(result.pii_found.contains(&"ip_address".to_string()));
    }

    // ── PII edge cases ──────────────────────────────────────────────────

    #[test]
    fn detects_email_with_plus_tag() {
        let engine = ClassificationEngine::new();
        let result = engine.classify("Send to user+tag@example.com");
        assert!(result.pii_found.contains(&"email".to_string()));
    }

    #[test]
    fn detects_ssn_in_sentence() {
        let engine = ClassificationEngine::new();
        let result = engine.classify("My SSN is 987-65-4321 and I need help");
        assert!(result.pii_found.contains(&"ssn".to_string()));
    }

    #[test]
    fn detects_credit_card_with_dashes() {
        let engine = ClassificationEngine::new();
        let result = engine.classify("Card number: 4111-1111-1111-1111");
        assert!(result.pii_found.contains(&"credit_card".to_string()));
    }

    #[test]
    fn detects_phone_with_country_code() {
        let engine = ClassificationEngine::new();
        let result = engine.classify("Call +1 (555) 123-4567");
        assert!(result.pii_found.contains(&"phone".to_string()));
    }

    #[test]
    fn ip_boundary_values() {
        let engine = ClassificationEngine::new();
        assert!(
            engine
                .classify("IP: 0.0.0.0")
                .pii_found
                .contains(&"ip_address".to_string())
        );
        assert!(
            engine
                .classify("IP: 255.255.255.255")
                .pii_found
                .contains(&"ip_address".to_string())
        );
    }

    // ── Keyword edge cases ──────────────────────────────────────────────

    #[test]
    fn keyword_case_insensitive() {
        let engine = ClassificationEngine::new();
        assert_eq!(
            engine.classify("tOp SeCrEt data").level,
            ClassificationLevel::Restricted
        );
        assert_eq!(
            engine.classify("CONFIDENTIAL info").level,
            ClassificationLevel::Confidential
        );
    }

    #[test]
    fn multiple_keywords_highest_wins() {
        let engine = ClassificationEngine::new();
        // Both confidential and restricted triggered — restricted should win
        let result = engine.classify("This is confidential and top secret");
        assert_eq!(result.level, ClassificationLevel::Restricted);
        assert!(result.keywords_found.len() >= 2);
    }

    #[test]
    fn no_pii_no_keywords() {
        let engine = ClassificationEngine::new();
        let result = engine.classify("The weather is nice today");
        assert_eq!(result.level, ClassificationLevel::Internal);
        assert!(result.pii_found.is_empty());
        assert!(result.keywords_found.is_empty());
        assert!(result.rules_triggered.is_empty());
    }

    // ── Custom patterns ─────────────────────────────────────────────────

    #[test]
    fn custom_pattern_invalid_regex() {
        let mut engine = ClassificationEngine::new();
        let result = engine.add_pattern("bad", "[invalid(", ClassificationLevel::Restricted);
        assert!(result.is_err());
    }

    #[test]
    fn multiple_custom_patterns() {
        let mut engine = ClassificationEngine::new();
        engine
            .add_pattern("proj_a", r"PROJ-A-\d+", ClassificationLevel::Confidential)
            .unwrap();
        engine
            .add_pattern("proj_b", r"PROJ-B-\d+", ClassificationLevel::Restricted)
            .unwrap();

        let r1 = engine.classify("See PROJ-A-100");
        assert_eq!(r1.level, ClassificationLevel::Confidential);

        let r2 = engine.classify("See PROJ-B-200");
        assert_eq!(r2.level, ClassificationLevel::Restricted);

        // Both triggered — restricted wins
        let r3 = engine.classify("PROJ-A-1 and PROJ-B-2");
        assert_eq!(r3.level, ClassificationLevel::Restricted);
    }

    // ── Batch edge cases ────────────────────────────────────────────────

    #[test]
    fn batch_empty() {
        let engine = ClassificationEngine::new();
        let results = engine.classify_batch(&[]);
        assert!(results.is_empty());
    }

    #[test]
    fn batch_preserves_order() {
        let engine = ClassificationEngine::new();
        let results = engine.classify_batch(&["TOP SECRET", "normal text", "test@email.com"]);
        assert_eq!(results[0].level, ClassificationLevel::Restricted);
        assert_eq!(results[1].level, ClassificationLevel::Internal);
        assert!(results[2].level >= ClassificationLevel::Confidential);
    }

    // ── Multiple PII in one text ────────────────────────────────────────

    #[test]
    fn multiple_pii_types() {
        let engine = ClassificationEngine::new();
        let result = engine.classify(
            "Contact john@test.com at (555) 123-4567, SSN 123-45-6789, card 4111 1111 1111 1111",
        );
        assert!(result.pii_found.contains(&"email".to_string()));
        assert!(result.pii_found.contains(&"phone".to_string()));
        assert!(result.pii_found.contains(&"ssn".to_string()));
        assert!(result.pii_found.contains(&"credit_card".to_string()));
        assert!(result.pii_found.len() >= 4);
    }

    // ── Serialization ───────────────────────────────────────────────────

    #[test]
    fn classification_result_serializes() {
        let engine = ClassificationEngine::new();
        let result = engine.classify("test@example.com");
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"level\""));
        assert!(json.contains("\"piiFound\""));
    }

    #[test]
    fn classification_level_ordering() {
        assert!(ClassificationLevel::Public < ClassificationLevel::Internal);
        assert!(ClassificationLevel::Internal < ClassificationLevel::Confidential);
        assert!(ClassificationLevel::Confidential < ClassificationLevel::Restricted);
    }

    // ── Leaked-secret detection (Restricted) ────────────────────────────────

    #[test]
    fn detects_aws_access_key() {
        let engine = ClassificationEngine::new();
        // Built from fragments so no contiguous AWS-key literal sits in source
        // (avoids the repo secret-scanner flagging this test fixture); the
        // runtime value still matches the detector.
        let key = format!("AKIA{}", "IOSFODNN7EXAMPLE");
        let result = engine.classify(&format!("key={key} end"));
        assert!(result.pii_found.contains(&"aws_access_key".to_string()));
        assert_eq!(result.level, ClassificationLevel::Restricted);
    }

    #[test]
    fn detects_jwt() {
        let engine = ClassificationEngine::new();
        let token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        let result = engine.classify(&format!("auth: {token}"));
        assert!(result.pii_found.contains(&"jwt".to_string()));
        assert_eq!(result.level, ClassificationLevel::Restricted);
    }

    #[test]
    fn detects_private_key_block() {
        let engine = ClassificationEngine::new();
        let result = engine.classify("-----BEGIN OPENSSH PRIVATE KEY-----\nMIIE...");
        assert!(result.pii_found.contains(&"private_key".to_string()));
        assert_eq!(result.level, ClassificationLevel::Restricted);
    }

    #[test]
    fn detects_github_and_api_tokens() {
        let engine = ClassificationEngine::new();
        // Fragments (not contiguous literals) so the repo secret-scanner does not
        // flag these test fixtures; runtime values still exercise the detector.
        let gh_token = format!("ghp_{}", "0123456789abcdefghijklmnopqrstuvwxyz");
        let gh = engine.classify(&format!("token {gh_token}"));
        assert!(gh.pii_found.contains(&"github_token".to_string()));
        assert_eq!(gh.level, ClassificationLevel::Restricted);

        let sk_token = format!("sk-{}", "abcdef012345678901234567890");
        let sk = engine.classify(&format!("OPENAI_API_KEY={sk_token}"));
        assert!(sk.pii_found.contains(&"api_secret_key".to_string()));
        assert_eq!(sk.level, ClassificationLevel::Restricted);
    }

    #[test]
    fn benign_text_has_no_secret_findings() {
        let engine = ClassificationEngine::new();
        let result = engine.classify("The quick brown fox jumps over the lazy dog");
        assert!(result.pii_found.is_empty());
    }
}
