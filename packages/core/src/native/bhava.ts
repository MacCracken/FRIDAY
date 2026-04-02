/**
 * Bhava stub — the native NAPI module is gone.
 * All functions return null; consumers handle null as "native unavailable".
 * Types are exported to satisfy `import type` statements in consumers.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BhavaPreset {
  id: string;
  name: string;
  summary: string;
  identity: { soul?: string };
  profile: { traits: Record<string, string> };
}

export interface BhavaBaseline {
  joy: number;
  sadness: number;
  anger: number;
  fear: number;
  arousal: number;
  valence: number;
}

export interface BhavaSentimentResult {
  state: unknown;
  valence: number;
  confidence: number;
  is_positive: boolean;
}

export interface BhavaSignalTickResult {
  state: unknown;
  stress?: unknown;
  energy?: unknown;
  flow?: unknown;
  circadian?: unknown;
  mood_label: string;
  // mood_prompt is always a string when the result is non-null
  mood_prompt: string;
  stress_level?: string;
  energy_level?: string;
  flow_phase?: string;
  performance?: number | null;
  alertness?: number | null;
}

export interface BhavaMetadata {
  name: string;
  traits: Record<string, string>;
  state: unknown;
}

// ── Core personality functions ────────────────────────────────────────────────

export function composeTraitPrompt(_traits: Record<string, string>): string | null {
  return null;
}

export function deriveBaseline(_traits: Record<string, string>): BhavaBaseline | null {
  return null;
}

export function createEmotionalStateWithBaseline(_traits: Record<string, string>): string | null {
  return null;
}

export function composeMoodPrompt(_stateJson: string): string | null {
  return null;
}

export function applySentimentFeedback(
  _text: string,
  _stateJson: string,
  _scale: number
): BhavaSentimentResult | null {
  return null;
}

export function composePreamble(): string | null {
  return null;
}

export function composeReasoningPrompt(_traits: Record<string, string>): string | null {
  return null;
}

export function composeEqPrompt(_traits: Record<string, string>): string | null {
  return null;
}

// Accepts arrays of any shape (Passion[], Inspiration[], Pain[]) — always returns null
export function composeSpiritPromptFromData(
  _passions: unknown[],
  _inspirations: unknown[],
  _pains: unknown[]
): string | null {
  return null;
}

export function composeSystemPrompt(
  _traits: Record<string, string>,
  _identity: unknown,
  _state: unknown,
  _spiritText: string
): string | null {
  return null;
}

export function listPresets(): string[] | null {
  return null;
}

export function getPreset(_id: string): BhavaPreset | null {
  return null;
}

export function buildMetadata(
  _name: string,
  _traits: Record<string, string>,
  _stateJson: string
): BhavaMetadata | null {
  return null;
}

// ── Bhava 2.0 — stress, energy, flow, circadian, signal loop ─────────────────

export function createStressState(_traits: Record<string, string>): string | null {
  return null;
}

export function createEnergyState(_traits: Record<string, string>): string | null {
  return null;
}

export function createFlowState(): string | null {
  return null;
}

export function createCircadian(_chronotype: string): string | null {
  return null;
}

export function signalTick(_composite: Record<string, unknown>): BhavaSignalTickResult | null {
  return null;
}
