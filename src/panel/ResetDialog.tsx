import {
  ButtonItem,
  DialogBody,
  DialogBodyText,
  DialogButton,
  DialogHeader,
  Focusable,
  ModalRoot,
  PanelSectionRow,
} from "@decky/ui";
import type { ReactNode } from "react";
import { resetAllChanges, resetPadChanges } from "../logic/defaults";
import type { Separator } from "../logic/layout";
import { type ResetPrompt, type ResetTarget, resetPrompt } from "../logic/reset";
import { type Connected, profileLine } from "../logic/view";
import { useModalOpener } from "./hooks";
import type { Change } from "./types";

type ResetDialogProps = {
  readonly prompt: ResetPrompt;
  readonly onReset: () => void;
  readonly onClose: () => void;
};

/**
 * Steam's confirmation for a destructive action: a red bar on top, Cancel focused so a habitual A press never
 * wipes settings, and Reset as Steam's `Destructive` button, grey until focused, then red with white text. B closes
 * it.
 */
function ResetDialog({ prompt, onReset, onClose }: ResetDialogProps): ReactNode {
  const reset = (): void => {
    onReset();
    onClose();
  };
  return (
    <ModalRoot onCancel={onClose} closeModal={onClose} bDestructiveWarning>
      <DialogHeader>{prompt.title}</DialogHeader>
      <DialogBody>
        <DialogBodyText>{prompt.question}</DialogBodyText>
        <Focusable flow-children="row" style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
          <DialogButton style={{ flex: 1 }} preferredFocus onClick={onClose}>
            Cancel
          </DialogButton>
          <DialogButton className="Destructive" style={{ flex: 1 }} onClick={reset}>
            Reset
          </DialogButton>
        </Focusable>
      </DialogBody>
    </ModalRoot>
  );
}

/** Props of {@link ResetRow}. */
export type ResetRowProps = {
  /** The whole profile in use, or one of its pads. */
  readonly target: ResetTarget;
  readonly snapshot: Connected;
  /** Writes to the profile this render shows. */
  readonly change: Change;
  readonly bottomSeparator?: Separator;
  readonly children: ReactNode;
};

/**
 * A button row that resets `target` to the plugin defaults once the user confirms; focus comes back to it after.
 *
 * The dialog takes `snapshot` and `change` as they are when it opens, so a reset never lands in a profile switched to
 * meanwhile.
 */
export function ResetRow({ target, snapshot, change, bottomSeparator = "none", children }: ResetRowProps): ReactNode {
  const opener = useModalOpener(`reset.${target}`, (close) => {
    const changes =
      target === "all"
        ? resetAllChanges(snapshot.settings, snapshot.defaults)
        : resetPadChanges(snapshot.settings, target);
    const reset = (): void => {
      if (Object.keys(changes).length > 0) void change(changes);
    };
    return <ResetDialog prompt={resetPrompt(profileLine(snapshot), target)} onReset={reset} onClose={close} />;
  });
  return (
    <PanelSectionRow>
      <Focusable ref={opener.ref} preferredFocus={opener.preferred}>
        <ButtonItem layout="below" bottomSeparator={bottomSeparator} onClick={opener.open}>
          {children}
        </ButtonItem>
      </Focusable>
    </PanelSectionRow>
  );
}
