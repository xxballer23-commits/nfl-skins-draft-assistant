// Scoring engine for the NFL Skins League.
// Pure functions, no DOM access, so this file can be unit tested outside the browser.

// The spec doc says "under 9.5", but replaying the 2025 season against real game
// scores shows the league actually played "10 or fewer" (29 pick-weeks hinged on it).
// User confirmed 10.5 is authoritative.
export const BONUS_LOW = 10.5;  // held to 10 points or fewer
export const BONUS_HIGH = 39.5; // scored 40 points or more

export const WEEKS = [
  ...Array.from({ length: 18 }, (_, i) => ({
    id: String(i + 1),
    label: `Week ${i + 1}`,
    postseason: false,
  })),
  { id: 'WC', label: 'Wild Card', postseason: true },
  { id: 'DIV', label: 'Divisional', postseason: true },
  { id: 'CC', label: 'Conf. Champ', postseason: true },
  { id: 'SB', label: 'Super Bowl', postseason: true },
];

export const WEEK_BY_ID = Object.fromEntries(WEEKS.map((w) => [w.id, w]));

const NO_SKINS = Object.freeze({ base: 0, bonus: 0, total: 0 });

/**
 * Skins earned by a single pick in a single week.
 *
 * @param direction 'W' for a Win pick, 'L' for a Lose pick.
 * @param entry     { result: 'W'|'L'|'T', pointsFor, pointsAgainst }, or null/undefined
 *                  for a bye week / no game played.
 * @param opts      { postseason, bonusEnabled }
 */
export function scorePick(direction, entry, opts = {}) {
  const { postseason = false, bonusEnabled = true } = opts;

  if (!entry || !entry.result) return NO_SKINS; // bye week or no game
  // Postseason rule: once a team makes the playoffs, Lose picks are dead for the
  // rest of the postseason regardless of the result or the margin.
  if (postseason && direction === 'L') return NO_SKINS;

  const won = entry.result === 'W';
  const lost = entry.result === 'L';
  const base = (direction === 'W' && won) || (direction === 'L' && lost) ? 1 : 0;
  if (base === 0) return NO_SKINS; // no base skin means no bonus skins either

  let bonus = 0;
  if (bonusEnabled) {
    const pf = entry.pointsFor;
    const pa = entry.pointsAgainst;
    // The two bonus conditions are independent checks, never an if/else chain:
    // a single pick can earn the base skin plus both bonuses in the same week.
    if (direction === 'W') {
      if (Number.isFinite(pa) && pa < BONUS_LOW) bonus += 1;
      if (Number.isFinite(pf) && pf > BONUS_HIGH) bonus += 1;
    } else {
      if (Number.isFinite(pf) && pf < BONUS_LOW) bonus += 1;
      if (Number.isFinite(pa) && pa > BONUS_HIGH) bonus += 1;
    }
  }

  return { base, bonus, total: base + bonus };
}

/** True unless the week has been explicitly toggled off in settings. */
export function bonusEnabledForWeek(settings, weekId) {
  return settings.bonusEnabledByWeek[weekId] !== false;
}

/**
 * Roll every entered result up into per-pick and per-team totals.
 * Returns { byPick, byTeam } keyed by id, each carrying a byWeek breakdown.
 */
export function computeTotals(state) {
  const { league, results, settings } = state;

  const byPick = {};
  for (const pick of league.picks) {
    byPick[pick.id] = { base: 0, bonus: 0, total: 0, byWeek: {} };
  }

  const byTeam = {};
  for (const team of league.teams) {
    const byWeek = {};
    for (const week of WEEKS) byWeek[week.id] = { base: 0, bonus: 0, total: 0 };
    byTeam[team.id] = { teamId: team.id, name: team.name, base: 0, bonus: 0, total: 0, byWeek };
  }

  for (const week of WEEKS) {
    const weekResults = results[week.id] || {};
    const bonusEnabled = bonusEnabledForWeek(settings, week.id);

    for (const pick of league.picks) {
      const skins = scorePick(pick.direction, weekResults[pick.id], {
        postseason: week.postseason,
        bonusEnabled,
      });

      const pickTotals = byPick[pick.id];
      pickTotals.byWeek[week.id] = skins;
      pickTotals.base += skins.base;
      pickTotals.bonus += skins.bonus;
      pickTotals.total += skins.total;

      const teamWeek = byTeam[pick.teamId].byWeek[week.id];
      teamWeek.base += skins.base;
      teamWeek.bonus += skins.bonus;
      teamWeek.total += skins.total;
    }
  }

  for (const team of Object.values(byTeam)) {
    for (const week of WEEKS) {
      team.base += team.byWeek[week.id].base;
      team.bonus += team.byWeek[week.id].bonus;
      team.total += team.byWeek[week.id].total;
    }
  }

  return { byPick, byTeam };
}

/**
 * Mendoza Line = average total skins across all teams. Payouts are zero-sum
 * by construction.
 *
 * @param teamTotals array of { teamId, name, base, bonus, total }
 */
export function computeStandings(teamTotals, skinValue) {
  const mendoza = teamTotals.reduce((sum, t) => sum + t.total, 0) / teamTotals.length;

  const rows = teamTotals
    .map((team) => {
      const diff = team.total - mendoza;
      const dollarsTeam = diff * skinValue;
      return { ...team, diff, dollarsTeam, dollarsPerTeammate: dollarsTeam / 2 };
    })
    .sort((a, b) => b.total - a.total || b.base - a.base || a.name.localeCompare(b.name));

  return { mendoza, rows };
}
