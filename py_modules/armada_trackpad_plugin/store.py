"""The versioned JSON store file that persists the profiles.

The file lives in the plugin's own settings directory. A file that cannot be trusted is moved aside as `.bad`
instead of deleted, so a bug here never destroys the user's profiles.
"""

import errno
import json
import os
import stat
import tempfile
from dataclasses import dataclass
from pathlib import Path

from armada_trackpad_plugin.profiles import GLOBAL, MAX_GAMES, MAX_STRING, GameProfile, Settings, Store, storable


MAX_STORE_BYTES = 256 * 1024
VERSION = 2
# The only format read; a file of any other version is moved aside like any other unreadable file.
MAX_APPID = 2**32 - 1
MAX_NAME = 128
_TOP_KEYS = frozenset({"version", "last_instance", "daemon_profile", "global", "global_active", "games"})
_GAME_KEYS = frozenset({"name", "enabled", "active", "settings"})


@dataclass(frozen=True)
class Loaded:
    """The result of reading the store file.

    Args:
        store: The stored profiles; empty when the file is missing or was rejected.
        exists: Whether a file was present, even a rejected one.
        warning: A message for the user when the file was rejected, else `None`.
    """

    store: Store
    exists: bool
    warning: str | None


class _InvalidStoreError(ValueError):
    """Raised when the file's content does not match the store shape."""


def _reject_constant(name: str) -> object:
    """Refuse the non-standard JSON constants `NaN` and `Infinity`."""
    raise _InvalidStoreError(f"non-finite number {name}")


def _string(value: object, limit: int, what: str) -> str:
    """Return `value` when it is a string of at most `limit` characters."""
    if not isinstance(value, str) or len(value) > limit:
        raise _InvalidStoreError(f"{what} must be a string of at most {limit} characters")
    return value


def _settings(value: object, what: str) -> Settings:
    """Return `value` when it maps short keys to `storable` values."""
    if not isinstance(value, dict):
        raise _InvalidStoreError(f"{what} must be an object")
    for key, item in value.items():
        _string(key, MAX_STRING, f"{what} key")
        if not storable(item):
            raise _InvalidStoreError(f"{what}[{key!r}] is not a setting value")
    return value


def _appid(text: str) -> int:
    """Parse a canonical decimal app id in `1..MAX_APPID`."""
    if not (text.isascii() and text.isdecimal()) or text != str(int(text)) or not 1 <= int(text) <= MAX_APPID:
        raise _InvalidStoreError(f"{text!r} is not an app id")
    return int(text)


def _flag(value: object, what: str) -> bool:
    """Return `value` when it is a bool."""
    if not isinstance(value, bool):
        raise _InvalidStoreError(f"{what} must be a boolean")
    return value


def _game(value: object, appid: int) -> GameProfile:
    """Build the profile stored for `appid`."""
    if not isinstance(value, dict) or set(value) != _GAME_KEYS:
        raise _InvalidStoreError(f"game {appid} must have exactly {sorted(_GAME_KEYS)}")
    return GameProfile(
        _string(value["name"], MAX_NAME, f"game {appid} name"),
        _flag(value["enabled"], f"game {appid} enabled"),
        _settings(value["settings"], f"game {appid} settings"),
        _flag(value["active"], f"game {appid} active"),
    )


def _store(document: object) -> Store:
    """Validate a parsed document and build the `Store`."""
    if not isinstance(document, dict):
        raise _InvalidStoreError("top level must be an object")
    version = document.get("version")
    if type(version) is not int or version != VERSION:
        raise _InvalidStoreError(f"unsupported version {version!r}")
    if set(document) != _TOP_KEYS:
        raise _InvalidStoreError(f"the store must have exactly {sorted(_TOP_KEYS)}")
    last_instance = document["last_instance"]
    if last_instance is not None:
        _string(last_instance, MAX_STRING, "last_instance")
    games_raw = document["games"]
    if not isinstance(games_raw, dict) or len(games_raw) > MAX_GAMES:
        raise _InvalidStoreError(f"games must be an object of at most {MAX_GAMES} entries")
    games = {_appid(key): _game(value, _appid(key)) for key, value in games_raw.items()}
    daemon_profile = _string(document["daemon_profile"], MAX_STRING, "daemon_profile")
    if daemon_profile != GLOBAL:
        prefix, _, appid = daemon_profile.partition(":")
        if prefix != "game":
            raise _InvalidStoreError("daemon_profile must be 'global' or 'game:<appid>'")
        _appid(appid)
    global_active = _flag(document["global_active"], "global_active")
    return Store(last_instance, daemon_profile, _settings(document["global"], "global"), games, global_active)


def _read(path: Path) -> bytes | None:
    """Read the file without following a symlink; `None` when it does not exist.

    Raises:
        _InvalidStoreError: The path is a symlink, not a regular file, or the file exceeds `MAX_STORE_BYTES`.
    """
    try:
        # O_NONBLOCK keeps a FIFO at the path from blocking the open.
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    except OSError as error:
        if error.errno == errno.ELOOP:
            raise _InvalidStoreError("the store path is a symlink") from error
        raise
    with os.fdopen(fd, "rb") as file:
        if not stat.S_ISREG(os.fstat(file.fileno()).st_mode):
            raise _InvalidStoreError("the store path is not a regular file")
        data = file.read(MAX_STORE_BYTES + 1)
    if len(data) > MAX_STORE_BYTES:
        raise _InvalidStoreError(f"the file exceeds {MAX_STORE_BYTES} bytes")
    return data


def load(path: Path) -> Loaded:
    """Read the store file.

    A file that is a symlink, too large, not valid JSON, of another version than `VERSION` or not shaped like a
    store is renamed to `<name>.bad` (replacing an older one) and the result is an empty store with a warning.

    Args:
        path: The store file.

    Returns:
        The stored profiles with whether a file existed and any warning.

    Raises:
        OSError: The file could not be read or moved aside for a reason other than its content.
    """
    try:
        data = _read(path)
        if data is None:
            return Loaded(Store(), exists=False, warning=None)
        store = _store(json.loads(data, parse_constant=_reject_constant))
        return Loaded(store, exists=True, warning=None)
    except (ValueError, RecursionError) as error:
        bad = path.with_name(path.name + ".bad")
        os.replace(path, bad)
        warning = f"{path.name} was unreadable ({error}); kept as {bad.name}"
        return Loaded(Store(), exists=True, warning=warning)


def _encode(store: Store) -> bytes:
    """Encode a store in the file format."""
    games = {
        str(appid): {
            "name": profile.name,
            "enabled": profile.enabled,
            "active": profile.active,
            "settings": profile.settings,
        }
        for appid, profile in store.games.items()
    }
    document = {
        "version": VERSION,
        "last_instance": store.last_instance,
        "daemon_profile": store.daemon_profile,
        "global": store.global_settings,
        "global_active": store.global_active,
        "games": games,
    }
    return json.dumps(document, indent=1, sort_keys=True, allow_nan=False).encode()


def _sync_dir(directory: Path) -> None:
    """Flush a directory so a rename in it survives a crash."""
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save(path: Path, store: Store) -> None:
    """Write the store file atomically with mode 0600.

    The data goes to a temp file in the same directory and replaces `path` by rename, so a crash leaves either
    the old or the new file and a symlink at `path` is replaced rather than written through.

    Args:
        path: The store file.
        store: The profiles to persist.

    Raises:
        ValueError: The store holds what `load` would reject (a non-finite number, an over-long name, a bad
            `daemon_profile`, too many games, ...) or its encoding exceeds `MAX_STORE_BYTES`.
        OSError: The file could not be written.
    """
    data = _encode(store)
    if len(data) > MAX_STORE_BYTES:
        raise ValueError(f"the store exceeds {MAX_STORE_BYTES} bytes")
    # The same check `load` applies, so a file that would be moved aside as bad is never written.
    _store(json.loads(data, parse_constant=_reject_constant))
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temp, path)
        _sync_dir(path.parent)
    except BaseException:
        Path(temp).unlink(missing_ok=True)
        raise
