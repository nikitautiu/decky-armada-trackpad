import { describe, expect, it } from "vitest";
import {
  DAEMON_INSTALL_PAGE,
  FULL_LOG_HINT,
  incompatibleNotice,
  NOT_INSTALLED,
  NOT_RUNNING,
  offlinePanel,
  startMessage,
  statusMessage,
  UNIT_CHECK_PENDING,
  type UnitCheck,
  unitAnswered,
  unitTimedOut,
  unsupportedNotice,
} from "./offline";

describe("startMessage", () => {
  it("waits for the connection after the unit started", () => {
    expect(startMessage({ ok: true, output: "" })).toEqual({
      failed: false,
      text: "Started. The panel connects as soon as the daemon is up.",
    });
  });

  it("shows systemctl's output when the start failed", () => {
    expect(startMessage({ ok: false, output: "Unit armada-trackpadd.service not found." })).toEqual({
      failed: true,
      text: "Unit armada-trackpadd.service not found.",
    });
  });

  it("says so when a failed start printed nothing", () => {
    expect(startMessage({ ok: false, output: "" })).toEqual({ failed: true, text: "Starting failed with no output." });
  });

  it("reports a reply of the wrong shape as a failure", () => {
    expect(startMessage(null)).toEqual({ failed: true, text: "The plugin's backend sent an unexpected reply." });
  });
});

describe("statusMessage", () => {
  it("shows the unit's status", () => {
    expect(statusMessage({ ok: true, output: "○ armada-trackpadd.service\n   Active: inactive (dead)" })).toEqual({
      failed: false,
      text: "○ armada-trackpadd.service\n   Active: inactive (dead)",
    });
  });

  it("says so when the status is empty", () => {
    expect(statusMessage({ ok: true, output: "" })).toEqual({
      failed: false,
      text: "The system reported no status for the trackpad daemon.",
    });
  });

  it("shows systemctl's output when reading failed", () => {
    expect(statusMessage({ ok: false, output: "Unit armada-trackpadd.service could not be found." })).toEqual({
      failed: true,
      text: "Unit armada-trackpadd.service could not be found.",
    });
  });

  it("says so when reading failed with no output", () => {
    expect(statusMessage({ ok: false, output: "" })).toEqual({ failed: true, text: "Reading the status failed." });
  });

  it("reports a reply of the wrong shape as a failure", () => {
    expect(statusMessage(null)).toEqual({ failed: true, text: "The plugin's backend sent an unexpected reply." });
  });
});

describe("FULL_LOG_HINT", () => {
  it("names the command for the full log", () => {
    expect(FULL_LOG_HINT).toBe("For a bug report, its full log: journalctl --user -u armada-trackpadd -n 50");
  });
});

describe("NOT_RUNNING", () => {
  it("says the daemon isn't running, without its internals", () => {
    expect(NOT_RUNNING).toEqual({
      title: "The trackpad daemon isn't running",
      text: "Touch Trackpad can't reach it. Your settings are kept and sent as soon as it's back.",
    });
  });
});

describe("NOT_INSTALLED", () => {
  it("says the daemon is a separate install and where its installer is described", () => {
    expect(NOT_INSTALLED).toEqual({
      title: "The trackpad daemon isn't installed",
      text:
        "Touch Trackpad needs the trackpad daemon, which is installed separately. Run its installer as described " +
        `at ${DAEMON_INSTALL_PAGE}. Your settings are kept and sent as soon as it runs.`,
    });
  });
});

describe("incompatibleNotice", () => {
  it("asks to update the daemon, naming its version and where its installer is described", () => {
    expect(incompatibleNotice("daemon", "0.1.0")).toEqual({
      title: "Update the trackpad daemon",
      text:
        "The installed trackpad daemon (version 0.1.0) is too old for this version of Touch Trackpad. Update it " +
        "with its latest installer, as described at github.com/nikitautiu/armada-trackpad-daemon#install.",
    });
  });

  it("asks to update the plugin, naming the daemon's version and where the plugin's releases are", () => {
    expect(incompatibleNotice("plugin", "0.9.0")).toEqual({
      title: "Update Touch Trackpad",
      text:
        "The installed trackpad daemon (version 0.9.0) is newer than this version of Touch Trackpad supports. " +
        "Install the latest release from github.com/nikitautiu/decky-armada-trackpad/releases.",
    });
  });

  it("names a daemon that reports no version as version unknown", () => {
    expect(incompatibleNotice("daemon", "unknown").text).toContain("(version unknown)");
  });
});

describe("unsupportedNotice", () => {
  it("says the device isn't supported, with the daemon's version and reason and where the list is", () => {
    expect(unsupportedNotice("0.2.0", "device not supported: AYN Odin 2")).toEqual({
      title: "This device isn't supported",
      text:
        "The trackpad daemon (version 0.2.0) reports: device not supported: AYN Odin 2. The supported devices are " +
        "listed at github.com/nikitautiu/decky-armada-trackpad#supported-devices.",
    });
  });
});

describe("offlinePanel", () => {
  it.each<[string, UnitCheck, ReturnType<typeof offlinePanel>]>([
    ["checking while read_unit has not answered", UNIT_CHECK_PENDING, "checking"],
    ["not installed when read_unit says so", { kind: "settled", installed: false }, "notInstalled"],
    ["not running when the daemon is installed", { kind: "settled", installed: true }, "notRunning"],
    ["not running when that is unknown", { kind: "settled", installed: null }, "notRunning"],
  ])("shows %s", (_name, check, panel) => {
    expect(offlinePanel(check)).toBe(panel);
  });
});

describe("unit check", () => {
  it.each([true, false, null])("takes read_unit's answer %s while pending", (installed) => {
    expect(unitAnswered(UNIT_CHECK_PENDING, installed)).toEqual({ kind: "settled", installed });
  });

  it("settles as unknown when read_unit is too slow", () => {
    expect(unitTimedOut(UNIT_CHECK_PENDING)).toEqual({ kind: "settled", installed: null });
  });

  it("ignores an answer after the timeout, so the buttons never change under the focus", () => {
    expect(unitAnswered(unitTimedOut(UNIT_CHECK_PENDING), false)).toEqual({ kind: "settled", installed: null });
  });

  it("ignores the timeout once read_unit has answered", () => {
    expect(unitTimedOut(unitAnswered(UNIT_CHECK_PENDING, false))).toEqual({ kind: "settled", installed: false });
  });
});
