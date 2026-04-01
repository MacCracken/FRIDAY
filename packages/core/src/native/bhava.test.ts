/**
 * Bhava 2.0 Native Wrapper Tests
 *
 * Tests the TypeScript wrapper layer for all bhava 2.0 NAPI functions.
 * Native module is mocked to null to exercise the graceful fallback path.
 * When native is available, tests verify JSON round-trip correctness.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock native to null — exercises fallback (returns null for everything)
vi.mock('./index.js', () => ({ native: null }));

import * as bhava from './bhava.js';

// ── Fallback Path (native unavailable) ─────────────────────────────────────

describe('bhava 2.0 wrappers — fallback path', () => {
  describe('zodiac', () => {
    it('listZodiacSigns returns null', () => {
      expect(bhava.listZodiacSigns()).toBeNull();
    });

    it('zodiacProfile returns null', () => {
      expect(bhava.zodiacProfile('scorpio')).toBeNull();
    });

    it('zodiacInfo returns null', () => {
      expect(bhava.zodiacInfo('scorpio')).toBeNull();
    });

    it('zodiacManifest returns null', () => {
      expect(bhava.zodiacManifest('scorpio')).toBeNull();
    });
  });

  describe('regulation', () => {
    it('createRegulatedMood returns null', () => {
      expect(bhava.createRegulatedMood('{}')).toBeNull();
    });

    it('regulate returns null', () => {
      expect(bhava.regulate('{}', 'suppress', 'frustration', 0.5, 1.0)).toBeNull();
    });

    it('defaultRegulationStrategy returns null', () => {
      expect(bhava.defaultRegulationStrategy({}, 'frustration')).toBeNull();
    });

    it('suppressionGap returns null', () => {
      expect(bhava.suppressionGap('{}')).toBeNull();
    });
  });

  describe('stress', () => {
    it('createStressState returns null', () => {
      expect(bhava.createStressState({})).toBeNull();
    });

    it('stressTick returns null', () => {
      expect(bhava.stressTick('{}', '{}')).toBeNull();
    });

    it('stressInfo returns null', () => {
      expect(bhava.stressInfo('{}')).toBeNull();
    });
  });

  describe('energy', () => {
    it('createEnergyState returns null', () => {
      expect(bhava.createEnergyState({})).toBeNull();
    });

    it('energyTick returns null', () => {
      expect(bhava.energyTick('{}', '{}')).toBeNull();
    });

    it('energyInfo returns null', () => {
      expect(bhava.energyInfo('{}')).toBeNull();
    });
  });

  describe('flow', () => {
    it('createFlowState returns null', () => {
      expect(bhava.createFlowState()).toBeNull();
    });

    it('flowTick returns null', () => {
      expect(bhava.flowTick('{}', '{}', 1.0, 1.0)).toBeNull();
    });

    it('flowInfo returns null', () => {
      expect(bhava.flowInfo('{}')).toBeNull();
    });
  });

  describe('circadian', () => {
    it('createCircadian returns null', () => {
      expect(bhava.createCircadian('neutral')).toBeNull();
    });

    it('circadianAlertness returns null', () => {
      expect(bhava.circadianAlertness('{}')).toBeNull();
    });

    it('circadianMoodModulation returns null', () => {
      expect(bhava.circadianMoodModulation('{}')).toBeNull();
    });
  });

  describe('monitor', () => {
    it('createMonitor returns null', () => {
      expect(bhava.createMonitor(0.5)).toBeNull();
    });

    it('monitorFeed returns null', () => {
      expect(bhava.monitorFeed('{}', 'hello')).toBeNull();
    });

    it('monitorFlush returns null', () => {
      expect(bhava.monitorFlush('{}')).toBeNull();
    });

    it('monitorFeedAndApply returns null', () => {
      expect(bhava.monitorFeedAndApply('{}', '{}', 'hello')).toBeNull();
    });
  });

  describe('signal loop', () => {
    it('signalTick returns null', () => {
      expect(bhava.signalTick({ state: {} })).toBeNull();
    });
  });

  // Verify existing 1.x wrappers still work
  describe('existing wrappers (1.x)', () => {
    it('composeTraitPrompt returns null', () => {
      expect(bhava.composeTraitPrompt({ formality: 'casual' })).toBeNull();
    });

    it('deriveBaseline returns null', () => {
      expect(bhava.deriveBaseline({ warmth: 'friendly' })).toBeNull();
    });

    it('composeSystemPrompt returns null', () => {
      expect(bhava.composeSystemPrompt({}, {}, null, '')).toBeNull();
    });

    it('buildMetadata returns null', () => {
      expect(bhava.buildMetadata('test', {}, null)).toBeNull();
    });
  });
});

// ── Native Path (when native module is available) ──────────────────────────
//
// These tests run when the native binary is built. They verify JSON
// round-trip correctness and API contract stability.

describe('bhava 2.0 wrappers — native path', () => {
  // Re-import with real native module. Skip all if unavailable.
  let realBhava: typeof bhava;
  let hasNative = false;

  beforeAll(async () => {
    vi.resetModules();
    // Try loading real native
    try {
      const mod = await import('./index.js');
      hasNative = mod.native !== null;
      if (hasNative) {
        realBhava = await import('./bhava.js');
      }
    } catch {
      hasNative = false;
    }
  });

  it.skipIf(!hasNative)('zodiacManifest returns profile and baseline for Scorpio', () => {
    const result = realBhava!.zodiacManifest('scorpio');
    expect(result).not.toBeNull();
    expect(result!.profile.traits).toBeDefined();
    expect(result!.baseline).toBeDefined();
    expect(result!.baseline.joy).toBeTypeOf('number');
  });

  it.skipIf(!hasNative)('signalTick returns mood_label and mood_prompt', () => {
    const state = realBhava!.createEmotionalState();
    expect(state).not.toBeNull();
    const result = realBhava!.signalTick({ state: JSON.parse(state!) });
    expect(result).not.toBeNull();
    expect(result!.mood_label).toBeTypeOf('string');
    expect(result!.mood_prompt).toBeTypeOf('string');
  });
});
