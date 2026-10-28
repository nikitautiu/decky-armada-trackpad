"""Decky entry point: keeps armada-trackpad-daemon and the stored profiles in step for the panel.

Decky calls any attribute of `Plugin` by name on behalf of Steam's browser, so the class holds only the
callables and the lifecycle hooks; helpers and state live at module level.
"""

import asyncio
import os
from dataclasses import dataclass
from pathlib import Path

import decky
from armada_trackpad_plugin import service, validate
from armada_trackpad_plugin.sync import Sync


_RESTART_DELAY = 5.0
# Seconds before `Sync.run` is started again after it ended with an exception.


@dataclass
class _Running:
    """The Sync and the task that runs it, once created."""

    sync: Sync | None = None
    task: asyncio.Task[None] | None = None


_running = _Running()


async def _emit(event: str, payload: dict[str, object]) -> None:
    """Send an event to the frontend."""
    await decky.emit(event, payload)


def _sync() -> Sync:
    """Return the Sync, creating it on first use."""
    if _running.sync is None:
        uid = os.getuid()
        _running.sync = Sync(
            Path(f"/run/user/{uid}") / "armada-trackpad.sock",
            uid,
            Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "profiles.json",
            _emit,
        )
    return _running.sync


async def _supervise(sync: Sync) -> None:
    """Run `sync` until cancelled, starting it again after a bug ends it."""
    while True:
        try:
            await sync.run()
        except Exception:  # noqa: BLE001 -- any bug in the sync loop must not leave the plugin dead
            decky.logger.exception("sync loop failed, restarting in %s s", _RESTART_DELAY)
        await asyncio.sleep(_RESTART_DELAY)


def _rejected(sync: Sync, error: validate.InvalidRequest) -> dict[str, object]:
    """Return the current snapshot carrying the reason a request was refused."""
    decky.logger.warning("request rejected: %s", error)
    return {**sync.snapshot(), "error": str(error)}


class Plugin:
    """The callables the panel invokes and the hooks Decky calls."""

    async def _main(self) -> None:
        """Start the sync loop once."""
        if _running.task is None:
            _running.task = asyncio.create_task(_supervise(_sync()))
        decky.logger.info("Touch Trackpad backend started")

    async def _unload(self) -> None:
        """Stop the sync loop and wait for it."""
        task, _running.task = _running.task, None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        decky.logger.info("armada trackpad backend stopped")

    async def get_state(self) -> dict[str, object]:
        """Return the current snapshot.

        Returns:
            The snapshot of the daemon, the profile and the game.
        """
        return _sync().snapshot()

    async def set_trackpads(self, on: object) -> dict[str, object]:
        """Set whether the pads are on in the game in use, until it exits; the pads switch now only in the game.

        Args:
            on: Whether the pads are on; must be a bool.

        Returns:
            The snapshot, with `error` set when no game runs. Never raises: a rejected argument returns the
            snapshot with `error` set.
        """
        sync = _sync()
        try:
            return await sync.set_trackpads(validate.flag(on))
        except validate.InvalidRequest as error:
            return _rejected(sync, error)

    async def set_default(self, on: object) -> dict[str, object]:
        """Save whether games of the profile in use start with the pads on; the game in use follows it.

        Args:
            on: The default; must be a bool.

        Returns:
            The snapshot. Never raises: a rejected argument returns the snapshot with `error` set.
        """
        sync = _sync()
        try:
            return await sync.set_default(validate.flag(on))
        except validate.InvalidRequest as error:
            return _rejected(sync, error)

    async def set_settings(self, changes: object, profile: object) -> dict[str, object]:
        """Change settings in a profile and on the daemon.

        Args:
            changes: Setting keys mapped to new values: at most 64 keys the daemon reports, never
                `panel_mm`, `log_level` or `focus_modes`; each value null, a bool, a number, a string of up to 64
                characters or a list of one to four such strings.
            profile: The profile the edit was made in, `"global"` or `"game:<appid>"`; an edit for another
                profile than the daemon's is dropped.

        Returns:
            The snapshot. Never raises: a rejected argument returns the snapshot with `error` set.
        """
        sync = _sync()
        try:
            return await sync.set_settings(validate.changes(changes, sync.writable()), validate.profile(profile))
        except validate.InvalidRequest as error:
            return _rejected(sync, error)

    async def reset_settings(self, keys: object, profile: object) -> dict[str, object]:
        """Reset settings in a profile to the daemon's defaults.

        Args:
            keys: Up to 64 keys the daemon manages, or null for all of them.
            profile: As for `set_settings`.

        Returns:
            The snapshot. Never raises: a rejected argument returns the snapshot with `error` set.
        """
        sync = _sync()
        try:
            return await sync.reset_settings(validate.keys(keys, sync.writable()), validate.profile(profile))
        except validate.InvalidRequest as error:
            return _rejected(sync, error)

    async def set_game_profile(self, enabled: object, initial: object) -> dict[str, object]:
        """Enable or disable the reported game's own profile: the running game's, else the browsed game's.

        Args:
            enabled: Whether the game's profile applies; must be a bool.
            initial: Settings changes a newly created profile starts with, over the global settings, checked as
                for `set_settings`; ignored when the game already has a profile.

        Returns:
            The snapshot. Never raises: a rejected argument returns the snapshot with `error` set.
        """
        sync = _sync()
        try:
            return await sync.set_game_profile(validate.flag(enabled), validate.changes(initial, sync.writable()))
        except validate.InvalidRequest as error:
            return _rejected(sync, error)

    async def set_current_game(self, appid: object, name: object, running: object) -> dict[str, object]:
        """Tell the backend which game the panel is for, and its profile while the daemon reports no game in front.

        The game is the running game, else the game whose library page is open.

        Args:
            appid: The Steam app id, an int in `1..2**32-1`; 0 or null means no game.
            name: The game's display name, at most 128 characters; ignored without a game.
            running: Whether the game runs, a bool; a game only browsed gets its profile but no Trackpads state.

        Returns:
            The snapshot. Never raises: a rejected argument returns the snapshot with `error` set.
        """
        sync = _sync()
        try:
            return await sync.set_game(validate.game(appid, name), running=validate.flag(running))
        except validate.InvalidRequest as error:
            return _rejected(sync, error)

    async def check(self) -> dict[str, object]:
        """Ask the daemon to check again whether pad mode is available.

        Returns:
            The snapshot; the new status follows as a `state` event.
        """
        return await _sync().check()

    async def start_daemon(self) -> dict[str, object]:
        """Start the daemon's user unit without waiting for it to come up.

        Returns:
            `{"ok": bool, "output": str}`: whether `systemctl` succeeded, and its output, capped at 16 KiB.
        """
        result = await service.start_daemon(os.getuid())
        return {"ok": result.ok, "output": result.output}

    async def read_status(self) -> dict[str, object]:
        """Return the daemon unit's status from the user manager.

        Returns:
            `{"ok": bool, "output": str}`: whether the status could be read (a stopped or failed unit counts as
            read), and the status text, capped at 16 KiB.
        """
        result = await service.read_status(os.getuid())
        return {"ok": result.ok, "output": result.output}

    async def read_unit(self) -> dict[str, object]:
        """Tell whether the daemon is installed, for the panel shown while it can't be reached.

        Returns:
            `{"installed": bool | None}`: whether the daemon's user unit loads and the program it starts exists;
            `None` when that could not be read.
        """
        return {"installed": await service.read_unit(os.getuid())}
