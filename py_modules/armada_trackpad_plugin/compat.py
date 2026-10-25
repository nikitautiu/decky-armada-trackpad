"""Whether the plugin can work with the daemon, from the daemon's `status`.

The daemon reports an integer `protocol` that changes only when its control protocol changes incompatibly; an
additive change keeps it. The plugin works with exactly `DAEMON_PROTOCOL` and syncs nothing with any other daemon.
The daemon's `version` string is never compared, only shown, so the user can tell what is installed. A daemon of
this protocol on hardware without a device profile reports an empty `device` and refuses every call but `status`,
so it gets nothing synced either.
"""

from collections.abc import Mapping


DAEMON_PROTOCOL = 1
# The control protocol this plugin speaks: a daemon's `status` must report exactly this.

type DaemonIssue = dict[str, str]
# Why the plugin leaves a reachable daemon alone, as the snapshot carries it: `kind`, the daemon's `version` and,
# for an unsupported device, the daemon's `reason`.


def _shown_version(status: Mapping[str, object]) -> str:
    """The daemon's version as the panel shows it: `unknown` when it is missing, empty or not a string."""
    version = status.get("version")
    return version if isinstance(version, str) and version else "unknown"


def daemon_issue(status: Mapping[str, object]) -> DaemonIssue | None:
    """Decide from a daemon's status whether the plugin can sync with it.

    Args:
        status: The daemon's `status` result.

    Returns:
        `None` when the daemon speaks `DAEMON_PROTOCOL` on a supported device. Otherwise `kind` is `update_daemon`
        for a missing, malformed or lower protocol, `update_plugin` for a higher one, or `unsupported_device` for
        an empty `device`, which also carries the daemon's `reason`; `version` is the daemon's version, or
        `unknown`.
    """
    protocol = status.get("protocol")
    # Not `isinstance`: a JSON `true` arrives as a bool, which is an int equal to 1.
    if type(protocol) is not int:
        protocol = None
    if protocol == DAEMON_PROTOCOL:
        if status.get("device") != "":
            return None
        reason = status.get("reason")
        return {
            "kind": "unsupported_device",
            "version": _shown_version(status),
            "reason": reason if isinstance(reason, str) else "",
        }
    newer = protocol is not None and protocol > DAEMON_PROTOCOL
    return {"kind": "update_plugin" if newer else "update_daemon", "version": _shown_version(status)}
