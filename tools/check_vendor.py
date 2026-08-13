#!/usr/bin/env python3
"""Check that js/vendor/ is still byte-identical to the tracker's engine.

This repo does not reimplement the scoring or the draft rules; it copies
scoring.js, draft.js and nfl-teams.js from nfl-skins-tracker and calls them.
Two repos means two copies, and two copies drift. This says so out loud.

    python3 tools/check_vendor.py [path-to-tracker]

If the tracker is not on this machine the check is skipped rather than failed,
so CI on a fresh clone still passes.
"""

import hashlib
import os
import sys

VENDORED = ["scoring.js", "draft.js", "nfl-teams.js"]
DEFAULT_TRACKER = os.path.expanduser("~/Desktop/nfl-skins-tracker")


def digest(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def main():
    tracker = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TRACKER
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "js", "vendor")

    upstream = os.path.join(tracker, "js")
    if not os.path.isdir(upstream):
        print(f"skip: tracker not found at {tracker}, cannot compare vendored engine")
        return 0

    drifted = []
    for name in VENDORED:
        mine = os.path.join(here, name)
        theirs = os.path.join(upstream, name)
        if not os.path.exists(theirs):
            drifted.append(f"{name}: missing from the tracker at {theirs}")
        elif digest(mine) != digest(theirs):
            drifted.append(f"{name}: differs from the tracker copy")

    if drifted:
        print("VENDOR DRIFT — the copied engine no longer matches the tracker:")
        for line in drifted:
            print(f"  - {line}")
        print("\nRe-copy with: cp " + " ".join(
            os.path.join(upstream, n) for n in VENDORED) + f" {here}/")
        print("Do not edit js/vendor/ by hand. The tracker is the source of truth.")
        return 1

    print(f"vendored engine matches {tracker} ({len(VENDORED)} files identical)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
