#!/usr/bin/env python3
"""Build the empirical score-shape table the simulator samples from.

    python3 tools/build_score_shape.py \
        --games ../nfl-skins-tracker/data/2025-games.json \
        --schedule /tmp/2025-schedule.json \
        --out data/score-shape.json

Why an empirical table instead of a distribution: both skins bonuses are tail
events (40+ sits past the 94th percentile of team-game scores; 10-or-fewer at
about the 13th). A negative binomial can be tuned to match one tail or the
other but not both at once, because real football scores have a fat low tail
(shutouts, field-goal-only games) and land on football-legal totals 60% of the
time. Sampling actual scores from games with a similar predicted mean keeps
both tails and the lumpiness for free.

The table is a list of (predicted mean, actual points) pairs. The simulator
draws from the k nearest pairs by predicted mean and applies a partial mean
correction. See js/score-model.js.

Python 3 stdlib only.
"""

import argparse
import json
import os
import sys
import statistics as st
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _emit import write_module

# Ridge-style shrinkage on the per-team ratings. With 17 games a team's raw
# scoring average is noisy; shrinking keeps the fitted means from absorbing
# variance that belongs in the residual.
SHRINK = 4.0
ITERATIONS = 400


def load_team_games(games_path, schedule_path):
    """[(team, opponent, points, is_home)] for every completed regular-season game."""
    with open(games_path) as fh:
        weeks = json.load(fh)["weeks"]
    with open(schedule_path) as fh:
        schedule = json.load(fh)["weeks"]

    home_by_week = {}
    for week, games in schedule.items():
        for game in games:
            home_by_week[(week, game["home"], game["away"])] = True

    rows = []
    unmatched = 0
    for week, teams in weeks.items():
        if not week.isdigit():
            continue  # postseason is simulated as a bracket, not sampled here
        for team, entry in teams.items():
            opponent = entry["opponent"]
            if (week, team, opponent) in home_by_week:
                is_home = True
            elif (week, opponent, team) in home_by_week:
                is_home = False
            else:
                unmatched += 1
                continue
            rows.append((team, opponent, entry["pointsFor"], is_home, week))
    return rows, unmatched


def fit_ratings(rows, league_mean, hfa):
    """Alternating least squares for offence/defence ratings, with shrinkage."""
    teams = sorted({r[0] for r in rows})
    off = {t: 0.0 for t in teams}
    def_ = {t: 0.0 for t in teams}
    by_off = {t: [r for r in rows if r[0] == t] for t in teams}
    by_def = {t: [r for r in rows if r[1] == t] for t in teams}

    for _ in range(ITERATIONS):
        for t in teams:
            rs = by_off[t]
            n = len(rs)
            resid = [r[2] - league_mean - def_[r[1]] - (hfa if r[3] else -hfa) for r in rs]
            off[t] = (n / (n + SHRINK)) * st.mean(resid)
        for t in teams:
            rs = by_def[t]
            n = len(rs)
            resid = [r[2] - league_mean - off[r[0]] - (hfa if r[3] else -hfa) for r in rs]
            def_[t] = (n / (n + SHRINK)) * st.mean(resid)
    return off, def_


def estimate_hfa(rows):
    """Half the home-field edge, in points added to the home side's expected score."""
    home = [r[2] for r in rows if r[3]]
    away = [r[2] for r in rows if not r[3]]
    return (st.mean(home) - st.mean(away)) / 2.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", required=True)
    parser.add_argument("--schedule", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    rows, unmatched = load_team_games(args.games, args.schedule)
    if unmatched:
        print(f"WARNING: {unmatched} team-games could not be matched to a home/away "
              f"record and were dropped. Not guessing at them.")

    league_mean = st.mean(r[2] for r in rows)
    hfa = estimate_hfa(rows)

    # Predictions are made OUT OF SAMPLE, one week held out at a time. Fitting
    # ratings on all 17 games and then predicting those same games lets the
    # ratings absorb the very noise the sampler is supposed to reproduce: the
    # spread of predicted means comes out too wide and the leftover spread too
    # narrow, which quietly thins both tails. Holding a week out keeps the
    # predicted/actual relationship honest.
    weeks = sorted({r[4] for r in rows}, key=int)
    raw = []
    for held_out in weeks:
        train = [r for r in rows if r[4] != held_out]
        off, def_ = fit_ratings(train, league_mean, hfa)
        for team, opponent, points, is_home, week in rows:
            if week != held_out:
                continue
            mu = league_mean + off.get(team, 0.0) + def_.get(opponent, 0.0) + (hfa if is_home else -hfa)
            raw.append((mu, points))

    # Out-of-sample predictions from shrunk ratings stay a little conservative,
    # so actual scores move slightly more than one-for-one with them. Rescale
    # about the league mean until they move exactly one-for-one; otherwise
    # recentring a neighbourhood on the mean it was asked for would flatten the
    # very spread that separates a blowout team from a grinder.
    mu_bar = st.mean(m for m, _ in raw)
    cov = sum((m - mu_bar) * (a - league_mean) for m, a in raw) / len(raw)
    var = sum((m - mu_bar) ** 2 for m, _ in raw) / len(raw)
    slope = cov / var

    pairs = sorted([round(league_mean + slope * (m - mu_bar), 4), a] for m, a in raw)

    actual = [p[1] for p in pairs]
    n = len(actual)
    resid = [a - m for m, a in pairs]
    diagnostics = {
        "teamGames": n,
        "leagueMeanPoints": round(league_mean, 4),
        "homeFieldHalfEdge": round(hfa, 4),
        "calibrationSlope": round(slope, 4),
        "predictedMeanSd": round(st.pstdev([p[0] for p in pairs]), 4),
        "residualSd": round(st.pstdev(resid), 4),
        "residualMean": round(st.mean(resid), 4),
        "empiricalPctLow": round(sum(a <= 10 for a in actual) / n, 4),
        "empiricalPctHigh": round(sum(a >= 40 for a in actual) / n, 4),
        "shrink": SHRINK,
        "validation": "leave-one-week-out",
    }

    doc = {
        "source": args.games,
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "diagnostics": diagnostics,
        "pairs": pairs,
    }
    write_module(args.out, doc, compact=True, header=(
        "Empirical score shape: (predicted mean, actual points) for every team-game.\n"
        "Generated by tools/build_score_shape.py. Do not hand-edit."))

    print(f"wrote {args.out}")
    for key, value in diagnostics.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
