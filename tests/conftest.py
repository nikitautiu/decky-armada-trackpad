"""Test setup: a stand-in for the `decky` module that Decky Loader provides at runtime."""

import logging
import sys
import tempfile
import types

import pytest


EMITTED: list[tuple[str, tuple[object, ...]]] = []
# Every event the code under test sent through `decky.emit`, in order.


async def _emit(event: str, *args: object) -> None:
    """Record an event instead of sending it to a frontend."""
    EMITTED.append((event, args))


def _install_decky() -> None:
    """Put a stub `decky` module into `sys.modules` before `main` imports it."""
    stub = types.ModuleType("decky")
    setattr(stub, "DECKY_PLUGIN_SETTINGS_DIR", tempfile.mkdtemp(prefix="decky-settings-"))  # noqa: B010 -- dynamic module
    setattr(stub, "logger", logging.getLogger("decky-stub"))  # noqa: B010
    setattr(stub, "emit", _emit)  # noqa: B010
    sys.modules["decky"] = stub


_install_decky()


@pytest.fixture(autouse=True)
def _clear_emitted() -> None:
    """Start each test with no recorded events."""
    EMITTED.clear()
