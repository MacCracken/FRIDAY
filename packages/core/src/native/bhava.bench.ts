/**
 * Bhava 2.0 Performance Benchmarks
 *
 * Measures the hot paths in the bhava signal loop:
 * - Zodiac manifest (personality initialization)
 * - Signal tick (per-interaction composite tick)
 * - Sentiment monitor feed (per-token streaming feedback)
 * - Regulation (per-response mood regulation)
 * - Stress/energy tick (per-interaction subsystem updates)
 *
 * These benchmarks require the native module. Skip gracefully if unavailable.
 *
 * Run:  npm run bench --workspace=packages/core
 *       -- or --
 *       cd packages/core && npx vitest bench
 */

import { bench, describe, beforeAll } from 'vitest';

// ── Native module detection ──────────────────────────────────────────────────

let bhava: typeof import('./bhava.js') | null = null;
let hasNative = false;

// Fixtures populated in beforeAll
let emotionalStateJson = '';
let stressJson = '';
let energyJson = '';
let flowJson = '';
let circadianJson = '';
let monitorJson = '';
let regulatedJson = '';
const traitsJson = JSON.stringify({
  formality: 'casual',
  humor: 'witty',
  verbosity: 'concise',
  directness: 'candid',
  warmth: 'friendly',
  empathy: 'empathetic',
  patience: 'patient',
  confidence: 'assertive',
  creativity: 'imaginative',
  risk_tolerance: 'bold',
  curiosity: 'curious',
  skepticism: 'balanced',
  autonomy: 'proactive',
  pedagogy: 'explanatory',
  precision: 'precise',
});
const traits = JSON.parse(traitsJson);

beforeAll(async () => {
  try {
    bhava = await import('./bhava.js');
    // Test if native is actually available
    const result = bhava.createEmotionalState();
    hasNative = result !== null;

    if (hasNative) {
      emotionalStateJson = bhava.createEmotionalState()!;
      stressJson = bhava.createStressState(traits)!;
      energyJson = bhava.createEnergyState(traits)!;
      flowJson = bhava.createFlowState()!;
      circadianJson = bhava.createCircadian('neutral')!;
      monitorJson = bhava.createMonitor(0.3)!;
      regulatedJson = bhava.createRegulatedMood(emotionalStateJson)!;
    }
  } catch {
    hasNative = false;
  }
});

// ── Zodiac (initialization — runs once per personality creation) ──────────

describe.skipIf(!hasNative)('zodiac — personality initialization', () => {
  bench('zodiacManifest (Scorpio)', () => {
    bhava!.zodiacManifest('scorpio');
  });

  bench('zodiacManifest (Aries)', () => {
    bhava!.zodiacManifest('aries');
  });

  bench('listZodiacSigns', () => {
    bhava!.listZodiacSigns();
  });

  bench('zodiacInfo', () => {
    bhava!.zodiacInfo('scorpio');
  });
});

// ── Signal Tick (hot path — runs every interaction) ──────────────────────

describe.skipIf(!hasNative)('signal tick — per-interaction hot path', () => {
  bench('signalTick (state only)', () => {
    bhava!.signalTick({ state: JSON.parse(emotionalStateJson) });
  });

  bench('signalTick (full composite: state + stress + energy + flow + circadian)', () => {
    bhava!.signalTick({
      state: JSON.parse(emotionalStateJson),
      stress: JSON.parse(stressJson),
      energy: JSON.parse(energyJson),
      flow: JSON.parse(flowJson),
      circadian: JSON.parse(circadianJson),
    });
  });
});

// ── Sentiment Monitor (hot path — runs per-token during streaming) ───────

describe.skipIf(!hasNative)('sentiment monitor — per-token streaming', () => {
  bench('monitorFeed (short token)', () => {
    bhava!.monitorFeed(monitorJson, 'hello ');
  });

  bench('monitorFeed (sentence boundary)', () => {
    bhava!.monitorFeed(monitorJson, 'This is wonderful work! ');
  });

  bench('monitorFeedAndApply (sentence with mood update)', () => {
    bhava!.monitorFeedAndApply(monitorJson, emotionalStateJson, 'I really appreciate that. ');
  });

  bench('monitorFlush', () => {
    bhava!.monitorFlush(monitorJson);
  });
});

// ── Mood & Regulation (per-response processing) ─────────────────────────

describe.skipIf(!hasNative)('mood & regulation — per-response', () => {
  bench('createEmotionalStateWithBaseline', () => {
    bhava!.createEmotionalStateWithBaseline(traits);
  });

  bench('stimulate + classify', () => {
    const state = bhava!.stimulate(emotionalStateJson, 'joy', 0.5)!;
    bhava!.classifyMood(state);
  });

  bench('applyDecay', () => {
    bhava!.applyDecay(emotionalStateJson);
  });

  bench('composeMoodPrompt', () => {
    bhava!.composeMoodPrompt(emotionalStateJson);
  });

  bench('createRegulatedMood', () => {
    bhava!.createRegulatedMood(emotionalStateJson);
  });

  bench('regulate (suppress frustration)', () => {
    bhava!.regulate(regulatedJson, 'suppress', 'frustration', 0.5, 1.0);
  });

  bench('regulate (reappraise)', () => {
    bhava!.regulate(regulatedJson, 'reappraise', 'frustration', 0.4, 0.8);
  });

  bench('defaultRegulationStrategy', () => {
    bhava!.defaultRegulationStrategy(traits, 'frustration');
  });

  bench('suppressionGap', () => {
    bhava!.suppressionGap(regulatedJson);
  });
});

// ── Subsystem Ticks (per-interaction) ────────────────────────────────────

describe.skipIf(!hasNative)('subsystem ticks — per-interaction', () => {
  bench('stressTick', () => {
    bhava!.stressTick(stressJson, emotionalStateJson);
  });

  bench('stressInfo', () => {
    bhava!.stressInfo(stressJson);
  });

  bench('energyTick', () => {
    bhava!.energyTick(energyJson, emotionalStateJson);
  });

  bench('energyInfo', () => {
    bhava!.energyInfo(energyJson);
  });

  bench('flowTick', () => {
    bhava!.flowTick(flowJson, emotionalStateJson, 0.8, 0.9);
  });

  bench('flowInfo', () => {
    bhava!.flowInfo(flowJson);
  });

  bench('circadianAlertness', () => {
    bhava!.circadianAlertness(circadianJson);
  });

  bench('circadianMoodModulation', () => {
    bhava!.circadianMoodModulation(circadianJson);
  });
});

// ── Sentiment Feedback (existing 1.x — baseline comparison) ─────────────

describe.skipIf(!hasNative)('sentiment feedback — 1.x baseline', () => {
  bench('applySentimentFeedback (short text)', () => {
    bhava!.applySentimentFeedback('That was helpful, thank you!', emotionalStateJson, 0.3);
  });

  bench('applySentimentFeedback (medium text)', () => {
    bhava!.applySentimentFeedback(
      'I really appreciate your help with this complex problem. The solution is elegant and well-structured. However, I noticed a small issue with the error handling.',
      emotionalStateJson,
      0.3
    );
  });
});

// ── System Prompt Composition (per-conversation start) ──────────────────

describe.skipIf(!hasNative)('system prompt composition', () => {
  bench('composeSystemPrompt (full)', () => {
    bhava!.composeSystemPrompt(
      traits,
      {
        soul: 'You are a sovereign AI entity',
        spirit: null,
        brain: 'Analytical and precise',
        body: null,
        heart: 'Empathetic',
      },
      emotionalStateJson,
      'Passionate about helping humans grow'
    );
  });

  bench('composeTraitPrompt', () => {
    bhava!.composeTraitPrompt(traits);
  });

  bench('selectReasoningStrategy', () => {
    bhava!.selectReasoningStrategy(traits);
  });

  bench('deriveEq', () => {
    bhava!.deriveEq(traits);
  });
});
