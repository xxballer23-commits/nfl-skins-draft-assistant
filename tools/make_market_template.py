#!/usr/bin/env python3
"""Emit the market file the model calibrates to, as a fill-in-by-hand template.

    python3 tools/make_market_template.py \
        --games ../nfl-skins-tracker/data/2025-games.json \
        --out data/2026-market.json

Two numbers per team: the Vegas season win total and the Vegas season points
total. Those are the only hand-entered inputs the model has.

This script CANNOT fetch Vegas numbers. It seeds the file with last season's
actual wins and points so the pipeline runs end to end, and marks the file
    "source": "PLACEHOLDER"
so the app can refuse to present the output as a real projection. Replace the
numbers with real market lines and set "source" to "vegas". Nothing downstream
guesses on your behalf.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _emit import write_module


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", required=True, help="a season games file to seed placeholders from")
    parser.add_argument("--out", required=True)
    parser.add_argument("--season", type=int, default=2026)
    args = parser.parse_args()

    with open(args.games) as fh:
        weeks = json.load(fh)["weeks"]

    wins = {}
    points = {}
    played = {}
    for week, teams in weeks.items():
        if not week.isdigit():
            continue
        for team, entry in teams.items():
            wins[team] = wins.get(team, 0) + (1 if entry["result"] == "W" else 0)
            points[team] = points.get(team, 0) + entry["pointsFor"]
            played[team] = played.get(team, 0) + 1

    if len(wins) != 32:
        print(f"ERROR: source season has {len(wins)} teams, expected 32", file=sys.stderr)
        return 1

    doc = {
        "season": args.season,
        "source": "PLACEHOLDER",
        "note": ("Seeded from actual results in " + args.games + ". These are NOT market "
                 "lines and price last season's rosters. Replace winTotal and pointsFor "
                 "with real Vegas numbers, then set \"source\" to \"vegas\"."),
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "teams": {
            team: {"winTotal": wins[team], "pointsFor": points[team]}
            for team in sorted(wins)
        },
    }
    write_module(args.out, doc, header=(
        "Hand-entered market inputs. THIS FILE IS MEANT TO BE EDITED BY HAND.\n"
        "Set source to \"vegas\" once the numbers are real market lines."))
    print(f"wrote {args.out} with 32 PLACEHOLDER teams")
    print("Replace the numbers with Vegas lines and set source to \"vegas\".")
    return 0


if __name__ == "__main__":
    sys.exit(main())
