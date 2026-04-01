//! ACT-R base-level activation scoring.
//!
//! Implements Anderson's ACT-R memory activation formula for ranking
//! retrieved memories by relevance, recency, and access frequency.
//!
//! `activation(n, age) = ln(n + 1) - 0.5 * ln(age / (n + 1))`
//!
//! Higher activation = more likely to be retrieved. Combines with
//! content match, Hebbian boost, and salience for composite scoring.

/// ACT-R base-level activation.
///
/// - `access_count`: number of times the memory has been accessed
/// - `age_days`: days since the memory was created
///
/// Returns a value typically in [-2, 5] — higher means more activated.
#[inline]
#[must_use]
pub fn actr_activation(access_count: u32, age_days: f64) -> f64 {
    let n = access_count as f64;
    let age = age_days.max(0.001); // avoid log(0)
    (n + 1.0).ln() - 0.5 * (age / (n + 1.0)).ln()
}

/// Sigmoid function for normalizing activation to [0, 1].
#[inline]
#[must_use]
pub fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

/// Composite relevance score combining multiple signals.
///
/// - `content_match`: semantic similarity [0, 1]
/// - `activation`: ACT-R base-level activation (any range, sigmoid-mapped)
/// - `hebbian_boost`: associative strength from co-activation [0, 1]
/// - `salience`: emotional/urgency score [0, 1]
/// - `confidence`: knowledge confidence [0, 1] — scales the final score
///
/// Weights:
/// - Content match: 60% (α = 0.4 for activation blend)
/// - Activation: 40% (via sigmoid normalization)
/// - Hebbian: additive bonus (capped at 0.3, scaled by 0.15)
/// - Salience: additive bonus (scaled by 0.1)
#[must_use]
pub fn composite_score(
    content_match: f64,
    activation: f64,
    hebbian_boost: f64,
    salience: f64,
    confidence: f64,
) -> f64 {
    let alpha = 0.4;
    let hebbian_cap = 0.3;
    let hebbian_scale = 0.15;
    let salience_weight = 0.1;

    let raw = (1.0 - alpha) * content_match
        + alpha * sigmoid(activation)
        + hebbian_boost.min(hebbian_cap) * hebbian_scale
        + salience * salience_weight;

    raw * confidence.max(0.1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activation_increases_with_access() {
        let low = actr_activation(1, 1.0);
        let high = actr_activation(10, 1.0);
        assert!(high > low, "more access should increase activation");
    }

    #[test]
    fn activation_decreases_with_age() {
        let fresh = actr_activation(5, 1.0);
        let old = actr_activation(5, 30.0);
        assert!(fresh > old, "older memories should have lower activation");
    }

    #[test]
    fn activation_handles_zero_age() {
        let a = actr_activation(0, 0.0);
        assert!(a.is_finite());
    }

    #[test]
    fn sigmoid_bounds() {
        assert!((sigmoid(0.0) - 0.5).abs() < 0.001);
        assert!(sigmoid(10.0) > 0.99);
        assert!(sigmoid(-10.0) < 0.01);
    }

    #[test]
    fn composite_respects_confidence() {
        let high = composite_score(0.8, 2.0, 0.1, 0.2, 1.0);
        let low = composite_score(0.8, 2.0, 0.1, 0.2, 0.3);
        assert!(high > low, "higher confidence should produce higher score");
    }

    #[test]
    fn composite_content_dominant() {
        let good_match = composite_score(0.9, 0.0, 0.0, 0.0, 1.0);
        let bad_match = composite_score(0.1, 0.0, 0.0, 0.0, 1.0);
        assert!(good_match > bad_match, "content match should dominate");
    }

    #[test]
    fn composite_in_valid_range() {
        let score = composite_score(1.0, 5.0, 1.0, 1.0, 1.0);
        assert!(
            score > 0.0 && score < 2.0,
            "score should be bounded: {score}"
        );
    }
}
