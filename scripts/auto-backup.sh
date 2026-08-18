#!/usr/bin/env bash
# Runs after every Claude Code turn in this project (Stop hook). Commits and pushes
# whatever changed, no-ops cleanly when there's nothing to commit, and never fails
# loudly if the push itself fails (e.g. no network) — that's just logged.
set -uo pipefail

REPO_DIR="/Users/sawko/Documents/Projekty/e-faktura-konvertor"
LOG_FILE="$REPO_DIR/.auto-backup.log"

cd "$REPO_DIR" || exit 0

git rev-parse --is-inside-work-tree > /dev/null 2>&1 || exit 0

git add -A

if git diff --cached --quiet; then
  exit 0
fi

TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"

if ! git commit -m "Auto-backup: $TIMESTAMP" > /dev/null 2>&1; then
  echo "[$TIMESTAMP] commit failed" >> "$LOG_FILE"
  exit 0
fi

if PUSH_OUTPUT=$(git push 2>&1); then
  echo "[$TIMESTAMP] committed and pushed" >> "$LOG_FILE"
else
  echo "[$TIMESTAMP] committed locally but push failed: $PUSH_OUTPUT" >> "$LOG_FILE"
fi

exit 0
