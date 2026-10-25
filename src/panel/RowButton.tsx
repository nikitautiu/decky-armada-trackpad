import { ButtonItem } from "@decky/ui";
import type { ReactNode } from "react";
import type { Separator } from "../logic/layout";

const ROTATION = { down: 0, up: 180, left: 90, right: -90 } as const;

/** A chevron icon pointing `direction`. */
export function Chevron({ direction }: { readonly direction: keyof typeof ROTATION }): ReactNode {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        transform: `rotate(${ROTATION[direction]}deg)`,
      }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Props of {@link RowButton}. */
export type RowButtonProps = {
  /** Shown before the content, such as a back chevron. */
  readonly leading?: ReactNode;
  /** Shown at the right edge, such as a chevron. */
  readonly trailing?: ReactNode;
  /** The line under the row; none by default. */
  readonly bottomSeparator?: Separator;
  readonly onClick: () => void;
  readonly children: ReactNode;
};

/**
 * A full-width button row with its content at the left and an icon at the right.
 *
 * A `ButtonItem` with its button below and no label, since a label beside the button squeezes it into a narrow
 * column; the button handles both touch and the A button. Its own outline already sets it apart from the rows
 * around it, as in Steam's own tabs.
 */
export function RowButton({
  leading,
  trailing,
  bottomSeparator = "none",
  onClick,
  children,
}: RowButtonProps): ReactNode {
  return (
    <ButtonItem layout="below" bottomSeparator={bottomSeparator} onClick={onClick}>
      <span style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", textAlign: "left" }}>
        {leading}
        <span style={{ flexGrow: 1, minWidth: 0 }}>{children}</span>
        {trailing}
      </span>
    </ButtonItem>
  );
}
