// Draft setup: team roster, randomised order, and the snake board.
// Pure functions, no DOM, so the ordering rules can be unit tested.

const ROUNDS = 5;

/**
 * Fisher-Yates. Takes the random source so tests can pin it down.
 */
export function shuffle(items, random = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Snake order: round 1 runs down the order, round 2 back up, and so on.
 * Returns 30 slots for a 6-team, 5-round draft.
 */
export function snakeSlots(order, rounds = ROUNDS) {
  const slots = [];
  for (let round = 1; round <= rounds; round += 1) {
    const sequence = round % 2 === 1 ? order : [...order].reverse();
    for (const teamId of sequence) {
      slots.push({ pickNo: slots.length + 1, round, teamId });
    }
  }
  return slots;
}

export function pickId(nflTeam, direction) {
  return `${nflTeam}-${direction}`;
}

/** Build the league object the rest of the app reads from a draft in progress. */
export function toLeague(draft) {
  const picks = [];
  for (const slot of snakeSlots(draft.order)) {
    const selection = draft.selections[slot.pickNo];
    if (!selection?.nflTeam || !selection?.direction) continue; // not picked yet
    picks.push({
      id: pickId(selection.nflTeam, selection.direction),
      teamId: slot.teamId,
      nflTeam: selection.nflTeam,
      direction: selection.direction,
      pickNo: slot.pickNo,
      round: slot.round,
    });
  }
  return { teams: draft.teams, picks };
}

/**
 * Seed a draft from whatever league is already published, so a new season
 * starts from last year's rosters instead of six blank rows. Round 1 of the
 * existing board tells us the order that produced it.
 */
export function draftFromLeague(league, season) {
  const teams = league.teams.map((t) => ({ id: t.id, name: t.name, members: [...t.members] }));
  const round1 = league.picks.filter((p) => p.round === 1).sort((a, b) => a.pickNo - b.pickNo);
  const order = round1.length === teams.length ? round1.map((p) => p.teamId) : teams.map((t) => t.id);
  const selections = {};
  for (const pick of league.picks) {
    selections[pick.pickNo] = { nflTeam: pick.nflTeam, direction: pick.direction };
  }
  return { season, teams, order, selections };
}

/**
 * Problems worth blocking on. The same NFL team may be drafted twice, once as a
 * Win pick and once as a Lose pick, so uniqueness applies to the combination.
 */
export function draftProblems(draft) {
  const problems = [];
  const slots = snakeSlots(draft.order);
  const seen = new Map();

  for (const slot of slots) {
    const selection = draft.selections[slot.pickNo];
    if (!selection?.nflTeam || !selection?.direction) continue;
    const id = pickId(selection.nflTeam, selection.direction);
    if (seen.has(id)) {
      problems.push(`Pick ${slot.pickNo} duplicates pick ${seen.get(id)}: ${selection.nflTeam} ${selection.direction === 'W' ? 'WIN' : 'LOSE'} is already taken.`);
    } else {
      seen.set(id, slot.pickNo);
    }
  }

  const unfilled = slots.filter((s) => {
    const selection = draft.selections[s.pickNo];
    return !selection?.nflTeam || !selection?.direction;
  });
  if (unfilled.length) {
    problems.push(`${unfilled.length} of ${slots.length} picks still to make.`);
  }

  for (const team of draft.teams) {
    if (!team.name.trim()) problems.push('Every team needs a name.');
  }

  return problems;
}

/** Which team+direction combinations are still on the board. */
export function availableSelections(draft, allNflTeams, exceptPickNo = null) {
  const taken = new Set();
  for (const [pickNo, selection] of Object.entries(draft.selections)) {
    if (Number(pickNo) === exceptPickNo) continue;
    if (selection?.nflTeam && selection?.direction) taken.add(pickId(selection.nflTeam, selection.direction));
  }
  const options = [];
  for (const nflTeam of allNflTeams) {
    for (const direction of ['W', 'L']) {
      if (!taken.has(pickId(nflTeam, direction))) options.push({ nflTeam, direction });
    }
  }
  return options;
}
