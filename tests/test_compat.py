"""Tests for deciding from the daemon's `status` whether the plugin can work with it."""

import pytest
from armada_trackpad_plugin.compat import DAEMON_PROTOCOL, daemon_issue


SUPPORTED = {"protocol": DAEMON_PROTOCOL, "version": "0.2.0", "device": "retroid-pocket-nova", "reason": ""}
# The status fields the check reads, as a supported daemon of this protocol reports them.


class TestProtocol:
    """Only the protocol decides compatibility; the version string is shown, never compared."""

    @pytest.mark.parametrize("version", ["0.2.0", "0.3.1", "1.0.0"])
    def test_same_protocol_is_compatible_whatever_the_version(self, version: str) -> None:
        """Any version of a daemon that speaks this protocol is fine."""
        assert daemon_issue({**SUPPORTED, "version": version}) is None

    @pytest.mark.parametrize(
        "protocol",
        [
            pytest.param(None, id="missing"),
            pytest.param(DAEMON_PROTOCOL - 1, id="older"),
            pytest.param(str(DAEMON_PROTOCOL), id="string"),
            pytest.param(True, id="bool"),
            pytest.param(float(DAEMON_PROTOCOL), id="float"),
        ],
    )
    def test_missing_or_older_protocol_asks_for_a_daemon_update(self, protocol: object) -> None:
        """A daemon without a usable protocol number, or with a lower one, is the side to update."""
        status = {key: value for key, value in SUPPORTED.items() if key != "protocol"}
        if protocol is not None:
            status["protocol"] = protocol
        assert daemon_issue(status) == {"kind": "update_daemon", "version": "0.2.0"}

    def test_newer_protocol_asks_for_a_plugin_update(self) -> None:
        """A daemon with a higher protocol number needs a newer plugin."""
        assert daemon_issue({**SUPPORTED, "protocol": DAEMON_PROTOCOL + 1, "version": "0.9.0"}) == {
            "kind": "update_plugin",
            "version": "0.9.0",
        }

    def test_other_protocol_wins_over_an_unsupported_device(self) -> None:
        """An old daemon on unsupported hardware is updated first: its status may mean something else."""
        assert daemon_issue({"version": "0.1.0", "device": "", "reason": "device not supported: AYN Odin 2"}) == {
            "kind": "update_daemon",
            "version": "0.1.0",
        }

    @pytest.mark.parametrize("version", [None, "", 2])
    def test_unreadable_version_is_shown_as_unknown(self, version: object) -> None:
        """A version that is missing, empty or not a string reads `unknown` in the issue."""
        status = {"version": version} if version is not None else {}
        assert daemon_issue(status) == {"kind": "update_daemon", "version": "unknown"}


class TestDevice:
    """A daemon of this protocol on hardware without a device profile reports an empty `device`."""

    def test_empty_device_is_unsupported_with_the_daemons_reason(self) -> None:
        """The issue carries the daemon's reason, which names the hardware it found."""
        status = {**SUPPORTED, "device": "", "reason": "device not supported: AYN Odin 2"}
        assert daemon_issue(status) == {
            "kind": "unsupported_device",
            "version": "0.2.0",
            "reason": "device not supported: AYN Odin 2",
        }

    def test_unreadable_reason_is_left_empty(self) -> None:
        """A reason that is not a string reads as empty, so the issue keeps its shape."""
        assert daemon_issue({**SUPPORTED, "device": "", "reason": None}) == {
            "kind": "unsupported_device",
            "version": "0.2.0",
            "reason": "",
        }
