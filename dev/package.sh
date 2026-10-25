#!/usr/bin/env bash
# Package the built plugin as the zip Decky installs: decky-armada-trackpad.zip, holding one decky-armada-trackpad/
# folder with only what the plugin runs, its licence and its README.
#
#   dev/package.sh [OUT_DIR]        # default: out/
#
# Packages the frontend as last built (scripts/node.sh pnpm build, or pnpm build in CI). The release workflow runs
# this script too, so the zip's layout has one source.
set -euo pipefail

name="decky-armada-trackpad"
repo="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "${1:-$repo/out}"
out="$(cd "${1:-$repo/out}" && pwd)"

cd "$repo"
[[ -f dist/index.js ]] || { echo "dist/index.js is missing: build the frontend first" >&2; exit 1; }
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

mkdir -p "$stage/$name/dist"
cp LICENSE README.md plugin.json package.json main.py "$stage/$name/"
cp dist/index.js "$stage/$name/dist/"
# Only the backend's sources, never a local run's __pycache__.
find py_modules -name '*.py' -exec cp --parents {} "$stage/$name/" \;

rm -f "$out/$name.zip"
(cd "$stage" && zip -qrX "$out/$name.zip" "$name")
echo "$out/$name.zip"
