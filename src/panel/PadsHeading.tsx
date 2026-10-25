import {
  DialogBody,
  DialogButton,
  DialogHeader,
  Field,
  Focusable,
  ModalRoot,
  PanelSectionRow,
  quickAccessControlsClasses,
} from "@decky/ui";
import type { ReactNode } from "react";
import { PAD_HELP } from "../logic/help";
import { useModalOpener } from "./hooks";
import { MUTED, NOTE, SECTION_TITLE } from "./style";

/** Steam's info mark: a filled circle with the "i" cut out, as on its Performance settings heading. */
function InfoIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 36 36" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M18 3a15 15 0 1 0 0 30a15 15 0 1 0 0-30ZM15.5 16h5v10h-5ZM18 8a3 3 0 1 1 0 6a3 3 0 1 1 0-6Z"
      />
    </svg>
  );
}

/** The pads help: each topic's summary, then its choices one per line; B or Close dismisses it. */
function PadsHelp({ onClose }: { readonly onClose: () => void }): ReactNode {
  return (
    <ModalRoot onCancel={onClose} closeModal={onClose}>
      <DialogHeader>Pads</DialogHeader>
      <DialogBody>
        {PAD_HELP.map((topic) => (
          <div key={topic.title} style={{ marginBottom: "14px" }}>
            <div className={quickAccessControlsClasses.PanelSectionTitle} style={SECTION_TITLE}>
              {topic.title}
            </div>
            <div style={{ ...NOTE, ...MUTED, marginBottom: "4px" }}>{topic.summary}</div>
            {topic.entries.map((entry) => (
              <div key={entry.label} style={NOTE}>
                <b>{entry.label}</b>: <span style={MUTED}>{entry.description}</span>
              </div>
            ))}
          </div>
        ))}
        <DialogButton preferredFocus onClick={onClose}>
          Close
        </DialogButton>
      </DialogBody>
    </ModalRoot>
  );
}

/**
 * The Pads section's heading, in Steam's section-title style, with an (i) that opens the pads help.
 *
 * The whole heading is the button, as Steam's own Performance settings heading is; focus comes back to it when
 * the panel mounts again after the help closes.
 */
export function PadsHeading(): ReactNode {
  const help = useModalOpener("pads.help", (close) => <PadsHelp onClose={close} />);
  return (
    <PanelSectionRow>
      <Focusable ref={help.ref} preferredFocus={help.preferred}>
        <Field
          label={
            <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <span className={quickAccessControlsClasses.PanelSectionTitle} style={SECTION_TITLE}>
                Pads
              </span>
              <InfoIcon />
            </span>
          }
          padding="none"
          bottomSeparator="none"
          highlightOnFocus
          // Steam's Field makes onClick its A press as well, so touch and the controller both open the help.
          onClick={help.open}
        />
      </Focusable>
    </PanelSectionRow>
  );
}
