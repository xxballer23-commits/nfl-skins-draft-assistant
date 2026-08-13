#!/usr/bin/env python3
"""Turn market win totals into the two-column market file the model calibrates to.

    python3 tools/build_market.py \
        --win-totals data/win-totals-2026.json \
        --games ../nfl-skins-tracker/data/2025-games.json \
        --last-schedule /tmp/2025-schedule.json \
        --schedule data/schedule-2026.js \
        --out data/market-2026.js

WHY THIS SCRIPT EXISTS
----------------------
The model needs two numbers per team: how much it wins and how much it scores.
Win totals are posted publicly by every sportsbook. Season-long team points
totals are not - books offer per-game team totals and weekly implied totals, but
no public board lists all 32 teams' season points. So the second column has to
come from somewhere else, and this script is that somewhere. It is a documented
compromise, not a market price, and the output is labelled accordingly.

THE SPLIT PROBLEM
-----------------
Expected points for team t against u:  leagueMean + off[t] + def[u] + hfa
so a game's margin is  net[t] - net[u] + 2*hfa,  where net = off - def.

Win totals pin down net. They say nothing about how net splits between scoring
and preventing. An 11-win team that wins 27-24 and an 11-win team that wins
20-13 have the same net and wildly different bonus profiles - 40+ and <=10 are
tail events, and they are a third of all skins. So the split has to be supplied.

Define  style = off + def,  which is a team's scoring environment: high style
means its games are shootouts, low style means they are rock fights. Unlike net,
style is invariant to the off/def gauge freedom, so it is a well-defined thing to
carry over from last season. This script takes last season's style, regresses it
hard toward league average (--lam, default 0.5, because scoring identity is only
moderately sticky year to year), and uses it to split the market's net.

    off = (style + net) / 2
    def = (style - net) / 2

Net comes from the market. Style comes from last season, heavily regressed. The
strength is priced by the market; only the shape is borrowed.

WHAT THIS DOES NOT DO
---------------------
It does not invent win totals. --win-totals is hand-entered and is checked to
sum to 272 before anything else runs. If you later find real season points props,
overwrite pointsFor in the output and set source to "vegas".

Python 3 stdlib only.
"""

import argparse
import json
import math
import os
import statistics as st
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _emit import read_module, write_module
from build_score_shape import load_team_games, fit_ratings, estimate_hfa

# Must match js/ratings.js, which re-solves from this file's output.
MARGIN_SD = 11.8
ITERATIONS = 400
DAMPING = 0.5

# 272 games, each distributing exactly 1.0 win (a tie counts 0.5 to each side).
TOTAL_WINS = 272.0


def normal_cdf(z):
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def normal_pdf(z):
    return math.exp(-0.5 * z * z) / math.sqrt(2.0 * math.pi)


def load_schedule(path):
    """[(team, opponent, is_home)] per team, from the generated ES module."""
    doc = read_module(path)
    by_team = {}
    for week in sorted(doc["weeks"], key=int):
        for game in doc["weeks"][week]:
            by_team.setdefault(game["home"], []).append((game["away"], True))
            by_team.setdefault(game["away"], []).append((game["home"], False))
    return by_team


def solve_net(win_targets, by_team, hfa, target_mean):
    """Find each team's net rating so projected wins hit the market total."""
    teams = sorted(by_team)
    net = {t: 0.0 for t in teams}
    for _ in range(ITERATIONS):
        for t in teams:
            projected = 0.0
            slope = 0.0
            for opponent, is_home in by_team[t]:
                margin = net[t] - net[opponent] + (2 * hfa if is_home else -2 * hfa)
                z = margin / MARGIN_SD
                projected += normal_cdf(z)
                slope += normal_pdf(z) / MARGIN_SD
            if slope > 1e-9:
                net[t] += DAMPING * (win_targets[t] - projected) / slope
        # net is only identified up to a constant. Anchor it so that the derived
        # defence ratings average zero, which is the gauge js/ratings.js uses.
        shift = target_mean - st.mean(net.values())
        for t in teams:
            net[t] += shift
    return net


def projected_wins(net, by_team, hfa):
    out = {}
    for t, games in by_team.items():
        total = 0.0
        for opponent, is_home in games:
            margin = net[t] - net[opponent] + (2 * hfa if is_home else -2 * hfa)
            total += normal_cdf(margin / MARGIN_SD)
        out[t] = total
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--win-totals", required=True)
    parser.add_argument("--games", required=True, help="last season's games, for the style prior")
    parser.add_argument("--last-schedule", required=True, help="last season's schedule, for home/away")
    parser.add_argument("--schedule", required=True, help="this season's schedule module")
    parser.add_argument("--out", required=True)
    parser.add_argument("--lam", type=float, default=0.5,
                        help="how much of last season's scoring style to keep (0 = none)")
    args = parser.parse_args()

    with open(args.win_totals) as fh:
        market = json.load(fh)
    win_targets = market["winTotals"]

    # --- refuse to build on a board that cannot be a real one ----------------
    if len(win_targets) != 32:
        print(f"ERROR: {len(win_targets)} teams in --win-totals, expected 32", file=sys.stderr)
        return 1
    total = sum(win_targets.values())
    if abs(total - TOTAL_WINS) > 1e-6:
        print(f"ERROR: win totals sum to {total}, not {TOTAL_WINS}.", file=sys.stderr)
        print("  272 games each distribute exactly 1.0 win, so a coherent board sums to 272.",
              file=sys.stderr)
        print("  Off by a few wins means the numbers came from more than one book, or a", file=sys.stderr)
        print("  media table rather than a live board. Not guessing which entries are wrong.",
              file=sys.stderr)
        return 1

    by_team = load_schedule(args.schedule)
    if sorted(by_team) != sorted(win_targets):
        missing = sorted(set(by_team) - set(win_targets))
        extra = sorted(set(win_targets) - set(by_team))
        print(f"ERROR: win totals do not match the schedule. missing={missing} extra={extra}",
              file=sys.stderr)
        return 1

    # --- last season's scoring style ----------------------------------------
    rows, unmatched = load_team_games(args.games, args.last_schedule)
    if unmatched:
        print(f"WARNING: {unmatched} team-games had no home/away record and were dropped.")
    league_mean = st.mean(r[2] for r in rows)
    hfa = estimate_hfa(rows)
    off25, def25 = fit_ratings(rows, league_mean, hfa)

    # Anchor last season's defence at zero so style is read in the same gauge.
    d_bar = st.mean(def25.values())
    off25 = {t: v + d_bar for t, v in off25.items()}
    def25 = {t: v - d_bar for t, v in def25.items()}

    style = {t: args.lam * (off25[t] + def25[t]) for t in win_targets}
    style_mean = st.mean(style.values())

    # --- market strength, last season's shape --------------------------------
    net = solve_net(win_targets, by_team, hfa, style_mean)
    off = {t: (style[t] + net[t]) / 2.0 for t in win_targets}
    dfn = {t: (style[t] - net[t]) / 2.0 for t in win_targets}

    points_for = {}
    for t in win_targets:
        total_pts = 0.0
        for opponent, is_home in by_team[t]:
            total_pts += league_mean + off[t] + dfn[opponent] + (hfa if is_home else -hfa)
        points_for[t] = total_pts

    fitted = projected_wins(net, by_team, hfa)
    win_err = max(abs(fitted[t] - win_targets[t]) for t in win_targets)

    doc = {
        "season": market.get("season", 2026),
        "source": "vegas-wins+regressed-style",
        "note": (
            f"winTotal is a real market line: {market.get('book')} as of {market.get('asOf')}, "
            f"hand-entered in {os.path.basename(args.win_totals)} and checked to sum to 272. "
            "pointsFor is NOT a market line. No public board lists season points totals for all "
            "32 teams, so it is derived: the market win total sets each team's net strength, and "
            f"last season's scoring style (off+def) regressed by lam={args.lam} decides how that "
            "strength splits between scoring and preventing. Replace pointsFor and set source to "
            "\"vegas\" if you find real season points props."
        ),
        "winTotalSource": {
            "book": market.get("book"),
            "asOf": market.get("asOf"),
            "via": market.get("via"),
            "sum": round(total, 4),
        },
        "pointsForMethod": {
            "derived": True,
            "lam": args.lam,
            "prior": args.games,
            "leagueMeanPoints": round(league_mean, 4),
            "homeFieldHalfEdge": round(hfa, 4),
            "marginSd": MARGIN_SD,
            "maxWinError": round(win_err, 6),
        },
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "teams": {
            t: {"winTotal": win_targets[t], "pointsFor": round(points_for[t], 1)}
            for t in sorted(win_targets)
        },
    }
    write_module(args.out, doc, header=(
        "Market inputs for the ratings solver. Generated by tools/build_market.py.\n"
        "winTotal is a hand-entered market line; pointsFor is DERIVED, not a market price.\n"
        "Edit data/win-totals-2026.json and re-run rather than hand-editing this file."))

    pts = sorted(points_for.items(), key=lambda kv: -kv[1])
    print(f"wrote {args.out}")
    print(f"  win totals      {market.get('book')} {market.get('asOf')}, sum {total}")
    print(f"  style regression lam={args.lam}  (0 = league-average shape for everyone)")
    print(f"  league mean     {league_mean:.4f} pts/team-game, hfa {hfa:.4f}/side")
    print(f"  max win error   {win_err:.6f}")
    print(f"  points range    {pts[-1][0]} {pts[-1][1]:.0f} .. {pts[0][0]} {pts[0][1]:.0f}")
    print(f"  net range       {min(net.values()):.2f} .. {max(net.values()):.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
