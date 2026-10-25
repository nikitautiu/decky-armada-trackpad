import { DialogButton, Focusable, GamepadButton, type GamepadEvent, PanelSection, PanelSectionRow } from "@decky/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { readStatus, readUnit, startDaemon } from "../backend";
import {
  type CommandMessage,
  FULL_LOG_HINT,
  NOT_INSTALLED,
  NOT_RUNNING,
  offlinePanel,
  startMessage,
  statusMessage,
  UNIT_CHECK_PENDING,
  UNIT_CHECK_TIMEOUT_MS,
  type UnitCheck,
  unitAnswered,
  unitTimedOut,
} from "../logic/offline";
import type { Offline } from "../logic/view";
import { parseCommandResult, parseUnit } from "../logic/wire";
import { AlertNotice } from "./AlertNotice";
import { Header } from "./Header";
import { BAD, MONO, MUTED, NOTE } from "./style";

// How far one D-pad press scrolls the output: about four lines.
const SCROLL_STEP_PX = 64;

/**
 * Command output in a box of its own height that the D-pad scrolls; React renders it as text, never as HTML.
 */
function OutputBox({ message }: { readonly message: CommandMessage }): ReactNode {
  const box = useRef<HTMLPreElement>(null);
  const scroll = (event: GamepadEvent): void => {
    const element = box.current;
    const step =
      event.detail.button === GamepadButton.DIR_DOWN
        ? SCROLL_STEP_PX
        : event.detail.button === GamepadButton.DIR_UP
          ? -SCROLL_STEP_PX
          : 0;
    if (element === null || step === 0) return;
    const before = element.scrollTop;
    element.scrollTop += step;
    // Focus stays on the box while it still scrolls, and moves on once the end is reached. Steam UI workaround: both
    // calls, since which one Steam's navigation honours is undocumented.
    if (element.scrollTop !== before) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  return (
    <Focusable
      // Steam UI workaround: a no-op activate handler is what makes Steam's navigation stop on a plain element.
      onActivate={() => undefined}
      onGamepadDirection={scroll}
    >
      <pre
        ref={box}
        style={{
          ...MONO,
          fontSize: "11px",
          lineHeight: "15px",
          margin: 0,
          maxHeight: "240px",
          overflowY: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          color: message.failed ? BAD : undefined,
        }}
      >
        {message.text}
      </pre>
    </Focusable>
  );
}

/**
 * The panel while the daemon can't be reached. Until `read_unit` answers (at most about a second): only the header.
 * Not installed: only how to install it. Otherwise, or while that is unknown: a notice, Start daemon, Show status and
 * where the log is.
 */
export function OfflineView({ snapshot }: { readonly snapshot: Offline }): ReactNode {
  const [unit, setUnit] = useState<UnitCheck>(UNIT_CHECK_PENDING);
  useEffect(() => {
    let current = true;
    const answer = (installed: boolean | null): void => {
      if (current) setUnit((check) => unitAnswered(check, installed));
    };
    const timer = setTimeout(() => setUnit(unitTimedOut), UNIT_CHECK_TIMEOUT_MS);
    readUnit()
      .then((reply) => answer(parseUnit(reply)))
      .catch((error: unknown) => {
        console.error("Touch Trackpad: read_unit failed", error);
        answer(null);
      });
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, []);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState<CommandMessage | null>(null);
  const [status, setStatus] = useState<CommandMessage | null>(null);
  const start = (): void => {
    setStarting(true);
    startDaemon()
      .then((reply) => setStarted(startMessage(parseCommandResult(reply))))
      .catch((error: unknown) => {
        console.error("Touch Trackpad: start_daemon failed", error);
        setStarted(startMessage(null));
      })
      .finally(() => setStarting(false));
  };
  const showStatus = (): void => {
    readStatus()
      .then((reply) => setStatus(statusMessage(parseCommandResult(reply))))
      .catch((error: unknown) => {
        console.error("Touch Trackpad: read_status failed", error);
        setStatus(statusMessage(null));
      });
  };
  const panel = offlinePanel(unit);
  if (panel === "checking") return <Header snapshot={snapshot} />;
  if (panel === "notInstalled") {
    return (
      <>
        <Header snapshot={snapshot} />
        <PanelSection>
          <PanelSectionRow>
            <AlertNotice notice={NOT_INSTALLED} />
          </PanelSectionRow>
        </PanelSection>
      </>
    );
  }
  return (
    <>
      <Header snapshot={snapshot} />
      <PanelSection>
        <PanelSectionRow>
          <AlertNotice notice={NOT_RUNNING} />
        </PanelSectionRow>
        <PanelSectionRow>
          <Focusable flow-children="row" style={{ display: "flex", gap: "10px", padding: "10px 0 4px" }}>
            <DialogButton style={{ flex: 1, minWidth: 0 }} disabled={starting} onClick={start}>
              {starting ? "Starting…" : "Start daemon"}
            </DialogButton>
            <DialogButton style={{ flex: 1, minWidth: 0 }} onClick={showStatus}>
              {status === null ? "Show status" : "Reload status"}
            </DialogButton>
          </Focusable>
        </PanelSectionRow>
        {started !== null && (
          <PanelSectionRow>
            {started.failed ? <OutputBox message={started} /> : <div style={{ ...NOTE, ...MUTED }}>{started.text}</div>}
          </PanelSectionRow>
        )}
        {status !== null && (
          <PanelSectionRow>
            <OutputBox message={status} />
          </PanelSectionRow>
        )}
        <PanelSectionRow>
          <div style={{ ...MONO, ...NOTE, ...MUTED, wordBreak: "break-word" }}>{FULL_LOG_HINT}</div>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}
