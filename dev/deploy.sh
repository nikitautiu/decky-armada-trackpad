#!/usr/bin/env bash
# Build the plugin and copy it to a device's plugin dir over SSH; reload it in Decky afterwards.
#
#   dev/deploy.sh HOST
#
# The plugin dir must exist with its files writable by the SSH user, so anything running as that user can change the
# code Decky loads: use this on a development device only.
# --inplace: Decky makes the plugin dir and plugin.json root-owned after the first load, so files are updated in place
# and no new top-level file can be created.
# --checksum without -t: an unchanged file is skipped by content, never touched, so the root-owned plugin.json
# only fails the copy when it really changed (then reinstall it as root).
# --chmod without -p: only files and dirs rsync creates get these modes (less the remote umask); existing ones keep
# theirs, so the root-owned plugin.json is never chmod-ed.
set -euo pipefail

[[ $# -eq 1 ]] || { echo "usage: $0 HOST" >&2; exit 2; }
host="$1"
repo="$(cd "$(dirname "$0")/.." && pwd)"
remote_dir="homebrew/plugins/decky-armada-trackpad"

cd "$repo"
scripts/node.sh pnpm build
rsync -rl --checksum --inplace --delete --chmod=D755,F644 \
  --include=/plugin.json --include=/package.json --include=/main.py \
  --include=/dist/ --include=/dist/index.js \
  --include=/py_modules/ --include='/py_modules/**/' --include='/py_modules/**.py' \
  --exclude='*' \
  ./ "$host:$remote_dir/"
echo "Copied to $host:$remote_dir. Reload it in Decky: Decky's settings > Plugins > the menu (...) of Touch Trackpad > Reload,"
echo "or restart Decky Loader on the device: sudo systemctl restart plugin_loader"
