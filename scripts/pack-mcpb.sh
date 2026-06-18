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

# Install production dependencies so node_modules is present in the archive.
# Claude Desktop spawns `node server/wrapper.js` directly and Node's module
# resolution needs node_modules next to the entry point. We do NOT ship dev
# tooling.
echo "Installing production dependencies..."
# --loglevel=warn (not --silent) so resolve / download failures still surface
# their reason. set -euo pipefail at the top would abort on a non-zero exit
# regardless, but the operator needs to see why.
npm install --omit=dev --no-audit --no-fund --loglevel=warn

# .mcpb is a ZIP. Include only what the runtime needs.
# Excludes: build artifacts, git metadata, dev scripts, editor cruft.
zip -r "$OUT" \
  manifest.json \
  package.json \
  package-lock.json \
  README.md \
  LICENSE \
  icon.png \
  server \
  node_modules \
  -x "*/.gitkeep" \
  -x "*.DS_Store" \
  -x "node_modules/.bin/*" \
  -x "node_modules/.cache/*" \
  >/dev/null

SIZE=$(du -h "$OUT" | cut -f1)
echo "Packed: $OUT ($SIZE)"
