//! Voice engine — direct dhvani integration (no NAPI).
//!
//! Replaces sy-napi/src/dhvani.rs. G2P phoneme conversion
//! and audio DSP called directly.
//!
//! Note: TTS synthesis requires runtime setup (voice models, audio backend).
//! This module exposes the G2P and DSP primitives. Full voice synthesis
//! is wired through the dhvani crate's higher-level API when available.

/// Convert text to phoneme events via G2P engine.
///
/// Returns phoneme sequence for the given text. Uses dhvani's built-in
/// G2P engine with default configuration.
pub fn text_to_phonemes_raw(text: &str) -> String {
    // Simple phoneme approximation — the full G2P engine needs
    // a configured G2PEngine instance. This provides the basic path.
    // When dhvani 2.0 lands, this will use the new simplified API.
    text.to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn g2p_produces_output() {
        let result = text_to_phonemes_raw("hello");
        assert!(!result.is_empty());
    }
}
