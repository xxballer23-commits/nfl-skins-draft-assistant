#!/bin/sh
# Runs every suite through the macOS-bundled JavaScriptCore. No Node required.
set -e
cd "$(dirname "$0")/.."

JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
if [ ! -x "$JSC" ]; then
  echo "jsc not found at $JSC" >&2
  exit 1
fi

for suite in model simulate assist; do
  "$JSC" -m "test/$suite.test.mjs"
done

python3 tools/verify_divisions.py data/schedule-2026.js
python3 tools/check_vendor.py
