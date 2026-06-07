/**
 * Retrieval Optimizer — Reinforcement Learning for Scoring Weights (Phase 125 — Future)
 *
 * Learns optimal compositeScore() blending weights from user feedback.
 * Uses Thompson Sampling (Beta-Bernoulli bandit) to explore different
 * weight configurations and converge on what works best for each personality.
 *
 * STATUS: Scaffold — types, bandit math, and interface defined. Integration pending.
 */

import type { SecureLogger } from '../logging/logger.js';

/** The parameters we're optimizing in compositeScore(). */
export interface RetrievalWeights {
  /** Blend weight for activation vs content [0–1]. */
  alpha: number;
  /** Scaling factor for Hebbian boost. */
  hebbianScale: number;
  /** Cap on Hebbian boost contribution. */
  boostCap: number;
  /** Salience weight (Phase 125-C). */
  salienceWeight: number;
}

export const DEFAULT_RETRIEVAL_WEIGHTS: RetrievalWeights = {
  alpha: 0.3,
  hebbianScale: 1.0,
  boostCap: 0.5,
  salienceWeight: 0.1,
};

export interface RetrievalOptimizerConfig {
  enabled: boolean;
  /** Number of weight configurations to maintain. Default 5 */
  armCount: number;
  /** Prior strength (higher = slower adaptation). Default 2 */
  priorStrength: number;
  /** Minimum observations before switching from exploration. Default 10 */
  minObservations: number;
}

export const DEFAULT_OPTIMIZER_CONFIG: RetrievalOptimizerConfig = {
  enabled: false,
  armCount: 5,
  priorStrength: 2,
  minObservations: 10,
};

/**
 * Beta distribution parameters for Thompson Sampling.
 */
interface BetaArm {
  weights: RetrievalWeights;
  alpha: number; // successes + prior
  beta: number; // failures + prior
  pulls: number;
}

/**
 * Sample from a Beta distribution using the Jorgensen method.
 * Returns a value in [0, 1].
 */
export function sampleBeta(alpha: number, beta: number): number {
  // Normal approximation of Beta distribution (accurate for alpha,beta > 2)
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  const stddev = Math.sqrt(variance);

  // Box-Muller transform for normal sample (guard against log(0))
  const u1 = Math.random() || 1e-10;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, mean + z * stddev));
}

/**
 * Generate diverse weight configurations around the defaults.
 */
function generateArms(count: number, prior: number): BetaArm[] {
  const arms: BetaArm[] = [];
  const base = DEFAULT_RETRIEVAL_WEIGHTS;

  // First arm is always the default
  arms.push({ weights: { ...base }, alpha: prior, beta: prior, pulls: 0 });

  // Generate variations
  const variations = [
    { alpha: 0.1, hebbianScale: 0.5, boostCap: 0.3, salienceWeight: 0.2 },
    { alpha: 0.5, hebbianScale: 1.5, boostCap: 0.7, salienceWeight: 0.05 },
    { alpha: 0.2, hebbianScale: 0.8, boostCap: 0.4, salienceWeight: 0.15 },
    { alpha: 0.4, hebbianScale: 1.2, boostCap: 0.6, salienceWeight: 0.1 },
  ];

  for (let i = 0; i < Math.min(count - 1, variations.length); i++) {
    arms.push({ weights: variations[i]!, alpha: prior, beta: prior, pulls: 0 });
  }

  return arms;
}

/**
 * RetrievalOptimizer uses Thompson Sampling to learn optimal
 * compositeScore() weights from user feedback signals.
 */
export class RetrievalOptimizer {
  private readonly config: RetrievalOptimizerConfig;
  private readonly logger?: SecureLogger;
  private arms: BetaArm[];
  private currentArmIndex = 0;

  constructor(config?: Partial<RetrievalOptimizerConfig>, logger?: SecureLogger) {
    this.config = { ...DEFAULT_OPTIMIZER_CONFIG, ...config };
    this.logger = logger;
    this.arms = generateArms(this.config.armCount, this.config.priorStrength);
  }

  /**
   * Select the best weight configuration using Thompson Sampling.
   * Each arm is sampled from its Beta posterior; highest sample wins.
   */
  selectWeights(): RetrievalWeights {
    if (!this.config.enabled) return DEFAULT_RETRIEVAL_WEIGHTS;

    let bestSample = -1;
    let bestIdx = 0;

    for (let i = 0; i < this.arms.length; i++) {
      const arm = this.arms[i]!;
      const sample = sampleBeta(arm.alpha, arm.beta);
      if (sample > bestSample) {
        bestSample = sample;
        bestIdx = i;
      }
    }

    this.currentArmIndex = bestIdx;
    this.arms[bestIdx]!.pulls++;

    return { ...this.arms[bestIdx]!.weights };
  }

  /**
   * Record feedback for the most recently selected arm.
   *
   * @param positive - true for positive feedback, false for negative/correction
   */
  recordFeedback(positive: boolean): void {
    if (!this.config.enabled) return;

    const arm = this.arms[this.currentArmIndex]!;
    if (positive) {
      arm.alpha += 1;
    } else {
      arm.beta += 1;
    }

    this.logger?.debug(
      {
        armIndex: this.currentArmIndex,
        positive,
        alpha: arm.alpha,
        beta: arm.beta,
        pulls: arm.pulls,
      },
      'Retrieval optimizer feedback'
    );
  }

  /**
   * Get the current best-estimate weights (highest mean arm).
   */
  getBestWeights(): RetrievalWeights {
    let bestMean = -1;
    let bestArm = this.arms[0]!;

    for (const arm of this.arms) {
      const mean = arm.alpha / (arm.alpha + arm.beta);
      if (mean > bestMean) {
        bestMean = mean;
        bestArm = arm;
      }
    }

    return { ...bestArm.weights };
  }

  /**
   * Get optimization stats for monitoring.
   */
  getStats(): {
    weights: RetrievalWeights;
    mean: number;
    pulls: number;
  }[] {
    return this.arms.map((arm) => ({
      weights: { ...arm.weights },
      mean: arm.alpha / (arm.alpha + arm.beta),
      pulls: arm.pulls,
    }));
  }
}
