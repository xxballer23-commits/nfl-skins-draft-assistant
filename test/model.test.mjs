// The RNG, the score sampler and the ratings solver.

import shape from '../data/score-shape.js';
import schedule from '../data/schedule-2026.js';
import market from '../data/market-2026.js';
import { makeRng, seedFrom } from '../js/rng.js';
import { createScoreModel } from '../js/score-model.js';
import { solveRatings, ratingsResiduals, normalCdf } from '../js/ratings.js';
import { ok, eq, close, report } from './harness.mjs';

// --- RNG -------------------------------------------------------------------
{
  const a = makeRng('abc');
  const b = makeRng('abc');
  let same = true;
  for (let i = 0; i < 500; i += 1) if (a() !== b()) same = false;
  ok(same, 'same seed gives the identical stream');

  const c = makeRng('abd');
  const d = makeRng('abc');
  ok(c() !== d(), 'different seeds diverge');
  ok(seedFrom('abc') === seedFrom('abc'), 'seedFrom is stable');

  const r = makeRng(42);
  let min = 1;
  let max = 0;
  let sum = 0;
  const n = 50000;
  for (let i = 0; i < n; i += 1) {
    const v = r();
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  ok(min >= 0 && max < 1, 'draws stay in [0, 1)');
  close(sum / n, 0.5, 0.01, 'draws are uniform on average');
}

// --- normal CDF ------------------------------------------------------------
{
  close(normalCdf(0), 0.5, 1e-6, 'normalCdf(0)');
  close(normalCdf(1.96), 0.975, 1e-4, 'normalCdf(1.96)');
  close(normalCdf(-1.96), 0.025, 1e-4, 'normalCdf(-1.96)');
  close(normalCdf(-3), 0.001349, 1e-5, 'normalCdf(-3)');
  ok(normalCdf(1) > normalCdf(0.99), 'normalCdf is increasing');
}

// --- score sampler ---------------------------------------------------------
{
  const model = createScoreModel(shape);
  eq(model.k, 40, 'default neighbourhood size');

  const random = makeRng('sampler');
  const draws = [];
  for (let i = 0; i < 40000; i += 1) draws.push(model.sample(model.leagueMean, random));
  ok(draws.every((d) => Number.isInteger(d) && d >= 0), 'scores are non-negative integers');
  const mean = draws.reduce((s, d) => s + d, 0) / draws.length;
  close(mean, model.leagueMean, 0.4, 'sampling at the league mean returns the league mean');

  // Unbiased across the range, not just in the middle.
  for (const mu of [14, 18, 23, 28, 33]) {
    let sum = 0;
    const trials = 20000;
    for (let i = 0; i < trials; i += 1) sum += model.sample(mu, random);
    close(sum / trials, mu, 0.5, `sampling at ${mu} returns ${mu}`);
  }

  // Conditional calibration: at league-average strength the sampler should hit
  // each tail at the rate real league-average teams did, which is not the same
  // as the pooled rate over strong and weak offences alike.
  const nearMean = shape.pairs.filter(([mu]) => Math.abs(mu - model.leagueMean) <= 1.5);
  ok(nearMean.length > 60, 'enough league-average team-games to compare against');
  const rate = (list, f) => list.filter(f).length / list.length;
  close(rate(draws, (d) => d <= 10), rate(nearMean, ([, a]) => a <= 10), 0.05,
    'low-tail rate at league-average strength matches those real games');
  close(rate(draws, (d) => d >= 40), rate(nearMean, ([, a]) => a >= 40), 0.05,
    'high-tail rate at league-average strength matches those real games');

  // The calibration that matters: replay every 2025 team-game at its own
  // predicted mean and both pooled tails must come back. This is the property
  // no single fitted distribution could deliver for both tails at once.
  let low = 0;
  let high = 0;
  let count = 0;
  for (const [mu] of shape.pairs) {
    for (let i = 0; i < 60; i += 1) {
      const d = model.sample(mu, random);
      if (d <= 10) low += 1;
      if (d >= 40) high += 1;
      count += 1;
    }
  }
  close(low / count, shape.diagnostics.empiricalPctLow, 0.012, 'pooled low tail reproduces 2025');
  close(high / count, shape.diagnostics.empiricalPctHigh, 0.012, 'pooled high tail reproduces 2025');

  // Monotonic in the mean, which is what makes one pick beat another.
  const strong = [];
  const weak = [];
  for (let i = 0; i < 20000; i += 1) {
    strong.push(model.sample(30, random));
    weak.push(model.sample(16, random));
  }
  const pct = (arr, f) => arr.filter(f).length / arr.length;
  ok(pct(strong, (d) => d >= 40) > pct(weak, (d) => d >= 40) * 5,
    'a strong offence hits 40+ far more often than a weak one');
  ok(pct(weak, (d) => d <= 10) > pct(strong, (d) => d <= 10) * 5,
    'a weak offence is held to 10 far more often than a strong one');

  // Deterministic under a fixed seed.
  const x = makeRng('fixed');
  const y = makeRng('fixed');
  let identical = true;
  for (let i = 0; i < 1000; i += 1) {
    if (model.sample(23 + (i % 10), x) !== model.sample(23 + (i % 10), y)) identical = false;
  }
  ok(identical, 'sampling is reproducible under a fixed seed');
}

// --- ratings solver --------------------------------------------------------
{
  const model = createScoreModel(shape);
  const ratings = solveRatings(schedule, market, { hfa: model.homeFieldHalfEdge });
  eq(ratings.teams.length, 32, 'all 32 teams rated');
  eq(ratings.games.length, 272, 'all 272 regular-season games loaded');

  const residuals = ratingsResiduals(ratings, market);
  const maxWin = Math.max(...residuals.map((r) => Math.abs(r.winError)));
  const maxPoints = Math.max(...residuals.map((r) => Math.abs(r.pointError)));
  ok(maxWin < 0.1, `every team's projected wins land on its target (max error ${maxWin.toFixed(4)})`);
  ok(maxPoints < 3, `every team's projected points land on its target (max error ${maxPoints.toFixed(3)})`);

  const defMean = ratings.teams.reduce((s, t) => s + ratings.def[t], 0) / 32;
  close(defMean, 0, 1e-6, 'defence ratings are anchored at zero');

  // A team with the same win total but fewer points must have the better defence.
  const synthetic = {
    teams: Object.fromEntries(ratings.teams.map((t, i) => [t, {
      winTotal: 8.5,
      pointsFor: i === 0 ? 300 : 380,
    }])),
  };
  const s2 = solveRatings(schedule, synthetic, { hfa: model.homeFieldHalfEdge });
  ok(s2.def[ratings.teams[0]] < s2.def[ratings.teams[1]],
    'equal wins on fewer points implies a stronger defence');
  ok(s2.off[ratings.teams[0]] < s2.off[ratings.teams[1]],
    'equal wins on fewer points implies a weaker offence');
}

report('model');
