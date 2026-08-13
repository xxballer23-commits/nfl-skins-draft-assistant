import schedule from '../data/schedule-2026.js';
import shape from '../data/score-shape.js';
import market from '../data/market-2026.js';
import settings from '../data/league-settings.js';
import { solveRatings, ratingsResiduals } from '../js/ratings.js';
import { createScoreModel } from '../js/score-model.js';
import { runSimulation } from '../js/simulate.js';

const log = typeof print === 'function' ? print : console.log;

const model = createScoreModel(shape);
const ratings = solveRatings(schedule, market, { hfa: model.homeFieldHalfEdge });

const res = ratingsResiduals(ratings, market);
const maxWinErr = Math.max(...res.map((r) => Math.abs(r.winError)));
const maxPtErr = Math.max(...res.map((r) => Math.abs(r.pointError)));
log(`calibration: max win error ${maxWinErr.toFixed(4)}, max points error ${maxPtErr.toFixed(3)}`);

const t0 = Date.now();
const sim = runSimulation(ratings, model, settings, { sims: 2000, seed: 'smoke' });
log(`${sim.sims} sims in ${Date.now() - t0} ms`);

log('\nrank  asset            total   base  bonus   reg   post    sd');
for (const r of sim.rows.slice(0, 12)) {
  log(`${String(r.rank).padStart(4)}  ${r.id.padEnd(14)} ${r.total.toFixed(2).padStart(6)} ${r.base.toFixed(2).padStart(6)} ${r.bonus.toFixed(2).padStart(6)} ${r.regularSeason.toFixed(2).padStart(5)} ${r.postseason.toFixed(2).padStart(6)} ${r.sd.toFixed(2).padStart(5)}`);
}
log('  ...');
for (const r of sim.rows.slice(-4)) {
  log(`${String(r.rank).padStart(4)}  ${r.id.padEnd(14)} ${r.total.toFixed(2).padStart(6)} ${r.base.toFixed(2).padStart(6)} ${r.bonus.toFixed(2).padStart(6)} ${r.regularSeason.toFixed(2).padStart(5)} ${r.postseason.toFixed(2).padStart(6)} ${r.sd.toFixed(2).padStart(5)}`);
}

const losers = sim.rows.filter((r) => r.direction === 'L').slice(0, 6);
log('\nbest Lose picks:');
for (const r of losers) {
  const t = sim.teamStats[r.nflTeam];
  log(`  ${r.id.padEnd(14)} total ${r.total.toFixed(2)}  bonus ${r.bonus.toFixed(2)}  (exp wins ${t.expectedWins.toFixed(1)}, PF ${t.pointsFor.toFixed(0)}, PA ${t.pointsAgainst.toFixed(0)})`);
}

log('\nplayoff diagnostics (top 5 by SB odds):');
const teams = Object.values(sim.teamStats).sort((a, b) => b.superBowlOdds - a.superBowlOdds);
for (const t of teams.slice(0, 5)) {
  log(`  ${t.team.padEnd(12)} wins ${t.expectedWins.toFixed(1)}  playoffs ${(t.playoffOdds * 100).toFixed(0)}%  SB ${(t.superBowlOdds * 100).toFixed(0)}%  post games ${t.expectedPostseasonGames.toFixed(2)}`);
}
const totalSb = teams.reduce((s, t) => s + t.superBowlOdds, 0);
const totalPlayoff = teams.reduce((s, t) => s + t.playoffOdds, 0);
log(`\nsums: SB odds ${totalSb.toFixed(3)} (want 1.000), playoff odds ${totalPlayoff.toFixed(3)} (want 14.000)`);
