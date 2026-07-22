#!/bin/bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: install-cli.sh <source> <destination>" >&2
  exit 2
fi

SOURCE="$1"
DESTINATION="$2"

if [ ! -x "$SOURCE" ]; then
  echo "ERROR: CLI candidate is not executable: $SOURCE" >&2
  exit 1
fi

if ! SOURCE_VERSION="$("$SOURCE" --version)"; then
  echo "ERROR: CLI candidate failed validation: $SOURCE" >&2
  exit 1
fi

DESTINATION_DIR="$(dirname "$DESTINATION")"
mkdir -p "$DESTINATION_DIR"
TEMP="$(mktemp "$DESTINATION_DIR/.opencode.XXXXXX")"

cleanup() {
  rm -f "$TEMP"
}
trap cleanup EXIT

cp "$SOURCE" "$TEMP"
chmod +x "$TEMP"

if ! TEMP_VERSION="$("$TEMP" --version)"; then
  echo "ERROR: Copied CLI failed validation" >&2
  exit 1
fi

if [ "$TEMP_VERSION" != "$SOURCE_VERSION" ]; then
  echo "ERROR: Copied CLI version does not match the candidate" >&2
  exit 1
fi

mv -f "$TEMP" "$DESTINATION"
trap - EXIT
echo "==> Installed CLI: $TEMP_VERSION"
