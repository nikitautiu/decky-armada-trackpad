import { DialogBody, DialogButton, DialogHeader, Focusable, ModalRoot, PanelSectionRow } from "@decky/ui";
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { Separator } from "../logic/layout";
import { type Frame, frameAt, precompute } from "../logic/preview/frame";
import { type Panel, type Point, panelOf, type Rect } from "../logic/preview/geometry";
import { NO_PANEL_SIZE } from "../logic/view";
import type { Settings } from "../logic/wire";
import { useModalOpener } from "./hooks";
import { RowButton } from "./RowButton";
import { FINGER, GHOST_LINE, MIDLINE, MUTED, NOTE, PAD_COLOR, SCREEN_FILL, SCREEN_LINE } from "./style";

// The drawing is in mm on the panel (its viewBox), so line widths, dashes and marks are in mm too.
const LINE_MM = 0.55;
const DASH_MM = "1.6 1.1";
const CORNER_MM = 2.2;
const FINGER_MM = 3.6;
const CONTACT_MM = 1.4;
const HELD_MM = 2.4;
const RIPPLE_FROM_MM = 2.5;
const RIPPLE_TO_MM = 7.5;

/**
 * How many `intervalS` periods have passed since the drawing mounted, checked on each animation frame until it
 * unmounts. A count, not a time, so the modal renders again only when it changes, not on every frame.
 */
function useTicks(ref: RefObject<SVGSVGElement | null>, intervalS: number): number {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    // Steam UI workaround: the drawing's own window, since the plugin's global one is Steam's hidden shared context,
    // where frames may not run.
    const view = ref.current?.ownerDocument.defaultView ?? window;
    let start: number | null = null;
    let request = 0;
    const tick = (now: number): void => {
      start ??= now;
      setTicks(Math.floor((now - start) / 1000 / intervalS));
      request = view.requestAnimationFrame(tick);
    };
    request = view.requestAnimationFrame(tick);
    return () => view.cancelAnimationFrame(request);
  }, [ref, intervalS]);
  return ticks;
}

/** `rect`, in screen fractions, as SVG attributes in mm on `panel`. */
function inMm(panel: Panel, rect: Rect): { x: number; y: number; width: number; height: number } {
  return {
    x: rect.x * panel.width,
    y: rect.y * panel.height,
    width: rect.width * panel.width,
    height: rect.height * panel.height,
  };
}

function centreMm(panel: Panel, point: Point): { cx: number; cy: number } {
  return { cx: point.x * panel.width, cy: point.y * panel.height };
}

function Drawing({ panel, shown }: { readonly panel: Panel; readonly shown: Frame }): ReactNode {
  const outline = { fill: "none", strokeWidth: LINE_MM };
  return (
    <>
      <rect x={0} y={0} width={panel.width} height={panel.height} rx={CORNER_MM} style={{ fill: SCREEN_FILL }} />
      {shown.areas.map((area) => (
        <rect key={area.side} {...inMm(panel, area.rect)} style={{ fill: PAD_COLOR[area.side], fillOpacity: 0.18 }} />
      ))}
      {shown.midline && (
        <line
          x1={panel.width / 2}
          y1={0}
          x2={panel.width / 2}
          y2={panel.height}
          style={{ stroke: MIDLINE, strokeWidth: LINE_MM / 2, strokeDasharray: DASH_MM }}
        />
      )}
      {shown.ghosts.map((ghost) => (
        <rect
          key={`${ghost.x},${ghost.y}`}
          {...inMm(panel, ghost)}
          rx={CORNER_MM}
          style={{ ...outline, stroke: GHOST_LINE, strokeDasharray: DASH_MM }}
        />
      ))}
      {shown.windows.map((window) => (
        <rect
          key={window.side}
          {...inMm(panel, window.rect)}
          rx={CORNER_MM}
          style={{
            fill: PAD_COLOR[window.side],
            fillOpacity: window.dashed ? 0.08 : 0.2,
            stroke: PAD_COLOR[window.side],
            strokeWidth: LINE_MM,
            strokeDasharray: window.dashed ? DASH_MM : "none",
          }}
        />
      ))}
      {shown.contact !== null && (
        <>
          <circle
            {...centreMm(panel, shown.contact.at)}
            r={CONTACT_MM}
            style={{ fill: PAD_COLOR[shown.contact.side] }}
          />
          {shown.contact.held && (
            <circle
              {...centreMm(panel, shown.contact.at)}
              r={HELD_MM}
              style={{ ...outline, stroke: PAD_COLOR[shown.contact.side] }}
            />
          )}
        </>
      )}
      {shown.ripple !== null && (
        <circle
          {...centreMm(panel, shown.ripple.at)}
          r={RIPPLE_FROM_MM + (RIPPLE_TO_MM - RIPPLE_FROM_MM) * shown.ripple.progress}
          style={{ ...outline, stroke: PAD_COLOR[shown.ripple.side], strokeOpacity: 1 - shown.ripple.progress }}
        />
      )}
      {shown.finger !== null && (
        <circle
          {...centreMm(panel, shown.finger)}
          r={FINGER_MM}
          style={{ fill: FINGER, fillOpacity: 0.28, stroke: FINGER, strokeWidth: LINE_MM }}
        />
      )}
      {/* The screen's outline, drawn in the drawing so it hugs the screen however the svg box is sized. */}
      <rect
        x={LINE_MM / 2}
        y={LINE_MM / 2}
        width={panel.width - LINE_MM}
        height={panel.height - LINE_MM}
        rx={CORNER_MM}
        style={{ ...outline, stroke: SCREEN_LINE }}
      />
    </>
  );
}

/** The whole screen at the panel's aspect, looping the pads' demos, the caption under it. */
function Animation({ settings, panel }: { readonly settings: Settings; readonly panel: Panel }): ReactNode {
  const svg = useRef<SVGSVGElement>(null);
  // The settings are a snapshot, so the whole loop is sampled once per opening and each frame is a lookup.
  const loop = useMemo(() => precompute(settings, panel), [settings, panel]);
  const shown = frameAt(loop, useTicks(svg, loop.interval) * loop.interval);
  return (
    <>
      <svg
        ref={svg}
        viewBox={`0 0 ${panel.width} ${panel.height}`}
        role="img"
        aria-label="How the pads react to touches"
        style={{ display: "block", width: "100%", maxHeight: "55vh" }}
      >
        <Drawing panel={panel} shown={shown} />
      </svg>
      <div style={{ ...NOTE, minHeight: "34px", margin: "8px 0 12px" }}>
        {shown.heading !== null && (
          <>
            <b>{shown.heading}</b> ·{" "}
          </>
        )}
        <span style={MUTED}>{shown.caption}</span>
      </div>
    </>
  );
}

/** The preview: the animation, or a line saying why there is none when the daemon reports no panel size. */
function PreviewModal({ settings, onClose }: { readonly settings: Settings; readonly onClose: () => void }): ReactNode {
  const panel = useMemo(() => panelOf(settings), [settings]);
  return (
    <ModalRoot onCancel={onClose} closeModal={onClose}>
      <DialogHeader>Preview</DialogHeader>
      <DialogBody>
        {panel === null ? (
          <div style={{ ...NOTE, ...MUTED, margin: "8px 0 12px" }}>{NO_PANEL_SIZE}</div>
        ) : (
          <Animation settings={settings} panel={panel} />
        )}
        <DialogButton preferredFocus onClick={onClose}>
          Close
        </DialogButton>
      </DialogBody>
    </ModalRoot>
  );
}

/**
 * The Preview row: opens a looping demo of how the pads behave with `settings`, as they are when it opens.
 *
 * Focus comes back to the row when the panel mounts again after the preview closes.
 */
export function PreviewRow({
  settings,
  bottomSeparator = "none",
}: {
  readonly settings: Settings;
  readonly bottomSeparator?: Separator;
}): ReactNode {
  // The modal is given this render's settings and is not rendered again by the panel, so it keeps them.
  const preview = useModalOpener("pads.preview", (close) => <PreviewModal settings={settings} onClose={close} />);
  return (
    <PanelSectionRow>
      <Focusable ref={preview.ref} preferredFocus={preview.preferred}>
        <RowButton bottomSeparator={bottomSeparator} onClick={preview.open}>
          Preview
        </RowButton>
      </Focusable>
    </PanelSectionRow>
  );
}
