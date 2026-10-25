"""The sync loop that keeps the daemon and the stored profiles in step.

The daemon keeps no settings across restarts, so the plugin holds them: a daemon instance the plugin has not
synced yet gets the active profile written to it, and every change seen on a synced instance (from the panel or
the CLI) is folded into the profile it belongs to. The profile in use follows the game the daemon reports in
front. Pad mode follows focus rules the plugin writes to the daemon, which applies them itself on every focus
change: a running game gets its current state (Trackpads, kept in memory while it runs), which starts from its
profile's saved default (Active in the store) and changes with the toggle key or chord and the panel. All daemon
I/O and store changes run under `Sync.lock`.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path

from armada_trackpad_plugin.compat import DaemonIssue, daemon_issue
from armada_trackpad_plugin.focus import (
    MANUAL,
    FocusReport,
    focus_report,
    focus_rules,
    focused_game,
    inherited_sessions,
    with_session,
)
from armada_trackpad_plugin.profiles import (
    FOCUS_MODES,
    GLOBAL,
    Game,
    ProfileLimitError,
    Settings,
    Store,
    active_profile,
    adopted,
    managed_keys,
    profile_active,
    profile_ref,
    profile_settings,
    target_changes,
    unstorable_keys,
    with_game_profile,
    with_profile_active,
    with_profile_settings,
)
from armada_trackpad_plugin.rpc import Connection, PeerError, RpcError
from armada_trackpad_plugin.store import load, save


type Emit = Callable[[str, dict[str, object]], Awaitable[None]]
# Sends an event (name, payload) to the frontend.

CALL_TIMEOUT = 5.0
# Seconds for connecting and for each daemon call; a daemon slower than this is treated as gone.
_MALFORMED = -32603
_NOT_RUNNING = "the trackpad daemon isn't running"
_STALE_EDIT = "profile changed, edit dropped"
_NO_GAME = "no game is running"

logger = logging.getLogger(__name__)


@dataclass
class _Live:
    """The daemon state seen on a connection that finished its handshake.

    Args:
        connection: The open connection.
        status: The daemon's latest status object.
        focus: The focus fields of `status`.
        defaults: The daemon's defaults.
        settings: The daemon's current settings. Every settings object the daemon returns goes through
            `Sync._adopt`, which assigns this field; the follow loop diffs against it, so a change assigned here
            directly would never reach the profile.
    """

    connection: Connection
    status: dict[str, object]
    focus: FocusReport
    defaults: dict[str, object]
    settings: dict[str, object]


async def _call(connection: Connection, method: str, params: Mapping[str, object] | None = None) -> object:
    """Call the daemon, treating a reply slower than `CALL_TIMEOUT` as a lost connection.

    Raises:
        ConnectionError: The connection is closed, or the call timed out (the connection is then closed).
        RpcError: The daemon answered with an error.
        ValueError: The request is over the line cap; nothing was sent.
    """
    try:
        return await asyncio.wait_for(connection.call(method, params), CALL_TIMEOUT)
    except TimeoutError:
        await connection.close()
        raise ConnectionError(f"{method} got no reply within {CALL_TIMEOUT} s") from None


async def _call_for_object(
    connection: Connection, method: str, params: Mapping[str, object] | None = None
) -> dict[str, object]:
    """Call the daemon for a result that must be a JSON object.

    Raises:
        RpcError: The daemon answered with an error or with something that is not an object.
        ConnectionError: As `_call`.
        ValueError: As `_call`.
    """
    result = await _call(connection, method, params)
    if not isinstance(result, dict):
        raise RpcError(_MALFORMED, f"{method} did not return an object")
    return result


async def _next_notification(connection: Connection) -> dict[str, object]:
    """Wait for the next notification on `connection`.

    Raises:
        ConnectionError: The connection closed first.
    """
    getter = asyncio.ensure_future(connection.notifications.get())
    closer = asyncio.ensure_future(connection.closed.wait())
    try:
        await asyncio.wait({getter, closer}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        getter.cancel()
        closer.cancel()
    if getter.done() and not getter.cancelled():
        return getter.result()
    raise ConnectionError("the daemon closed the connection")


def _drained(queue: asyncio.Queue[dict[str, object]], received: dict[str, object]) -> list[dict[str, object]]:
    """Empty `queue` and return `received` followed by every notification that was in it, in arrival order."""
    notifications = [received]
    while not queue.empty():
        notifications.append(queue.get_nowait())
    return notifications


def _focus_of(status: Mapping[str, object]) -> FocusReport:
    """The focus fields of a daemon status.

    Raises:
        RpcError: The fields are missing or malformed.
    """
    try:
        return focus_report(status)
    except ValueError as error:
        raise RpcError(_MALFORMED, str(error)) from None


def _shown(settings: Mapping[str, object]) -> dict[str, object]:
    """`settings` as the panel gets them: without the focus rules, which are the plugin's and never edited there."""
    return {key: value for key, value in settings.items() if key != FOCUS_MODES}


def _changed_keys(before: Settings, after: Settings) -> list[str]:
    """The managed keys of `after` whose value differs from `before`, sorted."""
    return sorted(key for key in managed_keys(after) if key not in before or before[key] != after[key])


def _with_known_daemon_profile(store: Store) -> Store:
    """`store` with `daemon_profile` set to `GLOBAL` when it names a game that has no profile."""
    known = {GLOBAL} | {profile_ref(appid) for appid in store.games}
    return store if store.daemon_profile in known else replace(store, daemon_profile=GLOBAL)


def _reason(error: Exception) -> str:
    """A loggable reason for a lost connection; a daemon error message may quote setting values."""
    return f"daemon error {error.code}" if isinstance(error, RpcError) else str(error) or type(error).__name__


def _command_error(error: Exception) -> str:
    """The message the panel shows for a failed daemon call: the daemon's own message when it answered."""
    return error.message if isinstance(error, RpcError) else str(error) or type(error).__name__


def _appid(game: Game | None) -> int | None:
    """The app id of `game`, or `None` without one."""
    return None if game is None else game.appid


def _sessions_of(sessions: Mapping[int, bool], appid: int | None) -> dict[int, bool]:
    """The current state of `appid` alone, from `sessions`: a game reported as started may already have one."""
    return {appid: sessions[appid]} if appid is not None and appid in sessions else {}


class Sync:
    """Keeps one daemon connection alive and the daemon's settings and the stored profiles in step.

    Every change goes out to the frontend as a `state` event carrying `snapshot()`; a daemon restart seen after
    an earlier instance also emits `daemon_restarted`.

    Args:
        socket_path: The daemon's control socket.
        uid: The only uid the daemon may run as.
        store_path: The profiles file.
        emit: Sends an event to the frontend.
        backoff: The first and the longest wait in seconds between connection attempts; the wait doubles
            after each failed attempt and starts over after a handshake.

    Attributes:
        lock: Held around all daemon I/O and store changes.
        store: The profiles as last read or changed; the file follows it unless a save fails.
        game: The running game Steam reports, or `None`.
        error: The last command or replay error for the user, else `None`.
    """

    def __init__(
        self, socket_path: Path, uid: int, store_path: Path, emit: Emit, backoff: tuple[float, float] = (0.5, 5.0)
    ) -> None:
        self.lock = asyncio.Lock()
        self.store = Store()
        self.game: Game | None = None
        self.error: str | None = None
        self._socket_path = socket_path
        self._uid = uid
        self._store_path = store_path
        self._emit = emit
        self._backoff = backoff
        self._live: _Live | None = None
        self._instance: str | None = None  # the instance this Sync last finished a handshake with
        self._focus_game: int | None = None  # the game the daemon last reported in front, while that game runs
        self._sessions: dict[int, bool] = {}  # the current state of each running game by app id, never saved
        self._inherited: dict[int, bool] = {}  # states a previous backend left in the rules, until a game report
        self._game_reported = False  # Steam has reported the running game (or none) at least once
        self._first_run = True  # no trustworthy store: adopt the daemon's settings instead of replaying
        self._read_only = False  # the file exists but could not be read, so saving would destroy it
        self._load_warning: str | None = None
        self._save_warning: str | None = None
        self._left_out: set[str] = set()  # unstorable daemon keys already logged
        self._issue: DaemonIssue | None = None  # why the plugin leaves the reachable daemon alone

    def snapshot(self) -> dict[str, object]:
        """Return the state the frontend shows.

        Returns:
            The snapshot in the shape of the shared contract: connection, daemon status and settings (without
            `focus_modes`), the profile edits go to, the game, whether a game is in front, the default of the
            profile in use (`default_on`), the current state of the game in use (`session_on`, `None` without a
            running game), any error or store warning, and why a reachable daemon is left alone (`daemon_issue`,
            see `compat.daemon_issue`; `None` while connected or unreachable).
        """
        live = self._live
        current = self._current_profile()
        return {
            "connected": live is not None,
            "status": None if live is None else dict(live.status),
            "settings": None if live is None else _shown(live.settings),
            "defaults": None if live is None else _shown(live.defaults),
            # While connected, the profile whose values the daemon holds: the one an edit tagged with it lands in.
            "profile": current if live is None else self.store.daemon_profile,
            "game": None if self.game is None else {"appid": self.game.appid, "name": self.game.name},
            "game_profile": current != GLOBAL,
            "in_game": live is not None and focused_game(live.focus) is not None,
            "default_on": profile_active(self.store, current),
            "session_on": None if self._game_in_use() is None else self._current_on(),
            "error": self.error,
            "store_warning": self._save_warning or self._load_warning,
            "daemon_issue": None if live is not None else self._issue,
        }

    async def run(self) -> None:
        """Connect to the daemon and keep it in step with the profiles until cancelled.

        A connection that fails, times out or is lost emits a disconnected snapshot and is retried after the
        backoff.
        """
        async with self.lock:
            self._load_store()
        first_wait, longest_wait = self._backoff
        wait = first_wait
        while True:
            if await self._session():
                wait = first_wait
            await asyncio.sleep(wait)
            wait = min(wait * 2, longest_wait)

    def writable(self) -> frozenset[str]:
        """Return the keys a panel edit may name.

        Returns:
            The daemon's managed keys; empty while disconnected.
        """
        live = self._live
        return frozenset() if live is None else managed_keys(live.settings)

    async def set_trackpads(self, on: bool) -> dict[str, object]:
        """Set the current state of the game in use, and switch pad mode to it while a game is in front.

        The game in use is the focused game, else the game last in front, else the running game. The state is kept
        in memory until the game exits and written to the daemon as that game's focus rule; nothing is saved. With
        Steam's UI in front, or the focus unknown, the pads are left as they are: the rule applies when the game
        regains focus, so they never grab the screen the QAM is drawn on. Without a running game, or when the switch
        is refused (pad mode unavailable), nothing changes and `error` says why.

        Args:
            on: Whether the game's pads are on.

        Returns:
            The snapshot, after emitting it.
        """
        return await self._command(lambda live: self._set_trackpads(live, on))

    async def set_default(self, on: bool) -> dict[str, object]:
        """Save the default of the profile in use, which the game in use then follows.

        The game in use drops its current state, so it takes the new default; the focus rules are written again,
        and with a game in front pad mode switches when that changes the game's state. A
        refused switch puts the daemon's reason in `error`; the default stays saved. Without a running game only
        the global default is saved and written.

        Args:
            on: Whether games of this profile start with the pads on.

        Returns:
            The snapshot, after emitting it.
        """
        return await self._command(lambda live: self._set_default(live, on))

    async def set_settings(self, changes: Mapping[str, object], profile: str) -> dict[str, object]:
        """Write settings to the daemon and store the result in the daemon's profile.

        Args:
            changes: The keys to set, already validated against `writable`.
            profile: The profile the panel showed when the edit was made; an edit for another profile than the
                daemon's is dropped with an `error`, so it never lands in the wrong profile.

        Returns:
            The snapshot, after emitting it.
        """
        return await self._command(lambda live: self._edit(live, profile, "set_settings", {"changes": dict(changes)}))

    async def reset_settings(self, keys: Sequence[str] | None, profile: str) -> dict[str, object]:
        """Reset settings to the daemon's defaults and store the result in the daemon's profile.

        Args:
            keys: The keys to reset, already validated against `writable`; `None` resets every managed key.
            profile: As for `set_settings`.

        Returns:
            The snapshot, after emitting it.
        """

        def params(live: _Live) -> dict[str, object]:
            """The request naming `keys`, or every managed key of the daemon's settings."""
            return {"keys": sorted(managed_keys(live.settings)) if keys is None else list(keys)}

        return await self._command(lambda live: self._edit(live, profile, "reset_settings", params(live)))

    async def check(self) -> dict[str, object]:
        """Ask the daemon to check again whether pad mode is available.

        Returns:
            The snapshot, after emitting it; the new status arrives with the daemon's notification.
        """
        return await self._command(self._check)

    async def set_game_profile(self, enabled: bool, initial: Mapping[str, object]) -> dict[str, object]:
        """Enable or disable the running game's profile and apply the profile and focus rules that follow.

        The daemon switches to the profile that now applies and gets the focus rules again. A new profile starts
        from the global settings and Active, with `initial` then written to it. Without a running game, or past the
        game profile limit, nothing changes and `error` says why.

        Args:
            enabled: Whether the game's profile applies.
            initial: The changes a new profile starts with, already validated against `writable`; ignored when
                the game already has a profile.

        Returns:
            The snapshot, after emitting it.
        """
        return await self._command(lambda live: self._enable_game_profile(live, enabled, initial))

    async def set_game(self, game: Game | None) -> dict[str, object]:
        """Record the running game and switch the daemon to the profile that applies.

        The profile in use is that of the game the daemon reports in front. While it reports none (Steam's UI or
        an unknown focus), it stays that of the game last in front, or else of the running game reported here.
        A report of another game, or of none, forgets the game last in front
        unless the daemon still reports it there; after a report of none, Steam's UI in front forgets it too. Each
        report drops the current state of every game but the one now running. Reports that arrive while a command
        holds the lock cost one switch, to the game reported last.
        While disconnected the game is only recorded; the next handshake applies it.

        Args:
            game: The running game, or `None`.

        Returns:
            The snapshot, after emitting it.
        """
        # Recorded before waiting for the lock, so a burst of reports is applied once, as the last one.
        changed = _appid(game) != _appid(self.game)
        if changed:
            self._focus_game = None if self._live is None else focused_game(self._live.focus)
        self.game, self._game_reported = game, True
        async with self.lock:
            if changed:  # under the lock, so a command that held it cannot bring back a state of the ended game
                self._sessions = _sessions_of(self._sessions, _appid(self.game))
            self._take_inherited()
            live = self._live
            if live is not None:
                await self._switch_profile(live)
                await self._write_rules(live)
            await self._publish()
            return self.snapshot()

    def _game_in_use(self) -> int | None:
        """The app id of the game in use: the focused game, else the game last in front, else the running game."""
        return self._focus_game if self._focus_game is not None else _appid(self.game)

    def _current_profile(self) -> str:
        """The reference of the profile in use: that of the game in use, else global."""
        return active_profile(self.store, self._game_in_use())

    def _take_inherited(self) -> None:
        """Make the running game's state from the previous backend's rules its own; drop the rest of them."""
        appid = _appid(self.game)
        if appid is not None and appid in self._inherited and appid not in self._sessions:
            self._sessions = with_session(self._sessions, appid, self._inherited[appid])
        self._inherited = {}

    def _rule_states(self) -> dict[int, bool]:
        """The states the rules carry: the sessions, after the previous backend's states still waiting for a report."""
        waiting = {appid: on for appid, on in self._inherited.items() if appid not in self._sessions}
        return {**waiting, **self._sessions}

    def _current_on(self) -> bool:
        """The current state of the game in use: its session's, else the default of the profile in use."""
        game = self._game_in_use()
        if game is not None and game in self._sessions:
            return self._sessions[game]
        return profile_active(self.store, self._current_profile())

    async def _command(self, action: Callable[[_Live], Awaitable[bool]]) -> dict[str, object]:
        """Run a panel command under the lock: `error` is cleared when `action` succeeds, set when disconnected.

        Args:
            action: Does the command's work on the connected daemon; on failure it sets `error` and returns
                `False`.

        Returns:
            The snapshot, after emitting it.
        """
        async with self.lock:
            live = self._live
            if live is None:
                self.error = _NOT_RUNNING
            elif await action(live):
                self.error = None
            await self._publish()
            return self.snapshot()

    async def _set_trackpads(self, live: _Live, on: bool) -> bool:
        """Switch pad mode when a game is in front, then record the state and the rules."""
        # Resolved before the await: a game report arriving during the round trip must not redirect the state.
        game = self._game_in_use()
        if game is None:
            self.error = _NO_GAME
            return False
        if focused_game(live.focus) is not None and not await self._set_mode(live, on):
            return False
        self._sessions = with_session(self._sessions, game, on)
        return await self._write_rules(live)

    async def _set_default(self, live: _Live, on: bool) -> bool:
        """Save the default and drop the game's state, write the rules, then switch pad mode if the state changed."""
        game, was_on = self._game_in_use(), self._current_on()
        self._update_store(with_profile_active(self.store, self._current_profile(), on))
        self._sessions = {appid: state for appid, state in self._sessions.items() if appid != game}
        if not await self._write_rules(live):
            return False
        now_on = self._current_on()
        if game is None or now_on == was_on or focused_game(live.focus) is None:
            return True  # no game whose pads would switch, or they already match
        return await self._set_mode(live, now_on)

    async def _set_mode(self, live: _Live, on: bool) -> bool:
        """Switch pad mode; a refusal sets `error` and returns `False`."""
        try:
            mode = await _call(live.connection, "set_mode", {"on": on})
        except (OSError, RpcError, ValueError) as error:
            self.error = _command_error(error)
            return False
        if mode in ("on", "off"):
            # The daemon's notification may wait behind the next command, which must already see the new mode.
            live.status = {**live.status, "mode": mode}
        return True

    async def _check(self, live: _Live) -> bool:
        """Ask the daemon to check availability; a failure sets `error` and returns `False`."""
        try:
            await _call(live.connection, "check")
        except (OSError, RpcError, ValueError) as error:
            self.error = _command_error(error)
            return False
        return True

    async def _edit(self, live: _Live, profile: str, method: str, params: Mapping[str, object]) -> bool:
        """Send a settings change for `profile` and adopt the daemon's reply into it.

        Returns:
            Whether the change was sent and adopted; otherwise `error` says why.
        """
        if profile != self.store.daemon_profile:
            self.error = _STALE_EDIT
            return False
        try:
            settings = await _call_for_object(live.connection, method, params)
        except (OSError, RpcError, ValueError) as error:
            self.error = _command_error(error)
            return False
        self._adopt(live, settings)
        return True

    async def _enable_game_profile(self, live: _Live, enabled: bool, initial: Mapping[str, object]) -> bool:
        """Store the running game's profile as enabled or disabled, then switch the profile and write the rules.

        A new profile then gets `initial`, once the daemon holds it.

        Returns:
            Whether all succeeded; otherwise `error` says why.
        """
        if self.game is None:
            self.error = _NO_GAME
            return False
        created = self.game.appid not in self.store.games
        try:
            store = with_game_profile(self.store, self.game, enabled)
        except ProfileLimitError as error:
            self.error = str(error)
            return False
        self._update_store(store)
        switched = await self._switch_profile(live)
        if switched and created and initial:
            ref = profile_ref(self.game.appid)
            switched = await self._edit(live, ref, "set_settings", {"changes": dict(initial)})
        return await self._write_rules(live) and switched

    async def _switch_profile(self, live: _Live) -> bool:
        """Write the profile in use to the daemon, unless the daemon already holds it.

        The file is marked as not synced with any instance before the write and as synced with `ref` after it,
        so a start that finds the daemon changed but the file not (a failed save, a cancelled or killed backend)
        replays the profile in use instead of adopting the daemon's settings into the old one. A file that
        cannot be marked stops the switch. A refused write keeps `daemon_profile` as it was, so edits still land
        in the profile whose values the daemon has; the next game report or focus change tries again. A write
        whose reply is lost may have been applied, so the connection is dropped and the reconnect replays.

        Returns:
            Whether the daemon holds the profile in use afterwards; otherwise `error` says why.
        """
        ref = self._current_profile()
        if ref == self.store.daemon_profile:
            return True
        synced_with = self.store.last_instance
        if not self._mark_unsynced():
            self.error = f"the profile can't change: {self._store_path.name} can't be saved"
            return False
        try:
            replayed = await self._replay(
                live.connection, profile_settings(self.store, ref), live.defaults, live.settings
            )
        except (OSError, RpcError) as error:
            self.error = _command_error(error)
            await live.connection.close()
            return False
        if replayed is None:
            self._update_store(replace(self.store, last_instance=synced_with))  # the daemon's settings are unchanged
            return False
        logger.info("switched to profile %s", ref)
        self._update_store(replace(self.store, daemon_profile=ref, last_instance=self._instance))
        self._adopt(live, replayed)
        return True

    def _mark_unsynced(self) -> bool:
        """Save the store as synced with no instance; a failed save keeps the store as it was.

        Returns:
            Whether the file now says so.
        """
        synced = self.store
        self.store = replace(synced, last_instance=None)
        if self._save():
            return True
        self.store = synced
        return False

    async def _write_rules(self, live: _Live) -> bool:
        """Write the focus rules of the defaults and current states, unless the daemon has them.

        A refused write leaves the daemon's settings as they were and sets `error`. A lost reply closes the
        connection; the next handshake writes the rules again.

        Returns:
            Whether the daemon has the rules afterwards; otherwise `error` says why.
        """
        rules = focus_rules(self.store, self._rule_states())
        if live.settings.get(FOCUS_MODES) == rules:
            return True
        if live.connection.closed.is_set():
            return False  # left to the next handshake, keeping the error that closed the connection
        try:
            settings = await _call_for_object(live.connection, "set_settings", {"changes": {FOCUS_MODES: rules}})
        except (OSError, RpcError, ValueError) as error:
            logger.warning("cannot write the focus rules: %s", _reason(error))
            self.error = f"could not write the focus rules: {_command_error(error)}"
            return False
        logger.info("wrote the focus rules")
        self._adopt(live, settings)
        return True

    async def _apply_focus_mode(self, live: _Live) -> None:
        """Switch pad mode to what the rules give the app in front: on only for a game whose current state is on."""
        on = focused_game(live.focus) is not None and self._current_on()
        if (live.status.get("mode") == "on") != on and (not on or live.status.get("available") is True):
            await self._set_mode(live, on)  # not turned on while unavailable: `_restore_mode` does it when it is

    async def _restore_mode(self, live: _Live) -> None:
        """Turn pad mode on if a game in front is on and the pads are off; a refusal only sets `error`."""
        if live.status.get("mode") != "on" and focused_game(live.focus) is not None and self._current_on():
            await self._set_mode(live, True)

    async def _publish(self) -> None:
        """Emit the current snapshot; call it with `lock` held so snapshots go out in order."""
        await self._emit("state", self.snapshot())

    def _load_store(self) -> None:
        """Read the store file; an unreadable or rejected file counts as a first run.

        An unreadable file also makes the session read-only, so it is never replaced by what was adopted.
        """
        try:
            loaded = load(self._store_path)
        except OSError as error:
            logger.warning("cannot read %s, not saving this session: %s", self._store_path.name, error)
            self._load_warning = f"{self._store_path.name} could not be read ({error}); changes are not saved"
            self._read_only = True
            return
        if loaded.warning is not None:
            logger.warning("%s", loaded.warning)
        self.store = _with_known_daemon_profile(loaded.store)
        self._load_warning = loaded.warning
        self._first_run = not loaded.exists or loaded.warning is not None

    def _update_store(self, store: Store) -> None:
        """Keep `store` and write it to the file when it differs; a failed write only sets the warning."""
        if store != self.store:
            self.store = store
            self._save()

    def _save(self) -> bool:
        """Write `store` to the file, unless the session is read-only; a failed write only sets the warning.

        Returns:
            Whether the file was written.
        """
        if self._read_only:
            return False
        try:
            save(self._store_path, self.store)
        except (OSError, ValueError) as error:
            logger.warning("cannot save %s: %s", self._store_path.name, error)
            self._save_warning = f"{self._store_path.name} could not be saved ({error})"
            return False
        self._save_warning = None
        return True

    async def _session(self) -> bool:
        """Run one connection from connect to loss, then emit a disconnected snapshot.

        Returns:
            Whether the handshake finished.
        """
        handshaken = False
        try:
            connection = await Connection.open(self._socket_path, self._uid, CALL_TIMEOUT)
        except PeerError as error:
            logger.warning("refusing the daemon socket: %s", error)
            self.error = "the trackpad daemon runs as another user"
            self._issue = None
        except OSError as error:
            logger.debug("cannot reach the daemon: %s", error)
            self._issue = None
        else:
            try:
                if await self._compatible(connection):
                    async with self.lock:
                        live = await self._handshake(connection)
                    handshaken = True
                    await self._follow(live)
            except (OSError, RpcError) as error:  # ConnectionError and TimeoutError are OSErrors
                logger.warning("lost the daemon connection: %s", _reason(error))
            finally:
                self._live = None
                await connection.close()
        async with self.lock:
            await self._publish()
        return handshaken

    async def _compatible(self, connection: Connection) -> bool:
        """Read the daemon's status; a daemon the plugin can't work with is recorded and gets nothing synced.

        A status that cannot be read clears the recorded issue, so an earlier one is not shown as current.

        Returns:
            Whether `compat.daemon_issue` finds no issue.

        Raises:
            RpcError: The daemon answered with an error or a malformed result.
            ConnectionError: The connection was lost or a call timed out.
        """
        try:
            status = await _call_for_object(connection, "status")
        except (OSError, RpcError):
            self._issue = None
            raise
        issue = daemon_issue(status)
        if issue is not None and issue != self._issue:
            logger.warning("daemon %s: %s, not syncing", issue["version"], issue["kind"])
        self._issue = issue
        return issue is None

    async def _handshake(self, connection: Connection) -> _Live:
        """Subscribe, read the daemon's state, reconcile it with the store and emit the result.

        The settings go first, then the focus rules. A daemon that kept running also gets the profile of the game
        reported while the plugin was away; a replayed instance also gets the mode the rules give the app in front.
        The first handshake of this backend with a daemon that kept running takes the states it still applies (see
        `_take_previous_states`), so a restarted backend flips nothing.

        Raises:
            RpcError: The daemon answered with an error or a malformed result.
            ConnectionError: The connection was lost or a call timed out.
        """
        status = await _call_for_object(connection, "subscribe")
        instance = status.get("instance")
        if not isinstance(instance, str):
            raise RpcError(_MALFORMED, "the status has no instance id")
        focus = _focus_of(status)
        defaults = await _call_for_object(connection, "get_defaults")
        settings = await _call_for_object(connection, "get_settings")
        self._log_left_out(settings)
        self.error = None
        if (game := focused_game(focus)) is not None:
            self._focus_game = game
        replaying = not self._first_run and instance != self.store.last_instance
        if self._instance is None and not replaying:
            self._take_previous_states(status, settings, game)
        store, settings = await self._reconcile(connection, instance, defaults, settings)
        restarted = self._instance not in (None, instance)
        first_run, self._first_run = self._first_run, False
        self._instance = instance
        self._update_store(store)
        if first_run:
            self._take_live_mode_as_active(status)
        live = self._live = _Live(connection, status, focus, defaults, settings)
        synced = self.store.last_instance == instance  # not after a refused replay, which would only be refused again
        if synced:
            await self._switch_profile(live)  # a game reported while away from a daemon that kept running
        await self._write_rules(live)
        if replaying and synced:
            await self._apply_focus_mode(live)
        if restarted:
            await self._emit("daemon_restarted", {})
        await self._publish()
        return live

    def _take_previous_states(self, status: Mapping[str, object], settings: Settings, game: int | None) -> None:
        """At this backend's first handshake with a daemon that kept running, take the states it still applies.

        A game in front keeps the live mode. The previous backend's states are read from the daemon's rules, which
        it wrote: the running game's becomes its state once Steam has reported it (so a restart under the QAM
        flips nothing when the QAM closes), and the others are dropped then. Until that report the rules keep
        carrying them.
        """
        if game is not None:
            self._sessions = with_session(self._sessions, game, status.get("mode") == "on")
        if not self._first_run:  # a store the daemon was synced with, so its rules are the plugin's
            self._inherited = inherited_sessions(settings.get(FOCUS_MODES), self.store)
            if self._game_reported:
                self._take_inherited()

    def _take_live_mode_as_active(self, status: Mapping[str, object]) -> None:
        """On a first run, make the daemon's live mode the global Active; a first run has no game profiles.

        The store is saved even when nothing changed, so the next start finds a file and does not take the mode
        again.
        """
        on = status.get("mode") == "on"
        logger.info("first run; taking the daemon's mode (%s) as the global default", "on" if on else "off")
        self.store = with_profile_active(self.store, GLOBAL, on)
        self._save()

    async def _reconcile(
        self, connection: Connection, instance: str, defaults: dict[str, object], settings: dict[str, object]
    ) -> tuple[Store, dict[str, object]]:
        """Decide between adopting the daemon's settings and replaying the profile in use to it.

        Returns:
            The store to keep and the daemon's settings afterwards.

        Raises:
            RpcError: The daemon's reply to a replay is not an object.
            ConnectionError: The connection was lost or a call timed out.
        """
        if self._first_run:
            logger.info("connected to daemon instance %s; adopting its settings", instance)
            global_settings = adopted({}, defaults, {}, settings)
            return replace(
                self.store, last_instance=instance, daemon_profile=GLOBAL, global_settings=global_settings
            ), settings
        if instance == self.store.last_instance:
            logger.info("connected to daemon instance %s, synced before", instance)
            ref = self.store.daemon_profile
            whole_state = adopted(profile_settings(self.store, ref), defaults, {}, settings)
            return with_profile_settings(self.store, ref, whole_state), settings
        ref = self._current_profile()
        replayed = await self._replay(connection, profile_settings(self.store, ref), defaults, settings)
        if replayed is None:
            # Not recorded as synced, so the next handshake with this instance replays again instead of
            # adopting the daemon's un-replayed settings over the profile.
            return self.store, settings
        logger.info("connected to daemon instance %s; applied profile %s", instance, ref)
        return replace(self.store, last_instance=instance, daemon_profile=ref), replayed

    async def _replay(
        self, connection: Connection, profile: Settings, defaults: Settings, settings: dict[str, object]
    ) -> dict[str, object] | None:
        """Write a profile's differences to the daemon and return the daemon's settings afterwards.

        A refused write sets `error` and returns `None`; the daemon applies all of a write or none of it, so its
        settings are unchanged. The connection stays up, so a value the daemon no longer accepts cannot keep the
        plugin reconnecting.

        Raises:
            RpcError: The daemon's reply is not an object.
            ConnectionError: The connection was lost or the call timed out.
        """
        changes = target_changes(profile, defaults, settings)
        if not changes:
            return settings
        logger.info("replaying %s", ", ".join(sorted(changes)))
        try:
            result = await _call(connection, "set_settings", {"changes": changes})
        except (RpcError, ValueError) as error:
            logger.warning("the daemon refused the profile: %s", _reason(error))
            self.error = f"could not restore the profile: {error}"
            return None
        if not isinstance(result, dict):
            raise RpcError(_MALFORMED, "set_settings did not return an object")
        return result

    async def _follow(self, live: _Live) -> None:
        """Fold each change the daemon announces into the store until the connection drops.

        Settings changes land in the profile they were synced with, a focus change that moves the profile in use
        switches it, and a mode switched by hand in a game becomes that game's current state.

        Raises:
            ConnectionError: The connection was lost or a call timed out.
            RpcError: The daemon answered with an error or a malformed result.
        """
        connection = live.connection
        while True:
            received = await _next_notification(connection)
            async with self.lock:
                # Drained under the lock, so a burst queued while a command held it costs one read; each status
                # is still looked at, so a toggle followed by a focus change is not lost behind it.
                in_use, toggled = self._current_profile(), False
                was_available = live.status.get("available") is True
                for status in _drained(connection.notifications, received):
                    toggled = self._take_status(live, status) or toggled
                settings = await _call_for_object(connection, "get_settings")
                self._adopt(live, settings)
                if self._current_profile() != in_use:  # a refused switch is retried by the next game report
                    await self._switch_profile(live)
                if toggled:
                    await self._write_rules(live)
                if not was_available and live.status.get("available") is True:
                    await self._restore_mode(live)  # a restarted daemon is `starting` when the replay arrives
                await self._publish()

    def _take_status(self, live: _Live, status: dict[str, object]) -> bool:
        """Take a status the daemon announced; a mode switched by hand in a game becomes its current state.

        Returns:
            Whether a current state was recorded.

        Raises:
            RpcError: The status has malformed focus fields.
        """
        focus = _focus_of(status)
        mode_changed = status.get("mode") != live.status.get("mode")
        live.status, live.focus = status, focus
        game = focused_game(focus)
        if game is None:
            # A game that quit while still in front is no longer in use once Steam reports none running.
            if self._game_reported and self.game is None:
                self._focus_game = None
            return False
        self._focus_game = game
        if focus.mode_by not in MANUAL or not mode_changed:
            return False
        logger.info("pad mode switched by hand in app %s; kept until the game exits", game)
        self._sessions = with_session(self._sessions, game, status.get("mode") == "on")
        return True

    def _adopt(self, live: _Live, settings: dict[str, object]) -> None:
        """Take `settings` as the daemon's and fold what changed into `daemon_profile`.

        Every settings object the daemon returns after the handshake (a `get_settings` result, or the reply of a
        `set_settings` or `reset_settings` command) must go through here; assigning `live.settings` directly
        would hide that change from the profile for good.
        """
        self._log_left_out(settings)
        ref = self.store.daemon_profile
        changed = _changed_keys(live.settings, settings)
        if changed:
            logger.info("the daemon changed %s; adopting into %s", ", ".join(changed), ref)
        profile = adopted(profile_settings(self.store, ref), live.defaults, live.settings, settings)
        live.settings = settings
        self._update_store(with_profile_settings(self.store, ref, profile))

    def _log_left_out(self, settings: Settings) -> None:
        """Log, once per key, the daemon's settings that profiles leave out because the store cannot hold them."""
        new = unstorable_keys(settings) - self._left_out
        if new:
            # repr: a key the store refuses may be long or hold a line break
            names = ", ".join(map(repr, sorted(new)))
            logger.warning("the daemon reports %s in a shape profiles can't hold; left out", names)
            self._left_out |= new
