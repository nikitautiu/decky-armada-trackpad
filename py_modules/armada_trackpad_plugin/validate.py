"""Validation of every argument the frontend passes to the backend's callables.

Any script in Steam's browser can call the callables, so each argument is checked against a closed set of
shapes before it reaches the daemon or the store. Ranges and enums are the daemon's job.
"""

import math
import re

from armada_trackpad_plugin.profiles import GLOBAL, NEVER_STORED, Game


MAX_KEYS = 64
MAX_STRING = 64
MAX_NAME = 128
MAX_LIST = 4
MAX_APPID = 2**32 - 1
_ECHO = 64
_PROFILE = re.compile(r"game:([1-9][0-9]{0,9})")


class InvalidRequest(ValueError):  # noqa: N818 -- the name is the callable contract, not an error suffix style
    """Raised when a callable argument is outside the allowed shapes."""


def _echo(value: object) -> str:
    """Return a short printable form of an untrusted value for an error message."""
    text = repr(value if isinstance(value, str) else type(value).__name__)
    return text[:_ECHO] + ("..." if len(text) > _ECHO else "")


def _is_string(value: object) -> bool:
    """Return whether `value` is a string within `MAX_STRING`."""
    return isinstance(value, str) and len(value) <= MAX_STRING


def _check_value(key: str, value: object) -> None:
    """Raise unless `value` is an allowed setting value."""
    if value is None or isinstance(value, bool | int) or _is_string(value):
        return
    if isinstance(value, float) and math.isfinite(value):
        return
    if isinstance(value, list) and 1 <= len(value) <= MAX_LIST and all(_is_string(item) for item in value):
        return
    raise InvalidRequest(f"invalid value for {_echo(key)}")


def changes(value: object, writable: frozenset[str]) -> dict[str, object]:
    """Validate a settings change.

    Args:
        value: The untrusted mapping of setting keys to new values.
        writable: The keys the daemon manages.

    Returns:
        The validated changes.

    Raises:
        InvalidRequest: The mapping is too large, names a key that is unknown or never written, or holds a
            value that is not null, a bool, a number, a short string or a list of one to four short strings.
    """
    if not isinstance(value, dict):
        raise InvalidRequest("changes must be an object")
    if len(value) > MAX_KEYS:
        raise InvalidRequest(f"at most {MAX_KEYS} keys per call")
    allowed = writable - NEVER_STORED
    for key, item in value.items():
        if not isinstance(key, str) or key not in allowed:
            raise InvalidRequest(f"unknown or read-only setting {_echo(key)}")
        _check_value(key, item)
    return dict(value)


def keys(value: object, writable: frozenset[str]) -> list[str] | None:
    """Validate the keys to reset.

    Args:
        value: The untrusted key list, or `None` for every managed key.
        writable: The keys the daemon manages.

    Returns:
        The validated keys, or `None` for all of them.

    Raises:
        InvalidRequest: The value is not a list of at most `MAX_KEYS` known keys.
    """
    if value is None:
        return None
    if not isinstance(value, list) or len(value) > MAX_KEYS:
        raise InvalidRequest(f"keys must be a list of at most {MAX_KEYS} names")
    allowed = writable - NEVER_STORED
    if len(set(map(str, value))) != len(value):
        raise InvalidRequest("duplicate keys")
    for key in value:
        if not isinstance(key, str) or key not in allowed:
            raise InvalidRequest(f"unknown or read-only setting {_echo(key)}")
    return list(value)


def profile(value: object) -> str:
    """Validate a profile reference.

    Args:
        value: The untrusted reference.

    Returns:
        `GLOBAL` or `game:<appid>` with an app id in `1..2**32-1`.

    Raises:
        InvalidRequest: The value is anything else.
    """
    if value == GLOBAL:
        return GLOBAL
    if isinstance(value, str) and (match := _PROFILE.fullmatch(value)) and int(match[1]) <= MAX_APPID:
        return value
    raise InvalidRequest(f"invalid profile {_echo(value)}")


def game(appid: object, name: object) -> Game | None:
    """Validate a game.

    Args:
        appid: The untrusted Steam app id; `0` or `None` mean no game.
        name: The untrusted display name, ignored without a game.

    Returns:
        The game, or `None` for the global profile.

    Raises:
        InvalidRequest: The app id is not an int in `1..2**32-1`, or the name is not a string within
            `MAX_NAME` characters.
    """
    if appid is None or (isinstance(appid, int) and not isinstance(appid, bool) and appid == 0):
        return None
    if not isinstance(appid, int) or isinstance(appid, bool) or not 1 <= appid <= MAX_APPID:
        raise InvalidRequest(f"invalid app id {_echo(appid)}")
    if not isinstance(name, str) or len(name) > MAX_NAME:
        raise InvalidRequest("invalid game name")
    return Game(appid, name)


def flag(value: object) -> bool:
    """Validate a boolean argument.

    Args:
        value: The untrusted value.

    Returns:
        The value.

    Raises:
        InvalidRequest: The value is not a real bool.
    """
    if not isinstance(value, bool):
        raise InvalidRequest("expected true or false")
    return value
