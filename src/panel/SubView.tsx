import { Focusable, type GamepadEvent, PanelSection, PanelSectionRow } from "@decky/ui";
import type { ReactNode } from "react";
import type { Separator } from "../logic/layout";
import type { PanelView } from "../logic/view";
import { swallowBack, useBackGuard, useReturnFrom, useViewOpening } from "./hooks";
import { Chevron, RowButton } from "./RowButton";

/** Props of {@link SubView}. */
export type SubViewProps = {
  /** Names the view in its back row. */
  readonly title: string;
  /** Leaves the view, from the back row or B. */
  readonly onBack: () => void;
  readonly children: ReactNode;
};

/** A view inside the plugin, such as Advanced: a back row at the top, and B leads back as well. */
export function SubView({ title, onBack, children }: SubViewProps): ReactNode {
  const opening = useViewOpening();
  const guarding = useBackGuard();
  const back = (event: GamepadEvent): void => {
    // Steam UI workaround: B must leave the view before the QAM sees it and closes the plugin; the press that closed a
    // modal reaches the view again and leaves nothing.
    swallowBack(event);
    if (!guarding) onBack();
  };
  return (
    <Focusable onCancelButton={back} onCancelActionDescription="Back">
      <PanelSection>
        <PanelSectionRow>
          {/* Steam UI workaround: Steam's own focus, which DOM focus doesn't move, must start inside the view, or B
              leaves the plugin. */}
          <Focusable autoFocus={opening}>
            <RowButton leading={<Chevron direction="left" />} onClick={onBack}>
              {title}
            </RowButton>
          </Focusable>
        </PanelSectionRow>
      </PanelSection>
      {children}
    </Focusable>
  );
}

/** Props of {@link OpenViewRow}. */
export type OpenViewRowProps = {
  /** The view the row opens. */
  readonly view: PanelView;
  readonly onOpen: () => void;
  readonly bottomSeparator?: Separator;
  readonly children: ReactNode;
};

/** A row that opens a {@link SubView}; focus comes back to it when B or the back row leaves that view. */
export function OpenViewRow({ view, onOpen, bottomSeparator = "none", children }: OpenViewRowProps): ReactNode {
  const returning = useReturnFrom(view);
  return (
    <PanelSectionRow>
      {/* Steam UI workaround: Steam starts the view at its first row, so focus is handed back to the row B returned
          from. */}
      <Focusable autoFocus={returning}>
        <RowButton trailing={<Chevron direction="right" />} bottomSeparator={bottomSeparator} onClick={onOpen}>
          {children}
        </RowButton>
      </Focusable>
    </PanelSectionRow>
  );
}
