#!/usr/bin/env python3
"""Check js/divisions.js against a fetched schedule.

Every NFL team plays each of its three division rivals exactly twice, so the
schedule is an independent witness for the division map. If the map is wrong,
playoff seeding is wrong, and that silently mis-prices every Win pick.

    python3 tools/verify_divisions.py data/schedule-2026.js
"""

import json
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _emit import read_module


def load_divisions(path="js/divisions.js"):
    with open(path) as fh:
        source = fh.read()
    block = source[source.index("export const DIVISIONS") : source.index("export const DIVISION_OF")]
    divisions = {}
    for name, teams in re.findall(r"'([^']+)':\s*\[([^\]]+)\]", block):
        divisions[name] = re.findall(r"'([^']+)'", teams)
    return divisions


def main():
    schedule_path = sys.argv[1] if len(sys.argv) > 1 else "data/schedule-2026.js"
    schedule = read_module(schedule_path)
    divisions = load_divisions()

    division_of = {t: d for d, ts in divisions.items() for t in ts}

    meetings = Counter()
    for games in schedule["weeks"].values():
        for game in games:
            meetings[frozenset((game["home"], game["away"]))] += 1

    problems = []
    if len(division_of) != 32:
        problems.append(f"division map has {len(division_of)} teams, expected 32")
    for name, teams in divisions.items():
        if len(teams) != 4:
            problems.append(f"{name} has {len(teams)} teams, expected 4")

    scheduled_teams = {t for pair in meetings for t in pair}
    unknown = scheduled_teams - set(division_of)
    if unknown:
        problems.append(f"teams in schedule but not in division map: {sorted(unknown)}")
    missing = set(division_of) - scheduled_teams
    if missing:
        problems.append(f"teams in division map but not in schedule: {sorted(missing)}")

    for name, teams in divisions.items():
        for i, a in enumerate(teams):
            for b in teams[i + 1 :]:
                n = meetings.get(frozenset((a, b)), 0)
                if n != 2:
                    problems.append(f"{name}: {a} vs {b} scheduled {n} times, expected 2")

    # And the converse: nobody outside a division should meet twice.
    for pair, n in meetings.items():
        a, b = sorted(pair)
        if n == 2 and division_of.get(a) != division_of.get(b):
            problems.append(f"{a} vs {b} play twice but are in different divisions")

    if problems:
        print(f"{len(problems)} PROBLEM(S):")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"divisions verified against {schedule_path}: "
          f"8 divisions x 4 teams, all 48 division pairings play exactly twice")
    return 0


if __name__ == "__main__":
    sys.exit(main())
