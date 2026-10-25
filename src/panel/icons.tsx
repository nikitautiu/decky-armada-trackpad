import type { ReactNode } from "react";

/** Props of the line icons; `size` in pixels, 20 by default like the icons of Steam's own rows. */
export type IconProps = { readonly size?: number };

function LineIcon({ size = 20, children }: IconProps & { readonly children: ReactNode }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }}
    >
      {children}
    </svg>
  );
}

/** A touch with ripples above and below: the Tap row. */
export function TapIcon(props: IconProps): ReactNode {
  return (
    <LineIcon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M6 6a8.5 8.5 0 0 1 12 0M6 18a8.5 8.5 0 0 0 12 0" />
    </LineIcon>
  );
}

/** A touch sending an arrow: the Tap sends row. */
export function TapOutputIcon(props: IconProps): ReactNode {
  return (
    <LineIcon {...props}>
      <circle cx="6" cy="12" r="3" />
      <path d="M12 12h8M16 8l4 4-4 4" />
    </LineIcon>
  );
}

/** A keyboard key: the Toggle key cell. */
export function ToggleKeyIcon(props: IconProps): ReactNode {
  return (
    <LineIcon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 15h8" />
    </LineIcon>
  );
}

/** Two shoulder buttons held together: the controller Chord cell. */
export function ChordIcon(props: IconProps): ReactNode {
  return (
    <LineIcon {...props}>
      <rect x="2" y="5" width="8" height="6" rx="2" />
      <rect x="14" y="5" width="8" height="6" rx="2" />
      <path d="M12 14v6M9 17h6" />
    </LineIcon>
  );
}
