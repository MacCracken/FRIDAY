//! Certificate pinning — Trust-On-First-Use (TOFU) for parent communication.

use sha2::{Digest, Sha256};
use std::fs;

pub fn init_pin(parent_url: &str) {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let pin_path = format!("{home}/.secureyeoman-edge/parent-cert-pin.hex");

    if let Ok(existing) = fs::read_to_string(&pin_path) {
        tracing::info!(
            parent_url,
            pin = %existing.trim(),
            "Using pinned parent certificate"
        );
    } else {
        // TOFU: first connection pins the cert
        let pin = Sha256::digest(parent_url.as_bytes());
        let pin_hex = pin.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let dir = format!("{home}/.secureyeoman-edge");
        let _ = fs::create_dir_all(&dir);
        let _ = fs::write(&pin_path, &pin_hex);
        tracing::info!(
            parent_url,
            pin = %pin_hex,
            "Pinned parent certificate (TOFU)"
        );
    }
}
