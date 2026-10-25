import type { CommandResult, UpdateSide } from "./wire";

/** A line to show under the offline view's buttons. */
export type CommandMessage = { readonly failed: boolean; readonly text: string };

const BAD_REPLY: CommandMessage = { failed: true, text: "The plugin's backend sent an unexpected reply." };

/** What to show after "Start daemon"; `result` is `null` when the reply had the wrong shape. */
export function startMessage(result: CommandResult | null): CommandMessage {
  if (result === null) return BAD_REPLY;
  // A started unit says nothing more: the backend's reconnect then replaces the offline view.
  if (result.ok) return { failed: false, text: "Started. The panel connects as soon as the daemon is up." };
  return { failed: true, text: result.output === "" ? "Starting failed with no output." : result.output };
}

/** What to show after "Show status"; `result` is `null` when the reply had the wrong shape. */
export function statusMessage(result: CommandResult | null): CommandMessage {
  if (result === null) return BAD_REPLY;
  if (result.output === "") {
    return {
      failed: !result.ok,
      text: result.ok ? "The system reported no status for the trackpad daemon." : "Reading the status failed.",
    };
  }
  return { failed: !result.ok, text: result.output };
}

/**
 * An optional diagnostic for bug reports: the backend can't read the journal, so the panel only names the command,
 * never runs it.
 */
export const FULL_LOG_HINT = "For a bug report, its full log: journalctl --user -u armada-trackpadd -n 50";

/** The headline and the line under it of a notice that replaces the panel. */
export type Notice = { readonly title: string; readonly text: string };

/** The notice while the daemon is installed, or that is unknown, but can't be reached. */
export const NOT_RUNNING: Notice = {
  title: "The trackpad daemon isn't running",
  text: "Touch Trackpad can't reach it. Your settings are kept and sent as soon as it's back.",
};

/** Where the daemon's README describes its installer, which also updates it. */
export const DAEMON_INSTALL_PAGE = "github.com/nikitautiu/armada-trackpad-daemon#install";

/** The notice while the daemon is not installed: its user unit or the program it starts is missing. */
export const NOT_INSTALLED: Notice = {
  title: "The trackpad daemon isn't installed",
  text:
    "Touch Trackpad needs the trackpad daemon, which is installed separately. Run its installer as described at " +
    `${DAEMON_INSTALL_PAGE}. Your settings are kept and sent as soon as it runs.`,
};

/**
 * Whether the offline view knows if the daemon is installed: `pending` until `read_unit` answers or the wait runs
 * out, then `settled` with the answer (`null` when unknown or too slow).
 */
export type UnitCheck = { readonly kind: "pending" } | { readonly kind: "settled"; readonly installed: boolean | null };

/** A unit check that has not settled yet. */
export const UNIT_CHECK_PENDING: UnitCheck = { kind: "pending" };

/** How long the offline view waits for `read_unit` before it shows Start daemon anyway. */
export const UNIT_CHECK_TIMEOUT_MS = 1000;

/**
 * The unit check after `read_unit` answers. An answer after the wait ran out is ignored: the view then already shows
 * Start daemon, and swapping it for the install notice would pull the button from under the focus.
 */
export function unitAnswered(check: UnitCheck, installed: boolean | null): UnitCheck {
  return check.kind === "pending" ? { kind: "settled", installed } : check;
}

/** The unit check once the wait for `read_unit` runs out: unknown, unless it has answered. */
export function unitTimedOut(check: UnitCheck): UnitCheck {
  return unitAnswered(check, null);
}

/** Which offline panel to show: nothing focusable while checking, so focus never lands on a button that goes away. */
export type OfflinePanel = "checking" | "notInstalled" | "notRunning";

/** The offline panel for `check`; an unknown install state gets the not-running panel with Start daemon. */
export function offlinePanel(check: UnitCheck): OfflinePanel {
  if (check.kind === "pending") return "checking";
  return check.installed === false ? "notInstalled" : "notRunning";
}

/** Where the plugin's README lists the devices the daemon supports. */
const SUPPORTED_DEVICES_PAGE = "github.com/nikitautiu/decky-armada-trackpad#supported-devices";

/**
 * The notice for a daemon on hardware it has no device profile for.
 *
 * @param daemonVersion - The version the daemon reports, or "unknown".
 * @param reason - The daemon's reason, which names the hardware it found.
 */
export function unsupportedNotice(daemonVersion: string, reason: string): Notice {
  return {
    title: "This device isn't supported",
    text:
      `The trackpad daemon (version ${daemonVersion}) reports: ${reason}. The supported devices are listed at ` +
      `${SUPPORTED_DEVICES_PAGE}.`,
  };
}

/** Where the plugin's releases are. */
const PLUGIN_RELEASES_PAGE = "github.com/nikitautiu/decky-armada-trackpad/releases";

/**
 * The notice for a daemon of another protocol: which side to update, with the daemon's version so the user can tell
 * what is installed.
 *
 * @param daemonVersion - The version the daemon reports, or "unknown".
 */
export function incompatibleNotice(update: UpdateSide, daemonVersion: string): Notice {
  const installed = `The installed trackpad daemon (version ${daemonVersion})`;
  return update === "daemon"
    ? {
        title: "Update the trackpad daemon",
        text:
          `${installed} is too old for this version of Touch Trackpad. Update it with its latest installer, as ` +
          `described at ${DAEMON_INSTALL_PAGE}.`,
      }
    : {
        title: "Update Touch Trackpad",
        text:
          `${installed} is newer than this version of Touch Trackpad supports. Install the latest release from ` +
          `${PLUGIN_RELEASES_PAGE}.`,
      };
}
