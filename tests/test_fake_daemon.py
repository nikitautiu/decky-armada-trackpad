"""Tests for the fake daemon's settings and mode behaviour, which later tasks rely on."""

import asyncio
import os
from collections.abc import Awaitable, Callable
from pathlib import Path

import pytest
from armada_trackpad_plugin.rpc import Connection, RpcError
from fake_daemon import FakeDaemon


def _run(tmp_path: Path, body: Callable[[FakeDaemon, Connection], Awaitable[None]]) -> None:
    """Run `body` with a started fake daemon and a connection to it."""

    async def scenario() -> None:
        """The scenario this test runs against the fake daemon."""
        fake = FakeDaemon()
        path = tmp_path / "armada-trackpad.sock"
        await fake.start(path)
        conn = await Connection.open(path, os.getuid())
        try:
            await body(fake, conn)
        finally:
            await conn.close()
            await fake.stop()

    asyncio.run(asyncio.wait_for(scenario(), timeout=10))


class TestSetSettings:
    """`set_settings` validation, edge normalization and notification."""

    def test_unknown_key_rejected_when_batch_has_one(self, tmp_path: Path) -> None:
        """An unknown key gives -32602 and none of the other changes apply."""

        async def body(fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            with pytest.raises(RpcError) as raised:
                await conn.call("set_settings", {"changes": {"size": 2.0, "bogus": 1}})
            assert raised.value.code == -32602
            assert fake.settings["size"] == 1.0

        _run(tmp_path, body)

    @pytest.mark.parametrize("key", ["preset", "left.preset", "right.preset"])
    def test_preset_key_rejected_like_an_unknown_setting(self, tmp_path: Path, key: str) -> None:
        """The daemon has no preset keys: one gives -32602 and nothing changes."""

        async def body(fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            with pytest.raises(RpcError) as raised:
                await conn.call("set_settings", {"changes": {key: "swipe"}})
            assert raised.value.code == -32602
            assert fake.settings["anchor"] == "fixed"

        _run(tmp_path, body)

    def test_single_edge_mode_becomes_four(self, tmp_path: Path) -> None:
        """`right.edges` given as one mode is stored as the list of four the daemon reports."""

        async def body(fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            await conn.call("set_settings", {"changes": {"right.anchor": "float", "right.edges": "clamp"}})
            assert fake.settings["right.anchor"] == "float"
            assert fake.settings["right.edges"] == ["clamp"] * 4
            assert fake.settings["left.anchor"] is None

        _run(tmp_path, body)

    def test_state_changed_published_when_settings_change(self, tmp_path: Path) -> None:
        """A subscriber gets a notification after a change that alters the settings."""

        async def body(_fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            await conn.call("subscribe")
            await conn.call("set_settings", {"changes": {"size": 2.0}})
            params = await asyncio.wait_for(conn.notifications.get(), timeout=5)
            assert params["mode"] == "off"

        _run(tmp_path, body)


class TestResetAndMode:
    """`reset_settings`, `set_mode` and `check`."""

    def test_reset_restores_default_when_key_listed(self, tmp_path: Path) -> None:
        """Resetting a key returns it to its default; other changes stay."""

        async def body(fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            await conn.call("set_settings", {"changes": {"size": 2.0, "tap": False}})
            await conn.call("reset_settings", {"keys": ["size"]})
            assert fake.settings["size"] == 1.0
            assert fake.settings["tap"] is False

        _run(tmp_path, body)

    def test_set_mode_raises_unavailable_when_not_available(self, tmp_path: Path) -> None:
        """Turning the mode on while unavailable gives -32000 with the reason."""

        async def body(fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            fake.available, fake.reason = False, "controller type is xbox-elite"
            with pytest.raises(RpcError) as raised:
                await conn.call("set_mode", {"on": True})
            assert raised.value.code == -32000
            assert raised.value.message == "controller type is xbox-elite"

        _run(tmp_path, body)

    def test_set_mode_returns_new_mode_when_available(self, tmp_path: Path) -> None:
        """The reply names the new mode and the status follows."""

        async def body(fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            assert await conn.call("set_mode", {"on": True}) == "on"
            assert fake.mode == "on"

        _run(tmp_path, body)

    def test_held_reply_arrives_only_once_released(self, tmp_path: Path) -> None:
        """A held method is applied at once, but its reply waits for `release`."""

        async def body(fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            fake.held.add("set_mode")
            call = asyncio.create_task(conn.call("set_mode", {"on": True}))
            await fake.wait_for_call("set_mode")
            await asyncio.sleep(0.05)
            assert (call.done(), fake.mode) == (False, "on")
            fake.release()
            assert await asyncio.wait_for(call, 2) == "on"

        _run(tmp_path, body)


BALATRO = 2379780
STEAM_UI = 769
RULES: dict[str, object] = {"apps": {str(STEAM_UI): "off", str(BALATRO): "on"}, "default": "keep"}
# Steam's UI turns the pads off, Balatro on, every other app leaves them as they are.


async def _with_rules(fake: FakeDaemon, conn: Connection, rules: dict[str, object] = RULES) -> None:
    """Write `rules` as the fake's focus rules and subscribe, so later state changes arrive on `conn`."""
    await conn.call("set_settings", {"changes": {"focus_modes": rules}})
    await conn.call("subscribe")


class TestFocusModes:
    """The `focus_modes` setting is validated like the daemon's."""

    @pytest.mark.parametrize(
        "rules",
        [
            pytest.param("on", id="not-an-object"),
            pytest.param({"apps": {}}, id="no-default"),
            pytest.param({"apps": {}, "default": "keep", "extra": 1}, id="extra-key"),
            pytest.param({"apps": [], "default": "keep"}, id="apps-not-an-object"),
            pytest.param({"apps": {}, "default": "maybe"}, id="bad-default"),
            pytest.param({"apps": {"1": "maybe"}, "default": "keep"}, id="bad-rule"),
            pytest.param({"apps": {"07": "on"}, "default": "keep"}, id="leading-zero"),
            pytest.param({"apps": {"+7": "on"}, "default": "keep"}, id="sign"),
            pytest.param({"apps": {"4294967296": "on"}, "default": "keep"}, id="over-32-bits"),
            pytest.param({"apps": {str(app): "on" for app in range(257)}, "default": "keep"}, id="257-apps"),
        ],
    )
    def test_invalid_rules_rejected_and_nothing_applied(self, tmp_path: Path, rules: object) -> None:
        """A malformed `focus_modes` gives -32602 and leaves the settings as they were."""

        async def body(fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            with pytest.raises(RpcError) as raised:
                await conn.call("set_settings", {"changes": {"focus_modes": rules, "size": 2.0}})
            assert raised.value.code == -32602
            assert fake.settings["focus_modes"] == {"apps": {}, "default": "keep"}
            assert fake.settings["size"] == 1.0

        _run(tmp_path, body)

    def test_valid_rules_accepted_with_256_apps_and_app_zero(self, tmp_path: Path) -> None:
        """256 apps, `"0"` among them, are within the daemon's limits."""

        async def body(fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            rules = {"apps": {str(app): "off" for app in range(256)}, "default": "on"}
            await conn.call("set_settings", {"changes": {"focus_modes": rules}})
            assert fake.settings["focus_modes"] == rules

        _run(tmp_path, body)


class TestFocus:
    """Focus changes, the rules they apply, and what `mode_by` reports."""

    def test_status_reports_focus_and_start(self, tmp_path: Path) -> None:
        """Before any change the focused app is unknown and the mode is as the daemon started."""

        async def body(_fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            status = await conn.call("status")
            assert isinstance(status, dict)
            assert (status["focused_app"], status["mode_by"]) == (None, "start")

        _run(tmp_path, body)

    def test_off_rule_applies_at_once(self, tmp_path: Path) -> None:
        """Focusing Steam's UI turns the pads off in the same notification, made by `focus`."""

        async def body(fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            await conn.call("set_mode", {"on": True})
            await _with_rules(fake, conn)
            await fake.focus(STEAM_UI)
            params = await asyncio.wait_for(conn.notifications.get(), timeout=5)
            assert (params["focused_app"], params["mode"], params["mode_by"]) == (STEAM_UI, "off", "focus")

        _run(tmp_path, body)

    def test_on_rule_waits_for_the_focus_to_settle(self, tmp_path: Path) -> None:
        """Focusing Balatro turns the pads on only once the focus settles."""

        async def body(fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            await _with_rules(fake, conn)
            await fake.focus(BALATRO)
            assert fake.mode == "off"
            await fake.settle()
            assert (fake.mode, fake.mode_by) == ("on", "focus")

        _run(tmp_path, body)

    def test_focus_change_before_settling_cancels_on(self, tmp_path: Path) -> None:
        """The launch flicker back to Steam's UI cancels the waiting `on`."""

        async def body(fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            await _with_rules(fake, conn)
            await fake.focus(BALATRO)
            await fake.focus(STEAM_UI)
            await fake.settle()
            assert fake.mode == "off"

        _run(tmp_path, body)

    def test_app_without_rule_uses_the_default(self, tmp_path: Path) -> None:
        """An app missing from `apps` gets `default`."""

        async def body(fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            await _with_rules(fake, conn, {"apps": {}, "default": "on"})
            await fake.focus(620)
            await fake.settle()
            assert fake.mode == "on"

        _run(tmp_path, body)

    @pytest.mark.parametrize("source", ["key", "chord"])
    def test_manual_toggle_reports_its_source_and_cancels_a_waiting_on(self, tmp_path: Path, source: str) -> None:
        """The key or chord toggles the mode, says so in `mode_by`, and holds until the next focus change."""

        async def body(fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            await _with_rules(fake, conn)
            await fake.focus(BALATRO)
            await fake.press(source)
            await fake.press(source)
            await fake.settle()
            assert (fake.mode, fake.mode_by) == ("off", source)

        _run(tmp_path, body)

    @pytest.mark.parametrize("source", ["key", "chord"])
    def test_off_locked_turns_off_at_once_and_ignores_toggles(self, tmp_path: Path, source: str) -> None:
        """An `off_locked` app turns the pads off on focus; the key or chord changes nothing while it is in front."""

        async def body(fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            await conn.call("set_mode", {"on": True})
            await _with_rules(fake, conn, {"apps": {str(STEAM_UI): "off_locked"}, "default": "on"})
            await fake.focus(STEAM_UI)
            assert (fake.mode, fake.mode_by) == ("off", "focus")
            await fake.press(source)
            assert (fake.mode, fake.mode_by) == ("off", "focus")
            await fake.focus(BALATRO)
            await fake.press(source)
            assert (fake.mode, fake.mode_by) == ("on", source)

        _run(tmp_path, body)

    def test_set_mode_reports_client(self, tmp_path: Path) -> None:
        """A mode change by a call reports `client`."""

        async def body(fake: FakeDaemon, conn: Connection) -> None:
            """The scenario this test runs against the fake daemon."""
            await conn.call("set_mode", {"on": True})
            assert fake.status()["mode_by"] == "client"

        _run(tmp_path, body)
