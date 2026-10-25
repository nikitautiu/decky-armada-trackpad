import { type GamepadEvent, showModal } from "@decky/ui";
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { backGuardLeft } from "../logic/backGuard";
import { createDebouncer } from "../logic/debounce";
import { claim, createMemory } from "../logic/memory";
import { createPendingPicks, shownValue } from "../logic/picks";
import { backFrom, type PanelView } from "../logic/view";
import { guardedModal } from "./ErrorBoundary";

/**
 * A control value that follows `shown` but moves at once when edited, then sends the last edit `delayMs` later.
 *
 * The edit stays on screen until its send settles; after that `shown` (the backend's next snapshot) wins.
 *
 * @param send - Delivers an edit; it should settle once the backend's reply has been taken in.
 * @returns The value to show, and the edit handler.
 */
export function useDebouncedEdit<T>(
  shown: T,
  delayMs: number,
  send: (value: T) => Promise<void>,
): readonly [T, (value: T) => void] {
  // Boxed, so that an edit to a falsy or null value still counts as pending.
  const [pending, setPending] = useState<{ readonly value: T } | null>(null);
  const edits = useRef(0);
  const [debouncer] = useState(() => createDebouncer<() => void>(delayMs, (deliver) => deliver()));
  const edit = (value: T): void => {
    edits.current += 1;
    const thisEdit = edits.current;
    setPending({ value });
    // `send` is this render's closure, so the edit goes to the profile shown when the user made it.
    debouncer.push(() => {
      void send(value).finally(() => {
        if (edits.current === thisEdit) setPending(null);
      });
    });
  };
  return [pending === null ? shown : pending.value, edit];
}

// Steam UI workaround: a pick made in a dropdown's list reaches the instance that opened it, which Decky has unmounted
// by then, and the panel mounts again before the pick's write is answered; a pick kept in React state would vanish.
const PENDING_PICKS = createPendingPicks();

/**
 * A dropdown value that follows `selected` but moves to a pick at once and keeps it, across a remount of the panel,
 * until the pick's write settles; after that `selected` (the backend's next snapshot) wins.
 *
 * A pick of the value already shown writes nothing.
 *
 * @param focusId - The dropdown's focus id, which finds its pick again after the remount.
 * @param write - Writes a pick; it should settle once the backend's reply has been taken in, and resolve at once
 *   when it writes nothing.
 * @returns The value to show, and the dropdown's change handler.
 */
export function usePick(
  focusId: string,
  selected: string,
  write: (value: string) => Promise<void>,
): readonly [string, (value: unknown) => void] {
  const [pending, setPending] = useState(() => PENDING_PICKS.get(focusId));
  useEffect(() => {
    const sync = (): void => setPending(PENDING_PICKS.get(focusId));
    // A pick may have settled between the first render and this subscription.
    sync();
    return PENDING_PICKS.subscribe(sync);
  }, [focusId]);
  const shown = shownValue(pending, selected);
  const pick = (value: unknown): void => {
    if (typeof value !== "string" || value === shown) return;
    const recorded = PENDING_PICKS.pick(focusId, value);
    void write(value).finally(() => PENDING_PICKS.settle(focusId, recorded));
  };
  return [shown, pick];
}

const STORAGE_PREFIX = "decky-armada-trackpad:";

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + key);
    return stored === null ? fallback : stored === "true";
  } catch {
    // Storage can be unavailable; the flag then starts from its default.
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, String(value));
  } catch {
    // Storage can be unavailable; the flag then lasts only while the panel is open.
  }
}

/** A boolean kept in `localStorage` under `key`, such as whether a section is open. */
export function useStoredFlag(key: string, initial: boolean): readonly [boolean, (value: boolean) => void] {
  const [flag, setFlag] = useState(() => readFlag(key, initial));
  const update = (value: boolean): void => {
    setFlag(value);
    writeFlag(key, value);
  };
  return [flag, update];
}

// Steam UI workaround: a dropdown's list opens in another window, and the panel's content unmounts while it is open and
// mounts again when it closes; a view kept in React state would then start over at the main page.
const PANEL_VIEW = createMemory<PanelView>("main");

// Steam UI workaround: Steam starts a view at its first row, so the view B or a back row just left is kept for the row
// that opens it to take focus on the view it returns to.
const LEFT_VIEW = createMemory<PanelView | null>(null);

/** What {@link usePanelView} gives the panel. */
export type PanelViewState = {
  readonly view: PanelView;
  /** Opens a view inside the plugin, such as Advanced. */
  readonly open: (view: PanelView) => void;
  /** Goes back one level from the view shown. */
  readonly back: () => void;
};

/** The view the panel shows, kept across a remount of the panel. */
export function usePanelView(): PanelViewState {
  const [view, setView] = useState(PANEL_VIEW.get);
  const show = (next: PanelView): void => {
    PANEL_VIEW.set(next);
    setView(next);
  };
  return {
    view,
    open: (next) => {
      LEFT_VIEW.set(null);
      show(next);
    },
    back: () => {
      LEFT_VIEW.set(view);
      show(backFrom(view));
    },
  };
}

/** Whether the row that opens `view` should take focus: the panel just came back from it. */
export function useReturnFrom(view: PanelView): boolean {
  const [returning] = useState(() => claim(LEFT_VIEW, view));
  return returning;
}

// Steam UI workaround: the panel mounts again after a popup (a dropdown's list, a dialog) closes, so the control whose
// popup is open is kept, by its focus id, for focus to return to it.
const OPEN_POPUP = createMemory<string | null>(null);

// Steam UI workaround: how long after a popup closes the panel may still mount again; past it, a remount that never
// came can't steal focus later.
const REMOUNT_GRACE_MS = 1000;

/** Start at the main page with the default focus next time, as when the plugin is unloaded. */
export function forgetPanelState(): void {
  PANEL_VIEW.reset();
  LEFT_VIEW.reset();
  MODAL_CLOSED_AT.reset();
  OPEN_POPUP.reset();
}

/** What {@link useFocusReturn} gives the wrapper of a control that opens a popup. */
export type FocusReturn = {
  /** For the `Focusable` around the control. */
  readonly ref: RefObject<HTMLDivElement | null>;
  /** Whether focus should start here: this control's popup was open when the panel unmounted. */
  readonly preferred: boolean;
  /** Call when the popup opens, such as from a dropdown's `onMenuOpened`. */
  readonly opened: () => void;
  /** Call when the popup closes, if it says so; a dropdown's list doesn't. */
  readonly closed: () => void;
};

/**
 * Return focus to this control when the panel mounts again after its popup closed.
 *
 * Steam UI workaround: otherwise Steam starts at the view's first row.
 *
 * @param id - Unique among the panel's controls, such as the setting key it writes.
 */
export function useFocusReturn(id: string): FocusReturn {
  const ref = useRef<HTMLDivElement>(null);
  const [preferred] = useState(() => claim(OPEN_POPUP, id));
  // A layout effect, so the remounted view is first painted with focus already here rather than on the QAM's tab
  // column. `preferredFocus` on the wrapper covers a Steam that only follows its navigation tree.
  useLayoutEffect(() => {
    if (!preferred) return;
    const focusControl = (): void => {
      const control = ref.current;
      // Steam UI workaround: the control's own document, since the panel renders in Steam's menu window, while the
      // plugin's `document` is its shared context, whose active element is never inside the panel.
      if (control === null || control.contains(control.ownerDocument.activeElement)) return;
      control.querySelector<HTMLElement>("button, [tabindex]")?.focus();
    };
    focusControl();
    // Steam UI workaround: Steam's own first focus of the remounted view may still land after this, so it is undone a
    // frame later.
    const frame = requestAnimationFrame(focusControl);
    return () => cancelAnimationFrame(frame);
  }, [preferred]);
  return {
    ref,
    preferred,
    opened: () => OPEN_POPUP.set(id),
    // Taken back only if no remount claimed it, so a later opening of the panel starts at its default focus.
    closed: () => setTimeout(() => claim(OPEN_POPUP, id), REMOUNT_GRACE_MS),
  };
}

/**
 * Whether a view inside the plugin opens fresh, rather than mounting again while focus returns to a control after
 * its popup, or to the row of a view it came back from.
 *
 * Read before the view's controls render, while such a control still holds its claim.
 */
export function useViewOpening(): boolean {
  const [opening] = useState(() => OPEN_POPUP.get() === null && LEFT_VIEW.get() === null);
  return opening;
}

// When a modal opened from the panel last closed, by `performance.now()`.
const MODAL_CLOSED_AT = createMemory<number | null>(null);

/**
 * Whether the panel, as it mounts, should ignore B for a moment. Turns false once the moment is over.
 *
 * Steam UI workaround: a modal just closed, and the B press that closed it may still reach the panel as a Back
 * ({@link backGuardLeft}).
 */
export function useBackGuard(): boolean {
  const [guarding, setGuarding] = useState(() => backGuardLeft(MODAL_CLOSED_AT.get(), performance.now()) > 0);
  useEffect(() => {
    const left = backGuardLeft(MODAL_CLOSED_AT.get(), performance.now());
    if (left === 0) return;
    const timer = setTimeout(() => setGuarding(false), left);
    return () => clearTimeout(timer);
  }, []);
  return guarding;
}

/** Keep a B press from going further, such as to the Quick Access menu, which would leave the plugin. */
export function swallowBack(event: GamepadEvent): void {
  // Steam UI workaround: both calls, since which one Steam's navigation honours is undocumented.
  event.preventDefault();
  event.stopPropagation();
}

/** What {@link useModalOpener} gives the wrapper of a control that opens a modal. */
export type ModalOpener = Pick<FocusReturn, "ref" | "preferred"> & {
  /** Opens the modal, such as from the control's `onClick`. */
  readonly open: () => void;
};

/**
 * Open the modal `render` draws from a control, with focus back on the control when the panel mounts again after
 * the modal closes. A modal that fails to render shows the error instead.
 *
 * @param id - As for {@link useFocusReturn}.
 * @param render - Draws the modal; the `close` it is given dismisses it.
 */
export function useModalOpener(id: string, render: (close: () => void) => ReactNode): ModalOpener {
  const focus = useFocusReturn(id);
  const open = (): void => {
    focus.opened();
    const close = (): void => {
      MODAL_CLOSED_AT.set(performance.now());
      modal.Close();
      focus.closed();
    };
    const modal = showModal(guardedModal(render, close));
  };
  return { ref: focus.ref, preferred: focus.preferred, open };
}
