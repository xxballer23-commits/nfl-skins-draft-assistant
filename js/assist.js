// Live-draft advice: what is left, what is likely to survive until my next
// pick, and therefore what to take now.
//
// Snake order, uniqueness on team+direction, and the available-selection rules
// all come from the tracker's draft.js rather than being rewritten here.

import { snakeSlots, availableSelections, pickId } from './vendor/draft.js';
import { makeRng } from './rng.js';

// Opponents are not clones of this model. Each one values every asset with a
// bit of noise and takes their own best, which is what stops the "will he last
// until my next pick?" answer from being far more confident than it deserves.
// Noise is in skins, so 2.0 means a rival can plausibly prefer an asset this
// model rates two expected skins lower.
export const DEFAULT_OPPONENT_NOISE = 2.0;
const SURVIVAL_SIMS = 2000;

export function draftSlots(order) {
  return snakeSlots(order);
}

/** The first slot with no selection, or null when the board is full. */
export function currentPickNo(draft) {
  for (const slot of snakeSlots(draft.order)) {
    const selection = draft.selections[slot.pickNo];
    if (!selection?.nflTeam || !selection?.direction) return slot.pickNo;
  }
  return null;
}

/** This team's pick numbers, in order. */
export function pickNumbersFor(draft, teamId) {
  return snakeSlots(draft.order).filter((s) => s.teamId === teamId).map((s) => s.pickNo);
}

/**
 * Where my next two turns fall relative to the clock.
 * onClock is true when the current pick is mine.
 */
export function myTurns(draft, teamId) {
  const current = currentPickNo(draft);
  const mine = pickNumbersFor(draft, teamId).filter((n) => n >= (current ?? Infinity));
  const onClock = current !== null && mine[0] === current;
  return {
    current,
    onClock,
    thisPick: onClock ? current : null,
    nextPick: onClock ? (mine[1] ?? null) : (mine[0] ?? null),
    picksUntilMine: onClock ? 0 : (mine[0] ?? null) === null ? null : mine[0] - current,
  };
}

/** Teams where both the Win and the Lose side are still on the board. */
export function bothDirectionsOpen(available) {
  const byTeam = new Map();
  for (const option of available) {
    if (!byTeam.has(option.nflTeam)) byTeam.set(option.nflTeam, new Set());
    byTeam.get(option.nflTeam).add(option.direction);
  }
  return [...byTeam.entries()]
    .filter(([, dirs]) => dirs.has('W') && dirs.has('L'))
    .map(([nflTeam]) => nflTeam);
}

/** Box-Muller, drawing from the seeded stream. */
function gaussian(random) {
  let u = 0;
  while (u === 0) u = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/**
 * Simulate the picks between now and my next turn.
 *
 * @returns for every currently-available asset:
 *   survival  P(still on the board when I pick again)
 *   bestNext  E[value of the best asset left then, if I take this one now]
 */
export function survivalOdds(sim, draft, teamId, allNflTeams, opts = {}) {
  const {
    noise = DEFAULT_OPPONENT_NOISE,
    sims = SURVIVAL_SIMS,
    seed = 'assist',
  } = opts;

  const turns = myTurns(draft, teamId);
  const available = availableSelections(draft, allNflTeams);
  const assets = available.map((o) => {
    const id = pickId(o.nflTeam, o.direction);
    return { id, nflTeam: o.nflTeam, direction: o.direction, value: sim.byId[id]?.total ?? 0 };
  });
  assets.sort((a, b) => b.value - a.value);
  const n = assets.length;

  const result = {
    turns,
    assets,
    survival: Object.fromEntries(assets.map((a) => [a.id, 1])),
    bestNext: Object.fromEntries(assets.map((a) => [a.id, 0])),
    interveningPicks: 0,
  };

  if (turns.current === null || turns.nextPick === null) return result;

  const from = turns.onClock ? turns.current + 1 : turns.current;
  const to = turns.nextPick - 1;
  const intervening = Math.max(0, to - from + 1);
  result.interveningPicks = intervening;

  if (intervening === 0) {
    for (const a of assets) result.survival[a.id] = 1;
    // Nothing happens in between, so the best left is simply the next best.
    for (let i = 0; i < n; i += 1) {
      result.bestNext[assets[i].id] = i === 0 ? (assets[1]?.value ?? 0) : assets[0].value;
    }
    return result;
  }

  const random = makeRng(seed);
  const survivedCount = new Float64Array(n);
  // For each sim, the best and second-best surviving value, so that a candidate
  // which is itself the best survivor falls back to the runner-up.
  let bestSum = 0;
  let secondSum = 0;
  const bestIndexCount = new Float64Array(n);
  const taken = new Uint8Array(n);

  for (let s = 0; s < sims; s += 1) {
    taken.fill(0);
    for (let p = 0; p < intervening; p += 1) {
      // One opponent's private valuation of the board.
      let bestIdx = -1;
      let bestVal = -Infinity;
      for (let i = 0; i < n; i += 1) {
        if (taken[i]) continue;
        const v = assets[i].value + gaussian(random) * noise;
        if (v > bestVal) { bestVal = v; bestIdx = i; }
      }
      if (bestIdx >= 0) taken[bestIdx] = 1;
    }

    let best = -Infinity;
    let bestIdx = -1;
    let second = -Infinity;
    for (let i = 0; i < n; i += 1) {
      if (taken[i]) continue;
      survivedCount[i] += 1;
      const v = assets[i].value;
      if (v > best) { second = best; best = v; bestIdx = i; }
      else if (v > second) second = v;
    }
    if (bestIdx >= 0) {
      bestSum += best;
      secondSum += second === -Infinity ? 0 : second;
      bestIndexCount[bestIdx] += 1;
    }
  }

  const meanBest = bestSum / sims;
  const meanSecond = secondSum / sims;
  for (let i = 0; i < n; i += 1) {
    result.survival[assets[i].id] = survivedCount[i] / sims;
    // If I take asset i now it cannot also be the best left later. Blend by how
    // often it would have been that best.
    const pWouldHaveBeenBest = bestIndexCount[i] / sims;
    result.bestNext[assets[i].id] =
      meanBest * (1 - pWouldHaveBeenBest) + meanSecond * pWouldHaveBeenBest;
  }
  return result;
}

/**
 * Rank what to take right now over a two-pick horizon: this asset plus whatever
 * is likely to be left when I come back around.
 */
export function recommendations(sim, odds, limit = 12) {
  const rows = odds.assets.map((a) => ({
    ...a,
    row: sim.byId[a.id],
    survival: odds.survival[a.id],
    bestNext: odds.bestNext[a.id],
    twoPickValue: a.value + odds.bestNext[a.id],
  }));
  rows.sort((a, b) => b.twoPickValue - a.twoPickValue || b.value - a.value);
  // How much two-pick value each option gives up against the recommended one.
  for (const r of rows) r.costVsBest = r.twoPickValue - rows[0].twoPickValue;
  return rows.slice(0, limit);
}
