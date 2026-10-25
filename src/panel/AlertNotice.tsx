import { Field } from "@decky/ui";
import type { ReactNode } from "react";
import type { Notice } from "../logic/offline";
import { ALERT } from "./style";

/**
 * A red notice with a headline and a line under it, for when the daemon can't be used; a `Field`, since that is what
 * renders reliably inside a `PanelSectionRow`.
 */
export function AlertNotice({ notice }: { readonly notice: Notice }): ReactNode {
  return (
    <div style={ALERT}>
      <Field
        label={notice.title}
        description={notice.text}
        icon={
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            aria-hidden="true"
            style={{ fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" }}
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M9 9l6 6M15 9l-6 6" />
          </svg>
        }
        focusable={false}
        bottomSeparator="none"
      />
    </div>
  );
}
