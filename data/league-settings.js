// League settings, mirroring the shape the tracker publishes in
// data/<season>-season.json. The simulator reads bonusEnabledByWeek through the
// tracker's own bonusEnabledForWeek() rather than hardcoding "bonuses are on",
// so switching a week off here changes the projections.
//
// Week 1 counts fully from 2026 on. 2025 excluding it was a one-off.

export default {
  season: '2026',
  skinValue: 100,
  bonusEnabledByWeek: {
    1: true, 2: true, 3: true, 4: true, 5: true, 6: true,
    7: true, 8: true, 9: true, 10: true, 11: true, 12: true,
    13: true, 14: true, 15: true, 16: true, 17: true, 18: true,
    WC: true, DIV: true, CC: true, SB: true,
  },
};
