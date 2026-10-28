"""Tests for the sync loop that keeps the daemon and the stored profiles in step, against the fake daemon."""

import asyncio
import contextlib
import copy
import errno
import gc
import itertools
import json
import os
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path

import pytest
from armada_trackpad_plugin import sync as sync_module
from armada_trackpad_plugin.compat import DAEMON_PROTOCOL
from armada_trackpad_plugin.focus import STEAM_UI, focus_rules
from armada_trackpad_plugin.profiles import GLOBAL, MAX_GAMES, Game, GameProfile, Store
from armada_trackpad_plugin.store import load, save
from armada_trackpad_plugin.sync import Sync
from fake_daemon import FakeDaemon


OLD_INSTANCE = "0000000000000000"
# An instance id the fake never reports, so a store that names it was written for an earlier daemon.
BALATRO = Game(2379780, "Balatro")
PORTAL = Game(620, "Portal 2")
BALATRO_REF = "game:2379780"

type _Payload = dict[str, object]
type _Predicate = Callable[[_Payload], bool]


def _anything(_payload: _Payload) -> bool:
    """Match every payload."""
    return True


def _connected(snapshot: _Payload) -> bool:
    """Match a snapshot taken while connected."""
    return snapshot["connected"] is True


def _disconnected(snapshot: _Payload) -> bool:
    """Match a snapshot taken while disconnected."""
    return snapshot["connected"] is False


def _settings_of(snapshot: Mapping[str, object]) -> Mapping[str, object]:
    """The `settings` of a connected snapshot."""
    settings = snapshot["settings"]
    assert isinstance(settings, dict)
    return settings


class _Events:
    """Records what `Sync` emits and lets a test wait for the next matching event."""

    def __init__(self) -> None:
        self.recorded: list[tuple[str, _Payload]] = []
        self.times: list[float] = []
        self.matched_at = 0.0  # loop time of the event `next` returned last
        self._cursor = 0
        self._arrived = asyncio.Event()

    async def emit(self, name: str, payload: _Payload) -> None:
        """Record one event; this is the `Emit` callable handed to `Sync`."""
        self.recorded.append((name, payload))
        self.times.append(asyncio.get_running_loop().time())
        self._arrived.set()

    def names(self) -> list[str]:
        """The names of every event recorded so far, in order."""
        return [name for name, _payload in self.recorded]

    async def next(self, name: str, predicate: _Predicate = _anything) -> _Payload:
        """Wait up to 2 s for the next unread event called `name` whose payload matches `predicate`."""
        return await asyncio.wait_for(self._scan(name, predicate), 2)

    async def _scan(self, name: str, predicate: _Predicate) -> _Payload:
        """Consume recorded events in order until one matches, waiting for more as they arrive."""
        while True:
            while self._cursor < len(self.recorded):
                event_name, payload = self.recorded[self._cursor]
                self._cursor += 1
                if event_name == name and predicate(payload):
                    self.matched_at = self.times[self._cursor - 1]
                    return payload
            self._arrived.clear()
            await self._arrived.wait()


@dataclass
class _Rig:
    """A started fake daemon and the paths a `Sync` uses; `start` runs the `Sync` against them."""

    fake: FakeDaemon
    socket_path: Path
    store_path: Path
    events: _Events = field(default_factory=_Events)
    sync: Sync | None = None
    task: asyncio.Task[None] | None = None

    def start(self, uid: int | None = None, backoff: tuple[float, float] = (0.01, 0.05)) -> Sync:
        """Create the `Sync` and run it as a task; the scenario cancels the task at the end."""
        uid = os.getuid() if uid is None else uid
        self.sync = Sync(self.socket_path, uid, self.store_path, self.events.emit, backoff)
        self.task = asyncio.create_task(self.sync.run())
        return self.sync

    def calls(self, method: str) -> list[dict[str, object]]:
        """The params of every `method` call the fake received."""
        return [params for name, params in self.fake.calls if name == method]

    def settings_writes(self) -> list[dict[str, object]]:
        """The params of every `set_settings` call other than a focus rules write."""
        return [params for params in self.calls("set_settings") if not _writes_rules(params)]

    def rules_writes(self) -> list[object]:
        """The rules of every focus rules write, in order."""
        return [_changes(params)["focus_modes"] for params in self.calls("set_settings") if _writes_rules(params)]


def _changes(params: Mapping[str, object]) -> Mapping[str, object]:
    """The `changes` of a `set_settings` call."""
    changes = params["changes"]
    assert isinstance(changes, dict)
    return changes


def _writes_rules(params: Mapping[str, object]) -> bool:
    """Whether a `set_settings` call writes the focus rules."""
    return "focus_modes" in _changes(params)


def _run(tmp_path: Path, body: Callable[[_Rig], Awaitable[None]]) -> None:
    """Run `body` with a rig on `tmp_path`, then cancel the sync and check nothing leaked."""
    problems: list[str] = []

    async def scenario() -> None:
        """Start the fake, run the body, then cancel the `Sync` task and stop the fake."""
        asyncio.get_running_loop().set_exception_handler(lambda _loop, context: problems.append(context["message"]))
        rig = _Rig(FakeDaemon(), tmp_path / "armada-trackpad.sock", tmp_path / "profiles.json")
        await rig.fake.start(rig.socket_path)
        try:
            await body(rig)
        finally:
            if rig.task is not None:
                rig.task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await rig.task
            await rig.fake.stop()

    asyncio.run(asyncio.wait_for(scenario(), timeout=10))
    gc.collect()  # a task dropped while pending reports itself only when collected
    assert problems == []


async def _start_connected(rig: _Rig, store: Store | None = None) -> Sync:
    """Save `store` when given, start the `Sync` and wait for its first connected snapshot."""
    if store is not None:
        save(rig.store_path, store)
    sync = rig.start()
    await rig.events.next("state", _connected)
    return sync


async def _start_disconnected(rig: _Rig, store: Store | None = None) -> Sync:
    """Stop the fake, save `store` when given, start the `Sync` and wait for its first disconnected snapshot."""
    await rig.fake.stop()
    if store is not None:
        save(rig.store_path, store)
    sync = rig.start()
    await rig.events.next("state", _disconnected)
    return sync


def _mode_of(snapshot: Mapping[str, object]) -> object:
    """The pad mode in the status of a connected snapshot."""
    status = snapshot["status"]
    assert isinstance(status, dict)
    return status["mode"]


def _available(snapshot: Mapping[str, object]) -> bool:
    """Whether a connected snapshot's status says pad mode is available."""
    status = snapshot["status"]
    return isinstance(status, dict) and status["available"] is True


def _focused_on(app: int | None) -> _Predicate:
    """Match a connected snapshot whose status has `app` in front."""

    def matches(snapshot: _Payload) -> bool:
        """Whether the snapshot's status reports `app` as the focused app."""
        status = snapshot["status"]
        return isinstance(status, dict) and status.get("focused_app") == app

    return matches


def _with_games(*games: tuple[Game, bool, dict[str, object]]) -> Store:
    """A store for an earlier daemon instance with an empty global profile and the given game profiles."""
    return Store(
        last_instance=OLD_INSTANCE,
        games={game.appid: GameProfile(game.name, enabled, settings) for game, enabled, settings in games},
    )


class TestHandshake:
    """What the first exchange with a daemon does to the daemon and the store."""

    def test_first_run_adopts_live_settings_and_pushes_nothing(self, tmp_path: Path) -> None:
        """Without a store file the live settings become the global profile and nothing is written."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.settings["right.anchor"] = "float"
            rig.start()
            await rig.events.next("state", _connected)
            stored = load(rig.store_path).store
            assert stored.global_settings == {"right.anchor": "float"}
            assert stored.last_instance == rig.fake.instance
            assert stored.daemon_profile == GLOBAL
            assert rig.settings_writes() == []

        _run(tmp_path, body)

    def test_same_instance_adopts_cli_changes_made_while_away(self, tmp_path: Path) -> None:
        """A daemon the plugin already synced keeps its settings; CLI changes land in the profile."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            save(rig.store_path, Store(last_instance=rig.fake.instance, global_settings={"right.anchor": "float"}))
            rig.fake.settings["right.anchor"] = "float"
            rig.fake.settings["size"] = 1.5  # set with the CLI while the plugin was not running
            rig.start()
            await rig.events.next("state", _connected)
            assert load(rig.store_path).store.global_settings == {"right.anchor": "float", "size": 1.5}
            assert rig.settings_writes() == []

        _run(tmp_path, body)

    def test_new_instance_replays_profile_and_keeps_mode_off(self, tmp_path: Path) -> None:
        """A daemon started since the last sync gets the profile's differences in one call; the mode stays off."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            save(rig.store_path, Store(last_instance=OLD_INSTANCE, global_settings={"right.anchor": "float"}))
            rig.start()
            snapshot = await rig.events.next("state", _connected)
            assert rig.settings_writes() == [{"changes": {"right.anchor": "float"}}]
            assert rig.calls("set_mode") == []
            assert rig.fake.mode == "off"
            assert _settings_of(snapshot)["right.anchor"] == "float"
            assert load(rig.store_path).store.last_instance == rig.fake.instance
            assert "daemon_restarted" not in rig.events.names()  # this Sync never saw the earlier instance

        _run(tmp_path, body)

    def test_replay_skips_stored_keys_the_daemon_lacks(self, tmp_path: Path) -> None:
        """A stored key an older daemon build does not know is neither sent nor dropped from the store."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            for key in ("pad_output", "left.pad_output", "right.pad_output"):
                del rig.fake.settings[key], rig.fake.defaults[key]
            stored = {"pad_output": "mouse", "size": 1.5}
            save(rig.store_path, Store(last_instance=OLD_INSTANCE, global_settings=stored))
            rig.start()
            await rig.events.next("state", _connected)
            assert rig.settings_writes() == [{"changes": {"size": 1.5}}]
            assert load(rig.store_path).store.global_settings == stored

        _run(tmp_path, body)

    def test_replay_never_sends_log_level(self, tmp_path: Path) -> None:
        """A debug log level set on the daemon survives a replay and never enters the store."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.settings["log_level"] = "debug"
            save(rig.store_path, Store(last_instance=OLD_INSTANCE, global_settings={"size": 1.5}))
            rig.start()
            await rig.events.next("state", _connected)
            assert rig.settings_writes() == [{"changes": {"size": 1.5}}]
            assert rig.fake.settings["log_level"] == "debug"
            assert "log_level" not in load(rig.store_path).store.global_settings

        _run(tmp_path, body)

    def test_replay_rejected_reports_error_and_stays_connected(self, tmp_path: Path) -> None:
        """A replay the daemon refuses is reported in `error` instead of reconnecting forever."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.fail_next["set_settings"] = (-32602, "size: out of range")
            save(rig.store_path, Store(last_instance=OLD_INSTANCE, global_settings={"size": 1.5}))
            rig.start()
            snapshot = await rig.events.next("state", _connected)
            assert snapshot["error"] is not None
            assert "size: out of range" in str(snapshot["error"])
            assert load(rig.store_path).store.global_settings == {"size": 1.5}
            assert len(rig.calls("subscribe")) == 1

        _run(tmp_path, body)

    def test_refused_replay_is_retried_and_keeps_the_profile(self, tmp_path: Path) -> None:
        """After a refused replay, reconnecting to the same instance replays again instead of adopting over it."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            stored = {"size": 1.5, "right.anchor": "float"}
            rig.fake.fail_next["set_settings"] = (-32602, "size: out of range")
            save(rig.store_path, Store(last_instance=OLD_INSTANCE, global_settings=stored))
            rig.start()
            await rig.events.next("state", lambda snapshot: snapshot["error"] is not None)
            await rig.fake.stop()
            await rig.fake.start(rig.socket_path)  # same instance, still at its defaults
            await rig.events.next("state", lambda snapshot: _connected(snapshot) and snapshot["error"] is None)
            assert len(rig.settings_writes()) == 2
            assert rig.fake.settings["size"] == 1.5
            assert load(rig.store_path).store.global_settings == stored

        _run(tmp_path, body)

    def test_daemon_profile_naming_a_missing_game_falls_back_to_global(self, tmp_path: Path) -> None:
        """A store whose `daemon_profile` names a game without a profile adopts into the global profile."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            game = {2379780: GameProfile("Balatro", enabled=True, settings={})}
            save(rig.store_path, Store(rig.fake.instance, "game:1", {}, game))
            rig.fake.settings["size"] = 1.5
            rig.start()
            await rig.events.next("state", _connected)
            stored = load(rig.store_path).store
            assert stored.daemon_profile == GLOBAL
            assert stored.global_settings == {"size": 1.5}

        _run(tmp_path, body)


class TestStoreProblems:
    """A store file that cannot be read or written never stops the sync."""

    def test_corrupt_store_sets_store_warning(self, tmp_path: Path) -> None:
        """A corrupt file is set aside, reported in the snapshot, and the live settings are kept, not replaced."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.store_path.write_bytes(b"{not json")
            rig.fake.settings["right.anchor"] = "float"
            rig.start()
            snapshot = await rig.events.next("state", _connected)
            assert "profiles.json.bad" in str(snapshot["store_warning"])
            assert rig.settings_writes() == []
            assert load(rig.store_path).store.global_settings == {"right.anchor": "float"}

        _run(tmp_path, body)

    @pytest.mark.skipif(os.geteuid() == 0, reason="root reads a file whatever its mode")
    def test_unreadable_store_is_never_overwritten(self, tmp_path: Path) -> None:
        """A store file that cannot be read keeps its bytes through a handshake and an adopted CLI change."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            save(rig.store_path, Store(last_instance=OLD_INSTANCE, global_settings={"size": 1.5}))
            original = rig.store_path.read_bytes()
            rig.store_path.chmod(0)
            try:
                rig.start()
                snapshot = await rig.events.next("state", _connected)
                assert "not saved" in str(snapshot["store_warning"])
                rig.fake.settings["size"] = 1.7
                await rig.fake.notify()
                await rig.events.next("state", lambda snapshot: _settings_of(snapshot)["size"] == 1.7)
            finally:
                rig.store_path.chmod(0o600)
            assert rig.store_path.read_bytes() == original

        _run(tmp_path, body)

    def test_failed_save_sets_store_warning_and_keeps_following(self, tmp_path: Path) -> None:
        """When the store cannot be written the snapshot says so and later daemon changes still arrive."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.store_path = tmp_path / "missing-directory" / "profiles.json"
            rig.start()
            snapshot = await rig.events.next("state", _connected)
            assert snapshot["store_warning"] is not None
            rig.fake.settings["size"] = 1.5
            await rig.fake.notify()
            await rig.events.next("state", lambda snapshot: _settings_of(snapshot)["size"] == 1.5)

        _run(tmp_path, body)

    def test_daemon_values_the_store_cannot_hold_are_left_out_of_profiles(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Settings of a newer daemon in shapes the store rejects are never stored nor replayed; saves still work."""
        unstorable = {"future.object": {"a": 1}, "future.numbers": [1, 2], "future.text": "x" * 65}

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            # Each differs from its default, so a profile that took it would keep it.
            rig.fake.defaults.update({"future.object": {"a": 0}, "future.numbers": [0], "future.text": ""})
            rig.fake.settings.update(unstorable)
            rig.fake.settings["size"] = 1.5
            rig.start()
            first = await rig.events.next("state", _connected)
            rig.fake.settings["size"] = 1.7
            await rig.fake.notify()
            changed = await rig.events.next("state", lambda snapshot: _settings_of(snapshot)["size"] == 1.7)
            assert (first["store_warning"], changed["store_warning"]) == (None, None)
            assert load(rig.store_path).store.global_settings == {"size": 1.7}
            await rig.fake.stop()
            rig.fake.instance = "bbbbbbbbbbbbbbbb"
            await rig.fake.start(rig.socket_path)
            await rig.events.next("state", _connected)
            assert all(key not in _changes(params) for params in rig.settings_writes() for key in unstorable)

        caplog.set_level("INFO", logger=sync_module.__name__)
        _run(tmp_path, body)
        left_out = [record.getMessage() for record in caplog.records if "left out" in record.getMessage()]
        assert all(sum(key in message for message in left_out) == 1 for key in unstorable)  # once over two handshakes


async def _restart_sync(rig: _Rig) -> Sync:
    """Stop the running `Sync` as a plugin unload does, then start a new one and wait for its handshake."""
    assert rig.task is not None
    rig.task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await rig.task
    rig.events = _Events()  # the new `Sync`'s events only
    sync = rig.start()
    await rig.events.next("state", _connected)
    return sync


class TestStoreFallingBehind:
    """A profile switch the store file could not record never moves the daemon's settings into another profile.

    Each scenario reproduces a store that fell behind: the daemon holds a game's profile while the file still names
    the global one as synced with that same daemon, and the next plugin start meets the same instance.
    """

    @pytest.mark.skipif(os.geteuid() == 0, reason="root writes into a read-only directory")
    def test_switch_is_refused_when_the_store_cannot_be_saved(self, tmp_path: Path) -> None:
        """With the settings directory read-only, a game's profile is not applied and global stays intact."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            settings_dir = tmp_path / "settings"
            settings_dir.mkdir()
            rig.store_path = settings_dir / "profiles.json"
            stored = Store(rig.fake.instance, GLOBAL, {}, {BALATRO.appid: GameProfile("Balatro", True, {"size": 1.5})})
            sync = await _start_connected(rig, stored)
            settings_dir.chmod(0o500)
            try:
                refused = await sync.set_game(BALATRO)
                assert "profiles.json" in str(refused["error"])
                assert (refused["profile"], rig.fake.settings["size"]) == (GLOBAL, 1.0)
            finally:
                settings_dir.chmod(0o700)
            await _restart_sync(rig)
            assert load(rig.store_path).store.global_settings == {}

        _run(tmp_path, body)

    def test_switch_whose_record_fails_to_save_replays_at_the_next_start(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A switch applied by the daemon but not recorded makes the next start replay instead of adopting."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            stored = Store(rig.fake.instance, GLOBAL, {}, {BALATRO.appid: GameProfile("Balatro", True, {"size": 1.5})})
            sync = await _start_connected(rig, stored)

            def save_unless_switched(path: Path, store: Store) -> None:
                """Write the store, failing like a full disk once it names Balatro's profile as the daemon's."""
                if store.daemon_profile == BALATRO_REF:
                    raise OSError(errno.ENOSPC, "No space left on device")
                save(path, store)

            monkeypatch.setattr(sync_module, "save", save_unless_switched)
            await sync.set_game(BALATRO)
            assert rig.fake.settings["size"] == 1.5
            monkeypatch.setattr(sync_module, "save", save)
            await _restart_sync(rig)  # the new `Sync` has no game reported: the global profile is in use
            assert load(rig.store_path).store.global_settings == {}
            assert rig.fake.settings["size"] == 1.0

        _run(tmp_path, body)

    def test_switch_cancelled_by_an_unload_replays_at_the_next_start(self, tmp_path: Path) -> None:
        """An unload while the daemon applies a focused game's profile leaves global intact at the next start."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            stored = Store(rig.fake.instance, GLOBAL, {}, {BALATRO.appid: GameProfile("Balatro", True, {"size": 1.5})})
            await _start_connected(rig, stored)
            rig.fake.silent.add("set_settings")
            await rig.fake.focus(BALATRO.appid)
            while not rig.settings_writes():
                await asyncio.sleep(0.005)
            rig.fake.settings["size"] = 1.5  # the daemon applies the write; the unload comes before its reply
            rig.fake.silent.clear()
            await _restart_sync(rig)
            stored_after = load(rig.store_path).store
            assert stored_after.global_settings == {}
            assert stored_after.daemon_profile == BALATRO_REF

        _run(tmp_path, body)


class TestFollow:
    """How daemon notifications reach the store and the snapshot."""

    def test_snapshot_copies_daemon_state(self, tmp_path: Path) -> None:
        """Changing a returned snapshot leaves the next snapshot untouched."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = rig.start()
            await rig.events.next("state", _connected)
            for name in ("status", "settings", "defaults"):
                part = sync.snapshot()[name]
                assert isinstance(part, dict)
                part["size"] = "changed"
                assert sync.snapshot()[name] != part

        _run(tmp_path, body)

    def test_cli_change_is_adopted_into_active_profile(self, tmp_path: Path) -> None:
        """A setting changed outside the plugin is stored in the active profile and emitted."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = rig.start()
            await rig.events.next("state", _connected)
            rig.fake.settings["size"] = 1.5
            await rig.fake.notify()
            await rig.events.next("state", lambda snapshot: _settings_of(snapshot)["size"] == 1.5)
            assert load(rig.store_path).store.global_settings == {"size": 1.5}
            assert _settings_of(sync.snapshot())["size"] == 1.5

        _run(tmp_path, body)

    def test_notification_burst_costs_one_read_and_keeps_the_last_status(self, tmp_path: Path) -> None:
        """Notifications that arrive together are answered with one `get_settings`; the last status wins."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.settings["focus_modes"] = focus_rules(Store(), {})  # no rules write, whose notification would read
            rig.start()
            await rig.events.next("state", _connected)
            reads = len(rig.calls("get_settings"))
            burst = b""
            for checked_at in (1.0, 2.0, 3.0):  # tells the three statuses apart
                rig.fake.checked_at = checked_at
                notification = {"jsonrpc": "2.0", "method": "state_changed", "params": rig.fake.status()}
                burst += (json.dumps(notification) + "\n").encode()
            # One write, so the client queues all three before the sync wakes up.
            await rig.fake.send_raw(burst)
            snapshot = await rig.events.next("state")
            assert snapshot["status"] == rig.fake.status()
            assert len(rig.calls("get_settings")) == reads + 1

        _run(tmp_path, body)


class TestReconnect:
    """Losing the daemon, getting it back, and noticing a restart."""

    def test_disconnected_snapshot_then_reconnects(self, tmp_path: Path) -> None:
        """A stopped daemon gives a disconnected snapshot; once it is back the sync reconnects."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.start()
            await rig.events.next("state", _connected)
            await rig.fake.stop()
            offline = await rig.events.next("state", _disconnected)
            assert offline["settings"] is None
            await rig.fake.start(rig.socket_path)
            await rig.events.next("state", _connected)

        _run(tmp_path, body)

    def test_restart_toast_only_after_a_previous_instance(self, tmp_path: Path) -> None:
        """`daemon_restarted` is emitted once, for a new instance after one this `Sync` already synced."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            save(rig.store_path, Store(last_instance=OLD_INSTANCE, global_settings={"size": 1.5}))
            rig.start()
            await rig.events.next("state", _connected)
            assert "daemon_restarted" not in rig.events.names()
            await rig.fake.stop()
            rig.fake.instance = "bbbbbbbbbbbbbbbb"
            rig.fake.settings = copy.deepcopy(rig.fake.defaults)
            await rig.fake.start(rig.socket_path)
            await rig.events.next("daemon_restarted")
            snapshot = await rig.events.next("state", _connected)
            assert _settings_of(snapshot)["size"] == 1.5
            assert rig.events.names().count("daemon_restarted") == 1

        _run(tmp_path, body)

    def test_socket_of_another_user_is_refused_with_a_reason(self, tmp_path: Path) -> None:
        """A daemon socket owned by another uid is never used, and the snapshot says why."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.start(uid=os.getuid() + 1)
            snapshot = await rig.events.next("state", _disconnected)
            assert snapshot["error"] == "the trackpad daemon runs as another user"
            assert rig.calls("subscribe") == []

        _run(tmp_path, body)

    def test_reconnect_wait_doubles_and_starts_over_after_a_handshake(self, tmp_path: Path) -> None:
        """Failed attempts wait 0.02, 0.04, 0.08, 0.16 s; after a handshake the next attempt waits 0.02 s again."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            await rig.fake.stop()
            rig.start(backoff=(0.02, 0.32))
            attempts = []
            for _attempt in range(5):
                await rig.events.next("state", _disconnected)
                attempts.append(rig.events.matched_at)
            waits = [later - earlier for earlier, later in itertools.pairwise(attempts)]
            # Lower bounds only: a sleep never ends early, but a slow machine may stretch it.
            assert all(wait >= expected - 0.005 for wait, expected in zip(waits, (0.02, 0.04, 0.08, 0.16), strict=True))
            await rig.fake.start(rig.socket_path)
            await rig.events.next("state", _connected)
            await rig.fake.stop()
            await rig.events.next("state", _disconnected)
            lost_at = rig.events.matched_at
            await rig.fake.start(rig.socket_path)
            await rig.events.next("state", _connected)
            assert rig.events.matched_at - lost_at < 0.16  # without the reset the wait would be 0.32 s

        _run(tmp_path, body)

    def test_call_timeout_counts_as_lost_connection(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """A daemon that never answers is dropped and retried like one that hung up."""
        monkeypatch.setattr(sync_module, "CALL_TIMEOUT", 0.05)

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.silent.add("get_defaults")
            rig.start()
            await rig.events.next("state", _disconnected)
            rig.fake.silent.clear()
            await rig.events.next("state", _connected)

        _run(tmp_path, body)


class TestCommands:
    """What the panel's commands send to the daemon and leave in the snapshot and the store."""

    def test_trackpads_unavailable_keep_mode_and_report_reason(self, tmp_path: Path) -> None:
        """A refused `set_mode` in a game leaves the mode off, records no state and puts the reason in `error`."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.available = False
            rig.fake.reason = "set the controller type to Xbox"
            rig.fake.focused_app = BALATRO.appid
            sync = await _start_connected(rig)
            snapshot = await sync.set_trackpads(True)
            assert (_mode_of(snapshot), snapshot["session_on"]) == ("off", False)
            assert snapshot["error"] == "set the controller type to Xbox"
            assert rig.events.recorded[-1] == ("state", snapshot)
            assert load(rig.store_path).store.global_active is False

        _run(tmp_path, body)

    def test_trackpads_return_the_new_mode(self, tmp_path: Path) -> None:
        """The snapshot returned by `set_trackpads` in a game already shows the mode the daemon switched to."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = BALATRO.appid
            sync = await _start_connected(rig)
            snapshot = await sync.set_trackpads(True)
            assert _mode_of(snapshot) == "on"
            assert rig.fake.mode == "on"

        _run(tmp_path, body)

    def test_stale_profile_edit_is_dropped(self, tmp_path: Path) -> None:
        """An edit tagged with the profile the daemon left is not sent, and the global profile stays as it was."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig, _with_games((BALATRO, True, {"size": 1.5})))
            await sync.set_game(BALATRO)
            sent = len(rig.settings_writes())
            snapshot = await sync.set_settings({"size": 2.0}, GLOBAL)
            assert len(rig.settings_writes()) == sent
            assert snapshot["error"] == "profile changed, edit dropped"
            assert load(rig.store_path).store.global_settings == {}

        _run(tmp_path, body)

    def test_edit_lands_in_the_profile_it_names(self, tmp_path: Path) -> None:
        """An edit for the daemon's profile is sent and its result stored in that profile."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig)
            snapshot = await sync.set_settings({"size": 1.5}, GLOBAL)
            assert rig.settings_writes() == [{"changes": {"size": 1.5}}]
            assert _settings_of(snapshot)["size"] == 1.5
            assert load(rig.store_path).store.global_settings == {"size": 1.5}

        _run(tmp_path, body)

    def test_edit_stores_the_daemons_reply_not_what_was_sent(self, tmp_path: Path) -> None:
        """One edge mode is sent as it is, but the profile stores the four edges the daemon reports."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig)
            await sync.set_settings({"right.edges": "recenter"}, GLOBAL)
            assert rig.settings_writes() == [{"changes": {"right.edges": "recenter"}}]
            assert load(rig.store_path).store.global_settings == {"right.edges": ["recenter"] * 4}

        _run(tmp_path, body)

    def test_reset_of_every_key_sends_only_managed_keys(self, tmp_path: Path) -> None:
        """Resetting with no keys names every managed key, so the log level and the panel size are left alone."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.settings["log_level"] = "debug"
            rig.fake.settings["size"] = 1.5
            sync = await _start_connected(rig)
            await sync.reset_settings(None, GLOBAL)
            (sent,) = rig.calls("reset_settings")
            assert isinstance(sent["keys"], list)
            assert "size" in sent["keys"]
            assert not {"log_level", "panel_mm"} & set(sent["keys"])
            assert rig.fake.settings["log_level"] == "debug"
            assert load(rig.store_path).store.global_settings == {}

        _run(tmp_path, body)

    def test_stale_profile_reset_is_dropped(self, tmp_path: Path) -> None:
        """A reset tagged with the profile the daemon left is not sent."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig)
            snapshot = await sync.reset_settings(["size"], BALATRO_REF)
            assert rig.calls("reset_settings") == []
            assert snapshot["error"] == "profile changed, edit dropped"

        _run(tmp_path, body)

    def test_check_asks_the_daemon_to_check_again(self, tmp_path: Path) -> None:
        """`check` reaches the daemon once and clears no state."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig)
            snapshot = await sync.check()
            assert len(rig.calls("check")) == 1
            assert snapshot["connected"] is True
            assert snapshot["error"] is None

        _run(tmp_path, body)

    def test_error_clears_on_the_next_successful_command(self, tmp_path: Path) -> None:
        """A command that succeeds after a refused one leaves no error behind."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig)
            rig.fake.fail_next["set_settings"] = (-32602, "size: out of range")
            failed = await sync.set_settings({"size": 9.0}, GLOBAL)
            assert failed["error"] == "size: out of range"
            assert (await sync.set_settings({"size": 1.5}, GLOBAL))["error"] is None

        _run(tmp_path, body)

    def test_command_while_disconnected_reports_that_the_daemon_is_not_running(self, tmp_path: Path) -> None:
        """A panel command without a daemon calls nothing and says why."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_disconnected(rig)
            snapshot = await sync.set_default(True)
            assert snapshot["connected"] is False
            assert snapshot["error"] == "the trackpad daemon isn't running"
            assert rig.fake.calls == []

        _run(tmp_path, body)

    def test_writable_is_the_managed_keys_and_empty_when_disconnected(self, tmp_path: Path) -> None:
        """`writable` lists the daemon's keys except the never-stored ones, and nothing without a daemon."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig)
            assert sync.writable() == frozenset(rig.fake.settings) - {"panel_mm", "log_level", "focus_modes"}
            await rig.fake.stop()
            await rig.events.next("state", _disconnected)
            assert sync.writable() == frozenset()

        _run(tmp_path, body)


class TestGameSwitch:
    """How the running game decides the profile the daemon holds."""

    def test_enable_game_profile_copies_global_and_switches(self, tmp_path: Path) -> None:
        """Enabling a game's profile starts it from the global settings and makes it the one edits go to."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig, Store(last_instance=OLD_INSTANCE, global_settings={"size": 1.5}))
            await sync.set_game(BALATRO)
            snapshot = await sync.set_game_profile(True, {})
            stored = load(rig.store_path).store
            assert stored.games[BALATRO.appid] == GameProfile("Balatro", enabled=True, settings={"size": 1.5})
            assert stored.daemon_profile == BALATRO_REF
            assert (snapshot["profile"], snapshot["game_profile"]) == (BALATRO_REF, True)
            await sync.set_settings({"size": 1.7}, BALATRO_REF)
            stored = load(rig.store_path).store
            assert stored.games[BALATRO.appid].settings == {"size": 1.7}
            assert stored.global_settings == {"size": 1.5}

        _run(tmp_path, body)

    def test_new_game_profile_starts_from_the_initial_changes(self, tmp_path: Path) -> None:
        """A game profile created with initial changes holds the global settings with them applied."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig, Store(last_instance=OLD_INSTANCE, global_settings={"size": 1.5}))
            await sync.set_game(BALATRO)
            snapshot = await sync.set_game_profile(True, {"size": 1.0, "side": 0.2})
            stored = load(rig.store_path).store
            assert stored.games[BALATRO.appid].settings == {"side": 0.2}
            assert stored.global_settings == {"size": 1.5}
            assert (_settings_of(snapshot)["size"], _settings_of(snapshot)["side"]) == (1.0, 0.2)

        _run(tmp_path, body)

    def test_existing_game_profile_ignores_the_initial_changes(self, tmp_path: Path) -> None:
        """Enabling a game profile that was kept while disabled brings its own settings back."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig, _with_games((BALATRO, False, {"size": 1.5})))
            await sync.set_game(BALATRO)
            snapshot = await sync.set_game_profile(True, {"size": 1.0})
            assert load(rig.store_path).store.games[BALATRO.appid].settings == {"size": 1.5}
            assert _settings_of(snapshot)["size"] == 1.5

        _run(tmp_path, body)

    def test_disabling_game_profile_switches_back_to_global(self, tmp_path: Path) -> None:
        """Disabling the running game's profile replays the global values and keeps the game's settings."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig, _with_games((BALATRO, True, {"size": 1.5})))
            await sync.set_game(BALATRO)
            snapshot = await sync.set_game_profile(False, {})
            assert _settings_of(snapshot)["size"] == 1.0
            stored = load(rig.store_path).store
            assert stored.daemon_profile == GLOBAL
            assert stored.games[BALATRO.appid] == GameProfile("Balatro", enabled=False, settings={"size": 1.5})

        _run(tmp_path, body)

    def test_game_switch_back_restores_global_values(self, tmp_path: Path) -> None:
        """Entering a game sends its differences; leaving it sends the global values back."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig, _with_games((BALATRO, True, {"size": 1.5})))
            await sync.set_game(BALATRO)
            assert rig.fake.settings["size"] == 1.5
            snapshot = await sync.set_game(None)
            assert rig.settings_writes() == [{"changes": {"size": 1.5}}, {"changes": {"size": 1.0}}]
            assert _settings_of(snapshot)["size"] == 1.0
            stored = load(rig.store_path).store
            assert stored.daemon_profile == GLOBAL
            assert stored.games[BALATRO.appid].settings == {"size": 1.5}

        _run(tmp_path, body)

    def test_switch_with_no_differences_sends_nothing(self, tmp_path: Path) -> None:
        """A game profile equal to the global one switches the profile without a daemon call."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig, _with_games((BALATRO, True, {})))
            snapshot = await sync.set_game(BALATRO)
            assert rig.settings_writes() == []
            assert snapshot["profile"] == BALATRO_REF
            assert load(rig.store_path).store.daemon_profile == BALATRO_REF

        _run(tmp_path, body)

    def test_log_level_survives_game_switches(self, tmp_path: Path) -> None:
        """A debug log level set with the CLI is never sent nor stored while games come and go."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.settings["log_level"] = "debug"
            sync = await _start_connected(rig, _with_games((BALATRO, True, {"size": 1.5})))
            await sync.set_game(BALATRO)
            await sync.set_game(None)
            assert rig.fake.settings["log_level"] == "debug"
            sent = [params["changes"] for params in rig.settings_writes()]
            assert all(isinstance(changes, dict) and "log_level" not in changes for changes in sent)
            stored = load(rig.store_path).store
            assert "log_level" not in stored.global_settings
            assert "log_level" not in stored.games[BALATRO.appid].settings

        _run(tmp_path, body)

    def test_cli_change_during_game_lands_in_game_profile(self, tmp_path: Path) -> None:
        """A key set with the CLI while a game profile is active is stored in that game's profile only."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig, _with_games((BALATRO, True, {"size": 1.5})))
            await sync.set_game(BALATRO)
            rig.fake.settings["right.anchor"] = "float"
            await rig.fake.notify()
            await rig.events.next("state", lambda snapshot: _settings_of(snapshot)["right.anchor"] == "float")
            stored = load(rig.store_path).store
            assert stored.games[BALATRO.appid].settings == {"size": 1.5, "right.anchor": "float"}
            assert stored.global_settings == {}

        _run(tmp_path, body)

    @pytest.mark.parametrize("games", [(), ((BALATRO, False, {"size": 1.5}),)], ids=["no-profile", "disabled"])
    def test_appid_without_enabled_profile_uses_global(
        self, tmp_path: Path, games: tuple[tuple[Game, bool, dict[str, object]], ...]
    ) -> None:
        """A game with no profile, or a disabled one, keeps the global profile on the daemon."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig, _with_games(*games))
            snapshot = await sync.set_game(BALATRO)
            assert rig.settings_writes() == []
            assert (snapshot["profile"], snapshot["game_profile"]) == (GLOBAL, False)
            assert snapshot["game"] == {"appid": BALATRO.appid, "name": "Balatro"}

        _run(tmp_path, body)

    def test_game_switches_queued_behind_the_lock_apply_only_the_latest(self, tmp_path: Path) -> None:
        """Games reported while the daemon is busy cost one switch, to the game reported last."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(
                rig, _with_games((BALATRO, True, {"size": 1.5}), (PORTAL, True, {"size": 1.7}))
            )
            async with sync.lock:
                first = asyncio.create_task(sync.set_game(BALATRO))
                second = asyncio.create_task(sync.set_game(PORTAL))
                await asyncio.sleep(0)  # both record their game, then wait for the lock
            await asyncio.wait_for(asyncio.gather(first, second), 2)
            assert rig.settings_writes() == [{"changes": {"size": 1.7}}]
            assert load(rig.store_path).store.daemon_profile == "game:620"

        _run(tmp_path, body)

    def test_game_set_while_disconnected_is_applied_at_handshake(self, tmp_path: Path) -> None:
        """A game reported before the daemon is up decides the profile the handshake replays."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_disconnected(rig, _with_games((BALATRO, True, {"size": 1.5})))
            offline = await sync.set_game(BALATRO)
            assert (offline["connected"], offline["error"]) == (False, None)
            await rig.fake.start(rig.socket_path)
            await rig.events.next("state", _connected)
            assert rig.settings_writes() == [{"changes": {"size": 1.5}}]
            assert load(rig.store_path).store.daemon_profile == BALATRO_REF

        _run(tmp_path, body)

    def test_game_set_while_disconnected_is_applied_after_reconnecting_to_the_same_instance(
        self, tmp_path: Path
    ) -> None:
        """A game reported while the connection is down is applied once the same daemon is back."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            stored = Store(rig.fake.instance, GLOBAL, {}, {BALATRO.appid: GameProfile("Balatro", True, {"size": 1.5})})
            await _start_connected(rig, stored)
            await rig.fake.stop()
            sync = rig.sync
            assert sync is not None
            await rig.events.next("state", _disconnected)
            await sync.set_game(BALATRO)
            await rig.fake.start(rig.socket_path)  # the same instance: the daemon kept running
            snapshot = await rig.events.next("state", _connected)
            assert rig.settings_writes() == [{"changes": {"size": 1.5}}]
            assert snapshot["profile"] == BALATRO_REF
            assert load(rig.store_path).store.daemon_profile == BALATRO_REF

        _run(tmp_path, body)

    def test_lost_switch_reply_replays_instead_of_adopting_into_the_old_profile(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A switch whose reply never comes leaves the old profile intact; the reconnect replays the game's."""
        monkeypatch.setattr(sync_module, "CALL_TIMEOUT", 0.05)

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig, _with_games((BALATRO, True, {"size": 1.5})))
            rig.fake.silent.add("set_settings")
            rig.fake.settings["size"] = 1.5  # the daemon applies the write; only its reply is lost
            lost = await sync.set_game(BALATRO)
            assert lost["error"] is not None
            rig.fake.silent.clear()
            await rig.events.next("state", _disconnected)
            await rig.events.next("state", _connected)
            stored = load(rig.store_path).store
            assert stored.global_settings == {}
            assert stored.games[BALATRO.appid].settings == {"size": 1.5}
            assert stored.daemon_profile == BALATRO_REF

        _run(tmp_path, body)

    def test_refused_switch_keeps_the_profile_the_daemon_holds(self, tmp_path: Path) -> None:
        """When the daemon refuses a game's profile, the snapshot keeps naming the profile edits still go to."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig, _with_games((BALATRO, True, {"size": 1.5})))
            rig.fake.fail_next["set_settings"] = (-32602, "size: out of range")
            snapshot = await sync.set_game(BALATRO)
            assert (snapshot["profile"], snapshot["game_profile"]) == (GLOBAL, True)
            assert "size: out of range" in str(snapshot["error"])
            stored = load(rig.store_path).store
            assert (stored.daemon_profile, stored.last_instance) == (GLOBAL, rig.fake.instance)
            accepted = await sync.set_settings({"right.anchor": "float"}, GLOBAL)
            assert accepted["error"] is None

        _run(tmp_path, body)

    def test_game_profile_without_a_game_reports_error(self, tmp_path: Path) -> None:
        """Enabling a game profile with no game running changes nothing and says why."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig)
            before = load(rig.store_path).store
            snapshot = await sync.set_game_profile(True, {})
            assert snapshot["error"] == "no game is running"
            assert load(rig.store_path).store == before

        _run(tmp_path, body)

    def test_enabling_past_the_profile_limit_reports_error_and_changes_nothing(self, tmp_path: Path) -> None:
        """A 201st game profile is refused with an error; the store and the daemon stay as they were."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            full: list[tuple[Game, bool, dict[str, object]]] = [
                (Game(appid, f"Game {appid}"), True, {}) for appid in range(1, MAX_GAMES + 1)
            ]
            sync = await _start_connected(rig, _with_games(*full))
            before = load(rig.store_path).store
            await sync.set_game(BALATRO)
            snapshot = await sync.set_game_profile(True, {})
            assert snapshot["error"] == f"at most {MAX_GAMES} game profiles"
            assert load(rig.store_path).store == before
            assert rig.settings_writes() == []

        _run(tmp_path, body)


class TestLibraryPage:
    """A game reported from its library page, with no game running: its profile is in use but it has no state."""

    def test_browsed_game_profile_is_in_use_until_the_page_is_left(self, tmp_path: Path) -> None:
        """Opening a game's page replays its profile; leaving the page replays the global values."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = STEAM_UI
            sync = await _start_connected(rig, _with_games((BALATRO, True, {"size": 1.5})))
            browsing = await sync.set_game(BALATRO, running=False)
            assert (browsing["profile"], browsing["game_profile"], rig.fake.settings["size"]) == (
                BALATRO_REF,
                True,
                1.5,
            )
            assert browsing["game"] == {"appid": BALATRO.appid, "name": "Balatro"}
            left = await sync.set_game(None)
            assert (left["profile"], rig.fake.settings["size"]) == (GLOBAL, 1.0)

        _run(tmp_path, body)

    def test_browsed_game_without_a_profile_keeps_global(self, tmp_path: Path) -> None:
        """A page of a game without a profile sends nothing and offers the game for a new profile."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = STEAM_UI
            sync = await _start_connected(rig)
            snapshot = await sync.set_game(BALATRO, running=False)
            assert rig.settings_writes() == []
            assert (snapshot["profile"], snapshot["game_profile"]) == (GLOBAL, False)
            assert snapshot["game"] == {"appid": BALATRO.appid, "name": "Balatro"}

        _run(tmp_path, body)

    def test_profile_enabled_from_the_page_is_created_and_edited(self, tmp_path: Path) -> None:
        """Enabling the browsed game's profile creates it with the initial changes; edits then land in it."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = STEAM_UI
            sync = await _start_connected(rig, Store(last_instance=OLD_INSTANCE, global_settings={"size": 1.5}))
            await sync.set_game(BALATRO, running=False)
            enabled = await sync.set_game_profile(True, {"side": 0.2})
            assert (enabled["profile"], enabled["error"]) == (BALATRO_REF, None)
            await sync.set_settings({"size": 1.7}, BALATRO_REF)
            stored = load(rig.store_path).store
            assert stored.games[BALATRO.appid] == GameProfile(
                "Balatro", enabled=True, settings={"size": 1.7, "side": 0.2}
            )
            assert stored.global_settings == {"size": 1.5}

        _run(tmp_path, body)

    def test_browsed_game_has_no_trackpads_state(self, tmp_path: Path) -> None:
        """A game that isn't running has no state to set: nothing is sent and `error` says why."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = STEAM_UI
            sync = await _start_connected(rig, _with_games((BALATRO, True, {})))
            browsing = await sync.set_game(BALATRO, running=False)
            rules = rig.fake.settings["focus_modes"]
            snapshot = await sync.set_trackpads(True)
            assert (browsing["session_on"], snapshot["session_on"], snapshot["error"]) == (
                None,
                None,
                "no game is running",
            )
            assert rig.calls("set_mode") == []
            assert rig.fake.settings["focus_modes"] == rules

        _run(tmp_path, body)

    def test_default_set_from_the_page_goes_to_the_browsed_profile(self, tmp_path: Path) -> None:
        """Start with trackpads on, set from the page, is saved in the game's profile and its rule; no switch."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = STEAM_UI
            sync = await _start_connected(rig, _with_games((BALATRO, True, {})))
            await sync.set_game(BALATRO, running=False)
            snapshot = await sync.set_default(True)
            assert (snapshot["default_on"], snapshot["error"]) == (True, None)
            stored = load(rig.store_path).store
            assert (stored.games[BALATRO.appid].active, stored.global_active) == (True, False)
            rules = {"apps": {"2379780": "on", "769": "off_locked"}, "default": "off"}
            assert rig.fake.settings["focus_modes"] == rules
            assert rig.calls("set_mode") == []

        _run(tmp_path, body)

    def test_launch_from_the_page_keeps_the_profile_without_a_second_replay(self, tmp_path: Path) -> None:
        """The browsed game starting keeps its profile on the daemon and gets its state from the default."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = STEAM_UI
            sync = await _start_connected(rig, _with_games((BALATRO, True, {"size": 1.5})))
            await sync.set_game(BALATRO, running=False)
            launched = await sync.set_game(BALATRO)
            assert rig.settings_writes() == [{"changes": {"size": 1.5}}]
            assert (launched["profile"], launched["session_on"]) == (BALATRO_REF, False)

        _run(tmp_path, body)

    def test_quitting_to_the_page_ends_the_games_state(self, tmp_path: Path) -> None:
        """A game that exits back to its page keeps its profile in use, but its state and rule are gone."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = STEAM_UI
            sync = await _start_connected(rig, _with_games((BALATRO, True, {"size": 1.5})))
            await sync.set_game(BALATRO)
            await sync.set_trackpads(True)
            quit_to_page = await sync.set_game(BALATRO, running=False)
            assert (quit_to_page["profile"], quit_to_page["session_on"]) == (BALATRO_REF, None)
            rules = {"apps": {"2379780": "off", "769": "off_locked"}, "default": "off"}
            assert rig.fake.settings["focus_modes"] == rules
            assert rig.settings_writes() == [{"changes": {"size": 1.5}}]

        _run(tmp_path, body)

    def test_game_closing_in_front_is_forgotten_when_steam_reports_its_page(self, tmp_path: Path) -> None:
        """A game in front that quits to its page stops being the game in use once Steam's UI takes focus."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig, _with_games((BALATRO, True, {})))
            await sync.set_game(BALATRO)
            await rig.fake.focus(BALATRO.appid)
            await rig.events.next("state", _focused_on(BALATRO.appid))
            await sync.set_trackpads(True)
            await sync.set_game(BALATRO, running=False)  # the daemon still reports the game in front
            await rig.fake.focus(STEAM_UI)
            snapshot = await rig.events.next("state", _focused_on(STEAM_UI))
            assert snapshot["session_on"] is None

        _run(tmp_path, body)

    def test_page_report_drops_the_previous_backends_states(self, tmp_path: Path) -> None:
        """A first report of a browsed game counts as no game running for the states a previous backend left."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = STEAM_UI
            rig.fake.settings["focus_modes"] = {"apps": {"769": "off_locked", "2379780": "on"}, "default": "off"}
            sync = await _start_connected(rig, Store(last_instance=rig.fake.instance))
            browsing = await sync.set_game(BALATRO, running=False)
            assert browsing["session_on"] is None
            assert rig.fake.settings["focus_modes"] == {"apps": {"769": "off_locked"}, "default": "off"}

        _run(tmp_path, body)


def _state_changed(status: Mapping[str, object]) -> bytes:
    """One `state_changed` line carrying `status`."""
    return (json.dumps({"jsonrpc": "2.0", "method": "state_changed", "params": dict(status)}) + "\n").encode()


class TestFocusRules:
    """The focus rules the plugin writes to the daemon, and the daemon's `focus_modes` kept out of the profiles."""

    def test_handshake_writes_the_rules_after_the_replayed_settings(self, tmp_path: Path) -> None:
        """A new instance gets the profile's settings, then one rules write from the profiles' Active."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            games = {
                BALATRO.appid: GameProfile("Balatro", True, {}, active=False),
                PORTAL.appid: GameProfile("Portal 2", False, {}, active=True),  # disabled: follows the global Active
            }
            store = Store(OLD_INSTANCE, GLOBAL, {"size": 1.5}, games, global_active=True)
            await _start_connected(rig, store)
            rules = {"apps": {"2379780": "off", "769": "off_locked"}, "default": "on"}
            assert [_changes(params) for params in rig.calls("set_settings")] == [{"size": 1.5}, {"focus_modes": rules}]
            assert rig.fake.settings["focus_modes"] == rules

        _run(tmp_path, body)

    def test_rules_the_daemon_already_has_are_not_written_again(self, tmp_path: Path) -> None:
        """A daemon that reports the same rules gets no write."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            store = Store(last_instance=rig.fake.instance, global_active=True)
            rig.fake.settings["focus_modes"] = focus_rules(store, {})
            await _start_connected(rig, store)
            assert rig.calls("set_settings") == []

        _run(tmp_path, body)

    def test_rules_set_outside_the_plugin_never_enter_a_profile(self, tmp_path: Path) -> None:
        """`focus_modes` changed with the CLI is not adopted, so the store stays saveable and holds the change."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig, Store(last_instance=rig.fake.instance))
            rig.fake.settings["focus_modes"] = {"apps": {"1": "on"}, "default": "keep"}
            rig.fake.settings["size"] = 1.5
            await rig.fake.notify()
            await rig.events.next("state", lambda snapshot: _settings_of(snapshot)["size"] == 1.5)
            assert load(rig.store_path).store.global_settings == {"size": 1.5}
            assert sync.snapshot()["store_warning"] is None

        _run(tmp_path, body)

    def test_snapshot_leaves_focus_modes_out(self, tmp_path: Path) -> None:
        """The panel gets the settings and defaults without the rules, which it never edits."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig)
            snapshot = sync.snapshot()
            for part in ("settings", "defaults"):
                shown = snapshot[part]
                assert isinstance(shown, dict)
                assert "focus_modes" not in shown
                assert shown["size"] == 1.0

        _run(tmp_path, body)

    def test_refused_rules_write_reports_error_and_keeps_the_settings(self, tmp_path: Path) -> None:
        """Rules the daemon refuses leave its settings and the profile as they were, and the connection up."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.settings["size"] = 1.5
            rig.fake.fail_next["set_settings"] = (-32602, "focus_modes: too many apps")
            sync = await _start_connected(rig, Store(last_instance=rig.fake.instance, global_settings={"size": 1.5}))
            assert "focus_modes: too many apps" in str(sync.snapshot()["error"])
            assert rig.fake.settings["focus_modes"] == {"apps": {}, "default": "keep"}
            assert rig.fake.settings["size"] == 1.5
            assert load(rig.store_path).store.global_settings == {"size": 1.5}
            assert len(rig.calls("subscribe")) == 1

        _run(tmp_path, body)

    def test_lost_rules_reply_keeps_the_profile_and_the_reconnect_writes_the_rules(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A rules write whose reply never comes loses neither the default nor the settings; the reconnect retries."""
        monkeypatch.setattr(sync_module, "CALL_TIMEOUT", 0.05)

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.settings["size"] = 1.5
            rig.fake.focused_app = STEAM_UI
            sync = await _start_connected(rig, Store(last_instance=rig.fake.instance, global_settings={"size": 1.5}))
            rig.fake.silent.add("set_settings")
            lost = await sync.set_default(True)
            assert lost["error"] is not None
            rig.fake.silent.clear()
            await rig.events.next("state", _disconnected)
            await rig.events.next("state", _connected)
            stored = load(rig.store_path).store
            assert (stored.global_active, stored.global_settings) == (True, {"size": 1.5})
            assert rig.fake.settings["focus_modes"] == {"apps": {"769": "off_locked"}, "default": "on"}

        _run(tmp_path, body)


class TestTrackpads:
    """Trackpads: the current state of the game in use, kept in memory and applied by the rules."""

    def test_trackpads_set_in_a_game_switch_now_and_save_nothing(self, tmp_path: Path) -> None:
        """With the game in front the pads switch at once; its rule follows and its profile's default stays."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = BALATRO.appid
            sync = await _start_connected(rig, _with_games((BALATRO, True, {})))
            snapshot = await sync.set_trackpads(True)
            assert rig.calls("set_mode") == [{"on": True}]
            assert (snapshot["session_on"], snapshot["default_on"]) == (True, False)
            stored = load(rig.store_path).store
            assert (stored.games[BALATRO.appid].active, stored.global_active) == (False, False)
            rules = {"apps": {"2379780": "on", "769": "off_locked"}, "default": "off"}
            assert rig.fake.settings["focus_modes"] == rules

        _run(tmp_path, body)

    @pytest.mark.parametrize("focus", [STEAM_UI, None], ids=["steam-ui", "unknown"])
    def test_trackpads_set_under_the_qam_wait_for_the_game(self, tmp_path: Path, focus: int | None) -> None:
        """Under the QAM the state goes into the game's rule; the pads switch only when the game has focus."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = focus
            sync = await _start_connected(rig)
            await sync.set_game(BALATRO)
            snapshot = await sync.set_trackpads(True)
            assert rig.calls("set_mode") == []
            assert (snapshot["session_on"], _mode_of(snapshot), snapshot["error"]) == (True, "off", None)
            assert load(rig.store_path).store.global_active is False
            rules = {"apps": {"2379780": "on", "769": "off_locked"}, "default": "off"}
            assert rig.fake.settings["focus_modes"] == rules
            await rig.fake.focus(BALATRO.appid)
            await rig.fake.settle()
            assert rig.fake.mode == "on"

        _run(tmp_path, body)

    def test_trackpads_without_a_game_report_error_and_change_nothing(self, tmp_path: Path) -> None:
        """In the library there is no game to switch: nothing is sent and `error` says why."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = STEAM_UI
            sync = await _start_connected(rig)
            rules = rig.fake.settings["focus_modes"]
            snapshot = await sync.set_trackpads(True)
            assert (snapshot["session_on"], snapshot["error"]) == (None, "no game is running")
            assert rig.calls("set_mode") == []
            assert rig.fake.settings["focus_modes"] == rules

        _run(tmp_path, body)

    def test_state_ends_with_the_game_and_the_next_launch_starts_from_the_default(self, tmp_path: Path) -> None:
        """Once the game exits its rule is gone; launched again it gets its profile's default."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = STEAM_UI
            sync = await _start_connected(rig, Store(last_instance=OLD_INSTANCE, global_active=True))
            await sync.set_game(BALATRO)
            await sync.set_trackpads(False)
            ended = await sync.set_game(None)
            assert ended["session_on"] is None
            assert rig.fake.settings["focus_modes"] == {"apps": {"769": "off_locked"}, "default": "on"}
            relaunched = await sync.set_game(BALATRO)
            assert relaunched["session_on"] is True

        _run(tmp_path, body)

    def test_game_ending_during_a_trackpads_switch_leaves_no_state_for_it(self, tmp_path: Path) -> None:
        """A game exit reported while `set_mode` is answered drops the state the switch then records, and its rule."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = BALATRO.appid
            sync = await _start_connected(rig, Store(last_instance=OLD_INSTANCE))  # a replay, which takes no live mode
            await sync.set_game(BALATRO)
            rig.fake.held.add("set_mode")
            switching = asyncio.create_task(sync.set_trackpads(True))
            await rig.fake.wait_for_call("set_mode")
            ending = asyncio.create_task(sync.set_game(None))
            await asyncio.sleep(0)  # the exit is recorded, then waits for the lock the switch holds
            rig.fake.release()
            await asyncio.wait_for(asyncio.gather(switching, ending), 2)
            assert rig.fake.settings["focus_modes"] == {"apps": {"769": "off_locked"}, "default": "off"}
            assert sync.snapshot()["session_on"] is False  # the default, not the state the switch set

        _run(tmp_path, body)


class TestDefault:
    """Start with trackpads on: the default saved in the profile in use."""

    def test_default_set_in_a_game_is_saved_and_the_game_follows_it(self, tmp_path: Path) -> None:
        """The game's state is dropped for the new default; the pads switch only when that changes the state."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = BALATRO.appid
            sync = await _start_connected(rig, _with_games((BALATRO, True, {})))
            await sync.set_trackpads(True)
            kept = await sync.set_default(True)
            assert (kept["default_on"], kept["session_on"]) == (True, True)
            switched = await sync.set_default(False)
            assert (switched["default_on"], switched["session_on"], rig.fake.mode) == (False, False, "off")
            assert rig.calls("set_mode") == [{"on": True}, {"on": False}]
            stored = load(rig.store_path).store
            assert (stored.games[BALATRO.appid].active, stored.global_active) == (False, False)
            rules = {"apps": {"2379780": "off", "769": "off_locked"}, "default": "off"}
            assert rig.fake.settings["focus_modes"] == rules

        _run(tmp_path, body)

    @pytest.mark.parametrize("game", [None, BALATRO], ids=["library", "qam-over-a-game"])
    def test_default_set_in_steam_ui_is_saved_and_leaves_the_pads(self, tmp_path: Path, game: Game | None) -> None:
        """With Steam's UI in front, the global default is saved and written as a rule; the mode is left alone."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = STEAM_UI
            sync = await _start_connected(rig)
            await sync.set_game(game)
            snapshot = await sync.set_default(True)
            assert rig.calls("set_mode") == []
            assert (snapshot["default_on"], snapshot["error"]) == (True, None)
            assert load(rig.store_path).store.global_active is True
            assert rig.fake.settings["focus_modes"] == {"apps": {"769": "off_locked"}, "default": "on"}

        _run(tmp_path, body)

    def test_refused_switch_keeps_the_default_saved(self, tmp_path: Path) -> None:
        """A default the pads can't take yet is saved anyway, with the daemon's reason in `error`."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.available, rig.fake.reason = False, "set the controller type to Xbox"
            rig.fake.focused_app = BALATRO.appid
            sync = await _start_connected(rig)
            snapshot = await sync.set_default(True)
            assert (snapshot["default_on"], snapshot["error"]) == (True, "set the controller type to Xbox")
            assert load(rig.store_path).store.global_active is True
            assert rig.fake.mode == "off"

        _run(tmp_path, body)

    def test_snapshot_default_is_the_default_of_the_profile_in_use(self, tmp_path: Path) -> None:
        """The global default without a game, the game's own once its profile applies; no state without a game."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            games = {BALATRO.appid: GameProfile("Balatro", True, {}, active=False)}
            sync = await _start_connected(rig, Store(OLD_INSTANCE, GLOBAL, {}, games, global_active=True))
            library = sync.snapshot()
            assert (library["default_on"], library["session_on"]) == (True, None)
            in_game = await sync.set_game(BALATRO)
            assert (in_game["profile"], in_game["default_on"], in_game["session_on"]) == (BALATRO_REF, False, False)

        _run(tmp_path, body)

    def test_game_profile_copies_global_default_and_gets_a_rule_while_enabled(self, tmp_path: Path) -> None:
        """A new game profile starts with the global default and has its own rule until it is disabled."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig, Store(last_instance=OLD_INSTANCE, global_active=True))
            await sync.set_game(BALATRO)
            await sync.set_game_profile(True, {})
            assert load(rig.store_path).store.games[BALATRO.appid].active is True
            rules = {"apps": {"2379780": "on", "769": "off_locked"}, "default": "on"}
            assert rig.fake.settings["focus_modes"] == rules
            await sync.set_game_profile(False, {})
            assert rig.fake.settings["focus_modes"] == {"apps": {"769": "off_locked"}, "default": "on"}

        _run(tmp_path, body)


class TestDaemonProtocol:
    """The plugin syncs only with a daemon that speaks its protocol, whatever the daemon's version."""

    def test_matching_protocol_connects_with_no_issue(self, tmp_path: Path) -> None:
        """A daemon of this protocol is synced, and the snapshot reports no issue with it."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig)
            assert sync.snapshot()["daemon_issue"] is None

        _run(tmp_path, body)

    @pytest.mark.parametrize(
        ("protocol", "kind"), [(None, "update_daemon"), (0, "update_daemon"), (DAEMON_PROTOCOL + 1, "update_plugin")]
    )
    def test_other_protocol_is_never_synced(self, tmp_path: Path, protocol: int | None, kind: str) -> None:
        """A daemon without this protocol gets no settings and no rules; the snapshot says which side to update."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.protocol = protocol
            save(rig.store_path, Store(last_instance=OLD_INSTANCE, global_settings={"size": 1.5}))
            rig.start()
            snapshot = await rig.events.next("state", lambda payload: payload["daemon_issue"] is not None)
            assert (snapshot["connected"], snapshot["daemon_issue"]) == (
                False,
                {"kind": kind, "version": rig.fake.version},
            )
            assert rig.calls("set_settings") == []
            assert rig.fake.settings["size"] == 1.0

        _run(tmp_path, body)

    def test_unsupported_device_is_never_synced(self, tmp_path: Path) -> None:
        """A daemon on hardware without a device profile gets no handshake; the snapshot carries its reason."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.device, rig.fake.available, rig.fake.reason = "", False, "device not supported: AYN Odin 2"
            rig.start()
            snapshot = await rig.events.next("state", lambda payload: payload["daemon_issue"] is not None)
            assert snapshot["daemon_issue"] == {
                "kind": "unsupported_device",
                "version": rig.fake.version,
                "reason": "device not supported: AYN Odin 2",
            }
            assert rig.calls("subscribe") == []

        _run(tmp_path, body)

    def test_updated_daemon_is_synced_on_the_next_try(self, tmp_path: Path) -> None:
        """Once the daemon speaks this protocol, the next connection attempt syncs as usual."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.protocol = None
            save(rig.store_path, Store(last_instance=OLD_INSTANCE, global_settings={"size": 1.5}))
            rig.start()
            await rig.events.next("state", lambda payload: payload["daemon_issue"] is not None)
            rig.fake.protocol = DAEMON_PROTOCOL
            snapshot = await rig.events.next("state", _connected)
            assert snapshot["daemon_issue"] is None
            assert rig.fake.settings["size"] == 1.5

        _run(tmp_path, body)

    def test_unreachable_daemon_clears_an_earlier_issue(self, tmp_path: Path) -> None:
        """An incompatible daemon that goes away reads as unreachable, not as the old issue."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.protocol = None
            rig.start()
            await rig.events.next("state", lambda payload: payload["daemon_issue"] is not None)
            await rig.fake.stop()
            snapshot = await rig.events.next("state", lambda payload: payload["daemon_issue"] is None)
            assert snapshot["connected"] is False

        _run(tmp_path, body)

    def test_failed_check_clears_an_earlier_issue(self, tmp_path: Path) -> None:
        """A `status` that fails on the next attempt leaves the daemon unknown, not the old issue."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.protocol = None
            rig.start()
            await rig.events.next("state", lambda payload: payload["daemon_issue"] is not None)
            rig.fake.fail_next["status"] = (-32603, "internal error")
            snapshot = await rig.events.next("state", lambda payload: payload["daemon_issue"] is None)
            assert snapshot["connected"] is False

        _run(tmp_path, body)


class TestFocusFollowing:
    """The profile in use follows the game the daemon reports in front."""

    def test_focus_on_a_game_switches_to_its_profile(self, tmp_path: Path) -> None:
        """A game gaining focus has its own profile replayed, with no game report needed."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            await _start_connected(rig, _with_games((BALATRO, True, {"size": 1.5})))
            await rig.fake.focus(BALATRO.appid)
            snapshot = await rig.events.next("state", _focused_on(BALATRO.appid))
            assert (snapshot["profile"], snapshot["in_game"], rig.fake.settings["size"]) == (BALATRO_REF, True, 1.5)

        _run(tmp_path, body)

    def test_steam_ui_keeps_the_games_profile(self, tmp_path: Path) -> None:
        """Opening the QAM over a game leaves its profile in use, so the QAM edits the game's profile."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            await _start_connected(rig, _with_games((BALATRO, True, {"size": 1.5})))
            await rig.fake.focus(BALATRO.appid)
            await rig.events.next("state", _focused_on(BALATRO.appid))
            writes = len(rig.settings_writes())
            await rig.fake.focus(STEAM_UI)
            snapshot = await rig.events.next("state", _focused_on(STEAM_UI))
            assert (snapshot["profile"], snapshot["in_game"]) == (BALATRO_REF, False)
            assert len(rig.settings_writes()) == writes

        _run(tmp_path, body)

    def test_game_without_enabled_profile_uses_global(self, tmp_path: Path) -> None:
        """Focus moving to a game with no profile of its own brings the global values back."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            await _start_connected(rig, _with_games((BALATRO, True, {"size": 1.5})))
            await rig.fake.focus(BALATRO.appid)
            await rig.events.next("state", _focused_on(BALATRO.appid))
            await rig.fake.focus(PORTAL.appid)
            snapshot = await rig.events.next("state", _focused_on(PORTAL.appid))
            assert (snapshot["profile"], rig.fake.settings["size"]) == (GLOBAL, 1.0)

        _run(tmp_path, body)

    def test_game_ending_returns_to_global(self, tmp_path: Path) -> None:
        """Once no game runs, Steam's UI in front uses the global profile again."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig, _with_games((BALATRO, True, {"size": 1.5})))
            await sync.set_game(BALATRO)
            await rig.fake.focus(BALATRO.appid)
            await rig.fake.focus(STEAM_UI)
            await rig.events.next("state", _focused_on(STEAM_UI))
            snapshot = await sync.set_game(None)
            assert (snapshot["profile"], rig.fake.settings["size"]) == (GLOBAL, 1.0)

        _run(tmp_path, body)

    def test_game_quitting_in_front_returns_to_global_once_steam_has_focus(self, tmp_path: Path) -> None:
        """A game reported ended while still in front is forgotten once Steam's UI has focus: no Trackpads switch."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            sync = await _start_connected(rig, _with_games((BALATRO, True, {"size": 1.5})))
            await sync.set_game(BALATRO)
            await rig.fake.focus(BALATRO.appid)
            await rig.events.next("state", _focused_on(BALATRO.appid))
            await sync.set_game(None)
            await rig.fake.focus(STEAM_UI)
            snapshot = await rig.events.next("state", _focused_on(STEAM_UI))
            assert (snapshot["profile"], snapshot["session_on"], rig.fake.settings["size"]) == (GLOBAL, None, 1.0)

        _run(tmp_path, body)

    def test_first_focus_after_start_picks_the_games_profile_and_mode(self, tmp_path: Path) -> None:
        """Started in Steam's UI, the first focus on a game applies its profile and, once settled, its Active."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = STEAM_UI
            games = {BALATRO.appid: GameProfile("Balatro", True, {"size": 1.5}, active=True)}
            await _start_connected(rig, Store(OLD_INSTANCE, GLOBAL, {}, games))
            assert rig.fake.mode == "off"
            await rig.fake.focus(BALATRO.appid)
            snapshot = await rig.events.next("state", _focused_on(BALATRO.appid))
            await rig.fake.settle()
            assert (snapshot["profile"], rig.fake.settings["size"], rig.fake.mode) == (BALATRO_REF, 1.5, "on")

        _run(tmp_path, body)

    def test_automatic_changes_leave_an_earlier_error(self, tmp_path: Path) -> None:
        """Game reports and focus changes keep an error for the panel to show."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.available, rig.fake.reason = False, "set the controller type to Xbox"
            rig.fake.focused_app = BALATRO.appid
            sync = await _start_connected(rig)
            await sync.set_trackpads(True)
            await sync.set_game(BALATRO)
            await rig.fake.focus(STEAM_UI)
            snapshot = await rig.events.next("state", _focused_on(STEAM_UI))
            assert snapshot["error"] == "set the controller type to Xbox"

        _run(tmp_path, body)


class TestManualToggles:
    """The toggle key and chord in a game change its current state, never a saved default."""

    @pytest.mark.parametrize("source", ["key", "chord"])
    def test_toggle_in_a_game_keeps_the_state_for_the_session(self, tmp_path: Path, source: str) -> None:
        """A game's toggled mode goes into its rule, so closing the QAM returns to it; its profile stays as saved."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = BALATRO.appid
            await _start_connected(rig, _with_games((BALATRO, True, {})))
            await rig.fake.press(source)
            snapshot = await rig.events.next("state", lambda snapshot: snapshot["session_on"] is True)
            assert snapshot["default_on"] is False
            stored = load(rig.store_path).store
            assert (stored.games[BALATRO.appid].active, stored.global_active) == (False, False)
            rules = {"apps": {"2379780": "on", "769": "off_locked"}, "default": "off"}
            assert rig.fake.settings["focus_modes"] == rules

        _run(tmp_path, body)

    def test_toggle_in_a_game_without_profile_gets_it_a_rule(self, tmp_path: Path) -> None:
        """A game on the global profile gets its own rule for the session; the global default stays."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = PORTAL.appid
            await _start_connected(rig)
            await rig.fake.press("key")
            await rig.events.next("state", lambda snapshot: snapshot["session_on"] is True)
            assert load(rig.store_path).store.global_active is False
            assert rig.fake.settings["focus_modes"] == {"apps": {"620": "on", "769": "off_locked"}, "default": "off"}

        _run(tmp_path, body)

    def test_toggle_reported_in_steam_ui_records_nothing(self, tmp_path: Path) -> None:
        """A manual mode change with Steam's UI in front belongs to no game."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = STEAM_UI
            await _start_connected(rig)
            rig.fake.mode, rig.fake.mode_by = "on", "key"
            await rig.fake.notify()
            snapshot = await rig.events.next("state", lambda snapshot: _mode_of(snapshot) == "on")
            assert snapshot["session_on"] is None
            assert rig.fake.settings["focus_modes"] == {"apps": {"769": "off_locked"}, "default": "off"}

        _run(tmp_path, body)

    @pytest.mark.parametrize("mode_by", ["client", "focus", "start", "unavailable"])
    def test_mode_changes_not_made_by_hand_leave_the_state(self, tmp_path: Path, mode_by: str) -> None:
        """A rule, a call, a start or lost pads change the mode in a game without recording a state."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = BALATRO.appid
            await _start_connected(rig, Store(last_instance=OLD_INSTANCE))  # a replay, which takes no live mode
            rig.fake.mode, rig.fake.mode_by = "on", mode_by
            await rig.fake.notify()
            snapshot = await rig.events.next("state", lambda snapshot: _mode_of(snapshot) == "on")
            assert snapshot["session_on"] is False
            assert rig.fake.settings["focus_modes"] == {"apps": {"769": "off_locked"}, "default": "off"}

        _run(tmp_path, body)

    def test_toggle_followed_by_a_focus_change_in_one_burst_still_counts(self, tmp_path: Path) -> None:
        """A key toggle read together with the QAM opening is not lost behind the later status."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = BALATRO.appid
            await _start_connected(rig)
            rig.fake.mode, rig.fake.mode_by = "on", "key"
            toggled = rig.fake.status()
            rig.fake.focused_app, rig.fake.mode, rig.fake.mode_by = STEAM_UI, "off", "focus"
            await rig.fake.send_raw(_state_changed(toggled) + _state_changed(rig.fake.status()))
            snapshot = await rig.events.next("state", _focused_on(STEAM_UI))
            assert snapshot["session_on"] is True
            assert load(rig.store_path).store.global_active is False

        _run(tmp_path, body)


class TestBackendRestartMidGame:
    """A backend that starts with a game in front keeps the pads as they are."""

    def test_first_handshake_takes_the_live_mode_as_the_games_state(self, tmp_path: Path) -> None:
        """The live mode becomes the game's state and rule, and the game's report that follows keeps it."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app, rig.fake.mode = BALATRO.appid, "on"
            sync = await _start_connected(rig, Store(last_instance=rig.fake.instance))
            assert sync.snapshot()["session_on"] is True
            reported = await sync.set_game(BALATRO)
            assert (reported["session_on"], reported["default_on"]) == (True, False)
            assert rig.calls("set_mode") == []
            rules = {"apps": {"2379780": "on", "769": "off_locked"}, "default": "off"}
            assert rig.fake.settings["focus_modes"] == rules

        _run(tmp_path, body)

    @staticmethod
    def _previous_rules(rig: _Rig, balatro: str) -> dict[str, object]:
        """Give the fake the rules a previous backend wrote with Balatro's state `balatro`, Steam's UI in front."""
        rules: dict[str, object] = {"apps": {"769": "off_locked", "2379780": balatro}, "default": "off"}
        rig.fake.focused_app, rig.fake.settings["focus_modes"] = STEAM_UI, copy.deepcopy(rules)
        return rules

    def test_restart_under_the_qam_takes_the_games_state_from_the_rules_once_it_is_reported(
        self, tmp_path: Path
    ) -> None:
        """Balatro's rule from the previous backend stays on the daemon and becomes its state when it is reported."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rules = self._previous_rules(rig, "on")
            sync = await _start_connected(rig, Store(last_instance=rig.fake.instance))
            assert rig.fake.settings["focus_modes"] == rules
            reported = await sync.set_game(BALATRO)
            assert (reported["session_on"], reported["default_on"]) == (True, False)
            assert rig.fake.settings["focus_modes"] == rules
            await rig.fake.focus(BALATRO.appid)
            await rig.fake.settle()
            assert rig.fake.mode == "on"

        _run(tmp_path, body)

    def test_restart_under_the_qam_takes_the_state_of_a_game_reported_before_the_handshake(
        self, tmp_path: Path
    ) -> None:
        """A game reported while the daemon was out of reach gets its rule's state at the handshake."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rules = self._previous_rules(rig, "on")
            sync = await _start_disconnected(rig, Store(last_instance=rig.fake.instance))
            await sync.set_game(BALATRO)
            await rig.fake.start(rig.socket_path)
            snapshot = await rig.events.next("state", _connected)
            assert snapshot["session_on"] is True
            assert rig.fake.settings["focus_modes"] == rules

        _run(tmp_path, body)

    def test_rules_of_a_game_no_longer_running_are_dropped(self, tmp_path: Path) -> None:
        """A first report of no game drops the previous backend's state, so a launch starts at the default."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            self._previous_rules(rig, "on")
            sync = await _start_connected(rig, Store(last_instance=rig.fake.instance))
            await sync.set_game(None)
            assert rig.fake.settings["focus_modes"] == {"apps": {"769": "off_locked"}, "default": "off"}
            launched = await sync.set_game(BALATRO)
            assert launched["session_on"] is False

        _run(tmp_path, body)

    def test_rules_of_a_new_daemon_instance_are_not_taken(self, tmp_path: Path) -> None:
        """A daemon the plugin did not write the rules for has no state of the plugin's in them."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            self._previous_rules(rig, "on")
            sync = await _start_connected(rig, Store(last_instance=OLD_INSTANCE))
            reported = await sync.set_game(BALATRO)
            assert reported["session_on"] is False

        _run(tmp_path, body)

    def test_reconnect_keeps_the_state_and_takes_no_live_mode(self, tmp_path: Path) -> None:
        """Only the backend's first handshake reads the live mode as a state."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = BALATRO.appid
            sync = await _start_connected(rig, Store(last_instance=rig.fake.instance))
            await rig.fake.stop()
            await rig.events.next("state", _disconnected)
            rig.fake.mode = "on"
            await rig.fake.start(rig.socket_path)
            await rig.events.next("state", _connected)
            assert sync.snapshot()["session_on"] is False

        _run(tmp_path, body)


class TestDaemonRestart:
    """A new daemon instance gets the settings, the rules and the mode for the app in front."""

    def test_new_instance_gets_settings_then_rules_then_the_mode(self, tmp_path: Path) -> None:
        """With a game in front whose Active is on, a restarted daemon ends up with the pads on."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = BALATRO.appid
            games = {BALATRO.appid: GameProfile("Balatro", True, {"size": 1.5}, active=True)}
            await _start_connected(rig, Store(OLD_INSTANCE, GLOBAL, {}, games))
            await rig.fake.stop()
            await rig.events.next("state", _disconnected)
            rig.fake.calls.clear()
            rig.fake.instance, rig.fake.mode = "bbbbbbbbbbbbbbbb", "off"
            rig.fake.settings = copy.deepcopy(rig.fake.defaults)
            await rig.fake.start(rig.socket_path)
            await rig.events.next("daemon_restarted")
            writes = [(name, params) for name, params in rig.fake.calls if name in ("set_settings", "set_mode")]
            rules = {"apps": {"2379780": "on", "769": "off_locked"}, "default": "off"}
            assert writes == [
                ("set_settings", {"changes": {"size": 1.5}}),
                ("set_settings", {"changes": {"focus_modes": rules}}),
                ("set_mode", {"on": True}),
            ]
            assert rig.fake.mode == "on"

        _run(tmp_path, body)

    @pytest.mark.parametrize("default", [True, False])
    def test_new_instance_gets_the_games_current_state_not_its_default(self, tmp_path: Path, default: bool) -> None:
        """A game whose Trackpads were switched against its default keeps that state across the daemon restart."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = BALATRO.appid
            sync = await _start_connected(rig, Store(last_instance=OLD_INSTANCE, global_active=default))
            await sync.set_trackpads(not default)
            await rig.fake.stop()
            await rig.events.next("state", _disconnected)
            rig.fake.calls.clear()
            rig.fake.instance, rig.fake.mode = "bbbbbbbbbbbbbbbb", "off"
            rig.fake.settings = copy.deepcopy(rig.fake.defaults)
            await rig.fake.start(rig.socket_path)
            await rig.events.next("daemon_restarted")
            current, saved = ("off", "on") if default else ("on", "off")
            assert rig.fake.mode == current
            assert rig.fake.settings["focus_modes"] == {
                "apps": {"2379780": current, "769": "off_locked"},
                "default": saved,
            }

        _run(tmp_path, body)

    def test_new_instance_in_steam_ui_leaves_the_pads_off(self, tmp_path: Path) -> None:
        """Steam's UI in front never gets the pads turned on by a replay."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = STEAM_UI
            await _start_connected(rig, Store(last_instance=OLD_INSTANCE, global_active=True))
            assert rig.calls("set_mode") == []

        _run(tmp_path, body)

    def test_same_instance_leaves_the_mode_alone(self, tmp_path: Path) -> None:
        """A daemon that kept running keeps its mode until the next focus change applies the rules."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.focused_app = BALATRO.appid
            await _start_connected(rig, Store(last_instance=rig.fake.instance, global_active=True))
            assert rig.calls("set_mode") == []

        _run(tmp_path, body)


class TestModeOnceAvailable:
    """A daemon that is not yet available gets the mode once it is."""

    @staticmethod
    async def _restart_unavailable(rig: _Rig, focus: int, active: bool) -> None:
        """Sync a store for `focus`, restart the fake as a `starting` daemon and wait for the replay.

        The store holds a Balatro profile with Active `active`; the global profile's Active is `active` too.
        """
        rig.fake.focused_app = focus
        games = {BALATRO.appid: GameProfile("Balatro", True, {}, active=active)}
        await _start_connected(rig, Store(OLD_INSTANCE, GLOBAL, {}, games, global_active=active))
        await rig.fake.stop()
        await rig.events.next("state", _disconnected)
        rig.fake.calls.clear()
        rig.fake.instance, rig.fake.mode = "bbbbbbbbbbbbbbbb", "off"
        rig.fake.available, rig.fake.reason = False, "starting"
        rig.fake.settings = copy.deepcopy(rig.fake.defaults)
        await rig.fake.start(rig.socket_path)
        await rig.events.next("daemon_restarted")

    @staticmethod
    async def _become_available(rig: _Rig) -> None:
        """Make the fake available and announce it."""
        rig.fake.available, rig.fake.reason = True, ""
        await rig.fake.notify()

    def test_mode_turns_on_when_the_daemon_becomes_available(self, tmp_path: Path) -> None:
        """A game in front with Active on gets the pads on once, after the replay found the daemon starting."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            await self._restart_unavailable(rig, BALATRO.appid, True)
            assert rig.fake.mode == "off"
            assert rig.calls("set_mode") == []  # no doomed attempt while unavailable
            await self._become_available(rig)
            await rig.events.next("state", lambda snapshot: _mode_of(snapshot) == "on")
            assert rig.fake.mode == "on"
            assert rig.calls("set_mode") == [{"on": True}]

        _run(tmp_path, body)

    @pytest.mark.parametrize(("focus", "active"), [(BALATRO.appid, False), (STEAM_UI, True)])
    def test_mode_stays_off_when_active_is_off_or_steam_has_focus(
        self, tmp_path: Path, focus: int, active: bool
    ) -> None:
        """Neither Active off nor Steam's UI in front gets the pads turned on."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            await self._restart_unavailable(rig, focus, active)
            await self._become_available(rig)
            await rig.events.next("state", _available)
            assert rig.calls("set_mode") == []
            assert rig.fake.mode == "off"

        _run(tmp_path, body)

    def test_mode_turns_on_after_an_availability_flap(self, tmp_path: Path) -> None:
        """Pad mode that went off because the daemon became unavailable returns when it is available again."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            await self._restart_unavailable(rig, BALATRO.appid, True)
            await self._become_available(rig)
            await rig.events.next("state", lambda snapshot: _mode_of(snapshot) == "on")
            rig.fake.available, rig.fake.reason = False, "lost"
            rig.fake.mode = "off"
            await rig.fake.notify()
            await rig.events.next("state", lambda snapshot: _mode_of(snapshot) == "off")
            await self._become_available(rig)
            await rig.events.next("state", lambda snapshot: _mode_of(snapshot) == "on")
            assert rig.fake.mode == "on"
            assert rig.calls("set_mode") == [{"on": True}, {"on": True}]

        _run(tmp_path, body)

    def test_refused_set_mode_sets_error_without_retrying(self, tmp_path: Path) -> None:
        """A daemon that refuses the switch leaves the mode off, shows the reason and is not asked again."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            await self._restart_unavailable(rig, BALATRO.appid, True)
            rig.fake.fail_next["set_mode"] = (-32000, "no")
            await self._become_available(rig)
            await rig.events.next("state", lambda snapshot: snapshot["error"] == "no")
            await asyncio.sleep(0.1)
            assert rig.calls("set_mode") == [{"on": True}]
            assert rig.fake.mode == "off"

        _run(tmp_path, body)


class TestFirstRunActive:
    """A first run takes the daemon's live mode as the global Active, once."""

    def test_store_of_another_version_is_moved_aside_as_a_first_run(self, tmp_path: Path) -> None:
        """A file of another version is kept as `.bad`, and the live mode becomes the global Active."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            games = {"2379780": {"name": "Balatro", "enabled": True, "settings": {}}}
            document = {"version": 1, "last_instance": rig.fake.instance, "daemon_profile": GLOBAL, "global": {}}
            rig.store_path.write_text(json.dumps({**document, "games": games}))
            rig.fake.mode = "on"
            await _start_connected(rig)
            stored = load(rig.store_path).store
            assert (stored.global_active, stored.games) == (True, {})
            assert rig.store_path.with_name(rig.store_path.name + ".bad").exists()

        _run(tmp_path, body)

    def test_first_run_takes_the_live_mode_as_global_active(self, tmp_path: Path) -> None:
        """Without a store the global Active, like the global settings, is adopted from the daemon."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            rig.fake.mode = "on"
            await _start_connected(rig)
            assert load(rig.store_path).store.global_active is True

        _run(tmp_path, body)

    def test_live_mode_is_taken_only_at_the_first_handshake(self, tmp_path: Path) -> None:
        """A reconnect after the first handshake keeps the Active learnt then."""

        async def body(rig: _Rig) -> None:
            """The scenario this test runs against the fake daemon."""
            await _start_connected(rig)
            await rig.fake.stop()
            await rig.events.next("state", _disconnected)
            rig.fake.mode = "on"
            await rig.fake.start(rig.socket_path)
            await rig.events.next("state", _connected)
            assert load(rig.store_path).store.global_active is False

        _run(tmp_path, body)
