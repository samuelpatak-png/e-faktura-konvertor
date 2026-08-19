#!/usr/bin/env bash
# Runs every fixture in backend/test/fixtures/*.xml through the official KOSIT validator
# (EN16931 XSD + Peppol BIS Billing 3.0 Schematron) and fails (non-zero exit) if any of them
# is REJECT. This is the "does our XML actually satisfy the official rules" gate — separate
# from and stricter than invoiceValidator.ts's fast, human-readable checks (see README).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/.."
FIXTURES_DIR="$BACKEND_DIR/test/fixtures"

"$SCRIPT_DIR/setup-kosit.sh"

# Resolved to a clean absolute path (no "..") — the validator does a strict string-prefix
# check between the repository path and resolved artifact paths, which breaks if the
# repository path itself still contains an unresolved ".." segment.
TOOLS_DIR="$(cd "$BACKEND_DIR/tools/kosit" && pwd)"

# Prefer `java` on PATH (what CI's actions/setup-java provides); fall back to the common
# Homebrew keg-only location for local macOS dev where openjdk isn't symlinked system-wide.
JAVA_BIN="java"
if ! command -v java >/dev/null 2>&1; then
  if [ -x "/opt/homebrew/opt/openjdk@21/bin/java" ]; then
    JAVA_BIN="/opt/homebrew/opt/openjdk@21/bin/java"
  elif [ -x "/usr/local/opt/openjdk@21/bin/java" ]; then
    JAVA_BIN="/usr/local/opt/openjdk@21/bin/java"
  else
    echo "No Java runtime found. Install one (e.g. 'brew install openjdk@21') or add java to PATH." >&2
    exit 1
  fi
fi

shopt -s nullglob
fixtures=("$FIXTURES_DIR"/*.xml)
shopt -u nullglob

if [ ${#fixtures[@]} -eq 0 ]; then
  echo "No fixture files found in $FIXTURES_DIR" >&2
  exit 1
fi

echo "Validating ${#fixtures[@]} fixture(s) against official Peppol BIS Billing 3.0 rules..."
"$JAVA_BIN" -jar "$TOOLS_DIR/validator.jar" \
  -s "$TOOLS_DIR/bis-config/scenarios.xml" \
  -r "$TOOLS_DIR/bis-config" \
  -p \
  "${fixtures[@]}"
