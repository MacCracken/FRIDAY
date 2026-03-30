/**
 * Dhvani Audio Engine — unit tests for NAPI wrappers and trait-to-voice mapping.
 */

import { describe, it, expect } from 'vitest';
import { native, nativeAvailable } from './index.js';
import {
  voiceProfileMale,
  voiceProfileFemale,
  voiceProfileFromConfig,
  g2pConvert,
  synthesizeSpeech,
  synthesizePhonemes,
  noiseReduce,
  resample,
  normalize,
  analyzeDynamics,
  loudnessLufs,
  isSilent,
  pcmToWav,
  suggestGain,
  traitsToVoiceProfile,
} from './dhvani.js';

// ── Trait-to-Voice Mapping (pure TS, always runs) ────────────────────────

describe('traitsToVoiceProfile', () => {
  it('produces default values for balanced traits', () => {
    const config = traitsToVoiceProfile({
      formality: 'balanced',
      humor: 'balanced',
      warmth: 'balanced',
      confidence: 'balanced',
      patience: 'balanced',
      precision: 'balanced',
    });

    expect(config.base).toBe('male');
    expect(config.base_f0).toBe(120); // no offset
    expect(config.f0_range).toBe(40); // male default
    expect(config.breathiness).toBeCloseTo(0.02, 2);
  });

  it('T.Ron traits produce authoritative voice', () => {
    const config = traitsToVoiceProfile({
      formality: 'formal',
      humor: 'deadpan',
      warmth: 'reserved',
      confidence: 'authoritative',
      patience: 'efficient',
      precision: 'meticulous',
      skepticism: 'skeptical',
      risk_tolerance: 'risk-averse',
    });

    // Authoritative + formal = lower pitch
    expect(config.base_f0!).toBeLessThan(120);
    // Deadpan = flat intonation
    expect(config.f0_range!).toBeLessThan(40);
    // Reserved warmth = low breathiness
    expect(config.breathiness!).toBeLessThan(0.02);
    // Meticulous = steady voice (low jitter)
    expect(config.jitter!).toBeLessThan(0.01);
    expect(config.shimmer!).toBeLessThan(0.02);
  });

  it('warm friendly traits produce expressive voice', () => {
    const config = traitsToVoiceProfile({
      formality: 'casual',
      humor: 'witty',
      warmth: 'friendly',
      confidence: 'balanced',
      patience: 'patient',
      precision: 'balanced',
    });

    // Witty = more f0 range
    expect(config.f0_range!).toBeGreaterThan(40);
    // Friendly = more breathiness
    expect(config.breathiness!).toBeGreaterThan(0.02);
    // Patient = more vibrato
    expect(config.vibrato_depth!).toBeGreaterThan(0.04);
  });

  it('supports female and child base voices', () => {
    const female = traitsToVoiceProfile({}, 'female');
    expect(female.base).toBe('female');
    expect(female.base_f0!).toBeCloseTo(220, 0);

    const child = traitsToVoiceProfile({}, 'child');
    expect(child.base).toBe('child');
    expect(child.base_f0!).toBeCloseTo(300, 0);
  });

  it('handles unknown trait values gracefully', () => {
    const config = traitsToVoiceProfile({ formality: 'unknown_value' });
    expect(config.base_f0).toBe(120); // no offset for unknown
  });
});

// ── Native Module Tests (skip when native unavailable) ───────────────────

// Skip when native module lacks dhvani functions (addon not yet rebuilt)
const dhvaniAvailable = nativeAvailable && typeof native?.dhvaniVoiceProfileMale === 'function';
describe.skipIf(!dhvaniAvailable)('dhvani native', () => {
  describe('voice profiles', () => {
    it('creates male voice profile', () => {
      const profile = voiceProfileMale();
      expect(profile).not.toBeNull();
      expect(profile!.base_f0).toBeCloseTo(120, 0);
      expect(profile!.formant_scale).toBeCloseTo(1.0, 1);
    });

    it('creates female voice profile', () => {
      const profile = voiceProfileFemale();
      expect(profile).not.toBeNull();
      expect(profile!.base_f0).toBeCloseTo(220, 0);
      expect(profile!.formant_scale).toBeGreaterThan(1.0);
    });

    it('creates profile from config', () => {
      const profile = voiceProfileFromConfig({
        base: 'male',
        base_f0: 100,
        breathiness: 0.1,
      });
      expect(profile).not.toBeNull();
      expect(profile!.base_f0).toBeCloseTo(100, 0);
      expect(profile!.breathiness).toBeCloseTo(0.1, 2);
    });
  });

  describe('G2P', () => {
    it('converts text to phoneme events', () => {
      const events = g2pConvert('hello');
      expect(events).not.toBeNull();
      expect(events!.length).toBeGreaterThan(0);
    });

    it('handles empty text', () => {
      const events = g2pConvert('');
      expect(events).not.toBeNull();
      expect(events!.length).toBe(0);
    });
  });

  describe('voice synthesis', () => {
    it('synthesizes speech from text', () => {
      const pcm = synthesizeSpeech('hello');
      expect(pcm).not.toBeNull();
      expect(pcm!.length).toBeGreaterThan(0);
    });

    it('synthesizes with custom voice profile', () => {
      const profile = voiceProfileFemale();
      const pcm = synthesizeSpeech('hello', profile, 22050);
      expect(pcm).not.toBeNull();
      expect(pcm!.length).toBeGreaterThan(0);
    });

    it('synthesizes from phoneme events', () => {
      const events = g2pConvert('hello');
      expect(events).not.toBeNull();
      const pcm = synthesizePhonemes(JSON.stringify(events));
      expect(pcm).not.toBeNull();
      expect(pcm!.length).toBeGreaterThan(0);
    });
  });

  describe('DSP', () => {
    // Generate a simple test signal: 1 second of 440Hz sine at 44100 Hz
    function generateSine(frequency: number, sampleRate: number, seconds: number): Buffer {
      const samples = sampleRate * seconds;
      const buf = Buffer.alloc(samples * 4);
      for (let i = 0; i < samples; i++) {
        const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.5;
        buf.writeFloatLE(value, i * 4);
      }
      return buf;
    }

    const testSignal = generateSine(440, 44100, 0.1); // 100ms of 440Hz

    it('applies noise reduction', () => {
      const result = noiseReduce(testSignal, 44100, 0.5);
      expect(result).not.toBeNull();
      expect(result!.length).toBe(testSignal.length);
    });

    it('resamples audio', () => {
      const result = resample(testSignal, 44100, 22050);
      expect(result).not.toBeNull();
      // Resampled to half rate = roughly half the samples
      expect(result!.length).toBeLessThan(testSignal.length);
      expect(result!.length).toBeGreaterThan(0);
    });

    it('normalizes audio', () => {
      const result = normalize(testSignal, 44100, 0.95);
      expect(result).not.toBeNull();
      expect(result!.length).toBe(testSignal.length);
    });
  });

  describe('analysis', () => {
    function generateSine(frequency: number, sampleRate: number, seconds: number): Buffer {
      const samples = sampleRate * seconds;
      const buf = Buffer.alloc(samples * 4);
      for (let i = 0; i < samples; i++) {
        const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.5;
        buf.writeFloatLE(value, i * 4);
      }
      return buf;
    }

    const testSignal = generateSine(440, 44100, 0.1);
    const silentSignal = Buffer.alloc(4410 * 4); // 100ms of silence

    it('analyzes dynamics', () => {
      const result = analyzeDynamics(testSignal, 44100);
      expect(result).not.toBeNull();
      expect(result!.peak.length).toBeGreaterThan(0);
      expect(result!.peak[0]).toBeGreaterThan(0);
      expect(result!.dynamic_range_db).toBeGreaterThan(0);
    });

    it('measures loudness', () => {
      const lufs = loudnessLufs(testSignal, 44100);
      expect(lufs).not.toBeNull();
      expect(lufs!).toBeLessThan(0); // LUFS is negative for non-clipping audio
    });

    it('detects silence', () => {
      expect(isSilent(silentSignal, 44100)).toBe(true);
      expect(isSilent(testSignal, 44100)).toBe(false);
    });

    it('suggests gain', () => {
      const gain = suggestGain(testSignal, 44100, 0.5);
      expect(gain).not.toBeNull();
      expect(gain!).toBeGreaterThan(0);
    });
  });

  describe('utility', () => {
    it('converts PCM to WAV', () => {
      const samples = 4410; // 0.1s at 44100
      const pcm = Buffer.alloc(samples * 4);
      for (let i = 0; i < samples; i++) {
        pcm.writeFloatLE(Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5, i * 4);
      }

      const wav = pcmToWav(pcm, 44100);
      expect(wav).not.toBeNull();
      // WAV header = 44 bytes + 16-bit PCM data
      expect(wav!.length).toBe(44 + samples * 2);
      // Check RIFF header
      expect(wav!.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(wav!.subarray(8, 12).toString('ascii')).toBe('WAVE');
    });
  });
});
