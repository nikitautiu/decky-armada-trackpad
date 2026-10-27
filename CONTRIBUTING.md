# Contributing

Thanks for helping. This file covers the development setup, the checks a change must pass, the code and test
conventions, the backend's security model and how a release is built. The daemon's control protocol, which the
plugin speaks, is described in armada-trackpad-daemon's
[docs/design.md](https://github.com/nikitautiu/armada-trackpad-daemon/blob/main/docs/design.md), "Control protocol".

## Layout

- `main.py`: the backend entry Decky loads, with the callables the panel invokes. It runs in Decky Loader's bundled Python
  (3.14 in Decky 3.3) with the standard library only: nothing is installed next to it.
- `py_modules/armada_trackpad_plugin/`: the backend. `sync.py` keeps the daemon and the stored profiles in step,
  `compat.py` decides whether a daemon can be used, `rpc.py` is the JSON-RPC client, `store.py` and `profiles.py`
  hold the profiles, `validate.py` checks every callable's arguments, `service.py` runs the few `systemctl` commands.
- `src/`: the Quick Access panel (React, `@decky/ui`, `@decky/api`, bundled by `@decky/rollup`). `src/logic/` holds
  every pure function, each with its tests next to it; `src/panel/` holds the components, which only wire them up.
- `tests/`: the backend tests; `tests/fake_daemon.py` is a fake daemon on a real Unix socket that speaks the control
  protocol.

## Development setup

You need Python 3.12 or newer, [uv](https://docs.astral.sh/uv/) and, for the frontend, either podman or Node 24 with
pnpm.

```sh
uv sync                                  # backend dev environment: pytest, ruff, mypy, pre-commit
uv run pytest
uv run ruff check
uv run ruff format --check               # drop --check to apply it
uv run mypy

scripts/node.sh pnpm install             # frontend dependencies
scripts/node.sh pnpm typecheck
scripts/node.sh pnpm lint                # Biome; scripts/node.sh pnpm format applies its fixes
scripts/node.sh pnpm test                # Vitest
scripts/node.sh pnpm build               # dist/index.js

uv run pre-commit install                # once: checks on each commit, tests on each push
uv run pre-commit run --all-files        # every check on every file, Vale included
```

`scripts/node.sh` runs Node and pnpm in a pinned podman container that mounts only this repository, so dependency
code never sees the rest of your home directory; only `pnpm install`, `add` and `update` get network access. Plain `pnpm install`, `pnpm test` and so on work too, with Node 24
and the pnpm version that `packageManager` in `package.json` names (`corepack enable` provides it).

The pre-commit hooks lint the Markdown with [Vale](https://vale.sh) and the
[ai-tells](https://github.com/tbhb/vale-ai-tells) style. pre-commit installs Vale from PyPI on first use.

CI runs the same checks on every push to `main` and every pull request. All of them must pass.

## Trying it on a device

`dev/deploy.sh HOST` builds the frontend and copies the plugin into `~/homebrew/plugins/decky-armada-trackpad` on
`HOST` over SSH, then prints how to reload it in Decky. The plugin dir must already exist with its files writable by
the SSH user: install a release zip once and change the owner of the files. Keep this to a development device,
because any process of that user can then change the plugin code in that folder.

The trackpads only work in a game: Steam's own UI keeps them off, so test their behaviour with a game in front.

## Code style

### Python

ruff (configured in `pyproject.toml`) and mypy in strict mode enforce most of this.

- Line length 120, double quotes, 4-space indent (`ruff format`).
- Built-in generics (`list[str]`), `X | None` rather than `Optional`, and the `type` statement for aliases.
- Type hints on every function and method, including `-> None`.
- No `Any` except for decoded JSON, with a comment saying why. Avoid `# noqa` and `# type: ignore`; when one is
  unavoidable, justify it in a comment.
- At most 5 arguments per function, cyclomatic complexity at most 10.
- Abstract inputs (`Mapping`, `Sequence`, `Iterable`), concrete return types.
- Google-style docstrings on public modules, classes and functions (`Args:`, `Returns:`, `Raises:`), written for the
  caller. A constant gets a `#` comment on the line after it, not a docstring.

### TypeScript

`pnpm typecheck` runs `tsc` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride` and `noFallthroughCasesInSwitch`. `pnpm lint` runs Biome.

- Line width 120, double quotes, 2-space indent, semicolons.
- No `any`. Backend data arrives as `unknown` and is narrowed by one parser per message type, in `src/logic/wire.ts`.
  A cast (`as`) needs a comment saying why it is sound.
- Discriminated unions rather than optional fields, so wrong states can't be represented.
- `type` for data shapes, `readonly` on data passed between modules, named exports only (the plugin entry's default
  export is the exception Decky requires).
- Components only wire things up. Anything that can be a pure function goes in `src/logic/`, with its tests.
- TSDoc on exported functions, types and components, for the caller.

### Both

- Readable code first: small functions that each do one thing, with inputs as parameters and results as return
  values. Side effects happen at the edges.
- Things that change together live together: colocate by feature, not by kind.
- Delete dead code and unused abstractions.
- Comments say why, not what, and never narrate history. No em dashes in prose.
- User-facing text uses American spelling, as Steam's own UI does. The product is **Touch Trackpad**, its on/off
  switch **Trackpads**, the pads the **left pad** and **right pad**; **Pad** is only a preset's name. Notices call the
  daemon **the trackpad daemon**.

## Tests

Changes are made test first. Write a failing test for the behaviour and make it pass with the simplest code. Then
clean up, running the tests after each step. When a change breaks an existing test, update that test first.

- Mock only at the boundaries: the daemon (use `tests/fake_daemon.py`), the filesystem, Decky's `decky` module, and
  `@decky/api`'s `callable` and events on the frontend. Never mock internal modules.
- Synthetic, predictable data, with fixed values.
- pytest: group tests in classes by concern, name them `test_<what>_when_<condition>`, give every test, class and
  helper a docstring, and use `pytest.mark.parametrize` instead of copies.
- Vitest: test files sit next to the code as `<name>.test.ts`, `describe` blocks by concern, `it.each` instead of
  copies, and names that say what and when (`"shows Custom when no preset matches"`).
- One assertion concept per test. Assert the fields a test is about rather than a whole object that grows over time.
- Check components on a device. DOM snapshots aren't used.

## Security model

The backend is code Decky loads into its own process tree, and any JavaScript running in Steam's UI can call its
callables. So:

- It runs as the session user: `plugin.json` has no `root` flag.
- It talks only to the daemon's Unix socket, and checks with `SO_PEERCRED` that the daemon runs as the same user.
  It doesn't open a network listener.
- It doesn't run a shell. The few commands it runs (`systemctl --user` for the daemon's unit) are fixed argument lists
  with absolute paths, a timeout and a cap on their output.
- Every callable validates its arguments (`validate.py`) before anything reaches the daemon or the profile store.
- It never logs touch coordinates or key streams.

Report a security problem privately, through GitHub's private vulnerability reporting (**Report a vulnerability** on
the repository's [Security tab](https://github.com/nikitautiu/decky-armada-trackpad/security)), not in a public
issue.

## The daemon's protocol

The daemon's `status` reports an integer `protocol`, which changes only when the control protocol changes in an
incompatible way. The plugin needs a daemon whose `protocol` equals `DAEMON_PROTOCOL` (`compat.py`). A daemon without it or with a lower
one has to be updated, and a higher one needs a newer plugin. An additive change to the protocol keeps the number, so the
plugin must tolerate fields it doesn't know. Change `DAEMON_PROTOCOL` only together with the daemon.

## Steam UI workarounds

The panel works around Steam UI, Decky and gamescope behaviour that no API documents. Each workaround is marked in
the code with a `Steam UI workaround:` comment and listed in
[docs/steam-ui-workarounds.md](docs/steam-ui-workarounds.md); add new ones to both, and re-check them after a Steam,
Decky or SteamOS update.

## Commits and pull requests

- Work on a branch and open a pull request against `main`.
- [Conventional commits](https://www.conventionalcommits.org/): `feat(panel): …`, `fix(sync): …`, `docs: …`. Keep
  each commit focused, with its tests, and passing the checks above.
- Note user-visible changes under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).

## Releases

1. Set the version in both `package.json` and `pyproject.toml`, and turn `## [Unreleased]` in `CHANGELOG.md` into
   `## [X.Y.Z] - YYYY-MM-DD`.
2. Tag the commit `vX.Y.Z` and push the tag.

For a `v*` tag CI checks that the tag equals `v` plus both versions and that `CHANGELOG.md` has a section for that
version. It then builds the frontend, runs `dev/package.sh` and attaches the zip, renamed
`decky-armada-trackpad-X.Y.Z.zip`, to a GitHub release with that section as its notes.

`dev/package.sh [OUT_DIR]` builds the same zip locally from the last `pnpm build`, in `out/` by default. The zip
holds one `decky-armada-trackpad/` folder with only what the plugin runs: `plugin.json`, `package.json`, `main.py`,
`dist/index.js`, the backend's `.py` files under `py_modules/`, the `LICENSE` and the `README.md`.
