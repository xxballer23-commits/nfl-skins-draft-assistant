// Turn hand-entered market numbers into per-team offence and defence ratings.
//
// Inputs per team: a Vegas win total and a Vegas season points-for total.
// That is two numbers for two unknowns, so the system is identified:
//   - the points total pins down how much a team scores,
//   - the win total, given how much it scores, pins down how much it allows.
// A team with a high win total and a modest points total comes out with a good
// defence, which is the correct reading.
//
// Expected points for team t against opponent u:
//   mean = leagueMean + off[t] + def[u] + (home ? hfa : -hfa)
//
// off/def are jointly unidentified up to a constant (add c to every off and
// subtract c from every def and nothing changes), so def is pinned to mean zero
// after each pass.

const ITERATIONS = 400;
const DAMPING = 0.5;

/** Standard normal CDF, Abramowitz & Stegun 7.1.26 via erf. */
export function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937
    + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

const pdf = (z) => 0.3989422804014327 * Math.exp((-z * z) / 2);

/**
 * @param schedule  { weeks: { '1': [{home, away}], ... } }
 * @param market    { teams: { Bills: { winTotal, pointsFor }, ... } }
 * @param opts      { hfa, marginSd }
 */
export function solveRatings(schedule, market, opts = {}) {
  const { hfa = 1.0349, marginSd = 11.8 } = opts;

  const teams = Object.keys(market.teams).sort();
  const games = [];
  for (const week of Object.keys(schedule.weeks).sort((a, b) => Number(a) - Number(b))) {
    for (const game of schedule.weeks[week]) {
      games.push({ week, home: game.home, away: game.away });
    }
  }

  const gamesByTeam = new Map(teams.map((t) => [t, []]));
  for (const game of games) {
    gamesByTeam.get(game.home).push({ opponent: game.away, home: true });
    gamesByTeam.get(game.away).push({ opponent: game.home, home: false });
  }

  const targetWins = {};
  const targetPoints = {};
  for (const team of teams) {
    targetWins[team] = market.teams[team].winTotal;
    targetPoints[team] = market.teams[team].pointsFor;
  }

  // League mean is whatever the market's points totals imply, not a constant.
  const gamesPerTeam = gamesByTeam.get(teams[0]).length;
  const leagueMean = teams.reduce((s, t) => s + targetPoints[t], 0) / teams.length / gamesPerTeam;

  const off = Object.fromEntries(teams.map((t) => [t, 0]));
  const def = Object.fromEntries(teams.map((t) => [t, 0]));

  const meanFor = (team, opponent, home) =>
    leagueMean + off[team] + def[opponent] + (home ? hfa : -hfa);

  for (let iter = 0; iter < ITERATIONS; iter += 1) {
    // Points: move each offence toward its target season total.
    for (const team of teams) {
      const mine = gamesByTeam.get(team);
      let projected = 0;
      for (const g of mine) projected += meanFor(team, g.opponent, g.home);
      off[team] += (DAMPING * (targetPoints[team] - projected)) / mine.length;
    }

    // Wins: move each defence toward its target win total. Raising def[t] means
    // allowing more points, which lowers the margin, so the step is negative.
    for (const team of teams) {
      const mine = gamesByTeam.get(team);
      let projected = 0;
      let slope = 0;
      for (const g of mine) {
        const margin = meanFor(team, g.opponent, g.home) - meanFor(g.opponent, team, !g.home);
        const z = margin / marginSd;
        projected += normalCdf(z);
        slope += pdf(z) / marginSd;
      }
      if (slope > 1e-9) {
        def[team] -= (DAMPING * (targetWins[team] - projected)) / slope;
      }
    }

    // Re-anchor: defence averages zero, the offset moves into offence.
    const defMean = teams.reduce((s, t) => s + def[t], 0) / teams.length;
    for (const team of teams) {
      def[team] -= defMean;
      off[team] += defMean;
    }
  }

  return { leagueMean, hfa, marginSd, teams, off, def, games, gamesByTeam, meanFor };
}

/** How far the fitted ratings land from the market numbers they were fitted to. */
export function ratingsResiduals(ratings, market) {
  const { teams, gamesByTeam, marginSd, meanFor } = ratings;
  const rows = [];
  for (const team of teams) {
    const mine = gamesByTeam.get(team);
    let points = 0;
    let wins = 0;
    for (const g of mine) {
      points += meanFor(team, g.opponent, g.home);
      const margin = meanFor(team, g.opponent, g.home) - meanFor(g.opponent, team, !g.home);
      wins += normalCdf(margin / marginSd);
    }
    rows.push({
      team,
      wins,
      winTarget: market.teams[team].winTotal,
      winError: wins - market.teams[team].winTotal,
      points,
      pointTarget: market.teams[team].pointsFor,
      pointError: points - market.teams[team].pointsFor,
    });
  }
  return rows;
}
