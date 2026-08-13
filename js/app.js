// DOM layer. All of the scoring and modelling lives in the pure modules; this
// file only reads them and draws.

import shape from '../data/score-shape.js';
import schedule from '../data/schedule-2026.js';
import market from '../data/market-2026.js';
import settings from '../data/league-settings.js';
import league from '../data/league-teams.js';

import { NFL_TEAMS } from './vendor/nfl-teams.js';
import { snakeSlots, availableSelections, pickId, shuffle } from './vendor/draft.js';
import { WEEKS } from './vendor/scoring.js';
import { solveRatings, ratingsResiduals } from './ratings.js';
import { createScoreModel } from './score-model.js';
import { runSimulation } from './simulate.js';
import {
  myTurns, bothDirectionsOpen, survivalOdds, recommendations, currentPickNo,
} from './assist.js';
import { makeRng } from './rng.js';

const STORE = 'nfl-skins-draft-assistant:v1';
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of [].concat(children)) {
    if (child != null) node.append(child.nodeType ? child : String(child));
  }
  return node;
};
const n1 = (x) => x.toFixed(1);
const n2 = (x) => x.toFixed(2);
const pct = (x) => `${Math.round(x * 100)}%`;

// --- state -----------------------------------------------------------------

const defaultState = () => ({
  order: league.teams.map((t) => t.id),
  selections: {},
  me: league.me,
  sims: 5000,
  seed: 'skins-2026',
  noise: 2.0,
  view: 'board',
  asset: null,
});

function load() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return { ...defaultState(), ...JSON.parse(raw) };
  } catch (err) {
    console.warn('could not read saved draft', err);
  }
  return defaultState();
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      order: state.order, selections: state.selections, me: state.me,
      sims: state.sims, seed: state.seed, noise: state.noise,
    }));
  } catch (err) {
    console.warn('could not save draft', err);
  }
}

const state = load();
const nameOf = (id) => league.teams.find((t) => t.id === id)?.name ?? id;
const draft = () => ({ order: state.order, selections: state.selections });

// --- model -----------------------------------------------------------------

const model = createScoreModel(shape);
const ratings = solveRatings(schedule, market, { hfa: model.homeFieldHalfEdge });
const residuals = ratingsResiduals(ratings, market);
let sim = null;

function rebuild() {
  const t0 = performance.now();
  sim = runSimulation(ratings, model, settings, { sims: state.sims, seed: state.seed });
  $('status').textContent =
    `${sim.sims} simulated seasons in ${Math.round(performance.now() - t0)} ms `
    + `\u00b7 seed "${sim.seed}" \u00b7 scoring by the tracker's own scorePick()`;
}

// --- banners ---------------------------------------------------------------

function banner() {
  const node = $('banner');
  const messages = [];
  let bad = false;

  if (market.source === 'vegas-wins+regressed-style') {
    // Win totals are real; the points column is not. Say which is which rather
    // than colouring the whole board as fake or waving it through as market.
    const src = market.winTotalSource ?? {};
    const method = market.pointsForMethod ?? {};
    // A line dated weeks ago may still be the current one, so say when it was
    // last checked against the book rather than letting asOf imply staleness.
    const checked = src.reverifiedOn
      ? `, unchanged when re-checked against the book on ${src.reverifiedOn}`
      : '';
    messages.push(
      `Win totals are real market lines (${src.book} as of ${src.asOf}${checked}, sum ${src.sum}). `
      + `POINTS TOTALS ARE DERIVED, NOT MARKET: no public board lists season points for all 32 `
      + `teams, so each team's net strength comes from its win total and the split between `
      + `scoring and preventing is last season's scoring style regressed by lam=${method.lam}. `
      + `Rankings driven by wins are on firm ground; the bonus split leans on that assumption.`);
  } else if (market.source !== 'vegas') {
    bad = true;
    messages.push(
      `MARKET DATA IS "${market.source}", NOT REAL LINES. Every number below is a `
      + `demonstration of the pipeline, not a projection. ${market.note ?? ''}`.trim()
      + '\nFill in data/win-totals-2026.json and run tools/build_market.py.');
  }
  if (schedule.problems?.length) {
    bad = true;
    messages.push(`SCHEDULE PROBLEMS:\n  - ${schedule.problems.join('\n  - ')}`);
  }
  const outside = sim?.coverage.fractionOutsideObserved ?? 0;
  if (outside > 0.02) {
    const [lo, hi] = sim.coverage.simulatedMeanRange;
    const [olo, ohi] = sim.coverage.observedMeanRange;
    messages.push(
      `${pct(outside)} of simulated team-games have an expected score outside the `
      + `${n1(olo)}-${n1(ohi)} range the sampler was built from `
      + `(this market reaches ${n1(lo)}-${n1(hi)}). Out there it is extrapolating, and the `
      + `tail rates it reproduces so well inside that range are no longer vouched for.`);
  }
  const worstWin = Math.max(...residuals.map((r) => Math.abs(r.winError)));
  if (worstWin > 0.25) {
    messages.push(`Ratings did not converge onto the market: worst win-total error ${n2(worstWin)}.`);
  }

  node.hidden = messages.length === 0;
  node.className = `banner${bad ? ' bad' : ''}`;
  node.textContent = messages.join('\n\n');
}

// --- draft board -----------------------------------------------------------

function renderBoard() {
  const view = $('view-board');
  view.replaceChildren();

  const slots = snakeSlots(state.order);
  const available = availableSelections(draft(), NFL_TEAMS);
  const turns = myTurns(draft(), state.me);
  const odds = survivalOdds(sim, draft(), state.me, NFL_TEAMS, {
    noise: state.noise, seed: `${state.seed}:assist`,
  });
  const recs = recommendations(sim, odds, 14);

  // Controls
  const controls = el('div', { className: 'panel' });
  const orderSelect = el('select');
  for (const team of league.teams) {
    orderSelect.append(el('option', { value: team.id, textContent: team.name, selected: team.id === state.me }));
  }
  orderSelect.onchange = () => { state.me = orderSelect.value; save(); render(); };

  const shuffleBtn = el('button', { className: 'action', textContent: 'Shuffle order' });
  shuffleBtn.onclick = () => {
    if (Object.keys(state.selections).length
      && !confirm('Shuffling the order re-assigns every pick already entered. Continue?')) return;
    state.order = shuffle(state.order, makeRng(`${state.seed}:order:${Date.now()}`));
    save();
    render();
  };
  const resetBtn = el('button', { className: 'action danger', textContent: 'Clear picks' });
  resetBtn.onclick = () => {
    if (!confirm('Clear every pick entered so far?')) return;
    state.selections = {};
    save();
    render();
  };
  controls.append(
    el('div', { className: 'row' }, [
      el('label', { textContent: 'I am' }), orderSelect,
      el('span', { className: 'muted', textContent: `\u00b7 order: ${state.order.map(nameOf).join(' \u2192 ')}` }),
    ]),
    el('div', { className: 'row' }, [shuffleBtn, resetBtn]),
  );
  view.append(controls);

  // Where the clock is
  const clock = el('div', { className: 'panel' });
  if (turns.current === null) {
    clock.append(el('div', { className: 'big', textContent: 'Draft complete' }));
  } else if (turns.onClock) {
    clock.append(
      el('div', { className: 'callout' }, [
        el('div', { className: 'muted', textContent: `Pick ${turns.thisPick} \u00b7 you are on the clock` }),
        el('div', { className: 'big', textContent: recs[0] ? recs[0].id.replace('-', ' ') : '\u2014' }),
        el('div', { className: 'muted', textContent: recs[0]
          ? `${n2(recs[0].value)} expected skins \u00b7 then ${n2(recs[0].bestNext)} expected from your `
            + `next pick at #${turns.nextPick ?? '\u2014'} \u00b7 ${odds.interveningPicks} rival picks in between`
          : '' }),
      ]),
    );
  } else {
    clock.append(
      el('div', { className: 'muted', textContent: `Pick ${turns.current} \u00b7 ${nameOf(slots[turns.current - 1].teamId)} on the clock` }),
      el('div', { className: 'big', textContent: `Your next pick: #${turns.nextPick ?? '\u2014'}` }),
      el('div', { className: 'muted', textContent: `${turns.picksUntilMine ?? 0} picks away` }),
    );
  }
  view.append(clock);

  // Enter a pick
  if (turns.current !== null) {
    const entry = el('div', { className: 'panel' });
    const teamSel = el('select');
    teamSel.append(el('option', { value: '', textContent: '\u2014 select \u2014' }));
    const openTeams = [...new Set(available.map((o) => o.nflTeam))].sort();
    for (const team of openTeams) teamSel.append(el('option', { value: team, textContent: team }));
    const dirSel = el('select');
    const refreshDirs = () => {
      dirSel.replaceChildren();
      for (const option of available.filter((o) => o.nflTeam === teamSel.value)) {
        dirSel.append(el('option', {
          value: option.direction,
          textContent: option.direction === 'W' ? 'WIN' : 'LOSE',
        }));
      }
    };
    teamSel.onchange = refreshDirs;
    refreshDirs();
    const submit = el('button', { className: 'action primary', textContent: `Record pick ${turns.current}` });
    submit.onclick = () => {
      if (!teamSel.value || !dirSel.value) return;
      state.selections[turns.current] = { nflTeam: teamSel.value, direction: dirSel.value };
      save();
      render();
    };
    const undo = el('button', { className: 'action', textContent: 'Undo last' });
    undo.onclick = () => {
      const last = Math.max(0, ...Object.keys(state.selections).map(Number));
      if (last) { delete state.selections[last]; save(); render(); }
    };
    entry.append(el('div', { className: 'row' }, [
      el('label', { textContent: `Pick ${turns.current} \u00b7 ${nameOf(slots[turns.current - 1].teamId)}` }),
      teamSel, dirSel, submit, undo,
    ]));
    view.append(entry);
  }

  // Recommendations
  if (turns.current !== null) {
    view.append(el('h2', { textContent: turns.onClock ? 'Take now' : 'Best available' }));
    const table = el('table');
    table.append(el('thead', {}, el('tr', {}, [
      el('th', { className: 'l', textContent: '#' }),
      el('th', { className: 'l', textContent: 'Asset' }),
      el('th', { textContent: 'Skins' }),
      el('th', { textContent: 'Base' }),
      el('th', { textContent: 'Bonus' }),
      el('th', { textContent: 'Post' }),
      el('th', { textContent: 'Lasts' }),
      el('th', { textContent: '2-pick' }),
      el('th', { textContent: 'Cost' }),
    ])));
    const body = el('tbody');
    recs.forEach((r, i) => {
      const row = el('tr');
      row.onclick = () => { state.asset = r.id; state.view = 'asset'; render(); };
      row.style.cursor = 'pointer';
      const survival = odds.interveningPicks === 0 ? '\u2014'
        : el('span', {
          className: `pill ${r.survival > 0.66 ? 'good' : r.survival > 0.33 ? 'warn' : 'bad'}`,
          textContent: pct(r.survival),
        });
      row.append(
        el('td', { className: 'l muted', textContent: i + 1 }),
        el('td', { className: 'l' }, [
          el('span', { className: `tag ${r.direction}`, textContent: r.direction }),
          ` ${r.nflTeam}`,
        ]),
        el('td', { textContent: n2(r.value) }),
        el('td', { className: 'muted', textContent: n2(r.row.base) }),
        el('td', { className: 'muted', textContent: n2(r.row.bonus) }),
        el('td', { className: 'muted', textContent: r.row.postseason > 0 ? n2(r.row.postseason) : '\u2014' }),
        el('td', {}, [survival]),
        el('td', { textContent: n2(r.twoPickValue) }),
        el('td', { className: 'muted', textContent: r.costVsBest === 0 ? '\u2014' : n2(r.costVsBest) }),
      );
      body.append(row);
    });
    table.append(body);
    view.append(table);

    if (odds.interveningPicks > 0) {
      const wait = recs.find((r) => r.survival > 0.7 && r.id !== recs[0].id);
      const risky = recs.filter((r) => r.survival < 0.3).slice(0, 3);
      const notes = [];
      if (risky.length) {
        notes.push(`Unlikely to last to #${turns.nextPick}: ${risky.map((r) => `${r.nflTeam}-${r.direction} (${pct(r.survival)})`).join(', ')}.`);
      }
      if (wait) {
        notes.push(`${wait.nflTeam}-${wait.direction} should still be there (${pct(wait.survival)}), so it is not worth reaching for.`);
      }
      if (notes.length) view.append(el('p', { className: 'muted', textContent: notes.join(' ') }));
    }
  }

  // Both directions open
  const both = bothDirectionsOpen(available);
  if (both.length) {
    view.append(el('h2', { textContent: `Both sides still open (${both.length} teams)` }));
    const ranked = both
      .map((team) => ({
        team,
        w: sim.byId[pickId(team, 'W')],
        l: sim.byId[pickId(team, 'L')],
      }))
      .sort((a, b) => Math.max(b.w.total, b.l.total) - Math.max(a.w.total, a.l.total))
      .slice(0, 10);
    const table = el('table');
    table.append(el('thead', {}, el('tr', {}, [
      el('th', { className: 'l', textContent: 'Team' }),
      el('th', { textContent: 'WIN' }),
      el('th', { textContent: 'LOSE' }),
      el('th', { className: 'l', textContent: 'Note' }),
    ])));
    const body = el('tbody');
    for (const r of ranked) {
      const gap = Math.abs(r.w.total - r.l.total);
      body.append(el('tr', {}, [
        el('td', { className: 'l', textContent: r.team }),
        el('td', { textContent: n2(r.w.total) }),
        el('td', { textContent: n2(r.l.total) }),
        el('td', { className: 'l muted', textContent: gap < 2
          ? 'both sides priced alike \u2014 whoever takes one hands the other away'
          : `${r.w.total > r.l.total ? 'WIN' : 'LOSE'} is the side worth having` }),
      ]));
    }
    table.append(body);
    view.append(table);
  }

  // The board itself
  view.append(el('h2', { textContent: 'Board' }));
  const grid = el('div', { className: 'slots' });
  for (const slot of slots) {
    const selection = state.selections[slot.pickNo];
    const classes = ['slot'];
    if (slot.teamId === state.me) classes.push('mine');
    if (slot.pickNo === turns.current) classes.push('now');
    if (!selection) classes.push('empty');
    const asset = selection ? sim.byId[pickId(selection.nflTeam, selection.direction)] : null;
    grid.append(el('div', { className: classes.join(' ') }, [
      el('div', { className: 'no', textContent: `#${slot.pickNo} R${slot.round}` }),
      el('div', { className: 'who', textContent: nameOf(slot.teamId) }),
      el('div', { className: 'sel' }, selection
        ? [el('span', { className: `tag ${selection.direction}`, textContent: selection.direction }),
          ` ${selection.nflTeam}`]
        : ['\u2014']),
      asset ? el('div', { className: 'no', textContent: `${n1(asset.total)} skins` }) : null,
    ]));
  }
  view.append(grid);

  // My roster so far
  const mine = slots.filter((s) => s.teamId === state.me && state.selections[s.pickNo]);
  if (mine.length) {
    const total = mine.reduce((s, slot) => {
      const sel = state.selections[slot.pickNo];
      return s + sim.byId[pickId(sel.nflTeam, sel.direction)].total;
    }, 0);
    // The Mendoza Line is the league average, so 30 picks spread over 6 teams.
    const drafted = Object.values(state.selections)
      .map((s) => sim.byId[pickId(s.nflTeam, s.direction)].total);
    const projectedMendoza = (drafted.reduce((a, b) => a + b, 0) / drafted.length) * 5;
    view.append(el('h2', { textContent: 'My roster' }));
    view.append(el('div', { className: 'grid' }, [
      el('div', { className: 'card' }, [
        el('div', { className: 'k', textContent: 'Picks made' }),
        el('div', { className: 'v', textContent: `${mine.length} of 5` }),
      ]),
      el('div', { className: 'card' }, [
        el('div', { className: 'k', textContent: 'Expected skins' }),
        el('div', { className: 'v', textContent: n1(total) }),
      ]),
      el('div', { className: 'card' }, [
        el('div', { className: 'k', textContent: 'Pace vs drafted average' }),
        el('div', { className: 'v', textContent: `${total - (projectedMendoza * mine.length) / 5 >= 0 ? '+' : ''}${n1(total - (projectedMendoza * mine.length) / 5)}` }),
      ]),
    ]));
    view.append(el('p', { className: 'muted', textContent:
      'Pace compares your picks against the average of everything drafted so far, '
      + 'not the finished Mendoza Line. It only means something once the rounds are even.' }));
  }
}

// --- rankings --------------------------------------------------------------

function renderRankings() {
  const view = $('view-rankings');
  view.replaceChildren();
  const taken = new Set(Object.values(state.selections)
    .filter((s) => s?.nflTeam).map((s) => pickId(s.nflTeam, s.direction)));

  const controls = el('div', { className: 'panel row' });
  const showTaken = el('input', { type: 'checkbox', id: 'showtaken', checked: true });
  showTaken.onchange = () => renderRankingsTable(view, taken, showTaken.checked);
  controls.append(showTaken, el('label', { htmlFor: 'showtaken', textContent: 'show drafted assets' }));
  view.append(controls);
  renderRankingsTable(view, taken, true);
}

function renderRankingsTable(view, taken, includeTaken) {
  view.querySelector('table')?.remove();
  view.querySelector('p.legend')?.remove();
  const max = Math.max(...sim.rows.map((r) => r.total));
  const table = el('table');
  table.append(el('thead', {}, el('tr', {}, [
    el('th', { className: 'l', textContent: '#' }),
    el('th', { className: 'l', textContent: 'Asset' }),
    el('th', { textContent: 'Skins' }),
    el('th', { className: 'l', textContent: 'Base / bonus' }),
    el('th', { textContent: 'Base' }),
    el('th', { textContent: 'Bonus' }),
    el('th', { textContent: 'Reg' }),
    el('th', { textContent: 'Post' }),
    el('th', { textContent: 'SD' }),
    el('th', { textContent: 'Wins' }),
    el('th', { textContent: 'PF' }),
    el('th', { textContent: 'PA' }),
    el('th', { textContent: 'Playoff' }),
  ])));
  const body = el('tbody');
  for (const r of sim.rows) {
    const isTaken = taken.has(r.id);
    if (isTaken && !includeTaken) continue;
    const stats = sim.teamStats[r.nflTeam];
    const row = el('tr', { className: isTaken ? 'taken' : '' });
    row.style.cursor = 'pointer';
    row.onclick = () => { state.asset = r.id; state.view = 'asset'; render(); };
    const scale = 150 / max;
    row.append(
      el('td', { className: 'l muted', textContent: r.rank }),
      el('td', { className: 'l' }, [
        el('span', { className: `tag ${r.direction}`, textContent: r.direction }),
        ` ${r.nflTeam}`,
      ]),
      el('td', { textContent: n2(r.total) }),
      el('td', { className: 'l' }, [
        el('span', { className: 'bar base', style: `width:${r.base * scale}px` }),
        el('span', { className: 'bar bonus', style: `width:${r.bonus * scale}px` }),
      ]),
      el('td', { className: 'muted', textContent: n2(r.base) }),
      el('td', { className: 'muted', textContent: n2(r.bonus) }),
      el('td', { className: 'muted', textContent: n2(r.regularSeason) }),
      el('td', { textContent: r.postseason > 0 ? n2(r.postseason) : '\u2014' }),
      el('td', { className: 'muted', textContent: n1(r.sd) }),
      el('td', { className: 'muted', textContent: n1(stats.expectedWins) }),
      el('td', { className: 'muted', textContent: Math.round(stats.pointsFor) }),
      el('td', { className: 'muted', textContent: Math.round(stats.pointsAgainst) }),
      el('td', { className: 'muted', textContent: pct(stats.playoffOdds) }),
    );
    body.append(row);
  }
  table.append(body);
  view.append(table);
  view.append(el('p', { className: 'legend muted', textContent:
    'Blue is base skins, amber is bonus. Post is postseason skins, which is structurally '
    + 'zero for every Lose pick. Click a row for the week-by-week breakdown.' }));
}

// --- per-week --------------------------------------------------------------

function renderAsset() {
  const view = $('view-asset');
  view.replaceChildren();

  const select = el('select');
  for (const r of sim.rows) {
    select.append(el('option', {
      value: r.id,
      textContent: `${r.rank}. ${r.nflTeam} ${r.direction === 'W' ? 'WIN' : 'LOSE'} \u2014 ${n2(r.total)}`,
      selected: r.id === state.asset,
    }));
  }
  select.onchange = () => { state.asset = select.value; render(); };
  view.append(el('div', { className: 'panel row' }, [el('label', { textContent: 'Asset' }), select]));

  const row = sim.byId[state.asset] ?? sim.rows[0];
  const stats = sim.teamStats[row.nflTeam];

  view.append(el('div', { className: 'grid' }, [
    ['Expected skins', n2(row.total)],
    ['Base', n2(row.base)],
    ['Bonus', n2(row.bonus)],
    ['Postseason', row.direction === 'L' ? '0 (rule)' : n2(row.postseason)],
    ['Expected wins', n1(stats.expectedWins)],
    ['Points for / against', `${Math.round(stats.pointsFor)} / ${Math.round(stats.pointsAgainst)}`],
    ['Playoff odds', pct(stats.playoffOdds)],
    ['Super Bowl odds', pct(stats.superBowlOdds)],
  ].map(([k, v]) => el('div', { className: 'card' }, [
    el('div', { className: 'k', textContent: k }),
    el('div', { className: 'v', textContent: v }),
  ]))));

  view.append(el('h2', { textContent: 'Week by week' }));
  const byWeek = WEEKS.map((w) => ({ week: w, cell: row.byWeek[w.id] }));
  const max = Math.max(...byWeek.map((b) => b.cell.total), 0.01);
  const table = el('table');
  table.append(el('thead', {}, el('tr', {}, [
    el('th', { className: 'l', textContent: 'Week' }),
    el('th', { className: 'l', textContent: 'Opponent' }),
    el('th', { textContent: 'Base' }),
    el('th', { textContent: 'Bonus' }),
    el('th', { textContent: 'Total' }),
    el('th', { className: 'l', textContent: '' }),
  ])));
  const body = el('tbody');
  for (const { week, cell } of byWeek) {
    let opponent = '\u2014';
    if (week.postseason) {
      opponent = row.direction === 'L' ? 'Lose picks score 0 in the postseason' : 'if still alive';
    } else {
      const game = (schedule.weeks[week.id] ?? [])
        .find((g) => g.home === row.nflTeam || g.away === row.nflTeam);
      opponent = game
        ? (game.home === row.nflTeam ? `vs ${game.away}` : `at ${game.home}`)
        : 'BYE';
    }
    body.append(el('tr', {}, [
      el('td', { className: 'l', textContent: week.label }),
      el('td', { className: 'l muted', textContent: opponent }),
      el('td', { className: 'muted', textContent: n2(cell.base) }),
      el('td', { className: 'muted', textContent: n2(cell.bonus) }),
      el('td', { textContent: n2(cell.total) }),
      el('td', { className: 'l' }, [
        el('span', { className: 'bar base', style: `width:${(cell.base / max) * 120}px` }),
        el('span', { className: 'bar bonus', style: `width:${(cell.bonus / max) * 120}px` }),
      ]),
    ]));
  }
  table.append(body);
  view.append(table);
  view.append(el('p', { className: 'muted', textContent:
    'Bye weeks and postseason weeks a team never reaches contribute nothing, which is why '
    + 'value is summed over the actual schedule rather than scaled from a season total.' }));
}

// --- model view ------------------------------------------------------------

function renderModel() {
  const view = $('view-model');
  view.replaceChildren();

  const controls = el('div', { className: 'panel' });
  const simsInput = el('input', { type: 'number', value: state.sims, min: 200, step: 500, style: 'width:100px' });
  const seedInput = el('input', { type: 'text', value: state.seed, style: 'width:150px' });
  const noiseInput = el('input', { type: 'number', value: state.noise, min: 0, step: 0.5, style: 'width:80px' });
  const apply = el('button', { className: 'action primary', textContent: 'Re-run' });
  apply.onclick = () => {
    state.sims = Math.max(200, Number(simsInput.value) || 5000);
    state.seed = seedInput.value || 'skins-2026';
    state.noise = Math.max(0, Number(noiseInput.value) || 0);
    save();
    rebuild();
    render();
  };
  controls.append(el('div', { className: 'row' }, [
    el('label', { textContent: 'Simulations' }), simsInput,
    el('label', { textContent: 'Seed' }), seedInput,
    el('label', { textContent: 'Rival noise (skins)' }), noiseInput,
    apply,
  ]));
  controls.append(el('p', { className: 'muted', textContent:
    'The seed fixes every random draw, so the same seed always produces the same board. '
    + 'Rival noise is how far a rival can plausibly stray from this model when picking; '
    + 'at zero they behave as five copies of it and the survival odds become far too confident.' }));
  view.append(controls);

  view.append(el('h2', { textContent: 'Inputs' }));
  view.append(el('div', { className: 'grid' }, [
    ['Market source', market.source],
    ['Score shape', `${shape.diagnostics.teamGames} team-games`],
    ['Validation', shape.diagnostics.validation ?? 'in-sample'],
    ['League mean points', n2(shape.diagnostics.leagueMeanPoints)],
    ['Home edge (per side)', n2(shape.diagnostics.homeFieldHalfEdge)],
    ['Residual SD', n2(shape.diagnostics.residualSd)],
    ['2025 rate held to 10-', pct(shape.diagnostics.empiricalPctLow)],
    ['2025 rate scoring 40+', pct(shape.diagnostics.empiricalPctHigh)],
    ['Sampler neighbourhood', `${model.k} games`],
    ['Means outside sampled range', pct(sim.coverage.fractionOutsideObserved)],
  ].map(([k, v]) => el('div', { className: 'card' }, [
    el('div', { className: 'k', textContent: k }),
    el('div', { className: 'v', textContent: v }),
  ]))));

  view.append(el('h2', { textContent: 'Calibration against the market' }));
  const worstWins = [...residuals].sort((a, b) => Math.abs(b.winError) - Math.abs(a.winError)).slice(0, 6);
  const table = el('table');
  table.append(el('thead', {}, el('tr', {}, [
    el('th', { className: 'l', textContent: 'Team' }),
    el('th', { textContent: 'Win target' }),
    el('th', { textContent: 'Fitted' }),
    el('th', { textContent: 'Error' }),
    el('th', { textContent: 'Points target' }),
    el('th', { textContent: 'Fitted' }),
    el('th', { textContent: 'Error' }),
  ])));
  const body = el('tbody');
  for (const r of worstWins) {
    body.append(el('tr', {}, [
      el('td', { className: 'l', textContent: r.team }),
      el('td', { className: 'muted', textContent: n1(r.winTarget) }),
      el('td', { textContent: n2(r.wins) }),
      el('td', { className: 'muted', textContent: n2(r.winError) }),
      el('td', { className: 'muted', textContent: Math.round(r.pointTarget) }),
      el('td', { textContent: Math.round(r.points) }),
      el('td', { className: 'muted', textContent: n1(r.pointError) }),
    ]));
  }
  table.append(body);
  view.append(table);
  view.append(el('p', { className: 'muted', textContent:
    'The six worst fits. Ratings are solved so that every team\u2019s projected wins and '
    + 'projected points land on the numbers in data/market-2026.js.' }));

  view.append(el('h2', { textContent: 'Where the value comes from' }));
  const wins = sim.rows.filter((r) => r.direction === 'W');
  const loses = sim.rows.filter((r) => r.direction === 'L');
  const avg = (list, key) => list.reduce((s, r) => s + r[key], 0) / list.length;
  view.append(el('div', { className: 'grid' }, [
    ['Win picks, avg skins', n2(avg(wins, 'total'))],
    ['Lose picks, avg skins', n2(avg(loses, 'total'))],
    ['Win picks, avg postseason', n2(avg(wins, 'postseason'))],
    ['Lose picks, avg postseason', n2(avg(loses, 'postseason'))],
    ['Bonus share of all skins', pct(sim.rows.reduce((s, r) => s + r.bonus, 0)
      / sim.rows.reduce((s, r) => s + r.total, 0))],
    ['Best Lose pick', loses[0] ? `${loses[0].nflTeam} (${n2(loses[0].total)})` : '\u2014'],
  ].map(([k, v]) => el('div', { className: 'card' }, [
    el('div', { className: 'k', textContent: k }),
    el('div', { className: 'v', textContent: v }),
  ]))));
}

// --- shell -----------------------------------------------------------------

function render() {
  banner();
  for (const button of $('tabs').children) {
    button.classList.toggle('active', button.dataset.view === state.view);
  }
  for (const view of ['board', 'rankings', 'asset', 'model']) {
    $(`view-${view}`).hidden = view !== state.view;
  }
  if (!state.asset) state.asset = sim.rows[0].id;
  if (state.view === 'board') renderBoard();
  if (state.view === 'rankings') renderRankings();
  if (state.view === 'asset') renderAsset();
  if (state.view === 'model') renderModel();
}

for (const button of $('tabs').children) {
  button.onclick = () => { state.view = button.dataset.view; render(); };
}

rebuild();
render();
