"""The daemon's focus fields and the focus rules the plugin derives from the profiles and the running game.

The daemon switches pad mode itself when gamescope's focused app changes, from rules the plugin writes as its
`focus_modes` setting: Steam's own UI turns the pads off and locks the toggle key and chord, a running game turns
them on or off by its current state (the session), any other game by the default of its own enabled profile, and
every other app by the global default.
"""

from collections.abc import Mapping
from dataclasses import dataclass

from armada_trackpad_plugin.profiles import MAX_GAMES, Store, active_profile, profile_active


STEAM_UI = 769
# Steam UI workaround: gamescope reports this one focused app id for all of Steam's own UI: the library, the QAM, the
# Steam menu, the controller configurator.
MANUAL = frozenset({"key", "chord"})
# The `mode_by` values of a mode the user switched by hand in the game.
_MODE_BY = frozenset({"start", "client", "focus", "unavailable"}) | MANUAL
_MAX_APP = 2**32 - 1
_STATES = frozenset({"on", "off"})
# The rules that carry a game's state; `off_locked` and `keep` never do.
_DAEMON_APPS = 256
# The most apps the daemon's `focus_modes` takes.
MAX_SESSIONS = _DAEMON_APPS - MAX_GAMES - 1
# The most games with a current state at once: with every game profile and Steam's UI, the rules still fit.
_FIELDS = ("focused_app", "mode_by")


@dataclass(frozen=True)
class FocusReport:
    """The focus fields of a daemon status.

    Args:
        focused_app: The app id gamescope has in front, or `None` while the daemon cannot tell.
        mode_by: What made the latest mode change: `start`, `client`, `key`, `chord`, `focus` or `unavailable`.
    """

    focused_app: int | None
    mode_by: str


def focus_report(status: Mapping[str, object]) -> FocusReport:
    """Read the focus fields of a daemon status.

    Args:
        status: A status object from the daemon, untrusted.

    Returns:
        The fields.

    Raises:
        ValueError: A field is missing, `focused_app` is not null or an int in `0..2**32-1`, or `mode_by` is not
            one of the daemon's values.
    """
    if not all(field in status for field in _FIELDS):
        raise ValueError("the status has no focus fields")
    app, mode_by = status["focused_app"], status["mode_by"]
    if app is not None and (not isinstance(app, int) or isinstance(app, bool) or not 0 <= app <= _MAX_APP):
        raise ValueError("the status has a malformed focused_app")
    if not isinstance(mode_by, str) or mode_by not in _MODE_BY:
        raise ValueError("the status has malformed focus fields")
    return FocusReport(app, mode_by)


def focused_game(report: FocusReport) -> int | None:
    """Return the game in front.

    Args:
        report: The daemon's focus fields.

    Returns:
        The focused app id, or `None` when Steam's UI is in front or the focus is unknown.
    """
    if report.focused_app in (None, STEAM_UI):
        return None
    return report.focused_app


def focus_rules(store: Store, sessions: Mapping[int, bool]) -> dict[str, object]:
    """Return the `focus_modes` setting that applies the defaults and the current states on each focus change.

    Args:
        store: The stored profiles, whose Active is each profile's default.
        sessions: The current state of each running game, by app id, oldest first; only the last `MAX_SESSIONS`
            count.

    Returns:
        `{"apps": {...}, "default": ...}`: Steam's UI `off_locked`, each game with a current state by it, each other
        game with an enabled profile by its default, and every other app by the global default. At most
        `MAX_GAMES + MAX_SESSIONS + 1` apps, within the daemon's 256.
    """
    games = {str(appid): _rule(profile.active) for appid, profile in store.games.items() if profile.enabled}
    current = {str(appid): _rule(on) for appid, on in list(sessions.items())[-MAX_SESSIONS:]}
    return {"apps": {**games, **current, str(STEAM_UI): "off_locked"}, "default": _rule(store.global_active)}


def with_session(sessions: Mapping[int, bool], appid: int, on: bool) -> dict[int, bool]:
    """Return `sessions` with the current state of `appid` set to `on`.

    Args:
        sessions: The current states by app id, oldest first.
        appid: The game whose state is set; it becomes the newest.
        on: Whether its pads are on.

    Returns:
        The new states, oldest first; past `MAX_SESSIONS` the oldest are dropped.
    """
    kept = {game: state for game, state in sessions.items() if game != appid}
    return dict(list({**kept, appid: on}.items())[-MAX_SESSIONS:])


def inherited_sessions(rules: object, store: Store) -> dict[int, bool]:
    """Return the current states a previous backend left in the daemon's `focus_modes`.

    Args:
        rules: The daemon's `focus_modes` setting, untrusted.
        store: The stored profiles, whose defaults the rules are compared with.

    Returns:
        Each game whose `on` or `off` rule differs from the default its profile gives, in the rules' order; at
        most the last `MAX_SESSIONS`. Empty for rules of another shape.
    """
    apps = rules.get("apps") if isinstance(rules, dict) else None
    if not isinstance(apps, dict):
        return {}
    states = {int(app): rule == "on" for app, rule in apps.items() if _is_game_id(app) and rule in _STATES}
    differing = {appid: on for appid, on in states.items() if on != _default_of(store, appid)}
    return dict(list(differing.items())[-MAX_SESSIONS:])


def _default_of(store: Store, appid: int) -> bool:
    """The default a game starts from: its own enabled profile's, else the global one."""
    return profile_active(store, active_profile(store, appid))


def _is_game_id(text: object) -> bool:
    """Whether `text` is an app id the plugin writes: decimal, no sign or leading zero, in `1..2**32-1`."""
    return (
        isinstance(text, str)
        and text.isascii()
        and text.isdecimal()
        and text == str(int(text))
        and 0 < int(text) <= _MAX_APP
    )


def _rule(on: bool) -> str:
    """The rule for a default or a current state."""
    return "on" if on else "off"
