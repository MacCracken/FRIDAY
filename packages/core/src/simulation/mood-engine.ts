/**
 * Mood Engine — Affect system layered on personality traits.
 *
 * Uses Russell's circumplex model of affect to map (valence, arousal) to
 * discrete mood labels. Mood decays exponentially toward personality-derived
 * baselines.
 *
 * Trait mapping uses the 15-trait × 5-level personality system (formality,
 * warmth, confidence, etc.) to derive emotional baselines. Compound effects
 * detect trait combinations that produce emergent behaviour.
 */

import type { MoodState, MoodLabel, MoodEventCreate, MoodEvent } from '@secureyeoman/shared';
import type { SimulationStore } from './simulation-store.js';
import type { SecureLogger } from '../logging/logger.js';
import * as bhava from '../native/bhava.js';
import type { BhavaSignalTickResult } from '../native/bhava.js';
import { uuidv7 } from '../utils/crypto.js';

// ── Trait value → mood modifiers (15 traits × 5 levels) ─────────────

/**
 * Maps each standard trait key to its 5-level valence/arousal modifiers.
 * Levels are ordered from far-left to far-right as defined in PersonalityEditor.
 * "balanced" is always neutral (0, 0).
 */
export const TRAIT_VALUE_MODIFIERS: Record<
  string,
  Record<string, { valence: number; arousal: number }>
> = {
  // Communication
  formality: {
    street: { valence: 0.05, arousal: 0.15 },
    casual: { valence: 0.05, arousal: 0.05 },
    balanced: { valence: 0, arousal: 0 },
    formal: { valence: -0.05, arousal: -0.1 },
    ceremonial: { valence: -0.05, arousal: -0.15 },
  },
  humor: {
    deadpan: { valence: -0.05, arousal: -0.15 },
    dry: { valence: 0.05, arousal: -0.05 },
    balanced: { valence: 0, arousal: 0 },
    witty: { valence: 0.15, arousal: 0.1 },
    comedic: { valence: 0.25, arousal: 0.2 },
  },
  verbosity: {
    terse: { valence: -0.05, arousal: -0.1 },
    concise: { valence: 0, arousal: -0.05 },
    balanced: { valence: 0, arousal: 0 },
    detailed: { valence: 0, arousal: 0.05 },
    exhaustive: { valence: -0.05, arousal: 0.1 },
  },
  directness: {
    evasive: { valence: -0.1, arousal: -0.1 },
    diplomatic: { valence: 0.05, arousal: -0.05 },
    balanced: { valence: 0, arousal: 0 },
    candid: { valence: 0, arousal: 0.1 },
    blunt: { valence: -0.1, arousal: 0.15 },
  },
  // Emotional
  warmth: {
    cold: { valence: -0.25, arousal: -0.15 },
    reserved: { valence: -0.1, arousal: -0.1 },
    balanced: { valence: 0, arousal: 0 },
    friendly: { valence: 0.2, arousal: 0.1 },
    effusive: { valence: 0.3, arousal: 0.2 },
  },
  empathy: {
    detached: { valence: -0.15, arousal: -0.1 },
    analytical: { valence: -0.05, arousal: -0.1 },
    balanced: { valence: 0, arousal: 0 },
    empathetic: { valence: 0.2, arousal: 0.05 },
    compassionate: { valence: 0.25, arousal: 0.1 },
  },
  patience: {
    brisk: { valence: -0.1, arousal: 0.15 },
    efficient: { valence: -0.05, arousal: 0.05 },
    balanced: { valence: 0, arousal: 0 },
    patient: { valence: 0.1, arousal: -0.1 },
    nurturing: { valence: 0.2, arousal: -0.15 },
  },
  confidence: {
    humble: { valence: 0, arousal: -0.15 },
    modest: { valence: 0, arousal: -0.05 },
    balanced: { valence: 0, arousal: 0 },
    assertive: { valence: 0.1, arousal: 0.15 },
    authoritative: { valence: 0.15, arousal: 0.2 },
  },
  // Cognitive
  creativity: {
    rigid: { valence: -0.1, arousal: -0.1 },
    conventional: { valence: -0.05, arousal: -0.05 },
    balanced: { valence: 0, arousal: 0 },
    imaginative: { valence: 0.15, arousal: 0.1 },
    'avant-garde': { valence: 0.2, arousal: 0.2 },
  },
  risk_tolerance: {
    'risk-averse': { valence: -0.1, arousal: -0.15 },
    cautious: { valence: -0.05, arousal: -0.05 },
    balanced: { valence: 0, arousal: 0 },
    bold: { valence: 0.1, arousal: 0.15 },
    reckless: { valence: 0.05, arousal: 0.3 },
  },
  curiosity: {
    narrow: { valence: -0.05, arousal: -0.1 },
    focused: { valence: 0, arousal: -0.05 },
    balanced: { valence: 0, arousal: 0 },
    curious: { valence: 0.15, arousal: 0.1 },
    exploratory: { valence: 0.2, arousal: 0.15 },
  },
  skepticism: {
    gullible: { valence: 0.05, arousal: -0.1 },
    trusting: { valence: 0.1, arousal: -0.05 },
    balanced: { valence: 0, arousal: 0 },
    skeptical: { valence: -0.1, arousal: 0.1 },
    contrarian: { valence: -0.15, arousal: 0.2 },
  },
  // Professional
  autonomy: {
    dependent: { valence: -0.1, arousal: -0.1 },
    consultative: { valence: 0, arousal: -0.05 },
    balanced: { valence: 0, arousal: 0 },
    proactive: { valence: 0.1, arousal: 0.1 },
    autonomous: { valence: 0.15, arousal: 0.15 },
  },
  pedagogy: {
    'terse-answer': { valence: -0.05, arousal: -0.1 },
    'answer-focused': { valence: 0, arousal: -0.05 },
    balanced: { valence: 0, arousal: 0 },
    explanatory: { valence: 0.1, arousal: 0.05 },
    socratic: { valence: 0.15, arousal: 0.1 },
  },
  precision: {
    approximate: { valence: 0, arousal: -0.1 },
    loose: { valence: 0, arousal: -0.05 },
    balanced: { valence: 0, arousal: 0 },
    precise: { valence: 0, arousal: 0.05 },
    meticulous: { valence: -0.05, arousal: 0.1 },
  },
};

// ── Compound trait effects ──────────────────────────────────────────

export interface CompoundEffect {
  /** Trait conditions: each key must have one of the listed values */
  conditions: Record<string, string[]>;
  /** Additional valence/arousal modifier when all conditions are met */
  modifier: { valence: number; arousal: number };
  /** Human-readable description */
  label: string;
}

export const COMPOUND_EFFECTS: CompoundEffect[] = [
  {
    conditions: { warmth: ['friendly', 'effusive'], humor: ['witty', 'comedic'] },
    modifier: { valence: 0.1, arousal: 0.1 },
    label: 'playful',
  },
  {
    conditions: { formality: ['formal', 'ceremonial'], humor: ['witty', 'comedic'] },
    modifier: { valence: 0.05, arousal: -0.05 },
    label: 'dry-wit',
  },
  {
    conditions: { warmth: ['friendly', 'effusive'], empathy: ['empathetic', 'compassionate'] },
    modifier: { valence: 0.1, arousal: -0.05 },
    label: 'nurturing',
  },
  {
    conditions: { confidence: ['assertive', 'authoritative'], directness: ['candid', 'blunt'] },
    modifier: { valence: 0, arousal: 0.1 },
    label: 'commanding',
  },
  {
    conditions: { skepticism: ['skeptical', 'contrarian'], curiosity: ['curious', 'exploratory'] },
    modifier: { valence: 0, arousal: 0.1 },
    label: 'investigative',
  },
  {
    conditions: { patience: ['patient', 'nurturing'], pedagogy: ['explanatory', 'socratic'] },
    modifier: { valence: 0.1, arousal: -0.1 },
    label: 'mentoring',
  },
  {
    conditions: { warmth: ['cold', 'reserved'], directness: ['candid', 'blunt'] },
    modifier: { valence: -0.1, arousal: 0.1 },
    label: 'brusque',
  },
];

/**
 * Check which compound effects are active for a given trait set.
 */
export function getActiveCompoundEffects(traits: Record<string, string>): CompoundEffect[] {
  // Build a lowercased lookup for case-insensitive matching
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(traits)) {
    lower[k.toLowerCase()] = v.toLowerCase();
  }
  return COMPOUND_EFFECTS.filter((effect) =>
    Object.entries(effect.conditions).every(([traitKey, allowedValues]) => {
      const value = lower[traitKey];
      return value != null && allowedValues.includes(value);
    })
  );
}

// ── Legacy trait key modifiers (kept for backward compat with free-form traits) ──

export const TRAIT_MOOD_MODIFIERS: Record<string, { valence: number; arousal: number }> = {
  cheerful: { valence: 0.3, arousal: 0.2 },
  serious: { valence: -0.1, arousal: -0.1 },
  energetic: { valence: 0.1, arousal: 0.4 },
  calm: { valence: 0.1, arousal: -0.3 },
  empathetic: { valence: 0.2, arousal: 0.0 },
  analytical: { valence: 0.0, arousal: -0.2 },
  playful: { valence: 0.3, arousal: 0.3 },
  reserved: { valence: -0.05, arousal: -0.2 },
  passionate: { valence: 0.15, arousal: 0.35 },
  stoic: { valence: 0.0, arousal: -0.3 },
  anxious: { valence: -0.2, arousal: 0.3 },
  confident: { valence: 0.15, arousal: 0.1 },
};

export interface MoodEngineOpts {
  store: SimulationStore;
  logger: SecureLogger;
}

export class MoodEngine {
  private store: SimulationStore;
  private logger: SecureLogger;

  constructor(opts: MoodEngineOpts) {
    this.store = opts.store;
    this.logger = opts.logger;
  }

  /**
   * Initialize mood for a personality, deriving baseline from traits.
   */
  async initializeMood(personalityId: string, traits: Record<string, string>): Promise<MoodState> {
    const { valence: baseV, arousal: baseA } = this.deriveBaseline(traits);
    const now = Date.now();
    const state: MoodState = {
      id: uuidv7(),
      personalityId,
      valence: baseV,
      arousal: baseA,
      dominance: 0.5,
      label: getMoodLabel(baseV, baseA),
      decayRate: 0.05,
      baselineValence: baseV,
      baselineArousal: baseA,
      updatedAt: now,
    };
    await this.store.upsertMoodState(state);
    this.logger.info({ personalityId, label: state.label }, 'mood initialized');
    return state;
  }

  /**
   * Apply a mood-influencing event. Records the event and updates state.
   * Accepts optional traits to use for initialization if no mood state exists.
   */
  async applyEvent(
    personalityId: string,
    input: MoodEventCreate,
    traits?: Record<string, string>
  ): Promise<MoodState> {
    let state = await this.store.getMoodState(personalityId);
    if (!state) {
      state = await this.initializeMood(personalityId, traits ?? {});
    }

    const now = Date.now();
    const event: MoodEvent = {
      id: uuidv7(),
      personalityId,
      eventType: input.eventType,
      valenceDelta: input.valenceDelta,
      arousalDelta: input.arousalDelta,
      source: input.source,
      metadata: input.metadata,
      createdAt: now,
    };
    await this.store.recordMoodEvent(event);

    const newValence = clamp(state.valence + input.valenceDelta, -1, 1);
    const newArousal = clamp(state.arousal + input.arousalDelta, 0, 1);
    const label = getMoodLabel(newValence, newArousal);

    await this.store.updateMoodValues(personalityId, newValence, newArousal, label);

    const updated: MoodState = {
      ...state,
      valence: newValence,
      arousal: newArousal,
      label,
      updatedAt: now,
    };
    return updated;
  }

  /**
   * Decay mood toward baseline by one step. Called per tick.
   */
  async decayMood(personalityId: string): Promise<MoodState | null> {
    const state = await this.store.getMoodState(personalityId);
    if (!state) return null;

    const rate = state.decayRate;
    const newValence = state.valence + (state.baselineValence - state.valence) * rate;
    const newArousal = state.arousal + (state.baselineArousal - state.arousal) * rate;
    const label = getMoodLabel(newValence, clamp(newArousal, 0, 1));

    await this.store.updateMoodValues(
      personalityId,
      clamp(newValence, -1, 1),
      clamp(newArousal, 0, 1),
      label
    );

    return {
      ...state,
      valence: clamp(newValence, -1, 1),
      arousal: clamp(newArousal, 0, 1),
      label,
      updatedAt: Date.now(),
    };
  }

  async getMood(personalityId: string): Promise<MoodState | null> {
    return this.store.getMoodState(personalityId);
  }

  /**
   * Compose a system prompt fragment reflecting current mood.
   */
  composeMoodPromptFragment(mood: MoodState): string {
    const lines = [
      '## Current Emotional State',
      `You are currently feeling **${mood.label}** (valence: ${mood.valence.toFixed(2)}, arousal: ${mood.arousal.toFixed(2)}).`,
    ];

    const toneGuide = MOOD_TONE_GUIDES[mood.label];
    if (toneGuide) {
      lines.push(`Modulate your tone accordingly: ${toneGuide}`);
    }

    return lines.join('\n');
  }

  // ── Bhava 2.0 Signal Loop ──────────────────────────────────────────

  /**
   * Initialize the full composite state for a personality.
   * Creates emotional state, stress, energy, flow, and circadian from traits.
   * Call once at personality creation — not lazily on first message.
   */
  async initializeCompositeState(
    personalityId: string,
    traits: Record<string, string>,
    chronotype:
      | 'early bird'
      | 'morning-leaning'
      | 'neutral'
      | 'evening-leaning'
      | 'night owl' = 'neutral'
  ): Promise<void> {
    const stateJson = bhava.createEmotionalStateWithBaseline(traits);
    const stressJson = bhava.createStressState(traits);
    const energyJson = bhava.createEnergyState(traits);
    const flowJson = bhava.createFlowState();
    const circadianJson = bhava.createCircadian(chronotype);

    if (!stateJson) {
      this.logger.debug(
        { personalityId },
        'bhava native unavailable — skipping composite state init'
      );
      return;
    }

    await this.store.upsertCompositeState(
      personalityId,
      stateJson,
      stressJson,
      energyJson,
      flowJson,
      circadianJson
    );

    this.logger.info({ personalityId }, 'composite emotional state initialized (bhava 2.0)');
  }

  /**
   * Run one tick of the bhava 2.0 signal loop.
   *
   * Loads all component states from DB, calls bhava.signalTick() which runs:
   *   decay → stress → energy → flow → circadian
   * Then persists the updated states back.
   *
   * Returns the signal tick result with mood_label, mood_prompt, and all
   * subsystem levels — ready for injection into the system prompt.
   */
  async signalTick(personalityId: string): Promise<BhavaSignalTickResult | null> {
    const composite = await this.store.getCompositeState(personalityId);
    if (!composite) return null;

    const input: Record<string, unknown> = {
      state: JSON.parse(composite.stateJson),
    };
    if (composite.stressJson) input.stress = JSON.parse(composite.stressJson);
    if (composite.energyJson) input.energy = JSON.parse(composite.energyJson);
    if (composite.flowJson) input.flow = JSON.parse(composite.flowJson);
    if (composite.circadianJson) input.circadian = JSON.parse(composite.circadianJson);

    const result = bhava.signalTick(input as Parameters<typeof bhava.signalTick>[0]);
    if (!result) return null;

    // Persist updated states
    await this.store.upsertCompositeState(
      personalityId,
      JSON.stringify(result.state),
      result.stress ? JSON.stringify(result.stress) : composite.stressJson,
      result.energy ? JSON.stringify(result.energy) : composite.energyJson,
      result.flow ? JSON.stringify(result.flow) : composite.flowJson,
      result.circadian ? JSON.stringify(result.circadian) : composite.circadianJson
    );

    this.logger.debug(
      {
        personalityId,
        mood: result.mood_label,
        stress: result.stress_level,
        energy: result.energy_level,
        flow: result.flow_phase,
      },
      'signal tick complete'
    );

    return result;
  }

  /**
   * Process sentiment feedback from an LLM response and trigger a signal tick.
   *
   * This is the feedback half of the signal loop:
   *   response text → sentiment analysis → mood stimulus → signal tick → updated state
   */
  async processSentimentAndTick(
    personalityId: string,
    responseText: string,
    traits: Record<string, string>,
    scale = 0.3
  ): Promise<BhavaSignalTickResult | null> {
    const composite = await this.store.getCompositeState(personalityId);
    if (!composite) return null;

    // Apply sentiment feedback to emotional state
    const sentimentResult = bhava.applySentimentFeedback(responseText, composite.stateJson, scale);
    if (sentimentResult) {
      // Update the emotional state with sentiment-influenced version
      await this.store.upsertCompositeState(
        personalityId,
        JSON.stringify(sentimentResult.state),
        composite.stressJson,
        composite.energyJson,
        composite.flowJson,
        composite.circadianJson
      );

      // Also update the 2D mood state for backward compatibility
      const valenceDelta = sentimentResult.valence * scale;
      const arousalDelta = Math.abs(sentimentResult.valence) * 0.1;
      await this.applyEvent(
        personalityId,
        {
          eventType: 'response_sentiment',
          valenceDelta,
          arousalDelta,
          source: 'bhava_sentiment',
          metadata: {
            valence: sentimentResult.valence,
            confidence: sentimentResult.confidence,
            is_positive: sentimentResult.is_positive,
          },
        },
        traits
      );
    }

    // Run full signal tick with updated state
    return this.signalTick(personalityId);
  }

  /**
   * Derive baseline valence/arousal from personality traits.
   *
   * Uses the 15-trait × 5-level system: looks up each trait key + value pair
   * in TRAIT_VALUE_MODIFIERS. Falls back to TRAIT_MOOD_MODIFIERS for free-form
   * trait keys (backward compat). Applies compound effects for trait combinations.
   */
  deriveBaseline(traits: Record<string, string>): { valence: number; arousal: number } {
    // Try bhava's 6D baseline derivation (maps joy→valence, arousal→arousal)
    const bhavaBaseline = bhava.deriveBaseline(traits);
    if (bhavaBaseline) {
      return { valence: bhavaBaseline.joy, arousal: Math.max(0, bhavaBaseline.arousal) };
    }

    // Fallback: original SY 2D circumplex derivation
    let totalV = 0;
    let totalA = 0;
    let count = 0;

    for (const [key, value] of Object.entries(traits)) {
      const lowerKey = key.toLowerCase();
      const lowerValue = value.toLowerCase();

      // Primary: look up trait key + value in the structured map
      const traitLevels = TRAIT_VALUE_MODIFIERS[lowerKey];
      if (traitLevels) {
        const mod = traitLevels[lowerValue];
        if (mod) {
          totalV += mod.valence;
          totalA += mod.arousal;
          count++;
          continue;
        }
      }

      // Fallback: legacy key-based lookup (for free-form traits like "cheerful")
      const legacyMod = TRAIT_MOOD_MODIFIERS[lowerKey];
      if (legacyMod) {
        totalV += legacyMod.valence;
        totalA += legacyMod.arousal;
        count++;
      }
    }

    if (count === 0) return { valence: 0, arousal: 0 };

    // Average the per-trait contributions first
    let avgV = totalV / count;
    let avgA = totalA / count;

    // Apply compound effects as additive bonuses (not averaged in — they're bonuses,
    // not additional "traits", so they shouldn't dilute per-trait contributions)
    const compounds = getActiveCompoundEffects(traits);
    for (const effect of compounds) {
      avgV += effect.modifier.valence;
      avgA += effect.modifier.arousal;
    }

    return {
      valence: clamp(avgV, -1, 1),
      arousal: clamp(avgA, 0, 1),
    };
  }
}

// ── Russell's circumplex mood label mapping ──────────────────────────

const MOOD_THRESHOLD = 0.15;

export function getMoodLabel(valence: number, arousal: number): MoodLabel {
  if (valence > 0.6 && arousal > 0.6) return 'ecstatic';
  if (valence > MOOD_THRESHOLD && arousal > 0.5) return 'excited';
  if (valence > 0.3 && arousal <= 0.5) return 'happy';
  if (valence > MOOD_THRESHOLD && arousal <= 0.3) return 'content';
  if (valence >= -MOOD_THRESHOLD && arousal <= 0.25) return 'calm';
  if (valence < -MOOD_THRESHOLD && arousal > 0.5) return 'angry';
  if (valence < -0.3 && arousal > 0.3) return 'anxious';
  if (valence < -0.3 && arousal <= 0.3) return 'sad';
  if (valence < -MOOD_THRESHOLD && arousal <= 0.3) return 'melancholy';
  return 'neutral';
}

const MOOD_TONE_GUIDES: Record<MoodLabel, string> = {
  ecstatic: 'Speak with enthusiasm and unbridled joy. Be effusive and celebratory.',
  excited: 'Communicate with energy and eagerness. Be animated and forward-leaning.',
  happy: 'Maintain a warm, positive tone. Be encouraging and optimistic.',
  content: 'Be relaxed and satisfied. Communicate with gentle warmth.',
  calm: 'Speak with measured tranquility. Be steady and reassuring.',
  neutral: 'Maintain a balanced, even tone. Be professional and clear.',
  melancholy: 'Allow a subtle wistfulness. Be reflective and gently subdued.',
  sad: 'Show empathy and vulnerability. Communicate with quiet sincerity.',
  angry: 'Be direct and forceful. Show controlled intensity without hostility.',
  anxious: 'Communicate with cautious awareness. Be thorough and detail-oriented.',
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
