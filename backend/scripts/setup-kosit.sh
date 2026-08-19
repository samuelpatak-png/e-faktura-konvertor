#!/usr/bin/env bash
# Downloads the official KOSIT validator + Peppol BIS Billing 3.0 Schematron configuration
# (pinned, exact versions below) into backend/tools/kosit/ — gitignored, idempotent, safe to
# re-run. Used by both local dev (npm run validate:fixtures) and CI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_DIR="$SCRIPT_DIR/../tools/kosit"

VALIDATOR_VERSION="1.6.2"
VALIDATOR_URL="https://github.com/itplr-kosit/validator/releases/download/v${VALIDATOR_VERSION}/validator-${VALIDATOR_VERSION}-standalone.jar"

CONFIG_VERSION="3.0.21"
CONFIG_URL="https://github.com/itplr-kosit/validator-configuration-bis/releases/download/release-${CONFIG_VERSION}/validation-configuration-bis-${CONFIG_VERSION}.zip"

mkdir -p "$TOOLS_DIR"
cd "$TOOLS_DIR"

if [ ! -f "validator-${VALIDATOR_VERSION}-standalone.jar" ]; then
  echo "Downloading KOSIT validator ${VALIDATOR_VERSION}..."
  curl -sL -o "validator-${VALIDATOR_VERSION}-standalone.jar" "$VALIDATOR_URL"
fi

if [ ! -d "bis-config-${CONFIG_VERSION}" ]; then
  echo "Downloading Peppol BIS validator configuration ${CONFIG_VERSION}..."
  curl -sL -o "bis-config-${CONFIG_VERSION}.zip" "$CONFIG_URL"
  unzip -q "bis-config-${CONFIG_VERSION}.zip" -d "bis-config-${CONFIG_VERSION}"
  rm "bis-config-${CONFIG_VERSION}.zip"
fi

# Stable symlinks so validate-fixtures.sh doesn't need to know the pinned version numbers.
ln -sf "validator-${VALIDATOR_VERSION}-standalone.jar" validator.jar
ln -sf "bis-config-${CONFIG_VERSION}" bis-config

echo "KOSIT validator ${VALIDATOR_VERSION} + Peppol BIS config ${CONFIG_VERSION} ready in $TOOLS_DIR"
