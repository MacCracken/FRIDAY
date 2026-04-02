//! Personality engine — direct bhava integration (no NAPI).
//!
//! Replaces sy-napi/src/bhava.rs. All functions call bhava directly
//! without JSON serialization at the boundary.

use bhava::archetype::{self, IdentityContent};
use bhava::circadian::CircadianRhythm;
use bhava::energy::{self, EnergyState};
use bhava::flow::FlowState;
use bhava::mood::{self, EmotionalState};
use bhava::sentiment;
use bhava::stress::StressState;
use bhava::traits::{PersonalityProfile, TraitKind, TraitLevel};
use bhava::zodiac::{self, ZodiacSign};

/// Map SY descriptive trait level to bhava TraitLevel.
pub fn sy_level_to_bhava(trait_key: &str, level: &str) -> Option<TraitLevel> {
    if level == "balanced" {
        return Some(TraitLevel::Balanced);
    }
    match (trait_key, level) {
        ("formality", "street") => Some(TraitLevel::Lowest),
        ("formality", "casual") => Some(TraitLevel::Low),
        ("formality", "formal") => Some(TraitLevel::High),
        ("formality", "ceremonial") => Some(TraitLevel::Highest),
        ("humor", "deadpan") => Some(TraitLevel::Lowest),
        ("humor", "dry") => Some(TraitLevel::Low),
        ("humor", "witty") => Some(TraitLevel::High),
        ("humor", "comedic") => Some(TraitLevel::Highest),
        ("warmth", "cold") => Some(TraitLevel::Lowest),
        ("warmth", "reserved") => Some(TraitLevel::Low),
        ("warmth", "friendly") => Some(TraitLevel::High),
        ("warmth", "effusive") => Some(TraitLevel::Highest),
        ("empathy", "detached") => Some(TraitLevel::Lowest),
        ("empathy", "analytical") => Some(TraitLevel::Low),
        ("empathy", "empathetic") => Some(TraitLevel::High),
        ("empathy", "compassionate") => Some(TraitLevel::Highest),
        ("patience", "brisk") => Some(TraitLevel::Lowest),
        ("patience", "efficient") => Some(TraitLevel::Low),
        ("patience", "patient") => Some(TraitLevel::High),
        ("patience", "nurturing") => Some(TraitLevel::Highest),
        ("confidence", "humble") => Some(TraitLevel::Lowest),
        ("confidence", "modest") => Some(TraitLevel::Low),
        ("confidence", "assertive") => Some(TraitLevel::High),
        ("confidence", "authoritative") => Some(TraitLevel::Highest),
        ("creativity", "rigid") => Some(TraitLevel::Lowest),
        ("creativity", "conventional") => Some(TraitLevel::Low),
        ("creativity", "imaginative") => Some(TraitLevel::High),
        ("creativity", "avant-garde") => Some(TraitLevel::Highest),
        ("risk_tolerance", "risk-averse") => Some(TraitLevel::Lowest),
        ("risk_tolerance", "cautious") => Some(TraitLevel::Low),
        ("risk_tolerance", "bold") => Some(TraitLevel::High),
        ("risk_tolerance", "reckless") => Some(TraitLevel::Highest),
        ("curiosity", "narrow") => Some(TraitLevel::Lowest),
        ("curiosity", "focused") => Some(TraitLevel::Low),
        ("curiosity", "curious") => Some(TraitLevel::High),
        ("curiosity", "exploratory") => Some(TraitLevel::Highest),
        ("skepticism", "gullible") => Some(TraitLevel::Lowest),
        ("skepticism", "trusting") => Some(TraitLevel::Low),
        ("skepticism", "skeptical") => Some(TraitLevel::High),
        ("skepticism", "contrarian") => Some(TraitLevel::Highest),
        ("autonomy", "dependent") => Some(TraitLevel::Lowest),
        ("autonomy", "consultative") => Some(TraitLevel::Low),
        ("autonomy", "proactive") => Some(TraitLevel::High),
        ("autonomy", "autonomous") => Some(TraitLevel::Highest),
        ("pedagogy", "terse-answer") => Some(TraitLevel::Lowest),
        ("pedagogy", "answer-focused") => Some(TraitLevel::Low),
        ("pedagogy", "explanatory") => Some(TraitLevel::High),
        ("pedagogy", "socratic") => Some(TraitLevel::Highest),
        ("precision", "approximate") => Some(TraitLevel::Lowest),
        ("precision", "loose") => Some(TraitLevel::Low),
        ("precision", "precise") => Some(TraitLevel::High),
        ("precision", "meticulous") => Some(TraitLevel::Highest),
        ("verbosity", "terse") => Some(TraitLevel::Lowest),
        ("verbosity", "concise") => Some(TraitLevel::Low),
        ("verbosity", "detailed") => Some(TraitLevel::High),
        ("verbosity", "exhaustive") => Some(TraitLevel::Highest),
        ("directness", "evasive") => Some(TraitLevel::Lowest),
        ("directness", "diplomatic") => Some(TraitLevel::Low),
        ("directness", "candid") => Some(TraitLevel::High),
        ("directness", "blunt") => Some(TraitLevel::Highest),
        _ => None,
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

/// Build a PersonalityProfile from a trait map (e.g., from DB).
pub fn profile_from_traits(
    name: &str,
    traits: &std::collections::HashMap<String, String>,
) -> PersonalityProfile {
    let mut profile = PersonalityProfile::new(name);
    for (key, value) in traits {
        if let Some(kind) = parse_trait_kind(key)
            && let Some(level) = sy_level_to_bhava(key, value)
        {
            profile.set_trait(kind, level);
        }
    }
    profile
}

/// Compose the full personality section of a system prompt.
///
/// Directly calls bhava — no JSON serialization boundary.
pub fn compose_system_prompt(
    profile: &PersonalityProfile,
    identity: &IdentityContent,
    mood: Option<&EmotionalState>,
    spirit_text: Option<&str>,
) -> String {
    let mut prompt = archetype::compose_identity_prompt(identity);

    let disposition = profile.compose_prompt();
    if !disposition.is_empty() {
        prompt.push('\n');
        prompt.push_str(&disposition);
    }

    if let Some(state) = mood {
        prompt.push('\n');
        prompt.push_str(&mood::compose_mood_prompt(state));
    }

    if let Some(spirit) = spirit_text {
        let trimmed = spirit.trim();
        if !trimmed.is_empty() {
            prompt.push_str("\n## Spirit\n\n");
            prompt.push_str(trimmed);
            prompt.push('\n');
        }
    }

    prompt
}

/// Run the full signal tick — decay, stress, energy, flow, circadian.
///
/// Direct call to bhava subsystems — no JSON boundary.
pub fn signal_tick(
    state: &mut EmotionalState,
    stress_state: Option<&mut StressState>,
    mut energy_state: Option<&mut EnergyState>,
    flow_state: Option<&mut FlowState>,
    circadian: Option<&CircadianRhythm>,
) -> SignalTickResult {
    let now = chrono::Utc::now();

    // Decay mood toward baseline
    state.apply_decay(now);

    // Stress
    if let Some(ss) = stress_state {
        ss.tick(&state.mood);
    }

    // Energy + track level for flow
    let mut energy_level = 1.0f32;
    if let Some(ref mut es) = energy_state {
        let exertion = energy::exertion_from_mood(&state.mood);
        es.tick(exertion);
        energy_level = es.energy.get();
    }

    // Circadian alertness
    let alertness = circadian.map(|c| c.alertness(now)).unwrap_or(1.0);

    // Flow
    if let Some(fs) = flow_state {
        fs.tick(&state.mood, energy_level, alertness);
    }

    let mood_label = state.classify().to_string();
    let mood_prompt = mood::compose_mood_prompt(state);

    SignalTickResult {
        mood_label,
        mood_prompt,
        alertness,
    }
}

/// Result from a signal tick — the data needed for prompt injection.
pub struct SignalTickResult {
    pub mood_label: String,
    pub mood_prompt: String,
    pub alertness: f32,
}

/// Apply sentiment feedback to an emotional state.
///
/// Direct call — no JSON serialization.
pub fn apply_sentiment_feedback(
    text: &str,
    state: &mut EmotionalState,
    scale: f32,
) -> SentimentFeedbackResult {
    let result = sentiment::analyze(text);
    let scale = scale.clamp(0.0, 1.0);
    for &(emotion, intensity) in &result.emotions {
        state.stimulate(emotion, intensity * scale);
    }
    SentimentFeedbackResult {
        valence: result.valence,
        confidence: result.confidence,
        is_positive: result.is_positive(),
        is_negative: result.is_negative(),
    }
}

pub struct SentimentFeedbackResult {
    pub valence: f32,
    pub confidence: f32,
    pub is_positive: bool,
    pub is_negative: bool,
}

/// Manifest a zodiac sign into initial conditions.
pub fn zodiac_manifest(sign: ZodiacSign) -> (PersonalityProfile, bhava::mood::MoodVector) {
    let profile = zodiac::sign_profile(sign);
    let baseline = mood::derive_mood_baseline(&profile);
    (profile, baseline)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_from_traits_basic() {
        let mut traits = std::collections::HashMap::new();
        traits.insert("warmth".into(), "friendly".into());
        traits.insert("humor".into(), "witty".into());
        let profile = profile_from_traits("test", &traits);
        assert_eq!(profile.get_trait(TraitKind::Warmth), TraitLevel::High);
        assert_eq!(profile.get_trait(TraitKind::Humor), TraitLevel::High);
    }

    #[test]
    fn compose_prompt_not_empty() {
        let profile = PersonalityProfile::new("test");
        let identity = IdentityContent::default();
        let result = compose_system_prompt(&profile, &identity, None, None);
        assert!(!result.is_empty());
    }

    #[test]
    fn signal_tick_returns_mood() {
        let mut state = EmotionalState::new();
        let result = signal_tick(&mut state, None, None, None, None);
        assert!(!result.mood_label.is_empty());
        assert!(!result.mood_prompt.is_empty());
    }

    #[test]
    fn sentiment_feedback_updates_state() {
        let mut state = EmotionalState::new();
        let result = apply_sentiment_feedback("This is wonderful!", &mut state, 0.5);
        assert!(result.confidence > 0.0);
    }

    #[test]
    fn zodiac_manifest_produces_profile() {
        let (profile, baseline) = zodiac_manifest(ZodiacSign::Scorpio);
        assert_eq!(profile.name, "Scorpio");
        // Baseline should have non-zero values for Water sign
        let _ = baseline;
    }
}
