// Conference and division structure, needed for playoff seeding.
// Verified against the fetched schedule by tools/verify_divisions.py: every team
// must play all three of its division rivals exactly twice.

export const DIVISIONS = {
  'AFC East': ['Bills', 'Dolphins', 'Patriots', 'Jets'],
  'AFC North': ['Ravens', 'Bengals', 'Browns', 'Steelers'],
  'AFC South': ['Texans', 'Colts', 'Jaguars', 'Titans'],
  'AFC West': ['Broncos', 'Chiefs', 'Raiders', 'Chargers'],
  'NFC East': ['Cowboys', 'Giants', 'Eagles', 'Commanders'],
  'NFC North': ['Bears', 'Lions', 'Packers', 'Vikings'],
  'NFC South': ['Falcons', 'Panthers', 'Saints', 'Buccaneers'],
  'NFC West': ['Cardinals', 'Rams', '49ers', 'Seahawks'],
};

export const DIVISION_OF = {};
export const CONFERENCE_OF = {};
for (const [division, teams] of Object.entries(DIVISIONS)) {
  for (const team of teams) {
    DIVISION_OF[team] = division;
    CONFERENCE_OF[team] = division.slice(0, 3);
  }
}
