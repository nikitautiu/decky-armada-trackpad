"""The per-game profile model: pure functions over an immutable `Store`, with no I/O.

A profile holds the settings that differ from the daemon's defaults, in the daemon's wire form, and its Active:
whether the pads are on while its game has focus (for the global profile, while any game without an enabled
profile of its own has focus). The plugin manages every setting the daemon reports except `NEVER_STORED` and
those whose key or value the store cannot hold.
"""

import math
from collections.abc import Mapping
from dataclasses import dataclass, field, replace


type Settings = Mapping[str, object]

FOCUS_MODES = "focus_modes"
# The daemon's focus rules: the plugin writes them from the defaults and the running games' states, never stored.
NEVER_STORED = frozenset({"panel_mm", "log_level", FOCUS_MODES})
# Hardware and diagnostics settings, and the focus rules: never stored in a profile, replayed or edited.
GLOBAL = "global"
MAX_GAMES = 200
MAX_STRING = 64
# The longest setting key or string value, and the longest string in a list value, the store holds.
_GAME_PREFIX = "game:"


class ProfileLimitError(ValueError):
    """Raised when a new game profile would exceed `MAX_GAMES`."""


@dataclass(frozen=True)
class Game:
    """A Steam game.

    Args:
        appid: The Steam app id.
        name: The display name.
    """

    appid: int
    name: str


@dataclass(frozen=True)
class GameProfile:
    """The stored profile of one game.

    Args:
        name: The game's display name when the profile was last touched.
        enabled: Whether the profile applies while the game runs.
        settings: The settings that differ from the defaults.
        active: Whether the pads are on while the game has focus.
    """

    name: str
    enabled: bool
    settings: Settings
    active: bool = False


@dataclass(frozen=True)
class Store:
    """Every stored profile.

    Args:
        last_instance: The daemon instance the plugin last synced with.
        daemon_profile: The profile last applied to `last_instance`.
        global_settings: The global profile's settings.
        games: The game profiles, keyed by Steam app id.
        global_active: The global profile's Active.
    """

    last_instance: str | None = None
    daemon_profile: str = GLOBAL
    global_settings: Settings = field(default_factory=dict)
    games: Mapping[int, GameProfile] = field(default_factory=dict)
    global_active: bool = False


def profile_ref(appid: int | None) -> str:
    """Return the reference of the profile a game owns.

    Args:
        appid: The game's Steam app id, or `None` without a game.

    Returns:
        `game:<appid>`, or `GLOBAL` without a game.
    """
    return GLOBAL if appid is None else f"{_GAME_PREFIX}{appid}"


def active_profile(store: Store, appid: int | None) -> str:
    """Return the reference of the profile that applies to a game.

    Args:
        store: The stored profiles.
        appid: The game's Steam app id, or `None` without a game.

    Returns:
        The game's reference when it has an enabled profile, otherwise `GLOBAL`.
    """
    if appid is not None and (profile := store.games.get(appid)) is not None and profile.enabled:
        return profile_ref(appid)
    return GLOBAL


def _appid(ref: str) -> int:
    """Return the app id inside a `game:<appid>` reference."""
    return int(ref.removeprefix(_GAME_PREFIX))


def profile_settings(store: Store, ref: str) -> Settings:
    """Return the settings stored under a profile reference.

    Args:
        store: The stored profiles.
        ref: `GLOBAL` or `game:<appid>`.

    Returns:
        The stored settings; empty for a game without a profile.
    """
    if ref == GLOBAL:
        return store.global_settings
    profile = store.games.get(_appid(ref))
    return {} if profile is None else profile.settings


def with_profile_settings(store: Store, ref: str, settings: Settings) -> Store:
    """Return a store whose profile `ref` holds `settings`.

    Args:
        store: The stored profiles.
        ref: `GLOBAL` or `game:<appid>`.
        settings: The new settings, already normalized.

    Returns:
        The updated store.

    Raises:
        KeyError: `ref` names a game without a profile.
    """
    if ref == GLOBAL:
        return replace(store, global_settings=settings)
    appid = _appid(ref)
    return replace(store, games={**store.games, appid: replace(store.games[appid], settings=settings)})


def profile_active(store: Store, ref: str) -> bool:
    """Return the Active stored under a profile reference.

    Args:
        store: The stored profiles.
        ref: `GLOBAL` or `game:<appid>`.

    Returns:
        The profile's Active; off for a game without a profile.
    """
    if ref == GLOBAL:
        return store.global_active
    profile = store.games.get(_appid(ref))
    return profile is not None and profile.active


def with_profile_active(store: Store, ref: str, on: bool) -> Store:
    """Return a store whose profile `ref` has Active `on`.

    Args:
        store: The stored profiles.
        ref: `GLOBAL` or `game:<appid>`.
        on: The new Active.

    Returns:
        The updated store.

    Raises:
        KeyError: `ref` names a game without a profile.
    """
    if ref == GLOBAL:
        return replace(store, global_active=on)
    appid = _appid(ref)
    return replace(store, games={**store.games, appid: replace(store.games[appid], active=on)})


def _short_string(value: object) -> bool:
    """Whether `value` is a string of at most `MAX_STRING` characters."""
    return isinstance(value, str) and len(value) <= MAX_STRING


def storable(value: object) -> bool:
    """Return whether the store can hold a setting value.

    Args:
        value: A setting value in the daemon's wire form.

    Returns:
        Whether it is null, a bool, an int, a finite float, a string of at most `MAX_STRING` characters, or a
        list of such strings.
    """
    if value is None or isinstance(value, bool | int) or _short_string(value):
        return True
    if isinstance(value, float):
        return math.isfinite(value)
    return isinstance(value, list) and all(_short_string(item) for item in value)


def _storable_setting(key: str, value: object) -> bool:
    """Whether the store can hold `key` with `value`."""
    return len(key) <= MAX_STRING and storable(value)


def managed_keys(reported: Settings) -> frozenset[str]:
    """Return the keys of daemon-reported settings that the plugin manages.

    Args:
        reported: Settings as the daemon reported them.

    Returns:
        The reported keys except `NEVER_STORED` and those the store cannot hold (see `unstorable_keys`).
    """
    return frozenset(
        key for key, value in reported.items() if key not in NEVER_STORED and _storable_setting(key, value)
    )


def unstorable_keys(reported: Settings) -> frozenset[str]:
    """Return the keys of daemon-reported settings left out of the profiles for their shape.

    Args:
        reported: Settings as the daemon reported them.

    Returns:
        The reported keys outside `NEVER_STORED` whose key is longer than `MAX_STRING` or whose value is not
        `storable`.
    """
    return frozenset(reported) - NEVER_STORED - managed_keys(reported)


def normalized(profile: Settings, defaults: Settings) -> dict[str, object]:
    """Drop the profile keys whose value equals the default.

    Args:
        profile: The profile's settings.
        defaults: The daemon's defaults.

    Returns:
        The differing keys; keys absent from `defaults` are kept since they cannot be compared.
    """
    return {key: value for key, value in profile.items() if key not in defaults or defaults[key] != value}


def target_changes(profile: Settings, defaults: Settings, current: Settings) -> dict[str, object]:
    """Return what to write so the daemon matches a profile.

    Args:
        profile: The profile to apply.
        defaults: The daemon's defaults.
        current: The daemon's current settings.

    Returns:
        The managed keys of `current` whose wanted value (the profile's, else the default) differs from the
        current one. Profile keys the daemon does not report are skipped.
    """
    wanted = {key: profile.get(key, defaults[key]) for key in managed_keys(current) if key in defaults}
    return {key: value for key, value in wanted.items() if value != current[key]}


def adopted(profile: Settings, defaults: Settings, before: Settings, after: Settings) -> dict[str, object]:
    """Fold the daemon's changes into a profile.

    Args:
        profile: The profile's settings.
        defaults: The daemon's defaults.
        before: The daemon's settings before the change; empty to treat every managed key as changed.
        after: The daemon's settings after the change.

    Returns:
        The profile with each changed managed key of `after` applied, then normalized. Stored keys that
        `after` does not report are kept.
    """
    merged = dict(profile)
    for key in managed_keys(after):
        if key not in before or before[key] != after[key]:
            merged[key] = after[key]
    return normalized(merged, defaults)


def with_game_profile(store: Store, game: Game, enabled: bool) -> Store:
    """Return a store with a game's profile enabled or disabled.

    A game without a profile starts from the global settings and Active. Disabling keeps the game's settings and
    Active. The stored name is refreshed either way.

    Args:
        store: The stored profiles.
        game: The game.
        enabled: Whether the profile should apply.

    Returns:
        The updated store.

    Raises:
        ProfileLimitError: Creating the profile would exceed `MAX_GAMES`.
    """
    existing = store.games.get(game.appid)
    if existing is None:
        if len(store.games) >= MAX_GAMES:
            raise ProfileLimitError(f"at most {MAX_GAMES} game profiles")
        profile = GameProfile(game.name, enabled, dict(store.global_settings), store.global_active)
    else:
        profile = replace(existing, name=game.name, enabled=enabled)
    return replace(store, games={**store.games, game.appid: profile})
