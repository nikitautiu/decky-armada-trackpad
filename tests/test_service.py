"""Tests for the service actions that start the daemon and read its unit status."""

import asyncio
import contextlib
import os
import signal
import sys
from collections.abc import Collection, Mapping, Sequence
from pathlib import Path

import pytest
from armada_trackpad_plugin import service
from armada_trackpad_plugin.service import CommandResult, command_env, run_command


class TestRunCommand:
    """`run_command` runs one fixed argv with a fixed environment and bounded time and output."""

    def test_output_truncated_to_cap(self) -> None:
        """Output beyond the cap is dropped and the command still counts as succeeded."""
        script = "import sys; sys.stdout.write('x' * 100000)"

        result = asyncio.run(run_command([sys.executable, "-c", script], {}, cap=1000))

        assert result == CommandResult(ok=True, output="x" * 1000)

    def test_timeout_kills_and_reports_not_ok(self) -> None:
        """A command that outlives the timeout is killed and reported as failed."""
        script = "import time; time.sleep(30)"

        result = asyncio.run(run_command([sys.executable, "-c", script], {}, timeout=0.3))

        assert result.ok is False
        assert "timed out" in result.output

    def test_timeout_is_one_deadline_when_the_child_outlives_its_output(self) -> None:
        """A child that prints for most of the timeout, then closes its output and keeps running, is killed in time."""
        script = (
            "import os, sys, time\n"
            "end = time.monotonic() + 0.9\n"
            "while time.monotonic() < end:\n"
            "    sys.stdout.write('x'); sys.stdout.flush(); time.sleep(0.05)\n"
            "os.close(1); os.close(2); time.sleep(30)\n"
        )

        async def timed() -> tuple[CommandResult, float]:
            """Run the script with a 1 s timeout and measure how long `run_command` took."""
            loop = asyncio.get_running_loop()
            started = loop.time()
            result = await run_command([sys.executable, "-c", script], {}, timeout=1.0)
            return result, loop.time() - started

        result, elapsed = asyncio.run(timed())

        assert result.ok is False
        assert elapsed < 1.5  # one 1 s deadline plus slack; two deadlines would take about 1.9 s

    def test_cancelled_command_kills_its_child(self, tmp_path: Path) -> None:
        """Cancelling the task awaiting a command kills and reaps the child instead of leaving it running."""
        pid_file = tmp_path / "pid"
        script = f"import os, time; open({str(pid_file)!r}, 'w').write(str(os.getpid())); time.sleep(30)"

        async def cancel_while_running() -> int:
            """Start the command, wait until the child runs, cancel the task and return the child's pid."""
            task = asyncio.create_task(run_command([sys.executable, "-c", script], {}))
            while not pid_file.exists() or not pid_file.read_text():
                await asyncio.sleep(0.01)
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            return int(pid_file.read_text())

        pid = asyncio.run(cancel_while_running())

        try:
            with pytest.raises(ProcessLookupError):
                os.kill(pid, 0)  # a reaped child no longer exists, not even as a zombie
        finally:
            with contextlib.suppress(ProcessLookupError):
                os.kill(pid, signal.SIGKILL)

    def test_env_is_exactly_the_given_env(self) -> None:
        """The child sees only the given variables, none of ours."""
        script = "import os; print(sorted(os.environ))"
        env = {"ARMADA_ONLY": "1"}

        result = asyncio.run(run_command([sys.executable, "-c", script], env))

        assert result.ok is True
        assert "ARMADA_ONLY" in result.output
        assert "HOME" not in result.output

    def test_failure_when_exit_code_is_nonzero_with_stderr_merged(self) -> None:
        """A non-zero exit is not ok and its stderr is part of the output."""
        script = "import sys; sys.stderr.write('boom'); sys.exit(3)"

        result = asyncio.run(run_command([sys.executable, "-c", script], {}))

        assert result == CommandResult(ok=False, output="boom")

    def test_ok_when_exit_code_is_one_of_the_ok_codes(self) -> None:
        """An exit status named in `ok_codes` counts as success and keeps its output."""
        script = "import sys; sys.stdout.write('inactive'); sys.exit(3)"

        result = asyncio.run(run_command([sys.executable, "-c", script], {}, ok_codes=(0, 3)))

        assert result == CommandResult(ok=True, output="inactive")

    def test_failure_when_program_is_missing(self) -> None:
        """A program that cannot be started is reported, not raised."""
        result = asyncio.run(run_command(["/nonexistent/program"], {}))

        assert result.ok is False
        assert result.output


class TestCommands:
    """The fixed commands and their environment."""

    def test_command_env_paths_use_uid(self) -> None:
        """The environment is exactly the session bus variables, PATH and LANG for the uid."""
        assert command_env(1000) == {
            "XDG_RUNTIME_DIR": "/run/user/1000",
            "DBUS_SESSION_BUS_ADDRESS": "unix:path=/run/user/1000/bus",
            "PATH": "/usr/bin",
            "LANG": "C.UTF-8",
        }

    def test_start_daemon_runs_the_start_argv_with_the_command_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """`start_daemon` runs `START_ARGV` with `command_env(uid)`."""
        calls: list[tuple[tuple[str, ...], dict[str, str]]] = []

        async def fake(argv: Sequence[str], env: Mapping[str, str]) -> CommandResult:
            calls.append((tuple(argv), dict(env)))
            return CommandResult(True, "")

        monkeypatch.setattr(service, "run_command", fake)

        result = asyncio.run(service.start_daemon(os.getuid()))

        assert result.ok is True
        assert calls == [(service.START_ARGV, command_env(os.getuid()))]

    def test_status_argv_never_reads_the_journal(self) -> None:
        """The status command asks the user manager only: `-n 0` keeps `systemctl` away from the journal."""
        assert service.STATUS_ARGV == (
            "/usr/bin/systemctl",
            "--user",
            "status",
            "armada-trackpadd.service",
            "--no-pager",
            "-n",
            "0",
        )

    def test_read_status_runs_the_status_argv_and_accepts_an_inactive_unit(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`read_status` runs `STATUS_ARGV` with `command_env(uid)`; exit 3 (inactive or failed unit) counts as ok."""
        calls: list[tuple[tuple[str, ...], dict[str, str], tuple[int, ...]]] = []

        async def fake(argv: Sequence[str], env: Mapping[str, str], *, ok_codes: Collection[int]) -> CommandResult:
            calls.append((tuple(argv), dict(env), tuple(sorted(ok_codes))))
            return CommandResult(True, "status")

        monkeypatch.setattr(service, "run_command", fake)

        result = asyncio.run(service.read_status(7))

        assert result == CommandResult(True, "status")
        assert calls == [(service.STATUS_ARGV, command_env(7), (0, 3))]


def _unit_show(load_state: str, program: str | None) -> str:
    """What `systemctl --user show -p LoadState,ExecStart` prints for a unit."""
    exec_start = "" if program is None else f"{{ path={program} ; argv[]={program} ; ignore_errors=no ; pid=0 }}"
    return f"LoadState={load_state}\nExecStart={exec_start}\n"


class TestReadUnit:
    """`read_unit`: whether the daemon is installed, from its user unit and the program it starts."""

    def test_unit_argv_reads_only_the_load_state_and_the_program(self) -> None:
        """One fixed `systemctl --user show` of the two properties it needs."""
        assert service.UNIT_ARGV == (
            "/usr/bin/systemctl",
            "--user",
            "show",
            "armada-trackpadd.service",
            "--property=LoadState,ExecStart",
        )

    @pytest.mark.parametrize(
        ("load_state", "program_exists", "installed"),
        [
            ("loaded", True, True),
            ("loaded", False, False),  # the unit file survived, the program did not (files removed by hand)
            ("not-found", None, False),
        ],
        ids=["installed", "program-gone", "no-unit"],
    )
    def test_installed_needs_the_unit_and_its_program(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
        load_state: str,
        program_exists: bool | None,
        installed: bool,
    ) -> None:
        """Installed means the unit loads and the program its `ExecStart` names exists."""
        program = tmp_path / "armada-trackpadd"
        if program_exists:
            program.write_text("")
        output = _unit_show(load_state, None if program_exists is None else str(program))
        calls: list[tuple[tuple[str, ...], dict[str, str]]] = []

        async def fake(argv: Sequence[str], env: Mapping[str, str]) -> CommandResult:
            calls.append((tuple(argv), dict(env)))
            return CommandResult(True, output)

        monkeypatch.setattr(service, "run_command", fake)

        assert asyncio.run(service.read_unit(7)) is installed
        assert calls == [(service.UNIT_ARGV, command_env(7))]

    @pytest.mark.parametrize(
        "result",
        [
            CommandResult(False, "Failed to connect to bus"),
            CommandResult(True, "LoadState=loaded\nExecStart=\n"),
            # A masked unit shows no `ExecStart`, so whether the daemon is installed cannot be told.
            CommandResult(True, "LoadState=masked\nExecStart=\n"),
        ],
        ids=["systemctl-failed", "no-program", "masked"],
    )
    def test_unknown_when_the_unit_cannot_be_read(self, monkeypatch: pytest.MonkeyPatch, result: CommandResult) -> None:
        """A failed `systemctl`, a loaded unit naming no program, or a masked unit tells nothing: `None`."""

        async def fake(_argv: Sequence[str], _env: Mapping[str, str]) -> CommandResult:
            return result

        monkeypatch.setattr(service, "run_command", fake)

        assert asyncio.run(service.read_unit(7)) is None
