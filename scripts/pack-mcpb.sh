#!/usr/bin/env bash
#
# Pack the extension into a .mcpb archive for sideload or directory submission.
#
# Output: build/browseros-<version>.mcpb
#
# The script reads the version from manifest.json so the archive name always
# matches what Claude Desktop displays after install.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required to read version from manifest.json" >&2
  exit 1
fi

VERSION=$(jq -r '.version' manifest.json)
if [ -z "$VERSION" ] || [ "$VERSION" = "null" ]; then
  echo "error: manifest.json has no .version field" >&2
  exit 1
fi

BUILD_DIR="$ROOT_DIR/build"
OUT="$BUILD_DIR/browseros-$VERSION.mcpb"

mkdir -p "$BUILD_DIR"
rm -f "$OUT"

# .mcpb is a ZIP. Include only the files that need to ship.
# Excludes: build artifacts, git metadata, node dev tooling, editor cruft.
zip -r "$OUT" \
  manifest.json \
  package.json \
  README.md \
  LICENSE \
  icon.png \
  server \
  -x "*/.gitkeep" \
  -x "*.DS_Store" \
  >/dev/null

echo "Packed: $OUT"
