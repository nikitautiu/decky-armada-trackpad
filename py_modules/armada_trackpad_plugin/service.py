"""The service actions: start the daemon's user unit, read its status, and tell whether it is installed.

Each runs one fixed command as the session user, with a fixed environment, no shell, a time limit and a cap on
the output kept. The journal is out of reach: the backend has no supplementary groups and the journal is
readable only through the `wheel` ACL, so the status comes from the user manager alone.
"""

import asyncio
import contextlib
import re
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path


START_ARGV = ("/usr/bin/systemctl", "--user", "--no-block", "start", "armada-trackpadd.service")
STATUS_ARGV = ("/usr/bin/systemctl", "--user", "status", "armada-trackpadd.service", "--no-pager", "-n", "0")
# `-n 0` shows no journal lines, which this process could not read anyway.
UNIT_ARGV = ("/usr/bin/systemctl", "--user", "show", "armada-trackpadd.service", "--property=LoadState,ExecStart")
# Only what `read_unit` needs: whether the unit loads, and the program it starts.
STATUS_OK_CODES = (0, 3)
# `systemctl status` exits 3 for an inactive or failed unit: the offline case, whose status is what to show.
TIMEOUT = 10.0
# Seconds a command may run before it is killed.
OUTPUT_CAP = 16 * 1024
# Bytes of output kept.
_CHUNK = 64 * 1024


@dataclass(frozen=True)
class CommandResult:
    """The outcome of a command.

    Args:
        ok: The command ran and exited with one of the statuses that count as success.
        output: Its combined stdout and stderr, truncated, or the reason it did not run to completion.
    """

    ok: bool
    output: str


def command_env(uid: int) -> dict[str, str]:
    """Return the environment `systemctl --user` needs to reach the user's bus.

    Args:
        uid: The session user's uid.

    Returns:
        The only variables a command gets.
    """
    runtime = f"/run/user/{uid}"
    return {
        "XDG_RUNTIME_DIR": runtime,
        "DBUS_SESSION_BUS_ADDRESS": f"unix:path={runtime}/bus",
        "PATH": "/usr/bin",
        "LANG": "C.UTF-8",
    }


async def _collect(stream: asyncio.StreamReader, cap: int) -> bytes:
    """Read `stream` to its end and keep the first `cap` bytes.

    The rest is still read so the command is not left blocked on a full pipe and its exit status stays real.
    """
    kept = bytearray()
    while chunk := await stream.read(_CHUNK):
        kept += chunk[: cap - len(kept)]
    return bytes(kept)


async def run_command(
    argv: Sequence[str],
    env: Mapping[str, str],
    timeout: float = TIMEOUT,
    cap: int = OUTPUT_CAP,
    ok_codes: Collection[int] = (0,),
) -> CommandResult:
    """Run `argv` without a shell and collect its output.

    Args:
        argv: The program and its arguments.
        env: The complete environment of the child.
        timeout: Seconds before the child is killed.
        cap: Bytes of output to keep.
        ok_codes: The exit statuses that count as success.

    Returns:
        The result; a program that cannot be started or that outlives `timeout` gives `ok=False` and a reason.
        The child is killed when the awaiting task is cancelled.
    """
    try:
        process = await asyncio.create_subprocess_exec(
            *argv,
            env=dict(env),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
    except OSError as error:
        return CommandResult(False, f"could not run {argv[0]}: {error.strerror or type(error).__name__}")
    assert process.stdout is not None  # noqa: S101 -- stdout=PIPE above always gives a stream
    try:
        async with asyncio.timeout(timeout):
            data = await _collect(process.stdout, cap)
            await process.wait()
    except TimeoutError:
        return CommandResult(False, f"timed out after {timeout:g} s")
    finally:
        if process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                process.kill()
            await process.wait()
    return CommandResult(process.returncode in ok_codes, data.decode(errors="replace"))


async def start_daemon(uid: int) -> CommandResult:
    """Start the daemon's user unit without waiting for it to come up.

    Args:
        uid: The session user's uid.

    Returns:
        The result of `systemctl --user --no-block start`.
    """
    return await run_command(START_ARGV, command_env(uid))


async def read_status(uid: int) -> CommandResult:
    """Read the daemon unit's status from the user manager.

    Args:
        uid: The session user's uid.

    Returns:
        The result of `systemctl --user status`; a stopped or failed unit still counts as ok.
    """
    return await run_command(STATUS_ARGV, command_env(uid), ok_codes=STATUS_OK_CODES)


async def read_unit(uid: int) -> bool | None:
    """Tell whether the daemon is installed: its user unit loads and the program it starts exists.

    The unit file and the daemon's virtualenv both live in the user's home, so an uninstall or files removed by hand
    can take one and leave the other: the unit alone is not enough.

    Args:
        uid: The session user's uid.

    Returns:
        Whether the daemon is installed, or `None` when `systemctl` fails, the unit is masked (a masked unit shows
        no program) or the unit names no program.
    """
    result = await run_command(UNIT_ARGV, command_env(uid))
    if not result.ok:
        return None
    fields = dict(line.split("=", 1) for line in result.output.splitlines() if "=" in line)
    load_state = fields.get("LoadState")
    if load_state == "masked":
        return None
    if load_state != "loaded":
        return False
    program = re.search(r"\bpath=(\S+)", fields.get("ExecStart", ""))
    return None if program is None else Path(program.group(1)).exists()
