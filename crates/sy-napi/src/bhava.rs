//! Bhava personality engine — NAPI bindings for Node.js.
//!
//! Exposes bhava's personality, mood, spirit, archetype, and preset APIs
//! to the TypeScript layer via JSON serialization.

use napi::bindgen_prelude::*;
use napi_derive::napi;

use bhava::archetype::{self, IdentityContent, IdentityLayer};
use bhava::circadian::{Chronotype, CircadianRhythm};
use bhava::energy::{self, EnergyState};
use bhava::flow::FlowState;
use bhava::monitor::SentimentMonitor;
use bhava::mood::{self, Emotion, EmotionalState};
use bhava::presets;
use bhava::regulation::{self, RegulatedMood, RegulationStrategy};
use bhava::sentiment;
use bhava::spirit::Spirit;
use bhava::stress::{self, StressState};
use bhava::traits::{PersonalityProfile, TraitGroup, TraitKind, TraitLevel};
use bhava::zodiac::{self, ZodiacSign};

// ── Trait Level Mapping ────────────────────────────────────────────────────
//
// SY stores trait levels as descriptive strings ("casual", "dry", "formal").
// Bhava uses normalized levels ("lowest", "low", "balanced", "high", "highest").
// This mapping converts SY descriptive names → bhava TraitLevel.

fn sy_level_to_bhava(trait_key: &str, level: &str) -> Option<TraitLevel> {
    let lower = level.to_lowercase();
    if lower == "balanced" {
        return Some(TraitLevel::Balanced);
    }
    // Map each trait's SY descriptive names to bhava levels (positional)
    match (trait_key, lower.as_str()) {
        // formality: street → casual → [balanced] → formal → ceremonial
        ("formality", "street") => Some(TraitLevel::Lowest),
        ("formality", "casual") => Some(TraitLevel::Low),
        ("formality", "formal") => Some(TraitLevel::High),
        ("formality", "ceremonial") => Some(TraitLevel::Highest),
        // humor: deadpan → dry → [balanced] → witty → comedic
        ("humor", "deadpan") => Some(TraitLevel::Lowest),
        ("humor", "dry") => Some(TraitLevel::Low),
        ("humor", "witty") => Some(TraitLevel::High),
        ("humor", "comedic") => Some(TraitLevel::Highest),
        // verbosity: terse → concise → [balanced] → detailed → exhaustive
        ("verbosity", "terse") => Some(TraitLevel::Lowest),
        ("verbosity", "concise") => Some(TraitLevel::Low),
        ("verbosity", "detailed") => Some(TraitLevel::High),
        ("verbosity", "exhaustive") => Some(TraitLevel::Highest),
        // directness: evasive → diplomatic → [balanced] → candid → blunt
        ("directness", "evasive") => Some(TraitLevel::Lowest),
        ("directness", "diplomatic") => Some(TraitLevel::Low),
        ("directness", "candid") => Some(TraitLevel::High),
        ("directness", "blunt") => Some(TraitLevel::Highest),
        // warmth: cold → reserved → [balanced] → friendly → effusive
        ("warmth", "cold") => Some(TraitLevel::Lowest),
        ("warmth", "reserved") => Some(TraitLevel::Low),
        ("warmth", "friendly") => Some(TraitLevel::High),
        ("warmth", "effusive") => Some(TraitLevel::Highest),
        // empathy: detached → analytical → [balanced] → empathetic → compassionate
        ("empathy", "detached") => Some(TraitLevel::Lowest),
        ("empathy", "analytical") => Some(TraitLevel::Low),
        ("empathy", "empathetic") => Some(TraitLevel::High),
        ("empathy", "compassionate") => Some(TraitLevel::Highest),
        // patience: brisk → efficient → [balanced] → patient → nurturing
        ("patience", "brisk") => Some(TraitLevel::Lowest),
        ("patience", "efficient") => Some(TraitLevel::Low),
        ("patience", "patient") => Some(TraitLevel::High),
        ("patience", "nurturing") => Some(TraitLevel::Highest),
        // confidence: humble → modest → [balanced] → assertive → authoritative
        ("confidence", "humble") => Some(TraitLevel::Lowest),
        ("confidence", "modest") => Some(TraitLevel::Low),
        ("confidence", "assertive") => Some(TraitLevel::High),
        ("confidence", "authoritative") => Some(TraitLevel::Highest),
        // creativity: rigid → conventional → [balanced] → imaginative → avant-garde
        ("creativity", "rigid") => Some(TraitLevel::Lowest),
        ("creativity", "conventional") => Some(TraitLevel::Low),
        ("creativity", "imaginative") => Some(TraitLevel::High),
        ("creativity", "avant-garde") => Some(TraitLevel::Highest),
        // risk_tolerance: risk-averse → cautious → [balanced] → bold → reckless
        ("risk_tolerance", "risk-averse") => Some(TraitLevel::Lowest),
        ("risk_tolerance", "cautious") => Some(TraitLevel::Low),
        ("risk_tolerance", "bold") => Some(TraitLevel::High),
        ("risk_tolerance", "reckless") => Some(TraitLevel::Highest),
        // curiosity: narrow → focused → [balanced] → curious → exploratory
        ("curiosity", "narrow") => Some(TraitLevel::Lowest),
        ("curiosity", "focused") => Some(TraitLevel::Low),
        ("curiosity", "curious") => Some(TraitLevel::High),
        ("curiosity", "exploratory") => Some(TraitLevel::Highest),
        // skepticism: gullible → trusting → [balanced] → skeptical → contrarian
        ("skepticism", "gullible") => Some(TraitLevel::Lowest),
        ("skepticism", "trusting") => Some(TraitLevel::Low),
        ("skepticism", "skeptical") => Some(TraitLevel::High),
        ("skepticism", "contrarian") => Some(TraitLevel::Highest),
        // autonomy: dependent → consultative → [balanced] → proactive → autonomous
        ("autonomy", "dependent") => Some(TraitLevel::Lowest),
        ("autonomy", "consultative") => Some(TraitLevel::Low),
        ("autonomy", "proactive") => Some(TraitLevel::High),
        ("autonomy", "autonomous") => Some(TraitLevel::Highest),
        // pedagogy: terse-answer → answer-focused → [balanced] → explanatory → socratic
        ("pedagogy", "terse-answer") => Some(TraitLevel::Lowest),
        ("pedagogy", "answer-focused") => Some(TraitLevel::Low),
        ("pedagogy", "explanatory") => Some(TraitLevel::High),
        ("pedagogy", "socratic") => Some(TraitLevel::Highest),
        // precision: approximate → loose → [balanced] → precise → meticulous
        ("precision", "approximate") => Some(TraitLevel::Lowest),
        ("precision", "loose") => Some(TraitLevel::Low),
        ("precision", "precise") => Some(TraitLevel::High),
        ("precision", "meticulous") => Some(TraitLevel::Highest),
        _ => None,
    }
}

fn bhava_level_to_sy(trait_key: &str, level: TraitLevel) -> &'static str {
    match level {
        TraitLevel::Balanced => "balanced",
        _ => match (trait_key, level) {
            ("formality", TraitLevel::Lowest) => "street",
            ("formality", TraitLevel::Low) => "casual",
            ("formality", TraitLevel::High) => "formal",
            ("formality", TraitLevel::Highest) => "ceremonial",
            ("humor", TraitLevel::Lowest) => "deadpan",
            ("humor", TraitLevel::Low) => "dry",
            ("humor", TraitLevel::High) => "witty",
            ("humor", TraitLevel::Highest) => "comedic",
            ("verbosity", TraitLevel::Lowest) => "terse",
            ("verbosity", TraitLevel::Low) => "concise",
            ("verbosity", TraitLevel::High) => "detailed",
            ("verbosity", TraitLevel::Highest) => "exhaustive",
            ("directness", TraitLevel::Lowest) => "evasive",
            ("directness", TraitLevel::Low) => "diplomatic",
            ("directness", TraitLevel::High) => "candid",
            ("directness", TraitLevel::Highest) => "blunt",
            ("warmth", TraitLevel::Lowest) => "cold",
            ("warmth", TraitLevel::Low) => "reserved",
            ("warmth", TraitLevel::High) => "friendly",
            ("warmth", TraitLevel::Highest) => "effusive",
            ("empathy", TraitLevel::Lowest) => "detached",
            ("empathy", TraitLevel::Low) => "analytical",
            ("empathy", TraitLevel::High) => "empathetic",
            ("empathy", TraitLevel::Highest) => "compassionate",
            ("patience", TraitLevel::Lowest) => "brisk",
            ("patience", TraitLevel::Low) => "efficient",
            ("patience", TraitLevel::High) => "patient",
            ("patience", TraitLevel::Highest) => "nurturing",
            ("confidence", TraitLevel::Lowest) => "humble",
            ("confidence", TraitLevel::Low) => "modest",
            ("confidence", TraitLevel::High) => "assertive",
            ("confidence", TraitLevel::Highest) => "authoritative",
            ("creativity", TraitLevel::Lowest) => "rigid",
            ("creativity", TraitLevel::Low) => "conventional",
            ("creativity", TraitLevel::High) => "imaginative",
            ("creativity", TraitLevel::Highest) => "avant-garde",
            ("risk_tolerance", TraitLevel::Lowest) => "risk-averse",
            ("risk_tolerance", TraitLevel::Low) => "cautious",
            ("risk_tolerance", TraitLevel::High) => "bold",
            ("risk_tolerance", TraitLevel::Highest) => "reckless",
            ("curiosity", TraitLevel::Lowest) => "narrow",
            ("curiosity", TraitLevel::Low) => "focused",
            ("curiosity", TraitLevel::High) => "curious",
            ("curiosity", TraitLevel::Highest) => "exploratory",
            ("skepticism", TraitLevel::Lowest) => "gullible",
            ("skepticism", TraitLevel::Low) => "trusting",
            ("skepticism", TraitLevel::High) => "skeptical",
            ("skepticism", TraitLevel::Highest) => "contrarian",
            ("autonomy", TraitLevel::Lowest) => "dependent",
            ("autonomy", TraitLevel::Low) => "consultative",
            ("autonomy", TraitLevel::High) => "proactive",
            ("autonomy", TraitLevel::Highest) => "autonomous",
            ("pedagogy", TraitLevel::Lowest) => "terse-answer",
            ("pedagogy", TraitLevel::Low) => "answer-focused",
            ("pedagogy", TraitLevel::High) => "explanatory",
            ("pedagogy", TraitLevel::Highest) => "socratic",
            ("precision", TraitLevel::Lowest) => "approximate",
            ("precision", TraitLevel::Low) => "loose",
            ("precision", TraitLevel::High) => "precise",
            ("precision", TraitLevel::Highest) => "meticulous",
            _ => "balanced",
        },
    }
}

fn parse_trait_kind(s: &str) -> Option<TraitKind> {
    match s {
        "formality" => Some(TraitKind::Formality),
        "humor" => Some(TraitKind::Humor),
        "verbosity" => Some(TraitKind::Verbosity),
        "directness" => Some(TraitKind::Directness),
        "warmth" => Some(TraitKind::Warmth),
        "empathy" => Some(TraitKind::Empathy),
        "patience" => Some(TraitKind::Patience),
        "confidence" => Some(TraitKind::Confidence),
        "creativity" => Some(TraitKind::Creativity),
        "risk_tolerance" => Some(TraitKind::RiskTolerance),
        "curiosity" => Some(TraitKind::Curiosity),
        "skepticism" => Some(TraitKind::Skepticism),
        "autonomy" => Some(TraitKind::Autonomy),
        "pedagogy" => Some(TraitKind::Pedagogy),
        "precision" => Some(TraitKind::Precision),
        _ => None,
    }
}

fn trait_kind_to_str(k: TraitKind) -> &'static str {
    match k {
        TraitKind::Formality => "formality",
        TraitKind::Humor => "humor",
        TraitKind::Verbosity => "verbosity",
        TraitKind::Directness => "directness",
        TraitKind::Warmth => "warmth",
        TraitKind::Empathy => "empathy",
        TraitKind::Patience => "patience",
        TraitKind::Confidence => "confidence",
        TraitKind::Creativity => "creativity",
        TraitKind::RiskTolerance => "risk_tolerance",
        TraitKind::Curiosity => "curiosity",
        TraitKind::Skepticism => "skepticism",
        TraitKind::Autonomy => "autonomy",
        TraitKind::Pedagogy => "pedagogy",
        TraitKind::Precision => "precision",
        _ => "unknown",
    }
}

/// Build a PersonalityProfile from SY's trait map (Record<string, string>).
fn profile_from_sy_traits(
    name: &str,
    traits: &serde_json::Map<String, serde_json::Value>,
) -> PersonalityProfile {
    let mut profile = PersonalityProfile::new(name);
    for (key, value) in traits {
        if let Some(level_str) = value.as_str()
            && let Some(kind) = parse_trait_kind(key)
            && let Some(level) = sy_level_to_bhava(key, level_str)
        {
            profile.set_trait(kind, level);
        }
    }
    profile
}

/// Serialize a PersonalityProfile to SY-compatible JSON with descriptive trait names.
fn profile_to_sy_json(profile: &PersonalityProfile) -> serde_json::Value {
    let mut traits = serde_json::Map::new();
    for &kind in TraitKind::ALL {
        let key = trait_kind_to_str(kind);
        let level = profile.get_trait(kind);
        let sy_name = bhava_level_to_sy(key, level);
        traits.insert(
            key.to_string(),
            serde_json::Value::String(sy_name.to_string()),
        );
    }

    serde_json::json!({
        "name": profile.name,
        "description": profile.description,
        "traits": traits,
    })
}

// ── Personality Profile ────────────────────────────────────────────────────

/// Create a bhava PersonalityProfile from SY's trait map.
/// Input: name (string), traits_json (JSON object: { "formality": "casual", ... })
/// Returns: JSON profile with SY-compatible trait names.
#[napi]
pub fn bhava_create_profile(name: String, traits_json: String) -> Result<String> {
    let traits: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&traits_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let profile = profile_from_sy_traits(&name, &traits);
    serde_json::to_string(&profile_to_sy_json(&profile))
        .map_err(|e| Error::from_reason(format!("{e}")))
}

/// Compose trait disposition prompt from SY trait map.
/// Returns: the "## Personality" section text from bhava's trait engine.
#[napi]
pub fn bhava_compose_trait_prompt(traits_json: String) -> Result<String> {
    let traits: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&traits_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let profile = profile_from_sy_traits("_", &traits);
    Ok(profile.compose_prompt())
}

/// Compute personality compatibility (0.0-1.0) between two SY trait maps.
#[napi]
pub fn bhava_profile_compatibility(a_json: String, b_json: String) -> Result<f64> {
    let a: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&a_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let b: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&b_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let pa = profile_from_sy_traits("a", &a);
    let pb = profile_from_sy_traits("b", &b);
    Ok(pa.compatibility(&pb) as f64)
}

/// Export a personality profile as markdown.
#[napi]
pub fn bhava_profile_to_markdown(name: String, traits_json: String) -> Result<String> {
    let traits: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&traits_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let profile = profile_from_sy_traits(&name, &traits);
    Ok(profile.to_markdown())
}

/// Import a personality profile from markdown. Returns JSON profile or error.
#[napi]
pub fn bhava_profile_from_markdown(markdown: String) -> Result<String> {
    let profile = PersonalityProfile::from_markdown(&markdown)
        .ok_or_else(|| Error::from_reason("Failed to parse personality markdown"))?;
    serde_json::to_string(&profile_to_sy_json(&profile))
        .map_err(|e| Error::from_reason(format!("{e}")))
}

// ── Presets ────────────────────────────────────────────────────────────────

/// List all available bhava preset IDs.
#[napi]
pub fn bhava_list_presets() -> String {
    serde_json::to_string(presets::list_presets()).unwrap_or_else(|_| "[]".to_string())
}

/// Get a preset by ID. Returns JSON { profile, identity } or error.
#[napi]
pub fn bhava_get_preset(id: String) -> Result<String> {
    let preset = presets::get_preset(&id)
        .ok_or_else(|| Error::from_reason(format!("Unknown preset: {id}")))?;

    let profile_json = profile_to_sy_json(&preset.profile);
    let identity_json = serde_json::json!({
        "soul": preset.identity.get(IdentityLayer::Soul),
        "spirit": preset.identity.get(IdentityLayer::Spirit),
        "brain": preset.identity.get(IdentityLayer::Brain),
        "body": preset.identity.get(IdentityLayer::Body),
        "heart": preset.identity.get(IdentityLayer::Heart),
    });

    let result = serde_json::json!({
        "id": preset.id,
        "name": preset.name,
        "summary": preset.summary,
        "profile": profile_json,
        "identity": identity_json,
    });

    serde_json::to_string(&result).map_err(|e| Error::from_reason(format!("{e}")))
}

// ── Archetypes / Identity ──────────────────────────────────────────────────

/// Compose the "In Our Image" cosmological preamble.
#[napi]
pub fn bhava_compose_preamble() -> String {
    archetype::compose_preamble()
}

/// Compose identity prompt from identity JSON.
/// Input: JSON { soul?: string, spirit?: string, brain?: string, body?: string, heart?: string }
#[napi]
pub fn bhava_compose_identity_prompt(identity_json: String) -> Result<String> {
    let identity = parse_identity(&identity_json)?;
    Ok(archetype::compose_identity_prompt(&identity))
}

fn parse_identity(json: &str) -> Result<IdentityContent> {
    let v: serde_json::Value =
        serde_json::from_str(json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let mut identity = IdentityContent::default();
    if let Some(s) = v.get("soul").and_then(|v| v.as_str()) {
        identity.set(IdentityLayer::Soul, s);
    }
    if let Some(s) = v.get("spirit").and_then(|v| v.as_str()) {
        identity.set(IdentityLayer::Spirit, s);
    }
    if let Some(s) = v.get("brain").and_then(|v| v.as_str()) {
        identity.set(IdentityLayer::Brain, s);
    }
    if let Some(s) = v.get("body").and_then(|v| v.as_str()) {
        identity.set(IdentityLayer::Body, s);
    }
    if let Some(s) = v.get("heart").and_then(|v| v.as_str()) {
        identity.set(IdentityLayer::Heart, s);
    }
    Ok(identity)
}

// ── Emotional State / Mood ─────────────────────────────────────────────────

/// Create a new neutral emotional state. Returns JSON.
#[napi]
pub fn bhava_create_emotional_state() -> String {
    let state = EmotionalState::new();
    serde_json::to_string(&state).unwrap_or_else(|_| "{}".to_string())
}

/// Create an emotional state with baseline derived from personality traits.
/// Input: SY traits JSON { "formality": "casual", ... }
#[napi]
pub fn bhava_create_emotional_state_with_baseline(traits_json: String) -> Result<String> {
    let traits: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&traits_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let profile = profile_from_sy_traits("_", &traits);
    let baseline = mood::derive_mood_baseline(&profile);
    let state = EmotionalState::with_baseline(baseline);
    serde_json::to_string(&state).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Derive mood baseline from SY traits. Returns JSON { joy, arousal, dominance, trust, interest, frustration }.
#[napi]
pub fn bhava_derive_baseline(traits_json: String) -> Result<String> {
    let traits: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&traits_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let profile = profile_from_sy_traits("_", &traits);
    let baseline = mood::derive_mood_baseline(&profile);
    serde_json::to_string(&baseline).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Stimulate an emotion on an emotional state.
/// Input: state_json, emotion ("joy"|"arousal"|"dominance"|"trust"|"interest"|"frustration"), intensity (f64)
#[napi]
pub fn bhava_stimulate(state_json: String, emotion: String, intensity: f64) -> Result<String> {
    let mut state: EmotionalState =
        serde_json::from_str(&state_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let emo = parse_emotion(&emotion)?;
    state.stimulate(emo, intensity as f32);
    serde_json::to_string(&state).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Apply time-based mood decay toward baseline. Returns updated state JSON.
#[napi]
pub fn bhava_apply_decay(state_json: String) -> Result<String> {
    let mut state: EmotionalState =
        serde_json::from_str(&state_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    state.apply_decay(chrono::Utc::now());
    serde_json::to_string(&state).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Classify current mood state. Returns mood label string.
#[napi]
pub fn bhava_classify_mood(state_json: String) -> Result<String> {
    let state: EmotionalState =
        serde_json::from_str(&state_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    Ok(state.classify().to_string())
}

/// Get mood deviation from baseline. Returns f64.
#[napi]
pub fn bhava_mood_deviation(state_json: String) -> Result<f64> {
    let state: EmotionalState =
        serde_json::from_str(&state_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    Ok(state.deviation() as f64)
}

/// Compose mood prompt fragment for system prompt injection.
#[napi]
pub fn bhava_compose_mood_prompt(state_json: String) -> Result<String> {
    let state: EmotionalState =
        serde_json::from_str(&state_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    Ok(mood::compose_mood_prompt(&state))
}

/// Compute action tendency from mood vector. Returns JSON.
#[napi]
pub fn bhava_action_tendency(state_json: String) -> Result<String> {
    let state: EmotionalState =
        serde_json::from_str(&state_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let tendency = mood::action_tendency(&state.mood);
    let result = format!("{tendency:?}");
    Ok(result)
}

fn parse_emotion(s: &str) -> Result<Emotion> {
    match s.to_lowercase().as_str() {
        "joy" => Ok(Emotion::Joy),
        "arousal" => Ok(Emotion::Arousal),
        "dominance" => Ok(Emotion::Dominance),
        "trust" => Ok(Emotion::Trust),
        "interest" => Ok(Emotion::Interest),
        "frustration" => Ok(Emotion::Frustration),
        _ => Err(Error::from_reason(format!("Unknown emotion: {s}"))),
    }
}

// ── Spirit ─────────────────────────────────────────────────────────────────

/// Create a new empty spirit. Returns JSON.
#[napi]
pub fn bhava_create_spirit() -> String {
    let spirit = Spirit::new();
    serde_json::to_string(&spirit).unwrap_or_else(|_| "{}".to_string())
}

/// Build a spirit from SY passion/inspiration/pain data arrays.
/// Each input is a JSON array: [{ name/source/trigger, description, intensity/impact/severity }]
#[napi]
pub fn bhava_spirit_from_data(
    passions_json: String,
    inspirations_json: String,
    pains_json: String,
) -> Result<String> {
    let mut spirit = Spirit::new();

    // Parse passions
    if let Ok(passions) = serde_json::from_str::<Vec<serde_json::Value>>(&passions_json) {
        for p in passions {
            let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let desc = p.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let intensity = p.get("intensity").and_then(|v| v.as_f64()).unwrap_or(0.5) as f32;
            if !name.is_empty() {
                spirit.add_passion(name, desc, intensity);
            }
        }
    }

    // Parse inspirations
    if let Ok(inspirations) = serde_json::from_str::<Vec<serde_json::Value>>(&inspirations_json) {
        for i in inspirations {
            let source = i.get("source").and_then(|v| v.as_str()).unwrap_or("");
            let desc = i.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let impact = i.get("impact").and_then(|v| v.as_f64()).unwrap_or(0.5) as f32;
            if !source.is_empty() {
                spirit.add_inspiration(source, desc, impact);
            }
        }
    }

    // Parse pains
    if let Ok(pains) = serde_json::from_str::<Vec<serde_json::Value>>(&pains_json) {
        for p in pains {
            let trigger = p
                .get("trigger")
                .or_else(|| p.get("trigger_name"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let desc = p.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let severity = p.get("severity").and_then(|v| v.as_f64()).unwrap_or(0.5) as f32;
            if !trigger.is_empty() {
                spirit.add_pain(trigger, desc, severity);
            }
        }
    }

    serde_json::to_string(&spirit).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Compose spirit prompt section from spirit JSON.
#[napi]
pub fn bhava_compose_spirit_prompt(spirit_json: String) -> Result<String> {
    let spirit: Spirit =
        serde_json::from_str(&spirit_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    Ok(spirit.compose_prompt())
}

// ── Sentiment Feedback ─────────────────────────────────────────────────────

/// Analyze text sentiment and apply feedback to emotional state.
/// Returns JSON { state: EmotionalState, valence: f32, confidence: f32 }.
#[napi]
pub fn bhava_apply_sentiment_feedback(
    text: String,
    state_json: String,
    scale: f64,
) -> Result<String> {
    let mut state: EmotionalState =
        serde_json::from_str(&state_json).map_err(|e| Error::from_reason(format!("{e}")))?;

    let result = sentiment::analyze(&text);
    let scale = (scale as f32).clamp(0.0, 1.0);
    for &(emotion, intensity) in &result.emotions {
        state.stimulate(emotion, intensity * scale);
    }

    let output = serde_json::json!({
        "state": state,
        "valence": result.valence,
        "confidence": result.confidence,
        "is_positive": result.is_positive(),
        "is_negative": result.is_negative(),
    });

    serde_json::to_string(&output).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Apply a mood trigger from interaction outcome.
/// outcome: "praised"|"criticized"|"surprised"|"threatened"|"neutral"
#[napi]
pub fn bhava_feedback_from_outcome(state_json: String, outcome: String) -> Result<String> {
    let mut state: EmotionalState =
        serde_json::from_str(&state_json).map_err(|e| Error::from_reason(format!("{e}")))?;

    match outcome.to_lowercase().as_str() {
        "praised" => state.apply_trigger(&mood::trigger_praised()),
        "criticized" => state.apply_trigger(&mood::trigger_criticized()),
        "surprised" => state.apply_trigger(&mood::trigger_surprised()),
        "threatened" => state.apply_trigger(&mood::trigger_threatened()),
        "neutral" => {}
        _ => return Err(Error::from_reason(format!("Unknown outcome: {outcome}"))),
    }

    serde_json::to_string(&state).map_err(|e| Error::from_reason(format!("{e}")))
}

// ── Reasoning Strategy ─────────────────────────────────────────────────────

/// Select dominant reasoning strategy from personality traits.
/// Returns JSON { strategy: string, description: string, scores: [[strategy, score]] }.
#[napi]
pub fn bhava_select_reasoning_strategy(traits_json: String) -> Result<String> {
    let traits: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&traits_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let profile = profile_from_sy_traits("_", &traits);

    let strategy = bhava::reasoning::select_reasoning_strategy(&profile);
    let description = bhava::reasoning::strategy_description(strategy);
    let scores: Vec<(String, f32)> = bhava::reasoning::reasoning_scores(&profile)
        .into_iter()
        .map(|(s, score)| (s.to_string(), score))
        .collect();

    let result = serde_json::json!({
        "strategy": strategy.to_string(),
        "description": description,
        "scores": scores,
    });

    serde_json::to_string(&result).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Compose reasoning strategy prompt fragment from personality traits.
#[napi]
pub fn bhava_compose_reasoning_prompt(traits_json: String) -> Result<String> {
    let traits: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&traits_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let profile = profile_from_sy_traits("_", &traits);
    Ok(bhava::reasoning::compose_reasoning_prompt(&profile))
}

// ── EQ (Emotional Intelligence) ───────────────────────────────────────────

/// Derive EQ profile from personality traits.
/// Returns JSON { perception, facilitation, understanding, management, overall, level }.
#[napi]
pub fn bhava_derive_eq(traits_json: String) -> Result<String> {
    let traits: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&traits_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let profile = profile_from_sy_traits("_", &traits);
    let eq = bhava::eq::eq_from_personality(&profile);

    let result = serde_json::json!({
        "perception": eq.perception,
        "facilitation": eq.facilitation,
        "understanding": eq.understanding,
        "management": eq.management,
        "overall": eq.overall(),
        "level": eq.level().to_string(),
        "perception_bonus": eq.perception_bonus(),
        "management_bonus": eq.management_bonus(),
        "stress_recovery_bonus": eq.stress_recovery_bonus(),
        "contagion_resistance": eq.contagion_resistance(),
    });

    serde_json::to_string(&result).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Compose EQ prompt fragment for system prompt injection.
#[napi]
pub fn bhava_compose_eq_prompt(traits_json: String) -> Result<String> {
    let traits: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&traits_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let profile = profile_from_sy_traits("_", &traits);
    let eq = bhava::eq::eq_from_personality(&profile);
    Ok(bhava::eq::compose_eq_prompt(&eq))
}

// ── Full System Prompt Composition ─────────────────────────────────────────

/// Compose the complete personality section of a system prompt.
/// Combines identity preamble + trait disposition + mood + spirit.
/// Input: traits_json, identity_json, state_json (optional "null"), spirit_text (optional "")
#[napi]
pub fn bhava_compose_system_prompt(
    traits_json: String,
    identity_json: String,
    state_json: String,
    spirit_text: String,
) -> Result<String> {
    let traits: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&traits_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let profile = profile_from_sy_traits("_", &traits);
    let identity = parse_identity(&identity_json)?;

    let mood: Option<EmotionalState> = if state_json == "null" || state_json.is_empty() {
        None
    } else {
        serde_json::from_str(&state_json).ok()
    };

    // Build prompt in the same order as bhava::ai::compose_system_prompt
    let mut prompt = archetype::compose_identity_prompt(&identity);

    let disposition = profile.compose_prompt();
    if !disposition.is_empty() {
        prompt.push('\n');
        prompt.push_str(&disposition);
    }

    if let Some(ref state) = mood {
        prompt.push('\n');
        prompt.push_str(&mood::compose_mood_prompt(state));
    }

    let spirit_trimmed = spirit_text.trim();
    if !spirit_trimmed.is_empty() {
        prompt.push_str("\n## Spirit\n\n");
        prompt.push_str(spirit_trimmed);
        prompt.push('\n');
    }

    Ok(prompt)
}

// ── Metadata ───────────────────────────────────────────────────────────────

/// Build personality metadata for agent registration.
/// Returns JSON { name, description, active_traits, mood_state, group_averages }.
#[napi]
pub fn bhava_build_metadata(
    name: String,
    traits_json: String,
    state_json: String,
) -> Result<String> {
    let traits: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&traits_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let profile = profile_from_sy_traits(&name, &traits);

    let mood: Option<EmotionalState> = if state_json == "null" || state_json.is_empty() {
        None
    } else {
        serde_json::from_str(&state_json).ok()
    };

    let active_traits: Vec<serde_json::Value> = profile
        .active_traits()
        .into_iter()
        .map(|tv| {
            let key = trait_kind_to_str(tv.trait_name);
            let sy_level = bhava_level_to_sy(key, tv.level);
            serde_json::json!([key, sy_level])
        })
        .collect();

    let group_averages: Vec<serde_json::Value> = TraitGroup::ALL
        .iter()
        .map(|&g| serde_json::json!([g.to_string(), profile.group_average(g)]))
        .collect();

    let mood_state = mood.map(|s| s.classify().to_string());

    let result = serde_json::json!({
        "name": name,
        "description": profile.description,
        "active_traits": active_traits,
        "mood_state": mood_state,
        "group_averages": group_averages,
    });

    serde_json::to_string(&result).map_err(|e| Error::from_reason(format!("{e}")))
}

// ── Zodiac Engine ─────────────────────────────────────────────────────────
//
// The zodiac chart sets initial conditions. bhava computes the personality;
// the LLM doesn't know it's a Scorpio — it just follows trait instructions.

fn parse_zodiac_sign(s: &str) -> Result<ZodiacSign> {
    match s.to_lowercase().as_str() {
        "aries" => Ok(ZodiacSign::Aries),
        "taurus" => Ok(ZodiacSign::Taurus),
        "gemini" => Ok(ZodiacSign::Gemini),
        "cancer" => Ok(ZodiacSign::Cancer),
        "leo" => Ok(ZodiacSign::Leo),
        "virgo" => Ok(ZodiacSign::Virgo),
        "libra" => Ok(ZodiacSign::Libra),
        "scorpio" => Ok(ZodiacSign::Scorpio),
        "sagittarius" => Ok(ZodiacSign::Sagittarius),
        "capricorn" => Ok(ZodiacSign::Capricorn),
        "aquarius" => Ok(ZodiacSign::Aquarius),
        "pisces" => Ok(ZodiacSign::Pisces),
        _ => Err(Error::from_reason(format!("Unknown zodiac sign: {s}"))),
    }
}

/// List all zodiac signs.
#[napi]
pub fn bhava_list_zodiac_signs() -> String {
    let signs: Vec<String> = ZodiacSign::ALL.iter().map(|s| s.to_string()).collect();
    serde_json::to_string(&signs).unwrap_or_else(|_| "[]".to_string())
}

/// Get a personality profile derived from a zodiac sign.
/// Returns JSON profile with SY-compatible trait names.
#[napi]
pub fn bhava_zodiac_profile(sign: String) -> Result<String> {
    let sign = parse_zodiac_sign(&sign)?;
    let profile = zodiac::sign_profile(sign);
    serde_json::to_string(&profile_to_sy_json(&profile))
        .map_err(|e| Error::from_reason(format!("{e}")))
}

/// Get element and modality for a zodiac sign.
/// Returns JSON { sign, element, modality }.
#[napi]
pub fn bhava_zodiac_info(sign: String) -> Result<String> {
    let sign = parse_zodiac_sign(&sign)?;
    let result = serde_json::json!({
        "sign": sign.to_string(),
        "element": zodiac::sign_element(sign).to_string(),
        "modality": zodiac::sign_modality(sign).to_string(),
    });
    serde_json::to_string(&result).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Manifest a zodiac sign into a full personality with mood baseline.
/// Returns JSON { profile, baseline } — the initial conditions for the signal loop.
#[napi]
pub fn bhava_zodiac_manifest(sign: String) -> Result<String> {
    let sign = parse_zodiac_sign(&sign)?;
    let profile = zodiac::sign_profile(sign);
    let baseline = mood::derive_mood_baseline(&profile);
    let result = serde_json::json!({
        "profile": profile_to_sy_json(&profile),
        "baseline": baseline,
    });
    serde_json::to_string(&result).map_err(|e| Error::from_reason(format!("{e}")))
}

// ── Regulation ────────────────────────────────────────────────────────────
//
// Separates felt mood from expressed mood. The LLM gets the expressed mood;
// the felt mood drives internal state transitions.

/// Create a regulated mood from an emotional state (no regulation applied).
/// Returns JSON RegulatedMood.
#[napi]
pub fn bhava_create_regulated_mood(state_json: String) -> Result<String> {
    let state: EmotionalState =
        serde_json::from_str(&state_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let regulated = RegulatedMood::from_state(&state);
    serde_json::to_string(&regulated).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Apply a regulation strategy to a regulated mood.
/// strategy: "accept"|"suppress"|"reappraise"|"distract"
/// Returns updated RegulatedMood JSON.
#[napi]
pub fn bhava_regulate(
    regulated_json: String,
    strategy: String,
    target_emotion: String,
    strength: f64,
    effectiveness: f64,
) -> Result<String> {
    let mut regulated: RegulatedMood =
        serde_json::from_str(&regulated_json).map_err(|e| Error::from_reason(format!("{e}")))?;

    let strat = match strategy.to_lowercase().as_str() {
        "accept" => RegulationStrategy::Accept,
        "suppress" => {
            let emo = parse_emotion(&target_emotion)?;
            RegulationStrategy::Suppress {
                target: emo,
                strength: strength as f32,
            }
        }
        "reappraise" => {
            let emo = parse_emotion(&target_emotion)?;
            RegulationStrategy::Reappraise {
                target: emo,
                reduction: strength as f32,
            }
        }
        "distract" => RegulationStrategy::Distract {
            decay_boost: strength as f32,
        },
        _ => return Err(Error::from_reason(format!("Unknown strategy: {strategy}"))),
    };

    regulated.regulate(strat, effectiveness as f32);
    serde_json::to_string(&regulated).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Derive default regulation strategy from personality traits for a given emotion.
/// Returns JSON RegulationStrategy.
#[napi]
pub fn bhava_default_regulation_strategy(
    traits_json: String,
    dominant_emotion: String,
) -> Result<String> {
    let traits: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&traits_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let profile = profile_from_sy_traits("_", &traits);
    let emo = parse_emotion(&dominant_emotion)?;
    let strategy = regulation::default_strategy(&profile, emo);
    serde_json::to_string(&strategy).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Get the suppression gap (how much the agent is hiding). Returns f64.
#[napi]
pub fn bhava_suppression_gap(regulated_json: String) -> Result<f64> {
    let regulated: RegulatedMood =
        serde_json::from_str(&regulated_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    Ok(regulated.suppression_gap() as f64)
}

// ── Stress ────────────────────────────────────────────────────────────────
//
// Chronic accumulated emotional wear. Degrades regulation effectiveness.

/// Create a stress state from personality traits.
/// Returns JSON StressState.
#[napi]
pub fn bhava_create_stress_state(traits_json: String) -> Result<String> {
    let traits: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&traits_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let profile = profile_from_sy_traits("_", &traits);
    let state = stress::stress_from_personality(&profile);
    serde_json::to_string(&state).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Tick stress state based on current mood vector.
/// Returns updated StressState JSON.
#[napi]
pub fn bhava_stress_tick(stress_json: String, state_json: String) -> Result<String> {
    let mut stress_state: StressState =
        serde_json::from_str(&stress_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let emotional_state: EmotionalState =
        serde_json::from_str(&state_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    stress_state.tick(&emotional_state.mood);
    serde_json::to_string(&stress_state).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Get stress level and modifiers.
/// Returns JSON { level, load, is_fatigued, is_burned_out, negative_amplifier, regulation_effectiveness }.
#[napi]
pub fn bhava_stress_info(stress_json: String) -> Result<String> {
    let state: StressState =
        serde_json::from_str(&stress_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let result = serde_json::json!({
        "level": state.level().to_string(),
        "load": state.load.get(),
        "is_fatigued": state.is_fatigued(),
        "is_burned_out": state.is_burned_out(),
        "negative_amplifier": state.negative_amplifier(),
        "regulation_effectiveness": state.regulation_effectiveness(),
    });
    serde_json::to_string(&result).map_err(|e| Error::from_reason(format!("{e}")))
}

// ── Energy ────────────────────────────────────────────────────────────────
//
// Depletable resource with Banister fitness-fatigue model.

/// Create energy state from personality traits.
/// Returns JSON EnergyState.
#[napi]
pub fn bhava_create_energy_state(traits_json: String) -> Result<String> {
    let traits: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&traits_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let profile = profile_from_sy_traits("_", &traits);
    let state = energy::energy_from_personality(&profile);
    serde_json::to_string(&state).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Tick energy state with mood-derived exertion.
/// Returns updated EnergyState JSON.
#[napi]
pub fn bhava_energy_tick(energy_json: String, state_json: String) -> Result<String> {
    let mut energy_state: EnergyState =
        serde_json::from_str(&energy_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let emotional_state: EmotionalState =
        serde_json::from_str(&state_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let exertion = energy::exertion_from_mood(&emotional_state.mood);
    energy_state.tick(exertion);
    serde_json::to_string(&energy_state).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Get energy level and performance info.
/// Returns JSON { level, energy, performance, can_enter_flow, is_depleted, regulation_effectiveness }.
#[napi]
pub fn bhava_energy_info(energy_json: String) -> Result<String> {
    let state: EnergyState =
        serde_json::from_str(&energy_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let result = serde_json::json!({
        "level": state.level().to_string(),
        "energy": state.energy.get(),
        "performance": state.performance(),
        "can_enter_flow": state.can_enter_flow(),
        "is_depleted": state.is_depleted(),
        "regulation_effectiveness": state.regulation_effectiveness(),
    });
    serde_json::to_string(&result).map_err(|e| Error::from_reason(format!("{e}")))
}

// ── Flow State ────────────────────────────────────────────────────────────
//
// Csikszentmihalyi flow detection with hysteresis.

/// Create a new flow state detector. Returns JSON FlowState.
#[napi]
pub fn bhava_create_flow_state() -> String {
    let state = FlowState::default();
    serde_json::to_string(&state).unwrap_or_else(|_| "{}".to_string())
}

/// Tick flow state based on current mood and energy/alertness.
/// Returns updated FlowState JSON.
#[napi]
pub fn bhava_flow_tick(
    flow_json: String,
    state_json: String,
    energy: f64,
    alertness: f64,
) -> Result<String> {
    let mut flow: FlowState =
        serde_json::from_str(&flow_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let emotional_state: EmotionalState =
        serde_json::from_str(&state_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    flow.tick(&emotional_state.mood, energy as f32, alertness as f32);
    serde_json::to_string(&flow).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Get flow phase and duration.
/// Returns JSON { phase, accumulator, flow_duration }.
#[napi]
pub fn bhava_flow_info(flow_json: String) -> Result<String> {
    let flow: FlowState =
        serde_json::from_str(&flow_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let result = serde_json::json!({
        "phase": flow.phase.to_string(),
        "accumulator": flow.accumulator,
        "flow_duration": flow.flow_duration,
    });
    serde_json::to_string(&result).map_err(|e| Error::from_reason(format!("{e}")))
}

// ── Circadian Rhythm ──────────────────────────────────────────────────────
//
// 24-hour alertness cycle — modulates mood, decay rate, and energy recovery.

fn parse_chronotype(s: &str) -> Result<Chronotype> {
    match s.to_lowercase().replace(['-', '_'], " ").as_str() {
        "early bird" | "earlybird" => Ok(Chronotype::EarlyBird),
        "morning leaning" | "morningleaning" => Ok(Chronotype::MorningLeaning),
        "neutral" => Ok(Chronotype::Neutral),
        "evening leaning" | "eveningleaning" => Ok(Chronotype::EveningLeaning),
        "night owl" | "nightowl" => Ok(Chronotype::NightOwl),
        _ => Err(Error::from_reason(format!("Unknown chronotype: {s}"))),
    }
}

/// Create a circadian rhythm with chronotype.
/// Returns JSON CircadianRhythm.
#[napi]
pub fn bhava_create_circadian(chronotype: String) -> Result<String> {
    let ct = parse_chronotype(&chronotype)?;
    let rhythm = CircadianRhythm::with_chronotype(ct);
    serde_json::to_string(&rhythm).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Get current alertness from circadian rhythm at the given UTC time.
/// Returns JSON { alertness, chronotype }.
#[napi]
pub fn bhava_circadian_alertness(circadian_json: String) -> Result<String> {
    let rhythm: CircadianRhythm =
        serde_json::from_str(&circadian_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let now = chrono::Utc::now();
    let alertness = rhythm.alertness(now);
    let result = serde_json::json!({
        "alertness": alertness,
        "chronotype": rhythm.chronotype.to_string(),
    });
    serde_json::to_string(&result).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Get mood modulation from circadian rhythm at current time.
/// Returns JSON MoodVector (modulation offsets for joy, arousal, interest).
#[napi]
pub fn bhava_circadian_mood_modulation(circadian_json: String) -> Result<String> {
    let rhythm: CircadianRhythm =
        serde_json::from_str(&circadian_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let now = chrono::Utc::now();
    let modulation = rhythm.mood_modulation(now);
    serde_json::to_string(&modulation).map_err(|e| Error::from_reason(format!("{e}")))
}

// ── Sentiment Monitor ─────────────────────────────────────────────────────
//
// Live sentiment monitoring for streaming text — the feedback loop.
// user message → sentiment → mood stimulus → tone guide → prompt → response → feedback

/// Create a sentiment monitor for streaming text.
/// Returns JSON SentimentMonitor.
#[napi]
pub fn bhava_create_monitor(scale: f64) -> String {
    let monitor = SentimentMonitor::new(scale as f32);
    serde_json::to_string(&monitor).unwrap_or_else(|_| "{}".to_string())
}

/// Feed a text chunk to the sentiment monitor.
/// Returns JSON { monitor, results: SentimentResult[] }.
#[napi]
pub fn bhava_monitor_feed(monitor_json: String, chunk: String) -> Result<String> {
    let mut monitor: SentimentMonitor =
        serde_json::from_str(&monitor_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let results = monitor.feed(&chunk);
    let output = serde_json::json!({
        "monitor": monitor,
        "results": results,
    });
    serde_json::to_string(&output).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Flush remaining text in the monitor buffer.
/// Returns JSON { monitor, results: SentimentResult[] }.
#[napi]
pub fn bhava_monitor_flush(monitor_json: String) -> Result<String> {
    let mut monitor: SentimentMonitor =
        serde_json::from_str(&monitor_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let results = monitor.flush();
    let output = serde_json::json!({
        "monitor": monitor,
        "results": results,
    });
    serde_json::to_string(&output).map_err(|e| Error::from_reason(format!("{e}")))
}

/// Feed text and apply sentiment results to emotional state.
/// Combines feed + apply_to_mood in one call for the signal loop.
/// Returns JSON { monitor, state, results }.
#[napi]
pub fn bhava_monitor_feed_and_apply(
    monitor_json: String,
    state_json: String,
    chunk: String,
) -> Result<String> {
    let mut monitor: SentimentMonitor =
        serde_json::from_str(&monitor_json).map_err(|e| Error::from_reason(format!("{e}")))?;
    let mut state: EmotionalState =
        serde_json::from_str(&state_json).map_err(|e| Error::from_reason(format!("{e}")))?;

    let results = monitor.feed(&chunk);
    for result in &results {
        monitor.apply_to_mood(&mut state, result);
    }

    let output = serde_json::json!({
        "monitor": monitor,
        "state": state,
        "results": results,
    });
    serde_json::to_string(&output).map_err(|e| Error::from_reason(format!("{e}")))
}

// ── Signal Loop Tick ──────────────────────────────────────────────────────
//
// One-shot tick for the full signal loop: decay → stress → energy → flow → circadian.
// Call once per interaction or on a timer.

/// Tick all subsystems in one call.
/// Input: JSON { state, stress, energy, flow, circadian } (all optional except state).
/// Returns: JSON with all updated subsystems + composite info.
#[napi]
pub fn bhava_signal_tick(composite_json: String) -> Result<String> {
    let v: serde_json::Value =
        serde_json::from_str(&composite_json).map_err(|e| Error::from_reason(format!("{e}")))?;

    // Emotional state (required)
    let mut state: EmotionalState = serde_json::from_value(
        v.get("state")
            .cloned()
            .ok_or_else(|| Error::from_reason("missing 'state'"))?,
    )
    .map_err(|e| Error::from_reason(format!("{e}")))?;

    // Apply decay
    state.apply_decay(chrono::Utc::now());

    // Stress (optional)
    let mut stress_state: Option<StressState> = v
        .get("stress")
        .and_then(|s| serde_json::from_value(s.clone()).ok());
    if let Some(ref mut ss) = stress_state {
        ss.tick(&state.mood);
    }

    // Energy (optional)
    let mut energy_state: Option<EnergyState> = v
        .get("energy")
        .and_then(|e| serde_json::from_value(e.clone()).ok());
    if let Some(ref mut es) = energy_state {
        let exertion = energy::exertion_from_mood(&state.mood);
        es.tick(exertion);
    }

    // Circadian (optional)
    let circadian: Option<CircadianRhythm> = v
        .get("circadian")
        .and_then(|c| serde_json::from_value(c.clone()).ok());
    let alertness = circadian
        .as_ref()
        .map(|c| c.alertness(chrono::Utc::now()))
        .unwrap_or(1.0);

    // Flow (optional)
    let mut flow_state: Option<FlowState> = v
        .get("flow")
        .and_then(|f| serde_json::from_value(f.clone()).ok());
    if let Some(ref mut fs) = flow_state {
        let energy_level = energy_state
            .as_ref()
            .map(|e| e.energy.get())
            .unwrap_or(1.0);
        fs.tick(&state.mood, energy_level, alertness);
    }

    // Compose result
    let mood_label = state.classify().to_string();
    let mood_prompt = mood::compose_mood_prompt(&state);

    let mut result = serde_json::json!({
        "state": state,
        "mood_label": mood_label,
        "mood_prompt": mood_prompt,
        "alertness": alertness,
    });

    if let Some(ss) = &stress_state {
        result["stress"] = serde_json::to_value(ss).unwrap_or_default();
        result["stress_level"] = serde_json::Value::String(ss.level().to_string());
    }
    if let Some(es) = &energy_state {
        result["energy"] = serde_json::to_value(es).unwrap_or_default();
        result["energy_level"] = serde_json::Value::String(es.level().to_string());
        result["performance"] = serde_json::json!(es.performance());
    }
    if let Some(fs) = &flow_state {
        result["flow"] = serde_json::to_value(fs).unwrap_or_default();
        result["flow_phase"] = serde_json::Value::String(fs.phase.to_string());
    }
    if let Some(c) = &circadian {
        result["circadian"] = serde_json::to_value(c).unwrap_or_default();
    }

    serde_json::to_string(&result).map_err(|e| Error::from_reason(format!("{e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_TRAITS: &str = r#"{"formality":"casual","humor":"witty","warmth":"friendly","empathy":"empathetic","patience":"patient","confidence":"assertive","creativity":"imaginative","risk_tolerance":"bold","curiosity":"curious","skepticism":"balanced","autonomy":"proactive","pedagogy":"explanatory","precision":"precise","verbosity":"concise","directness":"candid"}"#;

    fn emotional_state_json() -> String {
        bhava_create_emotional_state()
    }

    // ── Zodiac ──

    #[test]
    fn zodiac_list_returns_12_signs() {
        let json = bhava_list_zodiac_signs();
        let signs: Vec<String> = serde_json::from_str(&json).unwrap();
        assert_eq!(signs.len(), 12);
        assert!(signs.contains(&"Scorpio".to_string()));
    }

    #[test]
    fn zodiac_manifest_returns_profile_and_baseline() {
        let json = bhava_zodiac_manifest("scorpio".into()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(v.get("profile").is_some());
        assert!(v.get("baseline").is_some());
        assert!(v["profile"]["traits"].is_object());
    }

    #[test]
    fn zodiac_info_scorpio_is_water_fixed() {
        let json = bhava_zodiac_info("scorpio".into()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["element"].as_str().unwrap(), "Water");
        assert_eq!(v["modality"].as_str().unwrap(), "Fixed");
    }

    #[test]
    fn zodiac_invalid_sign_errors() {
        assert!(bhava_zodiac_profile("invalid".into()).is_err());
    }

    // ── Regulation ──

    #[test]
    fn regulation_roundtrip() {
        let state_json = emotional_state_json();
        let regulated = bhava_create_regulated_mood(state_json).unwrap();
        let gap = bhava_suppression_gap(regulated.clone()).unwrap();
        assert!(gap < 0.01);

        let suppressed =
            bhava_regulate(regulated, "suppress".into(), "frustration".into(), 0.8, 1.0).unwrap();
        let v: serde_json::Value = serde_json::from_str(&suppressed).unwrap();
        assert!(v.get("felt").is_some());
        assert!(v.get("expressed").is_some());
    }

    #[test]
    fn default_regulation_strategy_valid() {
        let json =
            bhava_default_regulation_strategy(TEST_TRAITS.into(), "frustration".into()).unwrap();
        let _v: serde_json::Value = serde_json::from_str(&json).unwrap();
    }

    // ── Stress ──

    #[test]
    fn stress_lifecycle() {
        let stress = bhava_create_stress_state(TEST_TRAITS.into()).unwrap();
        let info_json = bhava_stress_info(stress.clone()).unwrap();
        let info: serde_json::Value = serde_json::from_str(&info_json).unwrap();
        assert_eq!(info["level"].as_str().unwrap(), "relaxed");
        assert!(!info["is_fatigued"].as_bool().unwrap());

        let state = emotional_state_json();
        let updated = bhava_stress_tick(stress, state).unwrap();
        let _: serde_json::Value = serde_json::from_str(&updated).unwrap();
    }

    // ── Energy ──

    #[test]
    fn energy_lifecycle() {
        let energy = bhava_create_energy_state(TEST_TRAITS.into()).unwrap();
        let info_json = bhava_energy_info(energy.clone()).unwrap();
        let info: serde_json::Value = serde_json::from_str(&info_json).unwrap();
        assert_eq!(info["level"].as_str().unwrap(), "full");
        assert!(info["can_enter_flow"].as_bool().unwrap());

        let state = emotional_state_json();
        let updated = bhava_energy_tick(energy, state).unwrap();
        let _: serde_json::Value = serde_json::from_str(&updated).unwrap();
    }

    // ── Flow ──

    #[test]
    fn flow_starts_inactive() {
        let flow = bhava_create_flow_state();
        let info_json = bhava_flow_info(flow).unwrap();
        let info: serde_json::Value = serde_json::from_str(&info_json).unwrap();
        assert_eq!(info["phase"].as_str().unwrap(), "inactive");
        assert_eq!(info["flow_duration"].as_u64().unwrap(), 0);
    }

    #[test]
    fn flow_tick_updates() {
        let flow = bhava_create_flow_state();
        let state = emotional_state_json();
        let updated = bhava_flow_tick(flow, state, 0.8, 0.9).unwrap();
        let _: serde_json::Value = serde_json::from_str(&updated).unwrap();
    }

    // ── Circadian ──

    #[test]
    fn circadian_alertness_in_range() {
        let circ = bhava_create_circadian("neutral".into()).unwrap();
        let alert_json = bhava_circadian_alertness(circ).unwrap();
        let alert: serde_json::Value = serde_json::from_str(&alert_json).unwrap();
        let a = alert["alertness"].as_f64().unwrap();
        assert!((0.0..=1.0).contains(&a));
        assert_eq!(alert["chronotype"].as_str().unwrap(), "neutral");
    }

    #[test]
    fn circadian_mood_modulation_valid() {
        let circ = bhava_create_circadian("night owl".into()).unwrap();
        let json = bhava_circadian_mood_modulation(circ).unwrap();
        let _: serde_json::Value = serde_json::from_str(&json).unwrap();
    }

    #[test]
    fn circadian_invalid_chronotype_errors() {
        assert!(bhava_create_circadian("invalid".into()).is_err());
    }

    // ── Monitor ──

    #[test]
    fn monitor_feed_and_flush() {
        let monitor = bhava_create_monitor(0.5);
        let fed = bhava_monitor_feed(monitor, "This is great! ".into()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&fed).unwrap();
        assert!(v.get("monitor").is_some());
        assert!(v.get("results").is_some());
    }

    #[test]
    fn monitor_feed_and_apply_updates_state() {
        let monitor = bhava_create_monitor(0.5);
        let state = emotional_state_json();
        let result =
            bhava_monitor_feed_and_apply(monitor, state, "This is wonderful work! ".into())
                .unwrap();
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert!(v.get("monitor").is_some());
        assert!(v.get("state").is_some());
        assert!(v.get("results").is_some());
    }

    // ── Signal Tick ──

    #[test]
    fn signal_tick_state_only() {
        let state = emotional_state_json();
        let composite = format!(r#"{{"state":{state}}}"#);
        let result = bhava_signal_tick(composite).unwrap();
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert!(v.get("state").is_some());
        assert!(v.get("mood_label").is_some());
        assert!(v.get("mood_prompt").is_some());
    }

    #[test]
    fn signal_tick_full_composite() {
        let state = emotional_state_json();
        let stress = bhava_create_stress_state(TEST_TRAITS.into()).unwrap();
        let energy = bhava_create_energy_state(TEST_TRAITS.into()).unwrap();
        let flow = bhava_create_flow_state();
        let circ = bhava_create_circadian("neutral".into()).unwrap();

        let composite = format!(
            r#"{{"state":{state},"stress":{stress},"energy":{energy},"flow":{flow},"circadian":{circ}}}"#
        );
        let result = bhava_signal_tick(composite).unwrap();
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert!(v.get("stress_level").is_some());
        assert!(v.get("energy_level").is_some());
        assert!(v.get("performance").is_some());
        assert!(v.get("flow_phase").is_some());
        assert!(v.get("circadian").is_some());
    }

    #[test]
    fn signal_tick_missing_state_errors() {
        assert!(bhava_signal_tick(r#"{"stress":{}}"#.into()).is_err());
    }

    // ── Existing 1.x ──

    #[test]
    fn compose_system_prompt_works() {
        let identity = r#"{"soul":"test","spirit":null,"brain":null,"body":null,"heart":null}"#;
        let result = bhava_compose_system_prompt(
            TEST_TRAITS.into(),
            identity.into(),
            "null".into(),
            "".into(),
        )
        .unwrap();
        assert!(!result.is_empty());
    }

    #[test]
    fn build_metadata_works() {
        let state = emotional_state_json();
        let result = bhava_build_metadata("test".into(), TEST_TRAITS.into(), state).unwrap();
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["name"].as_str().unwrap(), "test");
        assert!(v["active_traits"].as_array().is_some());
    }
}
