"""Tests for the Decky entry point: one supervised sync task and validated callables."""

import asyncio
import os
from collections.abc import Awaitable, Callable, Iterator, Mapping, Sequence
from pathlib import Path

import conftest
import decky
import pytest
from armada_trackpad_plugin import service
from armada_trackpad_plugin.profiles import Game
from armada_trackpad_plugin.service import CommandResult

import main
from main import Plugin


class FakeSync:
    """Stands in for `Sync`: counts instances and records the calls that reach it."""

    instances: list["FakeSync"] = []  # noqa: RUF012 -- test double bookkeeping

    def __init__(
        self, socket_path: Path, uid: int, store_path: Path, emit: Callable[[str, dict[str, object]], Awaitable[None]]
    ) -> None:
        self.args = (socket_path, uid, store_path, emit)
        self.calls: list[tuple[str, object]] = []
        self.runs = 0
        self.fail_runs = 0
        self.cancelled = False
        self.instances.append(self)

    async def run(self) -> None:
        """Run until cancelled, or fail while `fail_runs` is not used up."""
        self.runs += 1
        if self.runs <= self.fail_runs:
            raise RuntimeError("bug")
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled = True
            raise

    def writable(self) -> frozenset[str]:
        """Return a fixed set of writable keys."""
        return frozenset({"size", "pads"})

    def snapshot(self) -> dict[str, object]:
        """Return a fixed snapshot."""
        return {"connected": True, "error": None}

    async def set_trackpads(self, on: bool) -> dict[str, object]:
        """Record the call."""
        self.calls.append(("set_trackpads", on))
        return self.snapshot()

    async def set_default(self, on: bool) -> dict[str, object]:
        """Record the call."""
        self.calls.append(("set_default", on))
        return self.snapshot()

    async def set_settings(self, changes: Mapping[str, object], profile: str) -> dict[str, object]:
        """Record the call."""
        self.calls.append(("set_settings", (dict(changes), profile)))
        return self.snapshot()

    async def reset_settings(self, keys: Sequence[str] | None, profile: str) -> dict[str, object]:
        """Record the call."""
        self.calls.append(("reset_settings", (keys, profile)))
        return self.snapshot()

    async def check(self) -> dict[str, object]:
        """Record the call."""
        self.calls.append(("check", None))
        return self.snapshot()

    async def set_game_profile(self, enabled: bool, initial: Mapping[str, object]) -> dict[str, object]:
        """Record the call."""
        self.calls.append(("set_game_profile", (enabled, dict(initial))))
        return self.snapshot()

    async def set_game(self, game: Game | None, *, running: bool = True) -> dict[str, object]:
        """Record the call."""
        self.calls.append(("set_game", (game, running)))
        return self.snapshot()


@pytest.fixture
def fake_sync(monkeypatch: pytest.MonkeyPatch) -> Iterator[type[FakeSync]]:
    """Replace `Sync` in `main` with `FakeSync` and give the test a fresh module state, restored afterwards."""
    FakeSync.instances = []
    monkeypatch.setattr(main, "Sync", FakeSync)
    monkeypatch.setattr(main, "_RESTART_DELAY", 0.01)
    monkeypatch.setattr(main, "_running", main._Running())
    yield FakeSync


class TestLifecycle:
    """`_main` starts one supervised sync task and `_unload` stops it."""

    def test_main_twice_starts_one_sync(self, fake_sync: type[FakeSync]) -> None:
        """A second `_main` leaves the first task and Sync in place."""

        async def scenario() -> None:
            plugin = Plugin()
            await plugin._main()
            await plugin._main()
            await asyncio.sleep(0)
            await plugin._unload()

        asyncio.run(scenario())

        assert len(fake_sync.instances) == 1
        assert fake_sync.instances[0].runs == 1

    def test_sync_gets_the_device_paths(self, fake_sync: type[FakeSync]) -> None:
        """The Sync is built with the socket, uid and store paths of this session."""

        async def scenario() -> None:
            plugin = Plugin()
            await plugin._main()
            await plugin._unload()

        asyncio.run(scenario())

        socket_path, uid, store_path, _emit = fake_sync.instances[0].args
        assert socket_path == Path(f"/run/user/{os.getuid()}") / "armada-trackpad.sock"
        assert uid == os.getuid()
        assert store_path == Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "profiles.json"

    def test_unload_cancels_the_sync_task(self, fake_sync: type[FakeSync]) -> None:
        """`_unload` cancels `Sync.run` and waits for it to finish."""

        async def scenario() -> None:
            plugin = Plugin()
            await plugin._main()
            await asyncio.sleep(0.01)
            await plugin._unload()

        asyncio.run(scenario())

        assert fake_sync.instances[0].cancelled is True

    def test_sync_restarted_when_run_raises(self, fake_sync: type[FakeSync]) -> None:
        """A bug that ends `Sync.run` with an exception is logged and `run` starts again."""

        async def scenario() -> None:
            plugin = Plugin()
            await plugin._main()
            fake_sync.instances[0].fail_runs = 2
            fake_sync.instances[0].runs = 0
            await asyncio.sleep(0.2)
            await plugin._unload()

        asyncio.run(scenario())

        assert fake_sync.instances[0].runs >= 3

    def test_emit_forwards_to_decky(self, fake_sync: type[FakeSync]) -> None:
        """The Sync's emit sends the event and its payload through `decky.emit`."""

        async def scenario() -> None:
            plugin = Plugin()
            await plugin._main()
            emit = fake_sync.instances[0].args[3]
            await emit("state", {"connected": False})
            await plugin._unload()

        asyncio.run(scenario())

        assert conftest.EMITTED == [("state", ({"connected": False},))]


class TestCallables:
    """Callables validate the frontend's arguments, then delegate; bad input comes back as an error."""

    @pytest.mark.parametrize("key", ["panel_mm", "focus_modes"])
    def test_set_settings_rejects_never_stored_key_without_calling_the_daemon(
        self, fake_sync: type[FakeSync], key: str
    ) -> None:
        """A key the panel may not write yields the snapshot with an error and no call reaches the Sync."""
        result = asyncio.run(Plugin().set_settings({key: "x"}, "global"))

        assert isinstance(result["error"], str)
        assert key in result["error"]
        assert [call for call in fake_sync.instances[0].calls if call[0] == "set_settings"] == []

    def test_set_settings_delegates_when_valid(self, fake_sync: type[FakeSync]) -> None:
        """A writable key reaches the Sync with its profile."""
        asyncio.run(Plugin().set_settings({"size": 1.5}, "game:620"))

        assert fake_sync.instances[0].calls == [("set_settings", ({"size": 1.5}, "game:620"))]

    def test_set_game_profile_delegates_initial_changes(self, fake_sync: type[FakeSync]) -> None:
        """Writable initial changes reach the Sync with the flag."""
        asyncio.run(Plugin().set_game_profile(True, {"size": 1.5}))

        assert fake_sync.instances[0].calls == [("set_game_profile", (True, {"size": 1.5}))]

    @pytest.mark.parametrize(("enabled", "initial"), [(1, {}), (True, {"panel_mm": "x"}), (True, None)])
    def test_set_game_profile_rejects_bad_arguments(
        self, fake_sync: type[FakeSync], enabled: object, initial: object
    ) -> None:
        """A non-bool flag or initial changes the panel may not write are an error, not a call."""
        result = asyncio.run(Plugin().set_game_profile(enabled, initial))

        assert isinstance(result["error"], str)
        assert fake_sync.instances[0].calls == []

    def test_set_settings_rejects_bad_profile(self, fake_sync: type[FakeSync]) -> None:
        """A malformed profile reference is an error, not a call."""
        result = asyncio.run(Plugin().set_settings({"size": 1.5}, "../x"))

        assert isinstance(result["error"], str)
        assert fake_sync.instances[0].calls == []

    def test_reset_settings_delegates_none_and_lists(self, fake_sync: type[FakeSync]) -> None:
        """`None` and a key list both pass validation and reach the Sync."""
        asyncio.run(Plugin().reset_settings(None, "global"))
        asyncio.run(Plugin().reset_settings(["size"], "global"))

        assert fake_sync.instances[0].calls == [
            ("reset_settings", (None, "global")),
            ("reset_settings", (["size"], "global")),
        ]

    def test_reset_settings_rejects_unknown_key(self, fake_sync: type[FakeSync]) -> None:
        """An unknown key is an error."""
        result = asyncio.run(Plugin().reset_settings(["nope"], "global"))

        assert isinstance(result["error"], str)
        assert fake_sync.instances[0].calls == []

    def test_set_current_game_rejects_bad_appid(self, fake_sync: type[FakeSync]) -> None:
        """An app id outside the allowed range is an error, not a call."""
        result = asyncio.run(Plugin().set_current_game(-5, "Evil", True))

        assert isinstance(result["error"], str)
        assert fake_sync.instances[0].calls == []

    @pytest.mark.parametrize("running", [1, "true", None])
    def test_set_current_game_rejects_a_running_flag_that_is_not_a_bool(
        self, fake_sync: type[FakeSync], running: object
    ) -> None:
        """Whether the game runs must be a real bool."""
        result = asyncio.run(Plugin().set_current_game(2379780, "Balatro", running))

        assert isinstance(result["error"], str)
        assert fake_sync.instances[0].calls == []

    def test_set_current_game_delegates_game_running_flag_and_none(self, fake_sync: type[FakeSync]) -> None:
        """A running game, a browsed game and the no-game value reach `Sync.set_game`."""
        asyncio.run(Plugin().set_current_game(2379780, "Balatro", True))
        asyncio.run(Plugin().set_current_game(620, "Portal 2", False))
        asyncio.run(Plugin().set_current_game(0, "", False))

        assert fake_sync.instances[0].calls == [
            ("set_game", (Game(2379780, "Balatro"), True)),
            ("set_game", (Game(620, "Portal 2"), False)),
            ("set_game", (None, False)),
        ]

    def test_simple_callables_delegate(self, fake_sync: type[FakeSync]) -> None:
        """`get_state`, `set_trackpads`, `set_default`, `check` and `set_game_profile` reach the Sync."""
        plugin = Plugin()
        state = asyncio.run(plugin.get_state())
        asyncio.run(plugin.set_trackpads(True))
        asyncio.run(plugin.set_default(False))
        asyncio.run(plugin.check())
        asyncio.run(plugin.set_game_profile(True, {}))

        assert state == {"connected": True, "error": None}
        assert fake_sync.instances[0].calls == [
            ("set_trackpads", True),
            ("set_default", False),
            ("check", None),
            ("set_game_profile", (True, {})),
        ]

    @pytest.mark.parametrize("callable_name", ["set_trackpads", "set_default"])
    def test_switches_reject_non_bool(self, fake_sync: type[FakeSync], callable_name: str) -> None:
        """A non-bool `on` is an error and never reaches the Sync."""
        result = asyncio.run(getattr(Plugin(), callable_name)(1))

        assert isinstance(result["error"], str)
        assert fake_sync.instances[0].calls == []

    def test_service_callables_return_ok_and_output(
        self, fake_sync: type[FakeSync], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`start_daemon` and `read_status` return the plain `{ok, output}` shape."""

        async def fake_start(_uid: int) -> CommandResult:
            return CommandResult(True, "")

        async def fake_status(_uid: int) -> CommandResult:
            return CommandResult(False, "Failed to connect to bus")

        monkeypatch.setattr(service, "start_daemon", fake_start)
        monkeypatch.setattr(service, "read_status", fake_status)
        plugin = Plugin()

        assert asyncio.run(plugin.start_daemon()) == {"ok": True, "output": ""}
        assert asyncio.run(plugin.read_status()) == {"ok": False, "output": "Failed to connect to bus"}

    @pytest.mark.parametrize("installed", [True, False, None])
    def test_read_unit_returns_whether_the_daemon_is_installed(
        self, fake_sync: type[FakeSync], monkeypatch: pytest.MonkeyPatch, installed: bool | None
    ) -> None:
        """`read_unit` passes on `service.read_unit`, unknown (`None`) included."""

        async def fake_read_unit(_uid: int) -> bool | None:
            return installed

        monkeypatch.setattr(service, "read_unit", fake_read_unit)

        assert asyncio.run(Plugin().read_unit()) == {"installed": installed}


def test_plugin_class_holds_only_callables_and_hooks() -> None:
    """Decky dispatches any attribute by name, so the class carries nothing else."""
    names = {name for name in vars(Plugin) if not name.startswith("__")}

    assert names == {
        "_main",
        "_unload",
        "get_state",
        "set_trackpads",
        "set_default",
        "set_settings",
        "reset_settings",
        "set_game_profile",
        "set_current_game",
        "check",
        "start_daemon",
        "read_status",
        "read_unit",
    }
