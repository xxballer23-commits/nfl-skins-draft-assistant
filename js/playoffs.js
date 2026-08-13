// Playoff seeding and bracket.
//
// This exists because of one scoring rule: in the postseason every Lose pick
// scores zero, while Win picks keep scoring with bonuses live. A Win pick on a
// contender therefore carries extra scoring weeks that no Lose pick can have,
// and pricing that needs a real bracket rather than a fudge factor.
//
// Note the #1 seed's Wild Card bye is a scoring zero, so the top seed is worth
// LESS in the postseason than a #2 seed that goes equally deep. That falls out
// of the bracket automatically; it would have to be special-cased otherwise.
//
// Tiebreakers are deliberately simplified. Real NFL tiebreakers are a long
// cascade (head-to-head, division record, common games, conference record,
// strength of victory). Inside a Monte Carlo they barely move the answer, so
// records are broken by team rating, then by coin flip.

import { CONFERENCE_OF, DIVISION_OF, DIVISIONS } from './divisions.js';

export const POSTSEASON_WEEKS = ['WC', 'DIV', 'CC', 'SB'];

const CONFERENCES = ['AFC', 'NFC'];

/**
 * Seed one conference 1-7.
 * @param records { team: { wins, losses, ties } }
 * @param strength { team: rating } used as the first tiebreaker
 * @param random   coin flip for exact ties
 */
export function seedConference(conference, records, strength, random) {
  const winPct = (t) => {
    const r = records[t];
    return (r.wins + 0.5 * r.ties) / (r.wins + r.losses + r.ties);
  };
  const jitter = new Map();
  const better = (a, b) => {
    const d = winPct(b) - winPct(a);
    if (Math.abs(d) > 1e-9) return d;
    const s = strength[b] - strength[a];
    if (Math.abs(s) > 1e-9) return s;
    if (!jitter.has(a)) jitter.set(a, random());
    if (!jitter.has(b)) jitter.set(b, random());
    return jitter.get(a) - jitter.get(b);
  };

  const divisionWinners = [];
  for (const [division, teams] of Object.entries(DIVISIONS)) {
    if (!division.startsWith(conference)) continue;
    divisionWinners.push([...teams].sort(better)[0]);
  }
  divisionWinners.sort(better);

  const isWinner = new Set(divisionWinners);
  const rest = Object.keys(records)
    .filter((t) => CONFERENCE_OF[t] === conference && !isWinner.has(t))
    .sort(better);

  return [...divisionWinners, ...rest.slice(0, 3)];
}

/**
 * Run a conference bracket, returning which teams play in each postseason week.
 * @param playGame (home, away, neutral) => { homePoints, awayPoints }
 * @returns { byWeek: { WC: [[home, away], ...], ... }, champion }
 */
export function runConferenceBracket(seeds, playGame) {
  const byWeek = { WC: [], DIV: [], CC: [] };
  const seedOf = new Map(seeds.map((t, i) => [t, i + 1]));

  // Wild Card: 2v7, 3v6, 4v5. The 1 seed sits out and scores nothing.
  const wcPairs = [[seeds[1], seeds[6]], [seeds[2], seeds[5]], [seeds[3], seeds[4]]];
  const wcWinners = [];
  for (const [home, away] of wcPairs) {
    byWeek.WC.push([home, away]);
    wcWinners.push(winnerOf(home, away, playGame));
  }

  // Divisional: the 1 seed draws the lowest remaining seed.
  wcWinners.sort((a, b) => seedOf.get(a) - seedOf.get(b));
  const lowest = wcWinners[wcWinners.length - 1];
  const divPairs = [
    [seeds[0], lowest],
    [wcWinners[0], wcWinners[1]],
  ];
  const divWinners = [];
  for (const [home, away] of divPairs) {
    byWeek.DIV.push([home, away]);
    divWinners.push(winnerOf(home, away, playGame));
  }

  // Conference Championship: higher seed hosts.
  divWinners.sort((a, b) => seedOf.get(a) - seedOf.get(b));
  byWeek.CC.push([divWinners[0], divWinners[1]]);
  const champion = winnerOf(divWinners[0], divWinners[1], playGame);

  return { byWeek, champion };
}

function winnerOf(home, away, playGame) {
  const { homePoints, awayPoints } = playGame(home, away, false);
  return homePoints >= awayPoints ? home : away;
}

/**
 * Full postseason across both conferences.
 * @returns { WC: [[home, away]], DIV: [...], CC: [...], SB: [[a, b]] }
 */
export function runPostseason(records, strength, random, playGame) {
  const byWeek = { WC: [], DIV: [], CC: [], SB: [] };
  const champions = [];
  for (const conference of CONFERENCES) {
    const seeds = seedConference(conference, records, strength, random);
    const { byWeek: conf, champion } = runConferenceBracket(seeds, playGame);
    for (const week of ['WC', 'DIV', 'CC']) byWeek[week].push(...conf[week]);
    champions.push(champion);
  }
  // Super Bowl is a neutral site, so nobody gets the home edge.
  byWeek.SB.push([champions[0], champions[1]]);
  return byWeek;
}

export { CONFERENCE_OF, DIVISION_OF };
