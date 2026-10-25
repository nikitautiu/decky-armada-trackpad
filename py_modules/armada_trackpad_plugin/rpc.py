"""An asyncio JSON-RPC 2.0 client for the daemon's control socket.

One UTF-8 JSON object per line, at most `MAX_LINE` bytes before the newline, in both directions. A single
reader task routes replies to the calls waiting for them and notifications to a queue. Any line the client
cannot trust (too long, not JSON, `NaN`, not an object) ends the connection, since the framing is lost.
"""

import asyncio
import contextlib
import itertools
import json
import math
import socket
import struct
from collections.abc import Mapping
from pathlib import Path
from typing import Self


MAX_LINE = 64 * 1024
# Bytes per line, not counting its newline, in both directions.

_PEERCRED = struct.Struct("iII")  # struct ucred: pid, uid, gid; ids are unsigned
_READ_CHUNK = 64 * 1024


class RpcError(Exception):
    """The daemon answered a call with an error.

    Args:
        code: The JSON-RPC error code.
        message: The daemon's message for the user.
    """

    def __init__(self, code: int, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code, self.message = code, message


class PeerError(OSError):
    """The socket's peer runs as another user than expected."""


class _BadLineError(Exception):
    """A line from the daemon that cannot be trusted."""


def _encode(message: Mapping[str, object]) -> bytes:
    # `json.dumps` escapes newlines inside strings, so the newline is a safe frame delimiter.
    return json.dumps(message, separators=(",", ":"), allow_nan=False).encode() + b"\n"


def _reject_constant(name: str) -> object:
    raise ValueError(f"{name} is not allowed")


def _reject_non_finite_float(text: str) -> float:
    value = float(text)
    if not math.isfinite(value):
        raise ValueError(f"{text} is not a finite number")
    return value


def _parse(line: bytes) -> dict[str, object]:
    """The JSON object on `line`; raises `_BadLineError` when it is anything else."""
    try:
        message: object = json.loads(
            line.decode("utf-8"), parse_constant=_reject_constant, parse_float=_reject_non_finite_float
        )
    except (UnicodeDecodeError, RecursionError, ValueError) as exc:  # JSONDecodeError is a ValueError
        raise _BadLineError(f"the daemon sent a line that is not valid JSON: {type(exc).__name__}") from None
    if not isinstance(message, dict):
        raise _BadLineError("the daemon sent something that is not an object")
    return message


def _result(reply: Mapping[str, object]) -> object:
    """The result of a response, or its error raised as `RpcError`."""
    error = reply.get("error")
    if error is None:
        return reply.get("result")
    if isinstance(error, dict):
        code, message = error.get("code"), error.get("message")
        if isinstance(code, int) and isinstance(message, str):
            raise RpcError(code, message)
    raise RpcError(-32603, "malformed error from the daemon")


def _check_peer(writer: asyncio.StreamWriter, expected_uid: int) -> None:
    """Raise `PeerError` unless the socket's peer runs as `expected_uid`."""
    sock: socket.socket = writer.get_extra_info("socket")
    _pid, uid, _gid = _PEERCRED.unpack(sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, _PEERCRED.size))
    if uid != expected_uid:
        raise PeerError(f"the socket belongs to uid {uid}, expected {expected_uid}")


class Connection:
    """One connection to the daemon; create it with `open`.

    Attributes:
        notifications: The params of each notification, in arrival order.
        closed: Set when the peer hangs up, sends a bad line, or `close` runs.
    """

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.notifications: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        self.closed = asyncio.Event()
        self._reader = reader
        self._writer = writer
        self._ids = itertools.count(1)
        self._pending: dict[int, asyncio.Future[object]] = {}
        self._reader_task = asyncio.create_task(self._read_loop())

    @classmethod
    async def open(cls, path: Path, expected_uid: int, timeout: float = 5.0) -> Self:
        """Connect to the daemon's socket and check who is on the other end.

        Args:
            path: The socket path.
            expected_uid: The only uid the peer may run as.
            timeout: Seconds to wait for the connection.

        Returns:
            The open connection.

        Raises:
            PeerError: The peer runs as another uid.
            OSError: The socket cannot be reached.
            TimeoutError: The connection took longer than `timeout`.
        """
        reader, writer = await asyncio.wait_for(asyncio.open_unix_connection(path), timeout)
        try:
            _check_peer(writer, expected_uid)
        except BaseException:
            writer.transport.abort()
            raise
        return cls(reader, writer)

    async def call(self, method: str, params: Mapping[str, object] | None = None) -> object:
        """Call `method` with `params` (by name) and wait for its result.

        Args:
            method: The daemon's method name.
            params: The method's params, or None for none.

        Returns:
            The reply's result.

        Raises:
            RpcError: The daemon answered with an error.
            ConnectionError: The connection is closed or closes before the reply.
            ValueError: The encoded request is over `MAX_LINE` bytes; nothing is sent.
        """
        if self.closed.is_set():
            raise ConnectionError("the connection is closed")
        request_id = next(self._ids)
        request: dict[str, object] = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            request["params"] = dict(params)
        line = _encode(request)
        if len(line) - 1 > MAX_LINE:
            raise ValueError(f"the request is over MAX_LINE ({MAX_LINE} bytes)")
        future: asyncio.Future[object] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        try:
            self._writer.write(line)
            await self._writer.drain()
            return await future
        except OSError as exc:  # a broken pipe while sending
            raise ConnectionError(str(exc)) from exc
        finally:
            self._pending.pop(request_id, None)
            if not future.done():
                future.cancel()
            elif not future.cancelled():
                future.exception()  # marks a failure no caller will raise as retrieved

    async def close(self) -> None:
        """Close the connection and fail the calls still waiting."""
        self._shut_down("the connection was closed")
        self._reader_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._reader_task
        with contextlib.suppress(OSError):
            await self._writer.wait_closed()

    def _shut_down(self, reason: str) -> None:
        """Mark the connection closed, drop the socket and fail every pending call."""
        self.closed.set()
        self._writer.transport.abort()
        for future in self._pending.values():
            if not future.done():
                future.set_exception(ConnectionError(reason))

    async def _read_loop(self) -> None:
        reason = "the daemon closed the connection"
        try:
            await self._route_lines()
        except _BadLineError as exc:
            reason = str(exc)
        except OSError as exc:  # includes ConnectionError
            reason = str(exc) or "the connection failed"
        finally:
            self._shut_down(reason)  # whatever ended the loop, no call may keep waiting

    async def _route_lines(self) -> None:
        """Route each line from the daemon until EOF; raises on a bad line."""
        buffer = b""
        while chunk := await self._reader.read(_READ_CHUNK):
            buffer += chunk
            while (newline := buffer.find(b"\n")) != -1:
                line, buffer = buffer[:newline], buffer[newline + 1 :]
                if len(line) > MAX_LINE:
                    raise _BadLineError(f"the daemon sent a line over {MAX_LINE} bytes")
                self._route(_parse(line))
            if len(buffer) > MAX_LINE:
                raise _BadLineError(f"the daemon sent a line over {MAX_LINE} bytes")

    def _route(self, message: dict[str, object]) -> None:
        is_notification = "method" in message and "id" not in message
        is_reply = "method" not in message and "id" in message and ("result" in message or "error" in message)
        if is_notification:
            params = message.get("params")
            if not isinstance(params, dict):
                raise _BadLineError("the daemon sent a notification without params")
            self.notifications.put_nowait(params)
        elif is_reply:
            self._resolve(message)
        else:
            raise _BadLineError("the daemon sent a message that is neither a reply nor a notification")

    def _resolve(self, reply: dict[str, object]) -> None:
        reply_id = reply["id"]
        if reply_id is None and "error" in reply:
            raise _BadLineError("the daemon rejected a request line")  # a parse error also ends its connection
        # `bool` is an `int`, but `true` is never an id this client sent.
        future = self._pending.get(reply_id) if isinstance(reply_id, int) and not isinstance(reply_id, bool) else None
        if future is None or future.done():
            return  # a reply to a call that was cancelled
        try:
            future.set_result(_result(reply))
        except RpcError as exc:
            future.set_exception(exc)
