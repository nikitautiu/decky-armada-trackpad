/**
 * The line under a row, as Steam's `bottomSeparator` names it: `standard` is the thin line between independent
 * settings, `thick` the section break before the next heading, `none` keeps a row with what follows it.
 */
export type Separator = "standard" | "thick" | "none";

/** The line that ends a section, before the next heading, as at the end of Steam's first Quick Access section. */
export const SECTION_BREAK: Separator = "thick";

/**
 * The line under the row at `index` of `count` peer rows: a thin line while another peer follows, `last` under the
 * last one.
 */
export function peerSeparator(index: number, count: number, last: Separator = "none"): Separator {
  return index < count - 1 ? "standard" : last;
}
