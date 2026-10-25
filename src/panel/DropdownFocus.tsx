import { Focusable } from "@decky/ui";
import type { ReactNode } from "react";
import { useFocusReturn } from "./hooks";

/** Props of {@link DropdownFocus}. */
export type DropdownFocusProps = {
  /** Unique among the panel's dropdowns, such as the setting key it writes; focus returns here after its list. */
  readonly focusId: string;
  /** Renders the dropdown; pass `opened` as its `onMenuOpened`. */
  readonly children: (opened: () => void) => ReactNode;
};

/**
 * The group every dropdown of the panel sits in. B on the closed dropdown goes back one level, as from any other row.
 *
 * Steam UI workaround: the panel mounts again after a dropdown's list closed, and focus is brought back to the
 * dropdown.
 */
export function DropdownFocus({ focusId, children }: DropdownFocusProps): ReactNode {
  const focus = useFocusReturn(focusId);
  return (
    <Focusable ref={focus.ref} preferredFocus={focus.preferred}>
      {children(focus.opened)}
    </Focusable>
  );
}
