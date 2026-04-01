/**
 * Bhava Personality Engine — typed wrappers over native NAPI bindings.
 *
 * Every function returns `T | null` — null when the native module is
 * unavailable (Bun runtime or SECUREYEOMAN_NO_NATIVE=1). Callers fall
 * back to the existing TypeScript implementations.
 */

import { native } from './index.js';
import type { Passion, Inspiration, Pain } from '@secureyeoman/shared';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BhavaPreset {
  id: string;
  name: string;
  summary: string;
  profile: {
    name: string;
    description: string | null;
    traits: Record<string, string>;
  };
  identity: {
    soul: string | null;
    spirit: string | null;
    brain: string | null;
    body: string | null;
    heart: string | null;
  };
}

export interface BhavaBaseline {
  joy: number;
  arousal: number;
  dominance: number;
  trust: number;
  interest: number;
  frustration: number;
}

export interface BhavaSentimentResult {
  state: unknown;
  valence: number;
  confidence: number;
  is_positive: boolean;
  is_negative: boolean;
}

export interface BhavaMetadata {
  name: string;
  description: string | null;
  active_traits: [string, string][];
  mood_state: string | null;
  group_averages: [string, number][];
}

// ── Personality Profile ────────────────────────────────────────────────────

export function composeTraitPrompt(traits: Record<string, string>): string | null {
  if (!native) return null;
  try {
    return native.bhavaComposeTraitPrompt(JSON.stringify(traits));
  } catch {
    return null;
  }
}

export function profileCompatibility(
  traitsA: Record<string, string>,
  traitsB: Record<string, string>
): number | null {
  if (!native) return null;
  try {
    return native.bhavaProfileCompatibility(JSON.stringify(traitsA), JSON.stringify(traitsB));
  } catch {
    return null;
  }
}

export function profileToMarkdown(name: string, traits: Record<string, string>): string | null {
  if (!native) return null;
  try {
    return native.bhavaProfileToMarkdown(name, JSON.stringify(traits));
  } catch {
    return null;
  }
}

export function profileFromMarkdown(markdown: string): Record<string, string> | null {
  if (!native) return null;
  try {
    const json = native.bhavaProfileFromMarkdown(markdown);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ── Presets ─────────────────────────────────────────────────────────────────

export function listPresets(): string[] | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaListPresets());
  } catch {
    return null;
  }
}

export function getPreset(id: string): BhavaPreset | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaGetPreset(id));
  } catch {
    return null;
  }
}

// ── Archetypes / Identity ──────────────────────────────────────────────────

export function composePreamble(): string | null {
  if (!native) return null;
  try {
    return native.bhavaComposePreamble();
  } catch {
    return null;
  }
}

export function composeIdentityPrompt(identity: Record<string, string | null>): string | null {
  if (!native) return null;
  try {
    return native.bhavaComposeIdentityPrompt(JSON.stringify(identity));
  } catch {
    return null;
  }
}

// ── Emotional State / Mood ─────────────────────────────────────────────────

export function createEmotionalState(): string | null {
  if (!native) return null;
  try {
    return native.bhavaCreateEmotionalState();
  } catch {
    return null;
  }
}

export function createEmotionalStateWithBaseline(traits: Record<string, string>): string | null {
  if (!native) return null;
  try {
    return native.bhavaCreateEmotionalStateWithBaseline(JSON.stringify(traits));
  } catch {
    return null;
  }
}

export function deriveBaseline(traits: Record<string, string>): BhavaBaseline | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaDeriveBaseline(JSON.stringify(traits)));
  } catch {
    return null;
  }
}

export function stimulate(stateJson: string, emotion: string, intensity: number): string | null {
  if (!native) return null;
  try {
    return native.bhavaStimulate(stateJson, emotion, intensity);
  } catch {
    return null;
  }
}

export function applyDecay(stateJson: string): string | null {
  if (!native) return null;
  try {
    return native.bhavaApplyDecay(stateJson);
  } catch {
    return null;
  }
}

export function classifyMood(stateJson: string): string | null {
  if (!native) return null;
  try {
    return native.bhavaClassifyMood(stateJson);
  } catch {
    return null;
  }
}

export function moodDeviation(stateJson: string): number | null {
  if (!native) return null;
  try {
    return native.bhavaMoodDeviation(stateJson);
  } catch {
    return null;
  }
}

export function composeMoodPrompt(stateJson: string): string | null {
  if (!native) return null;
  try {
    return native.bhavaComposeMoodPrompt(stateJson);
  } catch {
    return null;
  }
}

export function actionTendency(stateJson: string): string | null {
  if (!native) return null;
  try {
    return native.bhavaActionTendency(stateJson);
  } catch {
    return null;
  }
}

// ── Reasoning Strategy ──────────────────────────────────────────────────────

export interface BhavaReasoningResult {
  strategy: string;
  description: string;
  scores: [string, number][];
}

export function selectReasoningStrategy(
  traits: Record<string, string>
): BhavaReasoningResult | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaSelectReasoningStrategy(JSON.stringify(traits)));
  } catch {
    return null;
  }
}

export function composeReasoningPrompt(traits: Record<string, string>): string | null {
  if (!native) return null;
  try {
    return native.bhavaComposeReasoningPrompt(JSON.stringify(traits));
  } catch {
    return null;
  }
}

// ── EQ (Emotional Intelligence) ─────────────────────────────────────────────

export interface BhavaEqProfile {
  perception: number;
  facilitation: number;
  understanding: number;
  management: number;
  overall: number;
  level: string;
  perception_bonus: number;
  management_bonus: number;
  stress_recovery_bonus: number;
  contagion_resistance: number;
}

export function deriveEq(traits: Record<string, string>): BhavaEqProfile | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaDeriveEq(JSON.stringify(traits)));
  } catch {
    return null;
  }
}

export function composeEqPrompt(traits: Record<string, string>): string | null {
  if (!native) return null;
  try {
    return native.bhavaComposeEqPrompt(JSON.stringify(traits));
  } catch {
    return null;
  }
}

// ── Spirit ──────────────────────────────────────────────────────────────────

export function composeSpiritPromptFromData(
  passions: Passion[],
  inspirations: Inspiration[],
  pains: Pain[]
): string | null {
  if (!native) return null;
  try {
    const spiritJson = native.bhavaSpiritFromData(
      JSON.stringify(
        passions.map((p) => ({ name: p.name, description: p.description, intensity: p.intensity }))
      ),
      JSON.stringify(
        inspirations.map((i) => ({
          source: i.source,
          description: i.description,
          impact: i.impact,
        }))
      ),
      JSON.stringify(
        pains.map((p) => ({ trigger: p.trigger, description: p.description, severity: p.severity }))
      )
    );
    return native.bhavaComposeSpiritPrompt(spiritJson);
  } catch {
    return null;
  }
}

// ── Sentiment Feedback ──────────────────────────────────────────────────────

export function applySentimentFeedback(
  text: string,
  stateJson: string,
  scale: number
): BhavaSentimentResult | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaApplySentimentFeedback(text, stateJson, scale));
  } catch {
    return null;
  }
}

export function feedbackFromOutcome(
  stateJson: string,
  outcome: 'praised' | 'criticized' | 'surprised' | 'threatened' | 'neutral'
): string | null {
  if (!native) return null;
  try {
    return native.bhavaFeedbackFromOutcome(stateJson, outcome);
  } catch {
    return null;
  }
}

// ── Full System Prompt ──────────────────────────────────────────────────────

export function composeSystemPrompt(
  traits: Record<string, string>,
  identity: Record<string, string | null>,
  stateJson: string | null,
  spiritText: string
): string | null {
  if (!native) return null;
  try {
    return native.bhavaComposeSystemPrompt(
      JSON.stringify(traits),
      JSON.stringify(identity),
      stateJson ?? 'null',
      spiritText
    );
  } catch {
    return null;
  }
}

// ── Metadata ────────────────────────────────────────────────────────────────

export function buildMetadata(
  name: string,
  traits: Record<string, string>,
  stateJson: string | null
): BhavaMetadata | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaBuildMetadata(name, JSON.stringify(traits), stateJson ?? 'null'));
  } catch {
    return null;
  }
}

// ── Zodiac Engine (bhava 2.0) ─────────────────────────────────────────────

export interface BhavaZodiacInfo {
  sign: string;
  element: string;
  modality: string;
}

export interface BhavaZodiacManifest {
  profile: { name: string; description: string | null; traits: Record<string, string> };
  baseline: BhavaBaseline;
}

export function listZodiacSigns(): string[] | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaListZodiacSigns());
  } catch {
    return null;
  }
}

export function zodiacProfile(sign: string): Record<string, string> | null {
  if (!native) return null;
  try {
    const result = JSON.parse(native.bhavaZodiacProfile(sign));
    return result.traits;
  } catch {
    return null;
  }
}

export function zodiacInfo(sign: string): BhavaZodiacInfo | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaZodiacInfo(sign));
  } catch {
    return null;
  }
}

export function zodiacManifest(sign: string): BhavaZodiacManifest | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaZodiacManifest(sign));
  } catch {
    return null;
  }
}

// ── Regulation (bhava 2.0) ────────────────────────────────────────────────

export function createRegulatedMood(stateJson: string): string | null {
  if (!native) return null;
  try {
    return native.bhavaCreateRegulatedMood(stateJson);
  } catch {
    return null;
  }
}

export function regulate(
  regulatedJson: string,
  strategy: 'accept' | 'suppress' | 'reappraise' | 'distract',
  targetEmotion: string,
  strength: number,
  effectiveness: number
): string | null {
  if (!native) return null;
  try {
    return native.bhavaRegulate(regulatedJson, strategy, targetEmotion, strength, effectiveness);
  } catch {
    return null;
  }
}

export function defaultRegulationStrategy(
  traits: Record<string, string>,
  dominantEmotion: string
): string | null {
  if (!native) return null;
  try {
    return native.bhavaDefaultRegulationStrategy(JSON.stringify(traits), dominantEmotion);
  } catch {
    return null;
  }
}

export function suppressionGap(regulatedJson: string): number | null {
  if (!native) return null;
  try {
    return native.bhavaSuppressionGap(regulatedJson);
  } catch {
    return null;
  }
}

// ── Stress (bhava 2.0) ───────────────────────────────────────────────────

export interface BhavaStressInfo {
  level: string;
  load: number;
  is_fatigued: boolean;
  is_burned_out: boolean;
  negative_amplifier: number;
  regulation_effectiveness: number;
}

export function createStressState(traits: Record<string, string>): string | null {
  if (!native) return null;
  try {
    return native.bhavaCreateStressState(JSON.stringify(traits));
  } catch {
    return null;
  }
}

export function stressTick(stressJson: string, stateJson: string): string | null {
  if (!native) return null;
  try {
    return native.bhavaStressTick(stressJson, stateJson);
  } catch {
    return null;
  }
}

export function stressInfo(stressJson: string): BhavaStressInfo | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaStressInfo(stressJson));
  } catch {
    return null;
  }
}

// ── Energy (bhava 2.0) ───────────────────────────────────────────────────

export interface BhavaEnergyInfo {
  level: string;
  energy: number;
  performance: number;
  can_enter_flow: boolean;
  is_depleted: boolean;
  regulation_effectiveness: number;
}

export function createEnergyState(traits: Record<string, string>): string | null {
  if (!native) return null;
  try {
    return native.bhavaCreateEnergyState(JSON.stringify(traits));
  } catch {
    return null;
  }
}

export function energyTick(energyJson: string, stateJson: string): string | null {
  if (!native) return null;
  try {
    return native.bhavaEnergyTick(energyJson, stateJson);
  } catch {
    return null;
  }
}

export function energyInfo(energyJson: string): BhavaEnergyInfo | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaEnergyInfo(energyJson));
  } catch {
    return null;
  }
}

// ── Flow State (bhava 2.0) ──────────────────────────────────────────────

export interface BhavaFlowInfo {
  phase: string;
  accumulator: number;
  flow_duration: number;
}

export function createFlowState(): string | null {
  if (!native) return null;
  try {
    return native.bhavaCreateFlowState();
  } catch {
    return null;
  }
}

export function flowTick(
  flowJson: string,
  stateJson: string,
  energy: number,
  alertness: number
): string | null {
  if (!native) return null;
  try {
    return native.bhavaFlowTick(flowJson, stateJson, energy, alertness);
  } catch {
    return null;
  }
}

export function flowInfo(flowJson: string): BhavaFlowInfo | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaFlowInfo(flowJson));
  } catch {
    return null;
  }
}

// ── Circadian Rhythm (bhava 2.0) ────────────────────────────────────────

export interface BhavaCircadianAlertness {
  alertness: number;
  chronotype: string;
}

export function createCircadian(
  chronotype:
    | 'early bird'
    | 'morning-leaning'
    | 'neutral'
    | 'evening-leaning'
    | 'night owl'
): string | null {
  if (!native) return null;
  try {
    return native.bhavaCreateCircadian(chronotype);
  } catch {
    return null;
  }
}

export function circadianAlertness(circadianJson: string): BhavaCircadianAlertness | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaCircadianAlertness(circadianJson));
  } catch {
    return null;
  }
}

export function circadianMoodModulation(circadianJson: string): string | null {
  if (!native) return null;
  try {
    return native.bhavaCircadianMoodModulation(circadianJson);
  } catch {
    return null;
  }
}

// ── Sentiment Monitor (bhava 2.0) ───────────────────────────────────────

export function createMonitor(scale: number): string | null {
  if (!native) return null;
  try {
    return native.bhavaCreateMonitor(scale);
  } catch {
    return null;
  }
}

export interface BhavaMonitorResult {
  monitor: unknown;
  results: unknown[];
  state?: unknown;
}

export function monitorFeed(monitorJson: string, chunk: string): BhavaMonitorResult | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaMonitorFeed(monitorJson, chunk));
  } catch {
    return null;
  }
}

export function monitorFlush(monitorJson: string): BhavaMonitorResult | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaMonitorFlush(monitorJson));
  } catch {
    return null;
  }
}

export function monitorFeedAndApply(
  monitorJson: string,
  stateJson: string,
  chunk: string
): BhavaMonitorResult | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaMonitorFeedAndApply(monitorJson, stateJson, chunk));
  } catch {
    return null;
  }
}

// ── Signal Loop Tick (bhava 2.0) ────────────────────────────────────────

export interface BhavaSignalTickResult {
  state: unknown;
  mood_label: string;
  mood_prompt: string;
  alertness: number;
  stress?: unknown;
  stress_level?: string;
  energy?: unknown;
  energy_level?: string;
  performance?: number;
  flow?: unknown;
  flow_phase?: string;
  circadian?: unknown;
}

export function signalTick(composite: {
  state: unknown;
  stress?: unknown;
  energy?: unknown;
  flow?: unknown;
  circadian?: unknown;
}): BhavaSignalTickResult | null {
  if (!native) return null;
  try {
    return JSON.parse(native.bhavaSignalTick(JSON.stringify(composite)));
  } catch {
    return null;
  }
}
