// The season simulator and the playoff bracket, including the scoring rules
// that make this league strange.

import shape from '../data/score-shape.js';
import schedule from '../data/schedule-2026.js';
import market from '../data/market-2026.js';
import settings from '../data/league-settings.js';
import { solveRatings } from '../js/ratings.js';
import { createScoreModel } from '../js/score-model.js';
import { runSimulation, allAssets } from '../js/simulate.js';
import { seedConference, runConferenceBracket, runPostseason } from '../js/playoffs.js';
import { DIVISIONS, CONFERENCE_OF } from '../js/divisions.js';
import { makeRng } from '../js/rng.js';
import { ok, eq, close, report } from './harness.mjs';

// --- divisions -------------------------------------------------------------
{
  eq(Object.keys(DIVISIONS).length, 8, 'eight divisions');
  const all = Object.values(DIVISIONS).flat();
  eq(all.length, 32, '32 teams across the divisions');
  eq(new Set(all).size, 32, 'no team appears twice');
  eq(all.filter((t) => CONFERENCE_OF[t] === 'AFC').length, 16, '16 AFC teams');
  eq(all.filter((t) => CONFERENCE_OF[t] === 'NFC').length, 16, '16 NFC teams');
  for (const team of all) ok(schedule.weeks['1'] !== undefined, 'schedule loaded');
}

// --- seeding ---------------------------------------------------------------
{
  const random = makeRng('seed-test');
  const records = {};
  const strength = {};
  // Give every AFC team a distinct record, worst-to-best in listed order.
  const afc = Object.entries(DIVISIONS).filter(([d]) => d.startsWith('AFC')).flatMap(([, t]) => t);
  afc.forEach((team, i) => {
    records[team] = { wins: i, losses: 17 - i, ties: 0 };
    strength[team] = i;
  });
  const seeds = seedConference('AFC', records, strength, random);
  eq(seeds.length, 7, 'seven playoff teams per conference');
  eq(new Set(seeds).size, 7, 'no duplicate seeds');

  // The four division winners must occupy seeds 1-4 even when a wildcard has a
  // better record than some division winner.
  const winners = new Set();
  for (const [division, teams] of Object.entries(DIVISIONS)) {
    if (!division.startsWith('AFC')) continue;
    winners.add([...teams].sort((a, b) => records[b].wins - records[a].wins)[0]);
  }
  eq(seeds.slice(0, 4).filter((t) => winners.has(t)).length, 4, 'seeds 1-4 are the division winners');
  ok(seeds.slice(4).every((t) => !winners.has(t)), 'seeds 5-7 are not division winners');
  for (let i = 1; i < 4; i += 1) {
    ok(records[seeds[i - 1]].wins >= records[seeds[i]].wins, 'division winners ordered by record');
  }
  for (let i = 5; i < 7; i += 1) {
    ok(records[seeds[i - 1]].wins >= records[seeds[i]].wins, 'wildcards ordered by record');
  }
}

// --- bracket ---------------------------------------------------------------
{
  const seeds = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'];
  // Higher seed always wins, so the bracket shape is fully determined.
  const playGame = (home, away) => ({
    homePoints: Number(home.slice(1)) < Number(away.slice(1)) ? 24 : 17,
    awayPoints: Number(home.slice(1)) < Number(away.slice(1)) ? 17 : 24,
  });
  const { byWeek, champion } = runConferenceBracket(seeds, playGame);

  eq(byWeek.WC.length, 3, 'three Wild Card games per conference');
  ok(!byWeek.WC.flat().includes('S1'), 'the 1 seed does not play in the Wild Card round');
  eq(JSON.stringify(byWeek.WC), JSON.stringify([['S2', 'S7'], ['S3', 'S6'], ['S4', 'S5']]),
    'Wild Card pairings are 2v7, 3v6, 4v5');
  eq(byWeek.DIV.length, 2, 'two Divisional games');
  eq(JSON.stringify(byWeek.DIV[0]), JSON.stringify(['S1', 'S4']),
    'the 1 seed draws the lowest remaining seed after reseeding');
  eq(byWeek.CC.length, 1, 'one Conference Championship');
  eq(champion, 'S1', 'the best team wins when the better team always wins');

  // The 1 seed's bye is a scoring zero, so it plays FEWER games than a 2 seed
  // that goes just as far. This is the effect that makes the top seed worth
  // less in the postseason, and it has to fall out of the bracket, not a fudge.
  const gamesFor = (team) => ['WC', 'DIV', 'CC']
    .reduce((n, w) => n + byWeek[w].filter((p) => p.includes(team)).length, 0);
  eq(gamesFor('S1'), 2, 'the 1 seed plays two games to reach the Super Bowl');
  const seeds2 = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];
  const lowerWins = (home, away) => ({
    homePoints: Number(home.slice(1)) > Number(away.slice(1)) ? 24 : 17,
    awayPoints: Number(home.slice(1)) > Number(away.slice(1)) ? 17 : 24,
  });
  const second = runConferenceBracket(seeds2, lowerWins);
  const gamesFor2 = (team) => ['WC', 'DIV', 'CC']
    .reduce((n, w) => n + second.byWeek[w].filter((p) => p.includes(team)).length, 0);
  eq(gamesFor2('A7'), 3, 'a non-bye team plays three games to reach the Super Bowl');
}

// --- full postseason -------------------------------------------------------
{
  const random = makeRng('post');
  const records = {};
  const strength = {};
  Object.values(DIVISIONS).flat().forEach((team, i) => {
    records[team] = { wins: (i * 7) % 18, losses: 17 - ((i * 7) % 18), ties: 0 };
    strength[team] = ((i * 13) % 31) / 10;
  });
  const playGame = () => ({ homePoints: 21, awayPoints: 20 });
  const byWeek = runPostseason(records, strength, random, playGame);
  eq(byWeek.WC.length, 6, 'six Wild Card games league-wide');
  eq(byWeek.DIV.length, 4, 'four Divisional games');
  eq(byWeek.CC.length, 2, 'two Conference Championships');
  eq(byWeek.SB.length, 1, 'one Super Bowl');
  eq(byWeek.WC.length + byWeek.DIV.length + byWeek.CC.length + byWeek.SB.length, 13,
    'thirteen playoff games in total');
  const sbTeams = byWeek.SB[0];
  ok(CONFERENCE_OF[sbTeams[0]] !== CONFERENCE_OF[sbTeams[1]],
    'the Super Bowl is one team from each conference');
}

// --- the simulation as a whole --------------------------------------------
const model = createScoreModel(shape);
const ratings = solveRatings(schedule, market, { hfa: model.homeFieldHalfEdge });
const sim = runSimulation(ratings, model, settings, { sims: 1500, seed: 'suite' });

{
  eq(sim.rows.length, 64, '64 draftable assets');
  eq(allAssets(ratings.teams).length, 64, 'allAssets agrees');
  eq(new Set(sim.rows.map((r) => r.id)).size, 64, 'asset ids are unique');
  ok(sim.rows.every((r) => r.id === `${r.nflTeam}-${r.direction}`), 'ids are team-direction');

  // Postseason: every Lose pick scores exactly nothing, always.
  const losePost = sim.rows.filter((r) => r.direction === 'L')
    .reduce((s, r) => s + r.postseason, 0);
  eq(losePost, 0, 'Lose picks score zero across the whole postseason');
  for (const week of ['WC', 'DIV', 'CC', 'SB']) {
    const total = sim.rows.filter((r) => r.direction === 'L')
      .reduce((s, r) => s + r.byWeek[week].total, 0);
    eq(total, 0, `Lose picks score zero in ${week}`);
  }

  // Exactly one base skin per playoff game, to the winner's Win pick.
  const postBase = sim.rows.reduce(
    (s, r) => s + ['WC', 'DIV', 'CC', 'SB'].reduce((a, w) => a + r.byWeek[w].base, 0), 0);
  close(postBase, 13, 1e-9, 'postseason yields exactly 13 base skins, one per game');

  // Two base skins per decided regular-season game: one to the winner's Win
  // pick, one to the loser's Lose pick. Ties yield none.
  const regBase = sim.rows.reduce(
    (s, r) => s + sim.weekIds.filter((w) => /^\d+$/.test(w))
      .reduce((a, w) => a + r.byWeek[w].base, 0), 0);
  ok(regBase <= 544, 'regular-season base skins cannot exceed two per game');
  ok(regBase > 538, `ties stay rare (${((544 - regBase) / 2).toFixed(2)} per season)`);

  // Bonuses require the base skin, so they can never exceed twice it.
  for (const row of sim.rows) {
    ok(row.bonus <= row.base * 2 + 1e-9, `${row.id}: bonus never exceeds twice base`);
    ok(row.total >= row.base - 1e-9, `${row.id}: total is at least base`);
    close(row.base + row.bonus, row.total, 1e-9, `${row.id}: base plus bonus is the total`);
    close(row.regularSeason + row.postseason, row.total, 1e-9, `${row.id}: splits sum to the total`);
  }

  // Playoff structure, aggregated.
  const stats = Object.values(sim.teamStats);
  close(stats.reduce((s, t) => s + t.playoffOdds, 0), 14, 1e-6, 'fourteen playoff teams every year');
  close(stats.reduce((s, t) => s + t.superBowlOdds, 0), 1, 1e-6, 'one Super Bowl winner every year');
  close(stats.reduce((s, t) => s + t.expectedWins, 0), 272 - (544 - regBase) / 2, 0.5,
    'wins across the league equal decided games');

  // Every Win pick on a plausible contender must carry postseason value that no
  // Lose pick can have. This is the structural asymmetry in the rules.
  const contender = [...stats].sort((a, b) => b.playoffOdds - a.playoffOdds)[0];
  ok(sim.byId[`${contender.team}-W`].postseason > 1,
    'a Win pick on the best team carries real postseason value');
  eq(sim.byId[`${contender.team}-L`].postseason, 0,
    'the Lose pick on that same team carries none');
}

// --- reproducibility -------------------------------------------------------
{
  const a = runSimulation(ratings, model, settings, { sims: 200, seed: 'same' });
  const b = runSimulation(ratings, model, settings, { sims: 200, seed: 'same' });
  const c = runSimulation(ratings, model, settings, { sims: 200, seed: 'other' });
  eq(JSON.stringify(a.rows), JSON.stringify(b.rows), 'same seed gives identical rankings');
  ok(JSON.stringify(a.rows) !== JSON.stringify(c.rows), 'a different seed gives different rankings');
}

// --- bonus settings are read, not hardcoded --------------------------------
{
  const off = {
    ...settings,
    bonusEnabledByWeek: Object.fromEntries(
      Object.keys(settings.bonusEnabledByWeek).map((w) => [w, false])),
  };
  const noBonus = runSimulation(ratings, model, off, { sims: 300, seed: 'nobonus' });
  eq(noBonus.rows.reduce((s, r) => s + r.bonus, 0), 0,
    'turning every week off in settings removes every bonus skin');

  const week5Off = {
    ...settings,
    bonusEnabledByWeek: { ...settings.bonusEnabledByWeek, 5: false },
  };
  const partial = runSimulation(ratings, model, week5Off, { sims: 300, seed: 'wk5' });
  eq(partial.rows.reduce((s, r) => s + r.byWeek['5'].bonus, 0), 0,
    'turning off one week removes only that week');
  ok(partial.rows.reduce((s, r) => s + r.byWeek['6'].bonus, 0) > 0,
    'other weeks keep their bonuses');
  ok(partial.rows.reduce((s, r) => s + r.byWeek['5'].base, 0) > 0,
    'base skins survive when bonuses are switched off');
}

report('simulate');
