//! Dhvani audio engine — NAPI bindings for Node.js.
//!
//! Exposes dhvani's voice synthesis (svara), G2P (shabda), audio DSP,
//! and analysis APIs to the TypeScript layer.

use napi::bindgen_prelude::*;
use napi_derive::napi;

use dhvani::buffer::AudioBuffer;
use dhvani::dsp::NoiseReducer;
use dhvani::g2p::{G2PEngine, Language};
use dhvani::voice_synth::{PhonemeSequence, VoiceProfile};

/// Helper: convert `&[f32]` samples to a byte Buffer (little-endian f32).
fn samples_to_buffer(samples: &[f32]) -> Buffer {
    let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
    bytes.into()
}

/// Helper: decode a Buffer of LE f32 bytes back to `Vec<f32>`.
fn buffer_to_samples(buf: &Buffer) -> Vec<f32> {
    buf.chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

// ── Voice Profile ────────────────────────────────────────────────────────────

/// Create a default male voice profile. Returns JSON.
#[napi]
pub fn dhvani_voice_profile_male() -> String {
    let profile = VoiceProfile::new_male();
    serde_json::to_string(&profile).unwrap_or_else(|_| "{}".to_string())
}

/// Create a default female voice profile. Returns JSON.
#[napi]
pub fn dhvani_voice_profile_female() -> String {
    let profile = VoiceProfile::new_female();
    serde_json::to_string(&profile).unwrap_or_else(|_| "{}".to_string())
}

/// Create a voice profile from JSON parameters. Returns JSON.
///
/// Accepts VoiceProfile fields: base_f0, f0_range, formant_scale,
/// breathiness, vibrato_rate, vibrato_depth, jitter, shimmer.
/// Plus "base": "male"|"female"|"child" to select starting preset.
#[napi]
pub fn dhvani_voice_profile_from_json(config_json: String) -> Result<String> {
    let config: serde_json::Value =
        serde_json::from_str(&config_json).map_err(|e| Error::from_reason(e.to_string()))?;

    let mut profile = match config.get("base").and_then(|v| v.as_str()) {
        Some("female") => VoiceProfile::new_female(),
        Some("child") => VoiceProfile::new_child(),
        _ => VoiceProfile::new_male(),
    };

    if let Some(v) = config.get("base_f0").and_then(|v| v.as_f64()) {
        profile.base_f0 = v as f32;
    }
    if let Some(v) = config.get("f0_range").and_then(|v| v.as_f64()) {
        profile.f0_range = v as f32;
    }
    if let Some(v) = config.get("formant_scale").and_then(|v| v.as_f64()) {
        profile.formant_scale = v as f32;
    }
    if let Some(v) = config.get("breathiness").and_then(|v| v.as_f64()) {
        profile.breathiness = v as f32;
    }
    if let Some(v) = config.get("vibrato_rate").and_then(|v| v.as_f64()) {
        profile.vibrato_rate = v as f32;
    }
    if let Some(v) = config.get("vibrato_depth").and_then(|v| v.as_f64()) {
        profile.vibrato_depth = v as f32;
    }
    if let Some(v) = config.get("jitter").and_then(|v| v.as_f64()) {
        profile.jitter = v as f32;
    }
    if let Some(v) = config.get("shimmer").and_then(|v| v.as_f64()) {
        profile.shimmer = v as f32;
    }

    serde_json::to_string(&profile).map_err(|e| Error::from_reason(e.to_string()))
}

// ── G2P (Grapheme-to-Phoneme) ────────────────────────────────────────────────

/// Convert text to phoneme events via shabda G2P engine.
/// Returns JSON array of PhonemeEvent (compatible with svara).
#[napi]
pub fn dhvani_g2p_convert(text: String, language: Option<String>) -> Result<String> {
    let lang = match language.as_deref() {
        Some("english") | Some("en") | None => Language::English,
        Some(other) => {
            return Err(Error::from_reason(format!(
                "Unsupported G2P language: {other}"
            )));
        }
    };

    let engine = G2PEngine::new(lang);
    let events = engine
        .convert(&text)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    serde_json::to_string(&events).map_err(|e| Error::from_reason(e.to_string()))
}

// ── Voice Synthesis ──────────────────────────────────────────────────────────

/// Synthesize speech from text using G2P -> PhonemeSequence -> VoiceProfile -> audio.
/// Returns raw PCM f32 samples as a Buffer (mono, at the given sample rate).
///
/// This is the full G2P pipeline: text -> phonemes -> vocal synthesis.
/// For direct phoneme synthesis (bypassing G2P), use dhvani_synthesize_phonemes.
#[napi]
pub fn dhvani_synthesize_speech(
    text: String,
    voice_profile_json: Option<String>,
    sample_rate: Option<u32>,
) -> Result<Buffer> {
    let sr = sample_rate.unwrap_or(44100);

    let profile: VoiceProfile = match voice_profile_json {
        Some(json) => serde_json::from_str(&json).map_err(|e| Error::from_reason(e.to_string()))?,
        None => VoiceProfile::new_male(),
    };

    // G2P: text -> phoneme events
    let engine = G2PEngine::new(Language::English);
    let events = engine
        .convert(&text)
        .map_err(|e| Error::from_reason(format!("G2P conversion failed: {e}")))?;

    // Build phoneme sequence and render
    let mut sequence = PhonemeSequence::new();
    for event in events {
        sequence.push(event);
    }

    let samples = sequence
        .render(&profile, sr as f32)
        .map_err(|e| Error::from_reason(format!("Voice synthesis failed: {e}")))?;

    Ok(samples_to_buffer(&samples))
}

/// Synthesize speech from pre-built phoneme events JSON.
/// Useful when phoneme events have been manually constructed or modified.
#[napi]
pub fn dhvani_synthesize_phonemes(
    phoneme_events_json: String,
    voice_profile_json: Option<String>,
    sample_rate: Option<u32>,
) -> Result<Buffer> {
    let sr = sample_rate.unwrap_or(44100);

    let profile: VoiceProfile = match voice_profile_json {
        Some(json) => serde_json::from_str(&json).map_err(|e| Error::from_reason(e.to_string()))?,
        None => VoiceProfile::new_male(),
    };

    let events: Vec<dhvani::voice_synth::PhonemeEvent> = serde_json::from_str(&phoneme_events_json)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    let mut sequence = PhonemeSequence::new();
    for event in events {
        sequence.push(event);
    }

    let samples = sequence
        .render(&profile, sr as f32)
        .map_err(|e| Error::from_reason(format!("Phoneme synthesis failed: {e}")))?;

    Ok(samples_to_buffer(&samples))
}

// ── Audio DSP ────────────────────────────────────────────────────────────────

/// Apply noise reduction to raw PCM audio (mono f32 samples).
/// Strength: 0.0 (none) to 1.0 (maximum). Default 0.5.
/// Returns cleaned audio as a Buffer.
#[napi]
pub fn dhvani_noise_reduce(
    audio: Buffer,
    sample_rate: u32,
    strength: Option<f64>,
    channels: Option<u32>,
) -> Result<Buffer> {
    let ch = channels.unwrap_or(1);
    let samples = buffer_to_samples(&audio);

    let mut buf = AudioBuffer::from_interleaved(samples, ch, sample_rate)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    let mut reducer = NoiseReducer::default();
    reducer.process(&mut buf, strength.unwrap_or(0.5) as f32);

    Ok(samples_to_buffer(buf.samples()))
}

/// Resample audio to a target sample rate. Returns resampled PCM f32 Buffer.
#[napi]
pub fn dhvani_resample(
    audio: Buffer,
    source_rate: u32,
    target_rate: u32,
    channels: Option<u32>,
) -> Result<Buffer> {
    let ch = channels.unwrap_or(1);
    let samples = buffer_to_samples(&audio);

    let buf = AudioBuffer::from_interleaved(samples, ch, source_rate)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    let resampled = dhvani::buffer::resample_linear(&buf, target_rate)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(samples_to_buffer(resampled.samples()))
}

/// Normalize audio to a target peak level. Returns normalized PCM f32 Buffer.
#[napi]
pub fn dhvani_normalize(
    audio: Buffer,
    sample_rate: u32,
    target_peak: f64,
    channels: Option<u32>,
) -> Result<Buffer> {
    let ch = channels.unwrap_or(1);
    let samples = buffer_to_samples(&audio);

    let mut buf = AudioBuffer::from_interleaved(samples, ch, sample_rate)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    dhvani::dsp::normalize(&mut buf, target_peak as f32);

    Ok(samples_to_buffer(buf.samples()))
}

// ── Audio Analysis ───────────────────────────────────────────────────────────

/// Analyze audio dynamics (peak, RMS, crest factor, dynamic range). Returns JSON.
#[napi]
pub fn dhvani_analyze_dynamics(
    audio: Buffer,
    sample_rate: u32,
    channels: Option<u32>,
) -> Result<String> {
    let ch = channels.unwrap_or(1);
    let samples = buffer_to_samples(&audio);

    let buf = AudioBuffer::from_interleaved(samples, ch, sample_rate)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    let d = dhvani::analysis::analyze_dynamics(&buf);

    let json = serde_json::json!({
        "peak": d.peak(),
        "peak_db": d.peak_db(),
        "true_peak": d.true_peak(),
        "true_peak_db": d.true_peak_db(),
        "rms": d.rms(),
        "rms_db": d.rms_db(),
        "crest_factor_db": d.crest_factor_db(),
        "lufs": d.lufs(),
        "dynamic_range_db": d.dynamic_range_db(),
        "max_peak_db": d.max_peak_db(),
        "max_true_peak_db": d.max_true_peak_db(),
        "mean_rms": d.mean_rms(),
        "frame_count": d.frame_count(),
        "channel_count": d.channel_count(),
    });

    Ok(json.to_string())
}

/// Measure loudness in LUFS (EBU R128). Returns f64.
#[napi]
pub fn dhvani_loudness_lufs(audio: Buffer, sample_rate: u32, channels: Option<u32>) -> Result<f64> {
    let ch = channels.unwrap_or(1);
    let samples = buffer_to_samples(&audio);

    let buf = AudioBuffer::from_interleaved(samples, ch, sample_rate)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(dhvani::analysis::loudness_lufs(&buf) as f64)
}

/// Check if audio buffer is silent (below threshold in dB). Returns bool.
/// Default threshold: -60 dB.
#[napi]
pub fn dhvani_is_silent(
    audio: Buffer,
    sample_rate: u32,
    threshold_db: Option<f64>,
    channels: Option<u32>,
) -> Result<bool> {
    let ch = channels.unwrap_or(1);
    let samples = buffer_to_samples(&audio);

    let buf = AudioBuffer::from_interleaved(samples, ch, sample_rate)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(dhvani::analysis::is_silent(
        &buf,
        threshold_db.unwrap_or(-60.0) as f32,
    ))
}

// ── Utility ──────────────────────────────────────────────────────────────────

/// Convert PCM f32 audio buffer to WAV format (mono/stereo). Returns WAV bytes as Buffer.
#[napi]
pub fn dhvani_pcm_to_wav(audio: Buffer, sample_rate: u32, channels: Option<u32>) -> Result<Buffer> {
    let ch = channels.unwrap_or(1);
    let samples = buffer_to_samples(&audio);

    // Convert f32 samples to 16-bit PCM
    let pcm16: Vec<u8> = samples
        .iter()
        .flat_map(|&s| {
            let clamped = s.clamp(-1.0, 1.0);
            let i16_val = (clamped * 32767.0) as i16;
            i16_val.to_le_bytes()
        })
        .collect();

    let data_len = pcm16.len() as u32;
    let byte_rate = sample_rate * ch * 2;
    let block_align = ch as u16 * 2;

    let mut wav = Vec::with_capacity(44 + pcm16.len());
    // RIFF header
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVE");
    // fmt chunk
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM format
    wav.extend_from_slice(&(ch as u16).to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    // data chunk
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    wav.extend_from_slice(&pcm16);

    Ok(wav.into())
}

/// Suggest gain adjustment to reach target RMS level. Returns f64 gain factor.
#[napi]
pub fn dhvani_suggest_gain(
    audio: Buffer,
    sample_rate: u32,
    target_rms: f64,
    channels: Option<u32>,
) -> Result<f64> {
    let ch = channels.unwrap_or(1);
    let samples = buffer_to_samples(&audio);

    let buf = AudioBuffer::from_interleaved(samples, ch, sample_rate)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(dhvani::analysis::suggest_gain(&buf, target_rms as f32) as f64)
}
