"""Tests for the validation of callable arguments."""

import pytest
from armada_trackpad_plugin.profiles import Game
from armada_trackpad_plugin.validate import InvalidRequest, changes, flag, game, keys, profile


WRITABLE = frozenset({"size", "pads", "right.edges", "left.size", "right.anchor"})


class TestChanges:
    """`changes` accepts only small dicts of known keys with plain values."""

    def test_changes_accepts_when_shapes_are_allowed(self) -> None:
        """Floats, strings, lists of strings and null all pass."""
        value = {"right.anchor": "fixed", "size": 1.2, "right.edges": "recenter", "left.size": None}
        assert changes(value, WRITABLE) == value

    def test_changes_accepts_when_list_of_edges(self) -> None:
        """A list of one to four strings passes."""
        assert changes({"right.edges": ["clamp"] * 4}, WRITABLE) == {"right.edges": ["clamp"] * 4}

    def test_changes_accepts_when_bool_for_list_key(self) -> None:
        """Types are the daemon's job, so a bool passes."""
        assert changes({"right.edges": True}, WRITABLE) == {"right.edges": True}

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param([("size", 1)], id="not-a-dict"),
            pytest.param({f"k{i}": 1 for i in range(65)}, id="65-keys"),
            pytest.param({"panel_mm": 1}, id="panel_mm"),
            pytest.param({"log_level": "debug"}, id="log_level"),
            pytest.param({"focus_modes": "keep"}, id="focus_modes"),
            pytest.param({"nope": 1}, id="unknown-key"),
            pytest.param({"pads": "x" * 65}, id="long-string"),
            pytest.param({"size": float("nan")}, id="nan"),
            pytest.param({"size": float("inf")}, id="inf"),
            pytest.param({"size": {"a": 1}}, id="nested-dict"),
            pytest.param({"right.edges": ["a"] * 5}, id="list-of-5"),
            pytest.param({"right.edges": []}, id="empty-list"),
            pytest.param({"right.edges": [1]}, id="list-with-number"),
            pytest.param({"right.edges": ["x" * 65]}, id="list-with-long-string"),
            pytest.param({1: 1}, id="non-string-key"),
        ],
    )
    def test_changes_rejects_when_invalid(self, value: object) -> None:
        """Anything outside the allowed shapes raises."""
        with pytest.raises(InvalidRequest):
            changes(value, WRITABLE)

    @pytest.mark.parametrize("key", ["preset", "left.preset", "right.preset"])
    def test_changes_rejects_when_preset_key(self, key: str) -> None:
        """The daemon has no preset keys, so none is passed on to it."""
        with pytest.raises(InvalidRequest):
            changes({key: "swipe"}, WRITABLE)

    @pytest.mark.parametrize("key", ["panel_mm", "focus_modes"])
    def test_changes_rejects_never_stored_when_caller_allows_it(self, key: str) -> None:
        """A never-stored key stays rejected even inside `writable`."""
        with pytest.raises(InvalidRequest):
            changes({key: "x"}, WRITABLE | {key})

    def test_changes_error_caps_echo_when_key_is_long(self) -> None:
        """A long key is not echoed in full."""
        with pytest.raises(InvalidRequest) as raised:
            changes({"k" * 500: 1}, WRITABLE)
        assert len(str(raised.value)) < 200


class TestLimits:
    """Boundary values and caps."""

    def test_changes_accepts_when_exactly_64_writable_keys(self) -> None:
        """64 keys pass."""
        names = frozenset(f"k{i}" for i in range(65))
        assert len(changes(dict.fromkeys(sorted(names)[:64], 1), names)) == 64

    def test_changes_rejects_when_65_writable_keys(self) -> None:
        """Only the cap rejects 65 otherwise valid keys."""
        names = frozenset(f"k{i}" for i in range(65))
        with pytest.raises(InvalidRequest, match="at most"):
            changes(dict.fromkeys(names, 1), names)

    def test_changes_accepts_when_string_is_64_chars(self) -> None:
        """A 64-char string passes."""
        assert changes({"pads": "x" * 64}, WRITABLE) == {"pads": "x" * 64}

    def test_changes_rejects_when_negative_infinity(self) -> None:
        """`-inf` is not finite."""
        with pytest.raises(InvalidRequest):
            changes({"size": float("-inf")}, WRITABLE)

    def test_game_accepts_when_boundaries(self) -> None:
        """The largest app id and a 128-char name pass."""
        assert game(2**32 - 1, "n" * 128) == Game(2**32 - 1, "n" * 128)

    def test_game_rejects_when_appid_false(self) -> None:
        """`False` is a bool, not the global app id 0."""
        with pytest.raises(InvalidRequest):
            game(False, "x")

    def test_profile_accepts_when_max_appid(self) -> None:
        """The largest app id passes."""
        assert profile(f"game:{2**32 - 1}") == f"game:{2**32 - 1}"

    @pytest.mark.parametrize("value", ["game:" + "9" * 5000, "game:\uff11\uff12", "game:1 ", " game:1", "game:1\n"])
    def test_profile_rejects_when_unbounded_or_not_ascii(self, value: str) -> None:
        """Huge, non-ASCII or padded references raise without parsing."""
        with pytest.raises(InvalidRequest):
            profile(value)

    def test_error_echo_is_bounded_when_value_is_all_escapes(self) -> None:
        """The echoed text stays short even when `repr` expands it."""
        with pytest.raises(InvalidRequest) as raised:
            changes({"\n" * 500: 1}, WRITABLE)
        assert len(str(raised.value)) < 120

    def test_keys_rejects_when_duplicates(self) -> None:
        """A repeated key raises."""
        with pytest.raises(InvalidRequest):
            keys(["size", "size"], WRITABLE)


class TestKeys:
    """`keys` accepts `None` or a short list of writable keys."""

    def test_keys_returns_none_when_none(self) -> None:
        """`None` means every managed key."""
        assert keys(None, WRITABLE) is None

    def test_keys_returns_list_when_known(self) -> None:
        """Known keys pass."""
        assert keys(["size", "pads"], WRITABLE) == ["size", "pads"]

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param("size", id="string"),
            pytest.param(["nope"], id="unknown"),
            pytest.param(["panel_mm"], id="never-stored"),
            pytest.param(["focus_modes"], id="focus-rules"),
            pytest.param([1], id="number"),
            pytest.param(["size"] * 65, id="too-many"),
        ],
    )
    def test_keys_rejects_when_invalid(self, value: object) -> None:
        """Anything else raises."""
        with pytest.raises(InvalidRequest):
            keys(value, WRITABLE | {"panel_mm", "focus_modes"})


class TestGame:
    """`game` validates the app id and name."""

    def test_game_is_none_when_appid_zero(self) -> None:
        """Zero means global."""
        assert game(0, "x") is None

    def test_game_is_none_when_appid_none(self) -> None:
        """`None` means global."""
        assert game(None, None) is None

    def test_game_returns_game_when_valid(self) -> None:
        """A valid id and name build a `Game`."""
        assert game(2379780, "Balatro") == Game(2379780, "Balatro")

    def test_game_accepts_when_name_empty(self) -> None:
        """An empty name is allowed."""
        assert game(1, "") == Game(1, "")

    @pytest.mark.parametrize(
        ("appid", "name"),
        [
            pytest.param(-1, "x", id="negative"),
            pytest.param(2**32, "x", id="too-large"),
            pytest.param(True, "x", id="bool"),
            pytest.param("1", "x", id="string"),
            pytest.param(1.0, "x", id="float"),
            pytest.param(1, "x" * 129, id="long-name"),
            pytest.param(1, None, id="no-name"),
        ],
    )
    def test_game_rejects_when_invalid(self, appid: object, name: object) -> None:
        """Invalid ids and names raise."""
        with pytest.raises(InvalidRequest):
            game(appid, name)


class TestProfile:
    """`profile` accepts `global` or `game:<appid>`."""

    def test_profile_accepts_when_global(self) -> None:
        """`global` passes."""
        assert profile("global") == "global"

    def test_profile_accepts_when_game(self) -> None:
        """A valid game reference passes."""
        assert profile("game:2379780") == "game:2379780"

    @pytest.mark.parametrize(
        "value",
        ["game:0", "game:x", "other", "game:4294967296", "game:-1", "game:01", "game: 1", 5, None],
    )
    def test_profile_rejects_when_invalid(self, value: object) -> None:
        """Anything else raises."""
        with pytest.raises(InvalidRequest):
            profile(value)


class TestFlag:
    """`flag` accepts only real bools."""

    @pytest.mark.parametrize("value", [True, False])
    def test_flag_accepts_when_bool(self, value: bool) -> None:
        """Bools pass through."""
        assert flag(value) is value

    @pytest.mark.parametrize("value", [1, 0, "true", None])
    def test_flag_rejects_when_not_bool(self, value: object) -> None:
        """Truthy non-bools raise."""
        with pytest.raises(InvalidRequest):
            flag(value)
