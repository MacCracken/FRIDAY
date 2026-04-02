/**
 * Dhvani stub — the native NAPI audio engine is gone.
 * All functions return null. Consumer (multimodal/manager.ts) guards all
 * calls and throws when pcmBuffer is null, which triggers provider fallback.
 */

export interface VoiceProfileConfig {
  base?: 'male' | 'female' | 'child';
  pitch?: number;
  speed?: number;
  energy?: number;
}

export function voiceProfileMale(): string | null {
  return null;
}

export function voiceProfileFemale(): string | null {
  return null;
}

export function voiceProfileFromConfig(_config: VoiceProfileConfig): string | null {
  return null;
}

export function g2pConvert(_text: string, _language?: string | null): unknown | null {
  return null;
}

export function synthesizeSpeech(
  _text: string,
  _voiceProfileJson?: string | null,
  _sampleRate?: number | null
): Buffer | null {
  return null;
}

export function synthesizePhonemes(
  _phonemeEventsJson: string,
  _voiceProfileJson?: string | null,
  _sampleRate?: number | null
): Buffer | null {
  return null;
}

export function noiseReduce(
  _audio: Buffer,
  _sampleRate: number,
  _strength?: number | null,
  _channels?: number | null
): Buffer | null {
  return null;
}

export function resample(
  _audio: Buffer,
  _sourceRate: number,
  _targetRate: number,
  _channels?: number | null
): Buffer | null {
  return null;
}

export function normalize(
  _audio: Buffer,
  _sampleRate: number,
  _targetPeak: number,
  _channels?: number | null
): Buffer | null {
  return null;
}

export function analyzeDynamics(
  _audio: Buffer,
  _sampleRate: number,
  _channels?: number | null
): string | null {
  return null;
}

export function loudnessLufs(
  _audio: Buffer,
  _sampleRate: number,
  _channels?: number | null
): number | null {
  return null;
}

export function isSilent(
  _audio: Buffer,
  _sampleRate: number,
  _thresholdDb?: number | null,
  _channels?: number | null
): boolean | null {
  return null;
}

export function pcmToWav(
  _audio: Buffer,
  _sampleRate: number,
  _channels?: number | null
): Buffer | null {
  return null;
}

export function suggestGain(
  _audio: Buffer,
  _sampleRate: number,
  _targetRms: number,
  _channels?: number | null
): number | null {
  return null;
}
