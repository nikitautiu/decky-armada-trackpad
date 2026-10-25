#!/usr/bin/env bash
# Run a node or pnpm command in a pinned container that sees only this repository.
#
#   scripts/node.sh pnpm install        # the only commands that get network access
#   scripts/node.sh pnpm build|typecheck|lint|test
#
# The container mounts the repo and nothing else, so dependency code never reaches ~/.ssh or the rest of
# $HOME. pnpm itself comes from corepack, cached in .cache/ inside the repo.
set -euo pipefail

IMAGE="docker.io/library/node:24-bookworm-slim@sha256:2dd9a4f758e173b65fee15388f7706af6fb01ef50cf7a2c0538711d67a6981ae"
repo="$(cd "$(dirname "$0")/.." && pwd)"

[[ $# -gt 0 ]] || { echo "usage: $0 pnpm <args>" >&2; exit 2; }

network=none
case "${1} ${2:-}" in
  "pnpm install"|"pnpm add"|"pnpm update") network=slirp4netns ;;
esac

[[ "$1" == pnpm ]] && set -- corepack "$@"

tty=()
[[ -t 0 && -t 1 ]] && tty=(-it)

exec podman run --rm "${tty[@]}" \
  --userns=keep-id \
  --network "$network" \
  --volume "$repo:/work:z" \
  --workdir /work \
  --env HOME=/work/.cache/home \
  --env COREPACK_HOME=/work/.cache/corepack \
  --env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  "$IMAGE" "$@"
