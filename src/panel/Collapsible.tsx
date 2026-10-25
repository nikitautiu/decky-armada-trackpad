import { PanelSectionRow } from "@decky/ui";
import type { ReactNode } from "react";
import type { Separator } from "../logic/layout";
import { useStoredFlag } from "./hooks";
import { Chevron, RowButton } from "./RowButton";

/** Props of {@link Collapsible}. */
export type CollapsibleProps = {
  /** Names the stored open state; unique per section. */
  readonly id: string;
  readonly label: string;
  /** The line under the header while folded; while open, the caller's last row carries it. */
  readonly bottomSeparator?: Separator;
  readonly children: ReactNode;
};

/** Rows that fold away under a header row, inside the caller's section; it remembers whether it was open. */
export function Collapsible({ id, label, bottomSeparator = "none", children }: CollapsibleProps): ReactNode {
  const [open, setOpen] = useStoredFlag(`open.${id}`, true);
  return (
    <>
      <PanelSectionRow>
        <RowButton
          trailing={<Chevron direction={open ? "up" : "down"} />}
          bottomSeparator={open ? "none" : bottomSeparator}
          onClick={() => setOpen(!open)}
        >
          {label}
        </RowButton>
      </PanelSectionRow>
      {open && children}
    </>
  );
}
