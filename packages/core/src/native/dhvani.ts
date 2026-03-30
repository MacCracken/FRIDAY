/**
 * Dhvani Audio Engine — typed wrappers over native NAPI bindings.
 *
 * Every function returns `T | null` — null when the native module is
 * unavailable (Bun runtime or SECUREYEOMAN_NO_NATIVE=1). Callers fall
 * back to the existing TypeScript implementations.
 */

import { native } from './index.js';

// ── Bhava Personality → Voice Prosody ────────────────────────────────────

/**
 * Map bhava personality traits to dhvani VoiceProfile parameters.
 *
 * Trait dimensions influence voice characteristics:
 * - formality/confidence → base_f0 (lower = more authoritative)
 * - humor → f0_range (deadpan = flat, comedic = expressive)
 * - warmth/empathy → breathiness (cold = clear, effusive = breathy)
 * - patience → vibrato_rate/depth (brisk = less vibrato, nurturing = more)
 * - precision → jitter/shimmer (meticulous = steady, approximate = variable)
 * - confidence → formant_scale (authoritative = slightly deeper)
 */
export function traitsToVoiceProfile(
  traits: Record<string, string>,
  base: 'male' | 'female' | 'child' = 'male'
): VoiceProfileConfig {
  const config: VoiceProfileConfig = { base };

  // Trait level scoring: lowest=-2, low=-1, balanced=0, high=1, highest=2
  const score = (level: string | undefined): number => {
    if (!level || level === 'balanced') return 0;
    const low = level.toLowerCase();
    // Map each descriptive level to a numeric score
    const lowScores = [
      'street',
      'deadpan',
      'terse',
      'evasive',
      'cold',
      'detached',
      'brisk',
      'humble',
      'rigid',
      'risk-averse',
      'narrow',
      'gullible',
      'dependent',
      'terse-answer',
      'approximate',
    ];
    const midLowScores = [
      'casual',
      'dry',
      'concise',
      'diplomatic',
      'reserved',
      'analytical',
      'efficient',
      'modest',
      'conventional',
      'cautious',
      'focused',
      'trusting',
      'consultative',
      'answer-focused',
      'loose',
    ];
    const midHighScores = [
      'formal',
      'witty',
      'detailed',
      'candid',
      'friendly',
      'empathetic',
      'patient',
      'assertive',
      'imaginative',
      'bold',
      'curious',
      'skeptical',
      'proactive',
      'explanatory',
      'precise',
    ];
    const highScores = [
      'ceremonial',
      'comedic',
      'exhaustive',
      'blunt',
      'effusive',
      'compassionate',
      'nurturing',
      'authoritative',
      'avant-garde',
      'reckless',
      'exploratory',
      'contrarian',
      'autonomous',
      'socratic',
      'meticulous',
    ];

    if (lowScores.includes(low)) return -2;
    if (midLowScores.includes(low)) return -1;
    if (midHighScores.includes(low)) return 1;
    if (highScores.includes(low)) return 2;
    return 0;
  };

  const formality = score(traits.formality);
  const humor = score(traits.humor);
  const warmth = score(traits.warmth);
  const confidence = score(traits.confidence);
  const patience = score(traits.patience);
  const precision = score(traits.precision);

  // Base f0: authoritative/formal = lower pitch
  const f0Offsets = { male: 120, female: 220, child: 300 };
  const baseF0 = f0Offsets[base];
  config.base_f0 = baseF0 + formality * -5 + confidence * -8;

  // F0 range: deadpan humor = flat, comedic = expressive
  const f0Ranges = { male: 40, female: 50, child: 60 };
  config.f0_range = Math.max(10, f0Ranges[base] + humor * 15);

  // Formant scale: authoritative = slightly deeper resonance
  const formantBase = { male: 1.0, female: 1.17, child: 1.3 };
  config.formant_scale = formantBase[base] + confidence * -0.02;

  // Breathiness: warmth/empathy drives breathiness
  config.breathiness = Math.max(0, Math.min(1, 0.02 + warmth * 0.03));

  // Vibrato: patience/warmth drives vibrato expressiveness
  config.vibrato_rate = 5.0 + patience * 0.3;
  config.vibrato_depth = Math.max(0, 0.04 + patience * 0.01 + warmth * 0.01);

  // Jitter/shimmer: precision = steady, approximate = variable
  config.jitter = Math.max(0.005, 0.01 + precision * -0.002);
  config.shimmer = Math.max(0.01, 0.02 + precision * -0.003);

  return config;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface VoiceProfile {
  base_f0: number;
  f0_range: number;
  formant_scale: number;
  breathiness: number;
  vibrato_rate: number;
  vibrato_depth: number;
  jitter: number;
  shimmer: number;
}

export interface VoiceProfileConfig {
  base?: 'male' | 'female' | 'child';
  base_f0?: number;
  f0_range?: number;
  formant_scale?: number;
  breathiness?: number;
  vibrato_rate?: number;
  vibrato_depth?: number;
  jitter?: number;
  shimmer?: number;
}

export interface DynamicsAnalysis {
  peak: number[];
  peak_db: number[];
  true_peak: number[];
  true_peak_db: number[];
  rms: number[];
  rms_db: number[];
  crest_factor_db: number[];
  lufs: number;
  dynamic_range_db: number;
  max_peak_db: number;
  max_true_peak_db: number;
  mean_rms: number;
  frame_count: number;
  channel_count: number;
}

// ── Voice Profiles ────────────────────────────────────────────────────────

export function voiceProfileMale(): VoiceProfile | null {
  if (!native) return null;
  return JSON.parse(native.dhvaniVoiceProfileMale()) as VoiceProfile;
}

export function voiceProfileFemale(): VoiceProfile | null {
  if (!native) return null;
  return JSON.parse(native.dhvaniVoiceProfileFemale()) as VoiceProfile;
}

export function voiceProfileFromConfig(config: VoiceProfileConfig): VoiceProfile | null {
  if (!native) return null;
  return JSON.parse(native.dhvaniVoiceProfileFromJson(JSON.stringify(config))) as VoiceProfile;
}

// ── G2P (Grapheme-to-Phoneme) ────────────────────────────────────────────

export function g2pConvert(text: string, language?: string): unknown[] | null {
  if (!native) return null;
  return JSON.parse(native.dhvaniG2pConvert(text, language ?? null)) as unknown[];
}

// ── Voice Synthesis ──────────────────────────────────────────────────────

/**
 * Synthesize speech from text via G2P -> phoneme sequence -> vocal synthesis.
 * Returns raw PCM f32 samples as a Buffer (mono).
 */
export function synthesizeSpeech(
  text: string,
  voiceProfile?: VoiceProfile | null,
  sampleRate?: number
): Buffer | null {
  if (!native) return null;
  return native.dhvaniSynthesizeSpeech(
    text,
    voiceProfile ? JSON.stringify(voiceProfile) : null,
    sampleRate ?? null
  );
}

/**
 * Synthesize speech from pre-built phoneme events JSON.
 * Returns raw PCM f32 samples as a Buffer (mono).
 */
export function synthesizePhonemes(
  phonemeEventsJson: string,
  voiceProfile?: VoiceProfile | null,
  sampleRate?: number
): Buffer | null {
  if (!native) return null;
  return native.dhvaniSynthesizePhonemes(
    phonemeEventsJson,
    voiceProfile ? JSON.stringify(voiceProfile) : null,
    sampleRate ?? null
  );
}

// ── Audio DSP ────────────────────────────────────────────────────────────

/**
 * Apply noise reduction. Strength: 0.0 (none) to 1.0 (max). Default 0.5.
 */
export function noiseReduce(
  audio: Buffer,
  sampleRate: number,
  strength?: number,
  channels?: number
): Buffer | null {
  if (!native) return null;
  return native.dhvaniNoiseReduce(audio, sampleRate, strength ?? null, channels ?? null);
}

export function resample(
  audio: Buffer,
  sourceRate: number,
  targetRate: number,
  channels?: number
): Buffer | null {
  if (!native) return null;
  return native.dhvaniResample(audio, sourceRate, targetRate, channels ?? null);
}

export function normalize(
  audio: Buffer,
  sampleRate: number,
  targetPeak: number,
  channels?: number
): Buffer | null {
  if (!native) return null;
  return native.dhvaniNormalize(audio, sampleRate, targetPeak, channels ?? null);
}

// ── Audio Analysis ───────────────────────────────────────────────────────

export function analyzeDynamics(
  audio: Buffer,
  sampleRate: number,
  channels?: number
): DynamicsAnalysis | null {
  if (!native) return null;
  return JSON.parse(
    native.dhvaniAnalyzeDynamics(audio, sampleRate, channels ?? null)
  ) as DynamicsAnalysis;
}

export function loudnessLufs(audio: Buffer, sampleRate: number, channels?: number): number | null {
  if (!native) return null;
  return native.dhvaniLoudnessLufs(audio, sampleRate, channels ?? null);
}

export function isSilent(
  audio: Buffer,
  sampleRate: number,
  thresholdDb?: number,
  channels?: number
): boolean | null {
  if (!native) return null;
  return native.dhvaniIsSilent(audio, sampleRate, thresholdDb ?? null, channels ?? null);
}

// ── Utility ──────────────────────────────────────────────────────────────

/**
 * Convert raw PCM f32 samples to WAV format.
 */
export function pcmToWav(audio: Buffer, sampleRate: number, channels?: number): Buffer | null {
  if (!native) return null;
  return native.dhvaniPcmToWav(audio, sampleRate, channels ?? null);
}

export function suggestGain(
  audio: Buffer,
  sampleRate: number,
  targetRms: number,
  channels?: number
): number | null {
  if (!native) return null;
  return native.dhvaniSuggestGain(audio, sampleRate, targetRms, channels ?? null);
}
