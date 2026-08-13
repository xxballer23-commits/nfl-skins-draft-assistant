// Sampling a team's points in a single game.
//
// Both skins bonuses are tail events: 40-or-more sits past the 94th percentile
// of team-game scores, 10-or-fewer at about the 13th. Getting the mean right
// while getting the tails wrong would produce sensible-looking win/loss records
// and badly wrong bonus counts, which is most of what separates one pick from
// another. So this does not fit a distribution.
//
// Instead it draws from real games: find the k games whose predicted mean was
// closest to the mean we want, take one of those actual scores, and shift it by
// the leftover difference in means. That reproduces the low tail, the high tail
// and the lumpiness of football scores (60% of scores land on a small set of
// football-legal totals) without any of them having to be modelled.

import { randInt } from './rng.js';

export const DEFAULT_K = 40;

// The neighbourhood supplies the shape; the requested mean supplies the mean.
// Recentring is done on the neighbourhood's ACTUAL average score, not on the
// individual drawn game's predicted mean: with only 40 games in a window its
// actual average wanders about 1.3 points either side of its predicted average
// by chance, and leaving that in makes the sampler locally biased.
export const DEFAULT_MEAN_CORRECTION = 1.0;

export function createScoreModel(shape, options = {}) {
  const { k = DEFAULT_K, meanCorrection = DEFAULT_MEAN_CORRECTION } = options;
  const pairs = shape.pairs;
  const n = pairs.length;
  if (!n) throw new Error('score shape has no pairs');
  const means = new Float64Array(n);
  const points = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    means[i] = pairs[i][0];
    points[i] = pairs[i][1];
  }
  const window = Math.min(k, n);

  // Prefix sums make each window's actual average an O(1) lookup.
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) prefix[i + 1] = prefix[i] + points[i];
  const windowMean = (start) => (prefix[start + window] - prefix[start]) / window;

  /** Index of the first pair whose mean is >= target. */
  function lowerBound(mu) {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (means[mid] < mu) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** One team's points in one game, given its expected points. */
  function sample(mu, random) {
    let start = lowerBound(mu) - (window >> 1);
    if (start < 0) start = 0;
    if (start + window > n) start = n - window;
    const i = start + randInt(random, window);
    const shifted = points[i] + (mu - windowMean(start)) * meanCorrection;
    const rounded = Math.round(shifted);
    return rounded < 0 ? 0 : rounded;
  }

  return {
    sample,
    k: window,
    meanCorrection,
    leagueMean: shape.diagnostics.leagueMeanPoints,
    homeFieldHalfEdge: shape.diagnostics.homeFieldHalfEdge,
    residualSd: shape.diagnostics.residualSd,
    observedMeanRange: [means[0], means[n - 1]],
  };
}
