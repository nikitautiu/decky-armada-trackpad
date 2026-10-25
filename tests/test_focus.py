"""Tests for reading the daemon's focus fields and deriving the focus rules from the profiles and sessions."""

import pytest
from armada_trackpad_plugin.focus import (
    MAX_SESSIONS,
    STEAM_UI,
    FocusReport,
    focus_report,
    focus_rules,
    focused_game,
    inherited_sessions,
    with_session,
)
from armada_trackpad_plugin.profiles import MAX_GAMES, GameProfile, Store


BALATRO = 2379780
PORTAL = 620


class TestFocusReport:
    """`focus_report` reads `focused_app` and `mode_by` as strictly as the daemon defines them."""

    @pytest.mark.parametrize("app", [None, 0, STEAM_UI, BALATRO, 2**32 - 1])
    @pytest.mark.parametrize("mode_by", ["start", "client", "key", "chord", "focus", "unavailable"])
    def test_report_reads_valid_fields(self, app: int | None, mode_by: str) -> None:
        """Every app id in 0..2^32-1, null and every `mode_by` pass."""
        assert focus_report({"focused_app": app, "mode_by": mode_by}) == FocusReport(app, mode_by)

    @pytest.mark.parametrize(
        "status",
        [
            pytest.param({"focused_app": True, "mode_by": "key"}, id="bool-app"),
            pytest.param({"focused_app": -1, "mode_by": "key"}, id="negative-app"),
            pytest.param({"focused_app": 2**32, "mode_by": "key"}, id="app-over-32-bits"),
            pytest.param({"focused_app": "769", "mode_by": "key"}, id="string-app"),
            pytest.param({"focused_app": 769.0, "mode_by": "key"}, id="float-app"),
            pytest.param({"focused_app": 769, "mode_by": "keyboard"}, id="unknown-mode-by"),
            pytest.param({"focused_app": 769, "mode_by": None}, id="null-mode-by"),
            pytest.param({"focused_app": 769}, id="no-mode-by"),
            pytest.param({"mode_by": "key"}, id="no-focused-app"),
            pytest.param({"mode": "off", "instance": "a"}, id="no-focus-fields"),
        ],
    )
    def test_report_rejects_malformed_fields(self, status: dict[str, object]) -> None:
        """A field of the wrong type or range, or a missing one, is a malformed status."""
        with pytest.raises(ValueError, match="status"):
            focus_report(status)


class TestFocusedGame:
    """`focused_game` names a game only when one is in front."""

    @pytest.mark.parametrize(
        ("report", "expected"),
        [
            pytest.param(FocusReport(None, "start"), None, id="unknown"),
            pytest.param(FocusReport(STEAM_UI, "focus"), None, id="steam-ui"),
            pytest.param(FocusReport(BALATRO, "focus"), BALATRO, id="game"),
        ],
    )
    def test_focused_game(self, report: FocusReport, expected: int | None) -> None:
        """Steam's UI and an unknown focus are no game."""
        assert focused_game(report) == expected


class TestFocusRules:
    """`focus_rules` turns the profiles' defaults and the running games' states into the daemon's `focus_modes`."""

    def test_rules_lock_steam_ui_off_and_default_to_global_default(self) -> None:
        """Without game profiles every game follows the global default and Steam's UI is off and locked."""
        assert focus_rules(Store(global_active=True), {}) == {"apps": {"769": "off_locked"}, "default": "on"}
        assert focus_rules(Store(global_active=False), {}) == {"apps": {"769": "off_locked"}, "default": "off"}

    def test_rules_list_each_enabled_game_profile_with_its_default(self) -> None:
        """An enabled game profile gets its own rule; a disabled one follows the global default."""
        games = {
            BALATRO: GameProfile("Balatro", True, {}, active=True),
            PORTAL: GameProfile("Portal 2", True, {}, active=False),
            70: GameProfile("Half-Life", False, {}, active=True),
        }
        rules = focus_rules(Store(games=games), {})
        assert rules == {"apps": {"769": "off_locked", "2379780": "on", "620": "off"}, "default": "off"}

    def test_session_overrides_its_games_rule_and_adds_one_for_a_game_without_profile(self) -> None:
        """The current state of a running game wins over its profile's default, with or without a profile."""
        games = {BALATRO: GameProfile("Balatro", True, {}, active=True)}
        rules = focus_rules(Store(games=games, global_active=True), {BALATRO: False, PORTAL: False})
        assert rules == {"apps": {"769": "off_locked", "2379780": "off", "620": "off"}, "default": "on"}

    def test_steam_ui_stays_locked_off_whatever_a_profile_or_session_for_its_id_says(self) -> None:
        """Neither a stored profile nor a session under 769 turns the pads on in Steam's UI."""
        store = Store(games={STEAM_UI: GameProfile("Steam", True, {}, active=True)})
        assert focus_rules(store, {STEAM_UI: True})["apps"] == {"769": "off_locked"}

    def test_rules_stay_within_the_daemon_limit_with_every_game_profile_and_session(self) -> None:
        """`MAX_GAMES` profiles, `MAX_SESSIONS` sessions of other apps and Steam's UI fit the daemon's 256 apps."""
        games = {appid: GameProfile("g", True, {}, active=True) for appid in range(1000, 1000 + MAX_GAMES)}
        sessions = dict.fromkeys(range(5000, 5000 + MAX_SESSIONS), True)
        apps = focus_rules(Store(games=games), sessions)["apps"]
        assert isinstance(apps, dict)
        assert len(apps) == MAX_GAMES + MAX_SESSIONS + 1 == 256

    def test_only_the_last_max_sessions_states_count(self) -> None:
        """More states than `MAX_SESSIONS` still fit: the oldest are left out of the rules."""
        sessions = dict.fromkeys(range(1, MAX_SESSIONS + 2), True)
        apps = focus_rules(Store(), sessions)["apps"]
        assert isinstance(apps, dict)
        assert ("1" in apps, str(MAX_SESSIONS + 1) in apps, len(apps)) == (False, True, MAX_SESSIONS + 1)


class TestWithSession:
    """`with_session` records a game's current state within `MAX_SESSIONS`."""

    def test_session_is_recorded_and_replaced(self) -> None:
        """A new value for a game replaces its old one; other games keep theirs."""
        assert with_session({BALATRO: True, PORTAL: True}, BALATRO, False) == {BALATRO: False, PORTAL: True}

    def test_oldest_session_is_dropped_past_the_limit(self) -> None:
        """At `MAX_SESSIONS`, a new game pushes out the game recorded longest ago, never the one just set."""
        full = dict.fromkeys(range(1, MAX_SESSIONS + 1), True)
        sessions = with_session(full, BALATRO, False)
        assert len(sessions) == MAX_SESSIONS
        assert 1 not in sessions
        assert sessions[BALATRO] is False

    def test_updating_a_game_makes_it_the_newest(self) -> None:
        """A game set again is the last one dropped."""
        full = dict.fromkeys(range(1, MAX_SESSIONS + 1), True)
        sessions = with_session(with_session(full, 1, False), BALATRO, True)
        assert (1 in sessions, 2 in sessions) == (True, False)


class TestInheritedSessions:
    """`inherited_sessions` reads the current states a previous backend left in the daemon's rules."""

    def test_states_are_the_rules_that_differ_from_the_defaults(self) -> None:
        """A game's rule unlike its profile's default, or unlike the global default without one, is a state."""
        store = Store(games={BALATRO: GameProfile("Balatro", True, {}, active=True)}, global_active=False)
        rules = {"apps": {"769": "off_locked", "2379780": "off", "620": "on", "70": "off"}, "default": "off"}
        assert inherited_sessions(rules, store) == {BALATRO: False, PORTAL: True}

    @pytest.mark.parametrize(
        "rules",
        [
            pytest.param(None, id="no-rules"),
            pytest.param({"apps": []}, id="apps-not-an-object"),
            pytest.param({"apps": {"620": "keep", "70": True}}, id="not-on-or-off"),
            pytest.param({"apps": {"0620": "on", "x": "on", "0": "on", str(2**32): "on"}}, id="not-an-app-id"),
        ],
    )
    def test_nothing_is_read_from_malformed_or_foreign_rules(self, rules: object) -> None:
        """Rules the plugin would not have written give no state."""
        assert inherited_sessions(rules, Store(global_active=False)) == {}

    def test_at_most_max_sessions_states_are_read(self) -> None:
        """A daemon holding more differing rules than the plugin keeps gives the last `MAX_SESSIONS`."""
        rules = {"apps": {str(appid): "on" for appid in range(1, MAX_SESSIONS + 10)}, "default": "off"}
        assert len(inherited_sessions(rules, Store(global_active=False))) == MAX_SESSIONS
