// Monte Carlo valuation of all 64 draftable assets.
//
// Every skin is scored by the tracker's own scorePick() on a simulated game, so
// the thresholds, the base-gates-bonus rule and the postseason Lose rule are the
// validated code rather than a second implementation that can drift from it.
//
// The result does not depend on the draft at all, so this runs once and the
// draft board just filters it.

import { scorePick, bonusEnabledForWeek, WEEKS } from './vendor/scoring.js';
import { pickId } from './vendor/draft.js';
import { runPostseason, POSTSEASON_WEEKS } from './playoffs.js';
import { CONFERENCE_OF } from './divisions.js';
import { makeRng } from './rng.js';

export const DIRECTIONS = ['W', 'L'];
const REGULAR_WEEKS = WEEKS.filter((w) => !w.postseason).map((w) => w.id);

// The two teams' scores are sampled independently, which produces about six
// dead-even regular-season games a year. Real football sends those to overtime
// and only about one a year survives it. Ties score nothing for either
// direction, so leaving this alone would quietly shave ~2% off every asset's
// base skins. This is a modelling choice, not a measurement.
export const OT_RESOLVE_RATE = 0.84;
const OT_POINTS = 3;

/** Every team+direction combination, in a stable order. */
export function allAssets(teams) {
  const assets = [];
  for (const nflTeam of teams) {
    for (const direction of DIRECTIONS) {
      assets.push({ id: pickId(nflTeam, direction), nflTeam, direction });
    }
  }
  return assets;
}

/**
 * @param ratings   from solveRatings()
 * @param model     from createScoreModel()
 * @param settings  { bonusEnabledByWeek } - read, never hardcoded
 * @param opts      { sims, seed }
 */
export function runSimulation(ratings, model, settings, opts = {}) {
  const { sims = 5000, seed = 'skins-2026' } = opts;
  const random = makeRng(seed);

  const teams = ratings.teams;
  const teamIndex = new Map(teams.map((t, i) => [t, i]));
  const assets = allAssets(teams);
  const assetCount = assets.length;

  const weekIds = WEEKS.map((w) => w.id);
  const weekIndex = new Map(weekIds.map((id, i) => [id, i]));
  const weekCount = weekIds.length;
  const bonusOn = weekIds.map((id) => bonusEnabledForWeek(settings, id));
  const isPost = new Map(WEEKS.map((w) => [w.id, w.postseason]));

  const base = new Float64Array(assetCount);
  const bonus = new Float64Array(assetCount);
  const totalSq = new Float64Array(assetCount);
  const weekBase = new Float64Array(assetCount * weekCount);
  const weekBonus = new Float64Array(assetCount * weekCount);
  const runTotal = new Float64Array(assetCount);

  // Team-level diagnostics that explain the ranking.
  const wins = new Float64Array(teams.length);
  const pointsFor = new Float64Array(teams.length);
  const pointsAgainst = new Float64Array(teams.length);
  const madePlayoffs = new Float64Array(teams.length);
  const postGames = new Float64Array(teams.length);
  const wonSb = new Float64Array(teams.length);

  // Regular-season schedule, flattened once.
  const games = [];
  for (const weekId of REGULAR_WEEKS) {
    for (const game of ratings.games.filter((g) => g.week === weekId)) {
      games.push({ w: weekIndex.get(weekId), home: game.home, away: game.away });
    }
  }

  // A priori strength, used as the seeding tiebreaker: expected point margin
  // against a league-average opponent on a neutral field.
  const strength = {};
  for (const team of teams) strength[team] = ratings.off[team] - ratings.def[team];

  // How far this market pushes the sampler past the range of game means it was
  // built from. Beyond that range it is extrapolating, and the tails it
  // reproduces so well inside the range are no longer vouched for.
  const [observedLow, observedHigh] = model.observedMeanRange;
  let meanDraws = 0;
  let meanDrawsOutside = 0;
  let lowestMean = Infinity;
  let highestMean = -Infinity;

  const meanFor = (team, opponent, edge) => {
    const mu = ratings.leagueMean + ratings.off[team] + ratings.def[opponent] + edge;
    meanDraws += 1;
    if (mu < observedLow || mu > observedHigh) meanDrawsOutside += 1;
    if (mu < lowestMean) lowestMean = mu;
    if (mu > highestMean) highestMean = mu;
    return mu;
  };

  const playGame = (home, away, neutral) => {
    const edge = neutral ? 0 : ratings.hfa;
    return {
      homePoints: model.sample(meanFor(home, away, edge), random),
      awayPoints: model.sample(meanFor(away, home, -edge), random),
    };
  };

  /** A regular-season game, with overtime applied to most dead-even results. */
  const playRegularGame = (home, away) => {
    const r = playGame(home, away, false);
    if (r.homePoints !== r.awayPoints) return r;
    if (random() >= OT_RESOLVE_RATE) return r; // the rare game that stays tied
    // The stronger side wins overtime more often than not, but not always.
    const homeStronger = strength[home] + ratings.hfa >= strength[away];
    const strongerWins = random() < 0.62;
    const homeWins = homeStronger ? strongerWins : !strongerWins;
    return homeWins
      ? { homePoints: r.homePoints + OT_POINTS, awayPoints: r.awayPoints }
      : { homePoints: r.homePoints, awayPoints: r.awayPoints + OT_POINTS };
  };

  // Postseason games cannot end tied; football plays on until someone wins.
  const playPlayoffGame = (home, away, neutral) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const r = playGame(home, away, neutral);
      if (r.homePoints !== r.awayPoints) return r;
    }
    const r = playGame(home, away, neutral);
    return { homePoints: r.homePoints + 1, awayPoints: r.awayPoints };
  };

  const record = {};
  const scoreInto = (nflTeam, weekId, entry) => {
    const w = weekIndex.get(weekId);
    const post = isPost.get(weekId);
    const ti = teamIndex.get(nflTeam);
    for (let d = 0; d < 2; d += 1) {
      const ai = ti * 2 + d;
      const skins = scorePick(DIRECTIONS[d], entry, {
        postseason: post,
        bonusEnabled: bonusOn[w],
      });
      if (skins.total === 0) continue;
      base[ai] += skins.base;
      bonus[ai] += skins.bonus;
      runTotal[ai] += skins.total;
      weekBase[ai * weekCount + w] += skins.base;
      weekBonus[ai * weekCount + w] += skins.bonus;
    }
  };

  for (let sim = 0; sim < sims; sim += 1) {
    runTotal.fill(0);
    for (const team of teams) record[team] = { wins: 0, losses: 0, ties: 0 };

    for (const game of games) {
      const { homePoints, awayPoints } = playRegularGame(game.home, game.away);
      const result = homePoints > awayPoints ? 'W' : homePoints < awayPoints ? 'L' : 'T';
      const homeEntry = { result, pointsFor: homePoints, pointsAgainst: awayPoints };
      const awayEntry = {
        result: result === 'W' ? 'L' : result === 'L' ? 'W' : 'T',
        pointsFor: awayPoints,
        pointsAgainst: homePoints,
      };
      const weekId = weekIds[game.w];
      scoreInto(game.home, weekId, homeEntry);
      scoreInto(game.away, weekId, awayEntry);

      for (const [team, entry] of [[game.home, homeEntry], [game.away, awayEntry]]) {
        const ti = teamIndex.get(team);
        pointsFor[ti] += entry.pointsFor;
        pointsAgainst[ti] += entry.pointsAgainst;
        if (entry.result === 'W') { record[team].wins += 1; wins[ti] += 1; }
        else if (entry.result === 'L') record[team].losses += 1;
        else record[team].ties += 1;
      }
    }

    const bracket = runPostseason(record, strength, random, playPlayoffGame);
    const seenPostseason = new Set();
    for (const weekId of POSTSEASON_WEEKS) {
      const neutral = weekId === 'SB';
      for (const [home, away] of bracket[weekId]) {
        const { homePoints, awayPoints } = playPlayoffGame(home, away, neutral);
        const result = homePoints > awayPoints ? 'W' : 'L';
        scoreInto(home, weekId, { result, pointsFor: homePoints, pointsAgainst: awayPoints });
        scoreInto(away, weekId, {
          result: result === 'W' ? 'L' : 'W',
          pointsFor: awayPoints,
          pointsAgainst: homePoints,
        });
        for (const team of [home, away]) {
          seenPostseason.add(team);
          postGames[teamIndex.get(team)] += 1;
        }
        if (weekId === 'SB') {
          wonSb[teamIndex.get(result === 'W' ? home : away)] += 1;
        }
      }
    }
    // A bye is not an appearance in WC, so count the 1 seeds too.
    for (const weekId of ['WC', 'DIV']) {
      for (const [home, away] of bracket[weekId]) {
        seenPostseason.add(home);
        seenPostseason.add(away);
      }
    }
    for (const team of seenPostseason) madePlayoffs[teamIndex.get(team)] += 1;

    for (let ai = 0; ai < assetCount; ai += 1) totalSq[ai] += runTotal[ai] * runTotal[ai];
  }

  const teamStats = {};
  teams.forEach((team, i) => {
    teamStats[team] = {
      team,
      conference: CONFERENCE_OF[team],
      expectedWins: wins[i] / sims,
      pointsFor: pointsFor[i] / sims,
      pointsAgainst: pointsAgainst[i] / sims,
      playoffOdds: madePlayoffs[i] / sims,
      expectedPostseasonGames: postGames[i] / sims,
      superBowlOdds: wonSb[i] / sims,
    };
  });

  const rows = assets.map((asset, ai) => {
    const meanTotal = (base[ai] + bonus[ai]) / sims;
    const variance = Math.max(0, totalSq[ai] / sims - meanTotal * meanTotal);
    const byWeek = {};
    let regularSeason = 0;
    let postseason = 0;
    weekIds.forEach((id, w) => {
      const b = weekBase[ai * weekCount + w] / sims;
      const n = weekBonus[ai * weekCount + w] / sims;
      byWeek[id] = { base: b, bonus: n, total: b + n };
      if (isPost.get(id)) postseason += b + n;
      else regularSeason += b + n;
    });
    return {
      ...asset,
      base: base[ai] / sims,
      bonus: bonus[ai] / sims,
      total: meanTotal,
      sd: Math.sqrt(variance),
      regularSeason,
      postseason,
      byWeek,
    };
  });

  rows.sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
  rows.forEach((row, i) => { row.rank = i + 1; });

  const coverage = {
    observedMeanRange: [observedLow, observedHigh],
    simulatedMeanRange: [lowestMean, highestMean],
    fractionOutsideObserved: meanDrawsOutside / meanDraws,
  };

  return {
    rows,
    byId: Object.fromEntries(rows.map((r) => [r.id, r])),
    teamStats,
    coverage,
    sims,
    seed,
    weekIds,
  };
}
