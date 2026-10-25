"""A fake armada-trackpad-daemon: a real asyncio Unix-socket server speaking the control protocol.

It keeps its state in plain attributes that a test reads and mutates, so the same instance can be stopped and
started again on the same path to simulate a daemon restart. State is not reset by `start`: a test that wants
the settings of a fresh daemon assigns `fake.settings = dict(fake.defaults)`.
"""

import asyncio
import contextlib
import copy
import json
from collections.abc import Callable, Mapping
from pathlib import Path

from armada_trackpad_plugin.compat import DAEMON_PROTOCOL


type _Params = dict[str, object]

_SHARED_WITH_OVERRIDES = (
    "size",
    "center_y",
    "side",
    "anchor",
    "edges",
    "edge_grace_mm",
    "float_keep_inside",
    "tap",
    "tap_drag",
    "tap_output",
    "pad_output",
)
_INVALID_PARAMS = -32602
_UNAVAILABLE = -32000
_RULES = ("on", "off", "off_locked", "keep")
_OFF_RULES = frozenset({"off", "off_locked"})
_MAX_RULE_APPS = 256
_MAX_APP = 2**32 - 1


class _MethodError(Exception):
    """An error reply for the request being handled."""

    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


def _live_defaults() -> dict[str, object]:
    """The settings object as the daemon reports it on the Nova: overrides null, `edges` a list of four."""
    settings: dict[str, object] = {
        "pads": "both",
        "size": 1.0,
        "center_y": 0.5,
        "side": 0.0,
        "panel_mm": [91.0, 68.0],
        "anchor": "fixed",
        "edges": ["clamp"] * 4,
        "edge_grace_mm": 2.0,
        "float_keep_inside": False,
        "tap": True,
        "tap_drag": False,
        "tap_output": "pad",
        "pad_output": "pad",
        "tap_max_ms": 180,
        "tap_max_mm": 3.0,
        "click_ms": 40,
        "tap_drag_ms": 200,
        "toggle_key": "Insert",
        "toggle_chord": True,
        "log_level": "info",
        "focus_modes": {"apps": {}, "default": "keep"},
    }
    for side in ("left", "right"):
        for key in _SHARED_WITH_OVERRIDES:
            settings[f"{side}.{key}"] = None
    return settings


def _normalize_edges(value: object) -> object:
    """A single edge mode as a list of four; anything else unchanged."""
    return [value] * 4 if isinstance(value, str) else value


def _normalized(changes: Mapping[str, object]) -> dict[str, object]:
    """`changes` with every edges value as a list of four, as the daemon reports it."""
    return {key: _normalize_edges(value) if key.endswith("edges") else value for key, value in changes.items()}


def _is_app_id(text: str) -> bool:
    """Whether `text` is a decimal app id in 0..2^32-1 with no sign, space or leading zero."""
    return text.isascii() and text.isdecimal() and text == str(int(text)) and int(text) <= _MAX_APP


def _check_focus_modes(value: object) -> None:
    """Raise `invalid_params` unless `value` has the shape the daemon accepts for `focus_modes`."""
    if not isinstance(value, dict) or set(value) != {"apps", "default"}:
        raise _MethodError(_INVALID_PARAMS, "focus_modes must have exactly apps and default")
    apps = value["apps"]
    if not isinstance(apps, dict) or len(apps) > _MAX_RULE_APPS:
        raise _MethodError(_INVALID_PARAMS, f"focus_modes.apps must be an object of at most {_MAX_RULE_APPS} apps")
    if not all(_is_app_id(app) and rule in _RULES for app, rule in apps.items()) or value["default"] not in _RULES:
        raise _MethodError(_INVALID_PARAMS, "focus_modes has an invalid app id or rule")


def _params_object(params: object) -> _Params:
    if not isinstance(params, dict):
        raise _MethodError(_INVALID_PARAMS, "params must be an object")
    return params


class FakeDaemon:
    """A daemon on a Unix socket that answers the control protocol from mutable attributes.

    Attributes:
        settings: The current settings object.
        defaults: The device defaults, which `reset_settings` restores.
        mode: `"on"` or `"off"`.
        mode_by: What made the latest mode change, as the daemon reports it.
        focused_app: The app gamescope has in front, or `None` when unknown; change it with `focus`.
        available: Whether mode on is possible.
        reason: Why it is not, empty when available.
        instance: The id the daemon reports; change it between `stop` and `start` to simulate a restart.
        version: The version string the daemon reports.
        device: The device profile id the daemon reports, empty on unsupported hardware.
        protocol: The protocol number the daemon reports, or `None` to leave it out.
        fail_next: Method name to the `(code, message)` error returned for its next call only.
        silent: Method names that are recorded but never answered.
        held: Method names that are applied at once but answered only after `release`.
        calls: Every request received as `(method, params)`, in order.
    """

    def __init__(self) -> None:
        self.defaults: dict[str, object] = _live_defaults()
        self.settings: dict[str, object] = copy.deepcopy(self.defaults)
        self.mode = "off"
        self.mode_by = "start"
        self.focused_app: int | None = None
        self._on_waits = False  # an `on` rule waiting for the focus to settle
        self.available = True
        self.reason = ""
        self.instance = "aaaaaaaaaaaaaaaa"
        self.version = "0.2.0"
        self.device = "retroid-pocket-nova"
        # The protocol `status` reports; None leaves it out, as a daemon from before protocol numbers does.
        self.protocol: int | None = DAEMON_PROTOCOL
        self.checked_at: float | None = None
        self.fail_next: dict[str, tuple[int, str]] = {}
        self.silent: set[str] = set()
        self.held: set[str] = set()
        self._released = asyncio.Event()
        self.calls: list[tuple[str, _Params]] = []
        self._path: Path | None = None
        self._server: asyncio.Server | None = None
        self._clients: set[asyncio.StreamWriter] = set()
        self._subscribers: set[asyncio.StreamWriter] = set()
        self._call_arrived = asyncio.Event()
        self._methods: dict[str, Callable[[_Params], object]] = {
            "status": self._status,
            "subscribe": self._status,
            "get_settings": lambda _params: copy.deepcopy(self.settings),
            "get_defaults": lambda _params: copy.deepcopy(self.defaults),
            "set_settings": self._set_settings,
            "reset_settings": self._reset_settings,
            "set_mode": self._set_mode,
            "toggle": self._toggle,
            "check": self._check,
        }

    async def start(self, path: Path) -> None:
        """Listen on `path`, replacing a stale socket file."""
        with contextlib.suppress(FileNotFoundError):
            path.unlink()
        self._path = path
        self._server = await asyncio.start_unix_server(self._serve_client, path=str(path), limit=4 * 64 * 1024)

    async def stop(self) -> None:
        """Stop listening, hang up on every client and remove the socket file."""
        if self._server is None:
            return
        await asyncio.sleep(0.02)  # let the loop accept a client that just connected, so it is hung up on too
        self._server.close()
        for writer in list(self._clients):
            writer.transport.abort()
        await self._server.wait_closed()
        self._server = None
        self._subscribers.clear()
        if self._path is not None:
            with contextlib.suppress(FileNotFoundError):
                self._path.unlink()

    async def notify(self) -> None:
        """Publish a `state_changed` with the current status to every subscriber."""
        await self._publish()

    async def focus(self, app: int | None) -> None:
        """Move gamescope's focus to `app` and apply the rules as the daemon does.

        An `off` or `off_locked` rule applies at once; an `on` rule waits for `settle`, and the next focus change
        cancels it. Notifies only on a change.
        """
        if app == self.focused_app:
            return
        self.focused_app = app
        rule = self._rule(app)
        if rule in _OFF_RULES:
            self._change_mode("off", "focus")
        self._on_waits = rule == "on"
        await self._publish()

    async def settle(self) -> None:
        """Let the focus settle: an `on` rule waiting for it applies, unless pad mode is unavailable."""
        if self._on_waits and self.available:
            self._on_waits = False
            if self._change_mode("on", "focus"):
                await self._publish()

    async def press(self, source: str) -> None:
        """Toggle the mode with the toggle key (`"key"`) or the chord (`"chord"`), and notify.

        Ignored, with no notification, while an `off_locked` app is in front.
        """
        if self._rule(self.focused_app) == "off_locked":
            return
        self._on_waits = False
        self._change_mode("off" if self.mode == "on" else "on", source)
        await self._publish()

    async def send_raw(self, data: bytes) -> None:
        """Write `data` to every client as it is, newline or not, waiting for a first client to be accepted."""
        while not self._clients:
            await asyncio.sleep(0.005)
        for writer in list(self._clients):
            writer.write(data)
            await writer.drain()

    def release(self) -> None:
        """Send the replies of held methods, and answer them at once from now on."""
        self.held.clear()
        self._released.set()

    async def wait_for_call(self, method: str) -> None:
        """Return once `method` has been received at least once."""
        while not any(name == method for name, _params in self.calls):
            self._call_arrived.clear()
            await self._call_arrived.wait()

    def status(self) -> dict[str, object]:
        """The status object as the daemon reports it."""
        return {
            "mode_by": self.mode_by,
            "focused_app": self.focused_app,
            "mode": self.mode,
            "available": self.available,
            "reason": self.reason,
            "device": self.device,
            "pads": ["left", "right"],
            "toggle_key": self.settings["toggle_key"],
            "toggle_key_displays": [],
            "toggle_chord": "l1+l3+r1+r3",
            "toggle_chord_device": None,
            "version": self.version,
            **({} if self.protocol is None else {"protocol": self.protocol}),
            "instance": self.instance,
            "checked_at": self.checked_at,
            "inputplumber_version": "0.62.2",
        }

    async def _serve_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self._clients.add(writer)
        try:
            while line := await reader.readline():
                reply = self._handle(line, writer)
                if self.calls[-1][0] in self.held:
                    self._released.clear()
                    await self._released.wait()
                if reply is not None:
                    writer.write(reply)
                    await writer.drain()
                await self._publish_pending()
        except ConnectionError:
            pass  # the client hung up
        finally:
            self._clients.discard(writer)
            self._subscribers.discard(writer)
            writer.close()

    def _handle(self, line: bytes, writer: asyncio.StreamWriter) -> bytes | None:
        request = json.loads(line)
        method, params = request["method"], request.get("params", {})
        self.calls.append((method, params))
        self._call_arrived.set()
        if method in self.silent:
            return None
        try:
            if method in self.fail_next:
                code, message = self.fail_next.pop(method)
                raise _MethodError(code, message)
            handler = self._methods.get(method)
            if handler is None:
                raise _MethodError(-32601, f"unknown method {method!r}")
            result = handler(_params_object(params))
            if method == "subscribe":
                self._subscribers.add(writer)
            message_body: dict[str, object] = {"result": result}
        except _MethodError as exc:
            message_body = {"error": {"code": exc.code, "message": exc.message}}
        return json.dumps({"jsonrpc": "2.0", "id": request.get("id"), **message_body}).encode() + b"\n"

    def _status(self, _params: _Params) -> object:
        return self.status()

    # A change made by a handler is published after its reply, as the daemon's notifications follow the reply.
    _publish_requested = False

    async def _publish_pending(self) -> None:
        if self._publish_requested:
            self._publish_requested = False
            await self._publish()

    async def _publish(self) -> None:
        line = json.dumps({"jsonrpc": "2.0", "method": "state_changed", "params": self.status()}).encode() + b"\n"
        for writer in list(self._subscribers):
            if writer.is_closing():
                self._subscribers.discard(writer)
                continue
            writer.write(line)
            await writer.drain()

    def _apply(self, new_settings: dict[str, object]) -> None:
        if new_settings != self.settings:
            self.settings = new_settings
            self._publish_requested = True

    def _set_settings(self, params: _Params) -> object:
        changes = params.get("changes")
        if not isinstance(changes, dict) or set(params) != {"changes"}:
            raise _MethodError(_INVALID_PARAMS, "set_settings needs changes")
        expanded = _normalized(changes)
        unknown = sorted(set(expanded) - set(self.settings))
        if unknown:  # nothing is applied: the daemon validates the whole change first
            raise _MethodError(_INVALID_PARAMS, f"unknown settings: {', '.join(unknown)}")
        if "focus_modes" in expanded:
            _check_focus_modes(expanded["focus_modes"])
        self._apply({**self.settings, **expanded})
        return copy.deepcopy(self.settings)

    def _reset_settings(self, params: _Params) -> object:
        keys = params.get("keys")
        if keys is None:
            keys = list(self.settings)
        if not isinstance(keys, list) or not all(isinstance(key, str) for key in keys):
            raise _MethodError(_INVALID_PARAMS, "keys must be a list of setting names")
        unknown = sorted(set(keys) - set(self.settings))
        if unknown:
            raise _MethodError(_INVALID_PARAMS, f"unknown settings: {', '.join(unknown)}")
        self._apply({**self.settings, **{key: copy.deepcopy(self.defaults[key]) for key in keys}})
        return copy.deepcopy(self.settings)

    def _rule(self, app: int | None) -> str:
        """The rule the focus rules give `app`; `keep` for an unknown app."""
        if app is None:
            return "keep"
        rules = self.settings["focus_modes"]
        assert isinstance(rules, dict)  # `_check_focus_modes` keeps the shape
        return str(rules["apps"].get(str(app), rules["default"]))

    def _change_mode(self, mode: str, source: str) -> bool:
        """Set the mode and what made it; asking for the mode it already has changes nothing."""
        if mode == self.mode:
            return False
        self.mode, self.mode_by = mode, source
        return True

    def _switch_mode(self, on: bool) -> str:
        if on and not self.available:
            raise _MethodError(_UNAVAILABLE, self.reason)
        self._on_waits = False
        if self._change_mode("on" if on else "off", "client"):
            self._publish_requested = True
        return self.mode

    def _set_mode(self, params: _Params) -> object:
        on = params.get("on")
        if set(params) != {"on"} or not isinstance(on, bool):
            raise _MethodError(_INVALID_PARAMS, "set_mode takes on: true or false")
        return self._switch_mode(on)

    def _toggle(self, _params: _Params) -> object:
        return self._switch_mode(self.mode == "off")

    def _check(self, _params: _Params) -> object:
        self.checked_at = (self.checked_at or 0.0) + 1.0
        self._publish_requested = True
        return None
