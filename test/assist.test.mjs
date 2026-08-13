// Live-draft logic: snake order, what is left, and what survives to my next turn.

import shape from '../data/score-shape.js';
import schedule from '../data/schedule-2026.js';
import market from '../data/market-2026.js';
import settings from '../data/league-settings.js';
import league from '../data/league-teams.js';
import { solveRatings } from '../js/ratings.js';
import { createScoreModel } from '../js/score-model.js';
import { runSimulation } from '../js/simulate.js';
import {
  currentPickNo, pickNumbersFor, myTurns, bothDirectionsOpen, survivalOdds, recommendations,
} from '../js/assist.js';
import { snakeSlots, availableSelections } from '../js/vendor/draft.js';
import { NFL_TEAMS } from '../js/vendor/nfl-teams.js';
import { ok, eq, close, report } from './harness.mjs';

const order = league.teams.map((t) => t.id);
const ME = league.me;
const emptyDraft = { order, selections: {} };

// --- snake order -----------------------------------------------------------
{
  const slots = snakeSlots(order);
  eq(slots.length, 30, '6 teams x 5 rounds = 30 picks');
  eq(slots[0].teamId, order[0], 'round 1 starts at the top of the order');
  eq(slots[5].teamId, order[5], 'round 1 ends at the bottom');
  eq(slots[6].teamId, order[5], 'round 2 snakes back, so the bottom picks twice in a row');
  eq(slots[11].teamId, order[0], 'round 2 ends at the top');
  eq(slots[12].teamId, order[0], 'round 3 runs down again');
  for (const team of order) eq(pickNumbersFor(emptyDraft, team).length, 5, `${team} gets five picks`);

  // Five rounds is an odd number, so the snake does NOT come out even: the top
  // of the order keeps a real edge. Picking first is worth having.
  const totals = order.map((t) => pickNumbersFor(emptyDraft, t).reduce((a, b) => a + b, 0));
  eq(JSON.stringify(totals), JSON.stringify([75, 76, 77, 78, 79, 80]),
    'an odd number of rounds leaves the first slot ahead by 5 pick-positions');
  eq(pickNumbersFor(emptyDraft, order[0]).join(','), '1,12,13,24,25', 'first slot picks');
  eq(pickNumbersFor(emptyDraft, order[5]).join(','), '6,7,18,19,30', 'last slot picks');
}

// --- clock -----------------------------------------------------------------
{
  eq(currentPickNo(emptyDraft), 1, 'an empty board is on pick 1');
  const partial = { order, selections: { 1: { nflTeam: 'Chiefs', direction: 'W' } } };
  eq(currentPickNo(partial), 2, 'the clock moves to the first unfilled slot');

  const full = { order, selections: {} };
  snakeSlots(order).forEach((s, i) => {
    full.selections[s.pickNo] = { nflTeam: NFL_TEAMS[i], direction: 'W' };
  });
  eq(currentPickNo(full), null, 'a full board has no current pick');

  const mySlots = pickNumbersFor(emptyDraft, ME);
  const turns = myTurns(emptyDraft, ME);
  eq(turns.current, 1, 'clock reported');
  if (mySlots[0] === 1) {
    ok(turns.onClock, 'on the clock when my pick is current');
    eq(turns.thisPick, 1, 'this pick is 1');
    eq(turns.nextPick, mySlots[1], 'next pick is my second slot');
  } else {
    ok(!turns.onClock, 'not on the clock');
    eq(turns.nextPick, mySlots[0], 'next pick is my first slot');
    eq(turns.picksUntilMine, mySlots[0] - 1, 'countdown to my turn');
  }
}

// --- availability ----------------------------------------------------------
{
  eq(availableSelections(emptyDraft, NFL_TEAMS).length, 64, '64 assets on an empty board');

  const draft = {
    order,
    selections: {
      1: { nflTeam: 'Chiefs', direction: 'W' },
      2: { nflTeam: 'Chiefs', direction: 'L' },
      3: { nflTeam: 'Bills', direction: 'W' },
    },
  };
  const available = availableSelections(draft, NFL_TEAMS);
  eq(available.length, 61, 'three picks off the board leaves 61');
  ok(!available.some((o) => o.nflTeam === 'Chiefs'), 'both Chiefs sides are gone');
  ok(available.some((o) => o.nflTeam === 'Bills' && o.direction === 'L'),
    'Bills LOSE survives after Bills WIN is taken');

  const both = bothDirectionsOpen(available);
  ok(!both.includes('Chiefs'), 'Chiefs is not flagged, both sides taken');
  ok(!both.includes('Bills'), 'Bills is not flagged, one side taken');
  ok(both.includes('Jets'), 'an untouched team is flagged with both sides open');
  eq(both.length, 30, '30 teams still have both sides open');
}

// --- survival --------------------------------------------------------------
const model = createScoreModel(shape);
const ratings = solveRatings(schedule, market, { hfa: model.homeFieldHalfEdge });
const sim = runSimulation(ratings, model, settings, { sims: 800, seed: 'assist-suite' });

{
  // Put the clock on my first pick so there is a real gap to my second.
  const mySlots = pickNumbersFor(emptyDraft, ME);
  const draft = { order, selections: {} };
  for (const slot of snakeSlots(order)) {
    if (slot.pickNo >= mySlots[0]) break;
    draft.selections[slot.pickNo] = { nflTeam: NFL_TEAMS[slot.pickNo - 1], direction: 'W' };
  }
  const turns = myTurns(draft, ME);
  ok(turns.onClock, 'the clock is on me');

  const odds = survivalOdds(sim, draft, ME, NFL_TEAMS, { sims: 600, seed: 'surv' });
  eq(odds.interveningPicks, turns.nextPick - turns.thisPick - 1,
    'the gap to my next pick is the number of rival picks in between');
  const values = Object.values(odds.survival);
  ok(values.every((p) => p >= 0 && p <= 1), 'survival odds are probabilities');

  const ranked = odds.assets;
  ok(odds.survival[ranked[0].id] < odds.survival[ranked[ranked.length - 1].id],
    'the best asset is less likely to survive than the worst');
  ok(odds.survival[ranked[ranked.length - 1].id] > 0.9,
    'a bottom-ranked asset almost certainly survives');
  ok(odds.survival[ranked[0].id] < 0.6, 'the top asset is genuinely at risk');

  // Opponent noise has to matter: with no noise the top assets go every time.
  const sharp = survivalOdds(sim, draft, ME, NFL_TEAMS, { sims: 600, seed: 'surv', noise: 0.001 });
  const fuzzy = survivalOdds(sim, draft, ME, NFL_TEAMS, { sims: 600, seed: 'surv', noise: 6 });
  ok(sharp.survival[ranked[0].id] < fuzzy.survival[ranked[0].id],
    'noisier rivals make the top asset more likely to last');
  close(sharp.survival[ranked[0].id], 0, 0.02, 'perfectly sharp rivals always take the best asset');

  // Deterministic under a fixed seed.
  const again = survivalOdds(sim, draft, ME, NFL_TEAMS, { sims: 600, seed: 'surv' });
  eq(JSON.stringify(odds.survival), JSON.stringify(again.survival),
    'survival odds are reproducible under a seed');

  // Recommendations look two picks ahead.
  const recs = recommendations(sim, odds, 10);
  eq(recs.length, 10, 'ten recommendations');
  eq(recs[0].costVsBest, 0, 'the recommendation costs nothing against itself');
  ok(recs.every((r) => r.costVsBest <= 1e-9), 'alternatives cost value, never gain it');
  ok(recs.every((r) => r.twoPickValue >= r.value), 'two-pick value includes the follow-up pick');
  for (const r of recs) {
    close(r.twoPickValue, r.value + r.bestNext, 1e-9, `${r.id}: two-pick value adds up`);
  }
}

// --- back-to-back picks ----------------------------------------------------
{
  // At the snake turn a team picks twice in a row, so nothing can be sniped.
  const turnTeam = order[5];
  const draft = { order, selections: {} };
  for (let p = 1; p <= 5; p += 1) {
    draft.selections[p] = { nflTeam: NFL_TEAMS[p - 1], direction: 'W' };
  }
  const turns = myTurns(draft, turnTeam);
  eq(turns.thisPick, 6, 'picking at the end of round 1');
  eq(turns.nextPick, 7, 'and again at the start of round 2');
  const odds = survivalOdds(sim, draft, turnTeam, NFL_TEAMS, { sims: 200, seed: 'turn' });
  eq(odds.interveningPicks, 0, 'nobody picks in between at the turn');
  ok(Object.values(odds.survival).every((p) => p === 1), 'everything survives back-to-back picks');

  const recs = recommendations(sim, odds, 3);
  close(recs[0].twoPickValue, odds.assets[0].value + odds.assets[1].value, 1e-9,
    'at the turn the best plan is simply the two best assets');
}

report('assist');
