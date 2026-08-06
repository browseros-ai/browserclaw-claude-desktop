#!/usr/bin/env bash

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
OUT="$BUILD_DIR/browseros-neo-$VERSION.mcpb"

mkdir -p "$BUILD_DIR"
rm -f "$OUT"

# Claude Desktop runs the entry point directly, so runtime dependencies must be bundled.
echo "Installing production dependencies..."
npm ci --omit=dev --no-audit --no-fund --loglevel=warn

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
