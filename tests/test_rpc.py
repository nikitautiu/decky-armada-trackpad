"""Tests for the async JSON-RPC client against the fake daemon."""

import asyncio
import json
import os
from collections.abc import Awaitable, Callable
from pathlib import Path

import pytest
from armada_trackpad_plugin.rpc import MAX_LINE, Connection, PeerError, RpcError
from fake_daemon import FakeDaemon


def _run(tmp_path: Path, body: Callable[[FakeDaemon, Path], Awaitable[None]]) -> None:
    """Run `body` against a started fake daemon on a socket in `tmp_path`, stopping it afterwards."""

    async def scenario() -> None:
        """The scenario this test runs against the fake daemon."""
        fake = FakeDaemon()
        path = tmp_path / "armada-trackpad.sock"
        await fake.start(path)
        try:
            await body(fake, path)
        finally:
            await fake.stop()

    asyncio.run(asyncio.wait_for(scenario(), timeout=10))


class TestConnection:
    """The client's calls, notifications and failure handling."""

    def test_call_returns_result(self, tmp_path: Path) -> None:
        """A `status` call returns the daemon's status object."""

        async def body(fake: FakeDaemon, path: Path) -> None:
            """The scenario this test runs against the fake daemon."""
            conn = await Connection.open(path, os.getuid())
            try:
                result = await conn.call("status")
            finally:
                await conn.close()
            assert isinstance(result, dict)
            assert result["instance"] == fake.instance

        _run(tmp_path, body)

    def test_call_raises_rpc_error_when_daemon_answers_error(self, tmp_path: Path) -> None:
        """An error reply becomes an `RpcError` with the daemon's code and message."""

        async def body(fake: FakeDaemon, path: Path) -> None:
            """The scenario this test runs against the fake daemon."""
            fake.fail_next["status"] = (-32000, "nope")
            conn = await Connection.open(path, os.getuid())
            try:
                with pytest.raises(RpcError) as raised:
                    await conn.call("status")
            finally:
                await conn.close()
            assert raised.value.code == -32000
            assert raised.value.message == "nope"

        _run(tmp_path, body)

    def test_call_sends_params_by_name(self, tmp_path: Path) -> None:
        """The params mapping reaches the daemon as the request's params object."""

        async def body(fake: FakeDaemon, path: Path) -> None:
            """The scenario this test runs against the fake daemon."""
            conn = await Connection.open(path, os.getuid())
            try:
                await conn.call("set_settings", {"changes": {"size": 2.0}})
            finally:
                await conn.close()
            assert fake.calls == [("set_settings", {"changes": {"size": 2.0}})]
            assert fake.settings["size"] == 2.0

        _run(tmp_path, body)

    def test_notifications_arrive_between_calls(self, tmp_path: Path) -> None:
        """A `state_changed` published after `subscribe` lands in the queue as its params."""

        async def body(fake: FakeDaemon, path: Path) -> None:
            """The scenario this test runs against the fake daemon."""
            conn = await Connection.open(path, os.getuid())
            try:
                await conn.call("subscribe")
                await fake.notify()
                params = await asyncio.wait_for(conn.notifications.get(), timeout=5)
                assert "mode" in params
                assert await conn.call("status") is not None
            finally:
                await conn.close()

        _run(tmp_path, body)

    def test_open_raises_peer_error_when_uid_differs(self, tmp_path: Path) -> None:
        """A socket owned by another uid is refused."""

        async def body(_fake: FakeDaemon, path: Path) -> None:
            """The scenario this test runs against the fake daemon."""
            with pytest.raises(PeerError):
                await Connection.open(path, os.getuid() + 1)

        _run(tmp_path, body)

    def test_open_raises_os_error_when_no_daemon_listens(self, tmp_path: Path) -> None:
        """A missing socket surfaces as an `OSError` for the reconnect loop."""

        async def scenario() -> None:
            """The scenario this test runs against the fake daemon."""
            with pytest.raises(OSError):
                await Connection.open(tmp_path / "missing.sock", os.getuid())

        asyncio.run(scenario())

    def test_closed_set_when_line_too_long(self, tmp_path: Path) -> None:
        """A line over `MAX_LINE` bytes closes the connection and fails the pending call."""

        async def body(fake: FakeDaemon, path: Path) -> None:
            """The scenario this test runs against the fake daemon."""
            fake.silent.add("status")
            conn = await Connection.open(path, os.getuid())
            try:
                pending = asyncio.ensure_future(conn.call("status"))
                await fake.wait_for_call("status")
                await fake.send_raw(b"x" * (MAX_LINE + 1))
                await asyncio.wait_for(conn.closed.wait(), timeout=5)
                with pytest.raises(ConnectionError):
                    await pending
            finally:
                await conn.close()

        _run(tmp_path, body)

    def test_closed_set_when_line_is_not_json(self, tmp_path: Path) -> None:
        """A line that is not JSON closes the connection."""

        async def body(fake: FakeDaemon, path: Path) -> None:
            """The scenario this test runs against the fake daemon."""
            conn = await Connection.open(path, os.getuid())
            try:
                await fake.send_raw(b"not json\n")
                await asyncio.wait_for(conn.closed.wait(), timeout=5)
            finally:
                await conn.close()

        _run(tmp_path, body)

    def test_closed_set_when_line_holds_nan(self, tmp_path: Path) -> None:
        """A `NaN` token is rejected like any other bad line."""

        async def body(fake: FakeDaemon, path: Path) -> None:
            """The scenario this test runs against the fake daemon."""
            conn = await Connection.open(path, os.getuid())
            try:
                await fake.send_raw(b'{"jsonrpc":"2.0","id":1,"result":NaN}\n')
                await asyncio.wait_for(conn.closed.wait(), timeout=5)
            finally:
                await conn.close()

        _run(tmp_path, body)

    def test_closed_set_when_daemon_stops(self, tmp_path: Path) -> None:
        """Stopping the daemon sets `closed` and fails a call made afterwards."""

        async def body(fake: FakeDaemon, path: Path) -> None:
            """The scenario this test runs against the fake daemon."""
            conn = await Connection.open(path, os.getuid())
            try:
                await fake.stop()
                await asyncio.wait_for(conn.closed.wait(), timeout=5)
                with pytest.raises(ConnectionError):
                    await conn.call("status")
            finally:
                await conn.close()

        _run(tmp_path, body)

    def test_reconnect_sees_new_instance_when_daemon_restarts(self, tmp_path: Path) -> None:
        """After stop and start on the same path a new connection reads the new instance."""

        async def body(fake: FakeDaemon, path: Path) -> None:
            """The scenario this test runs against the fake daemon."""
            first = await Connection.open(path, os.getuid())
            await fake.stop()
            await asyncio.wait_for(first.closed.wait(), timeout=5)
            fake.instance = "bbbbbbbbbbbbbbbb"
            await fake.start(path)
            second = await Connection.open(path, os.getuid())
            try:
                result = await second.call("status")
            finally:
                await second.close()
                await first.close()
            assert isinstance(result, dict)
            assert result["instance"] == "bbbbbbbbbbbbbbbb"

        _run(tmp_path, body)

    def test_close_fails_pending_call_when_closed_locally(self, tmp_path: Path) -> None:
        """Closing the connection fails a call that is waiting for its reply."""

        async def body(fake: FakeDaemon, path: Path) -> None:
            """The scenario this test runs against the fake daemon."""
            fake.silent.add("status")
            conn = await Connection.open(path, os.getuid())
            pending = asyncio.ensure_future(conn.call("status"))
            await fake.wait_for_call("status")
            await conn.close()
            with pytest.raises(ConnectionError):
                await pending
            assert conn.closed.is_set()

        _run(tmp_path, body)

    def test_call_raises_value_error_when_request_too_long(self, tmp_path: Path) -> None:
        """An oversized request is refused before anything is sent, and the connection stays usable."""

        async def body(fake: FakeDaemon, path: Path) -> None:
            """Call with params larger than `MAX_LINE`."""
            conn = await Connection.open(path, os.getuid())
            try:
                with pytest.raises(ValueError, match="MAX_LINE"):
                    await conn.call("set_settings", {"changes": {"toggle_key": "x" * MAX_LINE}})
                assert fake.calls == []
                assert not conn.closed.is_set()
                assert await conn.call("status") is not None
            finally:
                await conn.close()

        _run(tmp_path, body)

    def test_call_sends_request_when_exactly_max_line(self, tmp_path: Path) -> None:
        """A request of exactly `MAX_LINE` bytes before its newline is sent."""

        async def body(fake: FakeDaemon, path: Path) -> None:
            """Pad the params until the compact encoding is `MAX_LINE` bytes."""
            request = {"jsonrpc": "2.0", "id": 1, "method": "status", "params": {"pad": ""}}
            overhead = len(json.dumps(request, separators=(",", ":")))
            conn = await Connection.open(path, os.getuid())
            try:
                await conn.call("status", {"pad": "x" * (MAX_LINE - overhead)})
            finally:
                await conn.close()
            assert len(fake.calls) == 1

        _run(tmp_path, body)

    def test_pending_call_fails_when_daemon_closes_mid_call(self, tmp_path: Path) -> None:
        """A call waiting for its reply fails with `ConnectionError` when the daemon hangs up."""

        async def body(fake: FakeDaemon, path: Path) -> None:
            """Stop the daemon while `status` is unanswered."""
            fake.silent.add("status")
            conn = await Connection.open(path, os.getuid())
            try:
                pending = asyncio.ensure_future(conn.call("status"))
                await fake.wait_for_call("status")
                await fake.stop()
                with pytest.raises(ConnectionError):
                    await asyncio.wait_for(pending, timeout=5)
            finally:
                await conn.close()

        _run(tmp_path, body)

    @pytest.mark.parametrize(
        "line",
        [
            b"x" * (MAX_LINE + 1) + b"\n",  # over-long but newline-terminated
            b'{"jsonrpc":"2.0","id":1,"result":1e999}\n',  # non-finite float
            b'{"jsonrpc":"2.0","id":1,"method":"state_changed","params":{}}\n',  # both id and method
            b'{"jsonrpc":"2.0","result":1}\n',  # neither a reply nor a notification
            b"[1]\n",  # not an object
        ],
    )
    def test_closed_set_when_line_is_untrustworthy(self, tmp_path: Path, line: bytes) -> None:
        """Lines that break the protocol close the connection."""

        async def body(fake: FakeDaemon, path: Path) -> None:
            """Send the line and wait for the client to hang up."""
            conn = await Connection.open(path, os.getuid())
            try:
                await fake.send_raw(line)
                await asyncio.wait_for(conn.closed.wait(), timeout=5)
            finally:
                await conn.close()

        _run(tmp_path, body)

    def test_reply_ignored_when_id_is_bool(self, tmp_path: Path) -> None:
        """A reply with `true` as id does not resolve call 1."""

        async def body(fake: FakeDaemon, path: Path) -> None:
            """Answer call 1 with a bool id, then with the real id."""
            fake.silent.add("status")
            conn = await Connection.open(path, os.getuid())
            try:
                pending = asyncio.ensure_future(conn.call("status"))
                await fake.wait_for_call("status")
                await fake.send_raw(b'{"jsonrpc":"2.0","id":true,"result":"wrong"}\n')
                await fake.send_raw(b'{"jsonrpc":"2.0","id":1,"result":"right"}\n')
                assert await asyncio.wait_for(pending, timeout=5) == "right"
            finally:
                await conn.close()

        _run(tmp_path, body)
