"""Tests for the pure per-game profile model."""

import pytest
from armada_trackpad_plugin.profiles import (
    GLOBAL,
    Game,
    GameProfile,
    ProfileLimitError,
    Store,
    active_profile,
    adopted,
    managed_keys,
    normalized,
    profile_active,
    profile_ref,
    profile_settings,
    storable,
    target_changes,
    unstorable_keys,
    with_game_profile,
    with_profile_active,
    with_profile_settings,
)


DEFAULTS: dict[str, object] = {
    "pads": "both",
    "size": 1.0,
    "panel_mm": [91.0, 68.0],
    "edges": ["clamp", "clamp", "clamp", "clamp"],
    "right.anchor": "fixed",
    "right.edges": ["clamp", "clamp", "clamp", "clamp"],
    "left.size": None,
    "log_level": "info",
    "focus_modes": {"apps": {}, "default": "keep"},
}
BALATRO = Game(appid=2379780, name="Balatro")


class TestProfileRefs:
    """Profile references and which profile is active."""

    def test_profile_ref_is_global_when_no_game(self) -> None:
        """Without a game the reference is `global`."""
        assert profile_ref(None) == GLOBAL

    def test_profile_ref_names_the_appid_when_game_given(self) -> None:
        """A game's app id maps to `game:<appid>`."""
        assert profile_ref(BALATRO.appid) == "game:2379780"

    def test_active_profile_is_global_when_game_has_no_profile(self) -> None:
        """A game without a stored profile uses the global one."""
        assert active_profile(Store(), BALATRO.appid) == GLOBAL

    def test_active_profile_is_global_when_no_game(self) -> None:
        """No game means the global profile."""
        assert active_profile(Store(), None) == GLOBAL

    def test_active_profile_is_game_when_profile_enabled(self) -> None:
        """An enabled profile is selected."""
        store = Store(games={BALATRO.appid: GameProfile("Balatro", True, {})})
        assert active_profile(store, BALATRO.appid) == "game:2379780"

    def test_active_profile_is_global_when_profile_disabled(self) -> None:
        """A disabled profile is ignored."""
        store = Store(games={BALATRO.appid: GameProfile("Balatro", False, {})})
        assert active_profile(store, BALATRO.appid) == GLOBAL


class TestProfileSettings:
    """Reading and replacing a profile's stored settings."""

    def test_profile_settings_reads_global_and_game(self) -> None:
        """Both kinds of reference resolve to their stored settings."""
        store = Store(global_settings={"size": 2.0}, games={1: GameProfile("A", True, {"pads": "left"})})
        assert profile_settings(store, GLOBAL) == {"size": 2.0}
        assert profile_settings(store, "game:1") == {"pads": "left"}

    def test_profile_settings_empty_when_game_unknown(self) -> None:
        """An unknown game has no stored keys."""
        assert profile_settings(Store(), "game:9") == {}

    def test_with_profile_settings_replaces_global(self) -> None:
        """Global settings are replaced and the original store is untouched."""
        store = Store()
        updated = with_profile_settings(store, GLOBAL, {"size": 2.0})
        assert updated.global_settings == {"size": 2.0}
        assert store.global_settings == {}

    def test_with_profile_settings_replaces_game_and_keeps_its_flags(self) -> None:
        """A game's settings change while its name and flag stay."""
        store = Store(games={1: GameProfile("A", True, {})})
        updated = with_profile_settings(store, "game:1", {"size": 2.0})
        assert updated.games[1] == GameProfile("A", True, {"size": 2.0})

    def test_with_profile_settings_raises_when_game_unknown(self) -> None:
        """Writing to a game without a profile is a caller bug."""
        with pytest.raises(KeyError):
            with_profile_settings(Store(), "game:1", {})


class TestActive:
    """Reading and setting the Active a profile saves."""

    def test_profile_active_reads_global_and_game(self) -> None:
        """Each reference resolves to its own Active."""
        store = Store(global_active=True, games={1: GameProfile("A", True, {}, active=False)})
        assert profile_active(store, GLOBAL) is True
        assert profile_active(store, "game:1") is False

    def test_with_profile_active_sets_only_the_named_profile(self) -> None:
        """Setting a game's Active leaves the global one and the game's other fields alone."""
        store = Store(global_active=False, games={1: GameProfile("A", True, {"size": 2.0}, active=False)})
        updated = with_profile_active(store, "game:1", True)
        assert updated.games[1] == GameProfile("A", True, {"size": 2.0}, active=True)
        assert updated.global_active is False
        assert with_profile_active(store, GLOBAL, True).global_active is True


class TestManagedKeys:
    """Which keys the plugin owns."""

    def test_managed_keys_excludes_never_stored(self) -> None:
        """`panel_mm`, `log_level` and `focus_modes` are never managed."""
        assert managed_keys(DEFAULTS) == {"pads", "size", "edges", "right.anchor", "right.edges", "left.size"}

    def test_managed_keys_excludes_values_the_store_cannot_hold(self) -> None:
        """A newer daemon's key with an object, a list of numbers or an over-long string or name is not managed."""
        reported = {
            "size": 1.0,
            "future.object": {"a": 1},
            "future.numbers": [1, 2],
            "future.text": "x" * 65,
            "k" * 65: True,
        }
        assert managed_keys(reported) == {"size"}

    def test_unstorable_keys_names_only_the_rejected_shapes(self) -> None:
        """The keys left out for their value's shape, without the keys that are never stored by name."""
        reported = {"size": 1.0, "future.object": {"a": 1}, "panel_mm": [91.0, 68.0], "focus_modes": {}}
        assert unstorable_keys(reported) == {"future.object"}


class TestStorable:
    """The setting values the store can hold."""

    @pytest.mark.parametrize("value", [None, True, 3, 1.5, "", "x" * 64, [], ["clamp"] * 4], ids=repr)
    def test_storable_accepts_wire_scalars_and_lists_of_short_strings(self, value: object) -> None:
        """Null, bools, numbers, strings of at most 64 characters and lists of such strings are storable."""
        assert storable(value) is True

    @pytest.mark.parametrize(
        "value", [float("nan"), float("inf"), "x" * 65, [1, 2], ["x" * 65], {"a": 1}, ("clamp",)], ids=repr
    )
    def test_storable_rejects_other_shapes(self, value: object) -> None:
        """Non-finite numbers, long strings, objects, tuples and lists holding anything but short strings are not."""
        assert storable(value) is False


class TestNormalized:
    """Dropping values that equal the defaults."""

    def test_normalized_drops_values_equal_to_default(self) -> None:
        """Only differing keys survive; lists compare by value."""
        profile = {"size": 1.0, "pads": "left", "edges": ["clamp", "clamp", "clamp", "clamp"]}
        assert normalized(profile, DEFAULTS) == {"pads": "left"}

    def test_normalized_keeps_keys_missing_from_defaults(self) -> None:
        """A key the daemon does not report cannot be compared, so it stays."""
        assert normalized({"pad_output": "x"}, DEFAULTS) == {"pad_output": "x"}


class TestTargetChanges:
    """What to write to make the daemon match a profile."""

    def test_target_changes_resets_keys_missing_from_profile_to_defaults(self) -> None:
        """A key the profile omits is wanted at its default."""
        current = {**DEFAULTS, "size": 2.0}
        assert target_changes({}, DEFAULTS, current) == {"size": 1.0}

    def test_target_changes_applies_profile_values(self) -> None:
        """Profile values that differ from the daemon are returned."""
        assert target_changes({"pads": "left"}, DEFAULTS, DEFAULTS) == {"pads": "left"}

    def test_target_changes_skips_keys_the_daemon_does_not_report(self) -> None:
        """A profile key absent from `current` is not written."""
        current = {k: v for k, v in DEFAULTS.items() if k != "right.anchor"}
        assert target_changes({"pad_output": "x"}, DEFAULTS, current) == {}

    def test_target_changes_never_touches_log_level(self) -> None:
        """`log_level` is not managed even when it differs from the default."""
        assert target_changes({}, DEFAULTS, {**DEFAULTS, "log_level": "debug"}) == {}

    def test_target_changes_never_touches_panel_mm(self) -> None:
        """`panel_mm` is not managed even when it differs from the default."""
        assert target_changes({}, DEFAULTS, {**DEFAULTS, "panel_mm": [1.0, 2.0]}) == {}

    def test_target_changes_never_touches_focus_modes(self) -> None:
        """The focus rules are written as rules, never replayed as a profile setting."""
        current = {**DEFAULTS, "focus_modes": {"apps": {"769": "off"}, "default": "on"}}
        assert target_changes({}, DEFAULTS, current) == {}

    def test_target_changes_empty_when_daemon_matches(self) -> None:
        """Nothing to send when the daemon already has the profile."""
        current = {**DEFAULTS, "pads": "left"}
        assert target_changes({"pads": "left"}, DEFAULTS, current) == {}


class TestAdopted:
    """What a profile becomes after the daemon changed."""

    def test_adopted_applies_changed_keys(self) -> None:
        """A key that changed between `before` and `after` is stored."""
        after = {**DEFAULTS, "pads": "left"}
        assert adopted({}, DEFAULTS, DEFAULTS, after) == {"pads": "left"}

    def test_adopted_drops_values_equal_to_default(self) -> None:
        """A key changed back to its default leaves the profile."""
        before = {**DEFAULTS, "pads": "left"}
        assert adopted({"pads": "left"}, DEFAULTS, before, DEFAULTS) == {}

    def test_adopted_ignores_keys_unchanged_between_before_and_after(self) -> None:
        """Keys that did not move keep the profile's own value."""
        after = {**DEFAULTS, "size": 2.0}
        assert adopted({"pads": "left"}, DEFAULTS, DEFAULTS, after) == {"pads": "left", "size": 2.0}

    def test_adopted_keeps_stored_keys_the_daemon_does_not_report(self) -> None:
        """Stored keys missing from `after` stay in the profile."""
        after = {**DEFAULTS, "size": 2.0}
        assert adopted({"pad_output": "x"}, DEFAULTS, DEFAULTS, after) == {"pad_output": "x", "size": 2.0}

    def test_adopted_with_empty_before_takes_every_managed_key_and_keeps_unreported(self) -> None:
        """An empty `before` adopts the whole managed state of `after`, minus never-stored keys."""
        rules = {"apps": {"769": "off"}, "default": "on"}
        after = {**DEFAULTS, "pads": "left", "log_level": "debug", "panel_mm": [1.0, 2.0], "focus_modes": rules}
        result = adopted({"pad_output": "x", "size": 3.0}, DEFAULTS, {}, after)
        assert result == {"pad_output": "x", "pads": "left"}


class TestGameProfiles:
    """Creating, enabling and disabling game profiles."""

    def test_enabling_copies_global(self) -> None:
        """A new profile starts from the global settings and the global Active."""
        store = with_game_profile(Store(global_settings={"size": 2.0}, global_active=True), BALATRO, True)
        assert store.games[BALATRO.appid] == GameProfile("Balatro", True, {"size": 2.0}, active=True)
        assert active_profile(store, BALATRO.appid) == "game:2379780"

    def test_disabling_keeps_game_settings_and_returns_global(self) -> None:
        """Disabling hides the profile without losing its settings."""
        store = with_game_profile(Store(), BALATRO, True)
        store = with_profile_settings(store, "game:2379780", {"pads": "left"})
        store = with_game_profile(store, BALATRO, False)
        assert store.games[BALATRO.appid].settings == {"pads": "left"}
        assert active_profile(store, BALATRO.appid) == GLOBAL

    def test_reenabling_keeps_existing_settings_and_refreshes_name(self) -> None:
        """An existing profile is not overwritten by global; only the name updates."""
        store = Store(
            global_settings={"size": 2.0}, global_active=True, games={1: GameProfile("Old", False, {"pads": "left"})}
        )
        updated = with_game_profile(store, Game(1, "New"), True)
        assert updated.games[1] == GameProfile("New", True, {"pads": "left"}, active=False)

    def test_limit_raises_past_200_games(self) -> None:
        """The 201st game is refused, while existing games can still change."""
        games = {appid: GameProfile("g", True, {}) for appid in range(1, 201)}
        store = Store(games=games)
        with pytest.raises(ProfileLimitError):
            with_game_profile(store, Game(999, "extra"), True)
        assert with_game_profile(store, Game(5, "g"), False).games[5].enabled is False
