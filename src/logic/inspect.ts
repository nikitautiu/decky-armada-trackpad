import type { Settings, SettingValue, Status } from "./wire";

/** One line of the read-only settings view. */
export type InspectRow = {
  readonly group: "shared" | "right" | "left";
  readonly key: string;
  readonly value: string;
  readonly changed: boolean;
};

function formatValue(key: string, value: SettingValue): string {
  if (Array.isArray(value)) {
    if (key === "panel_mm") return value.join("x");
    if (key === "edges" && value.length > 0 && value.every((item) => item === value[0])) return String(value[0]);
    return value.join(", ");
  }
  return String(value);
}

function sameValue(a: SettingValue | undefined, b: SettingValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The rows of the settings view, in wire order.
 *
 * Side overrides appear only when set; their `key` has the side prefix removed because `group` carries it.
 * `changed` compares against the full wire key in `defaults`.
 */
export function inspectRows(settings: Settings, defaults: Settings): InspectRow[] {
  const rows: InspectRow[] = [];
  for (const [wireKey, value] of Object.entries(settings)) {
    if (value === null) continue;
    const dot = wireKey.indexOf(".");
    const prefix = dot < 0 ? "" : wireKey.slice(0, dot);
    const group = prefix === "left" || prefix === "right" ? prefix : "shared";
    const key = group === "shared" ? wireKey : wireKey.slice(dot + 1);
    rows.push({ group, key, value: formatValue(key, value), changed: !sameValue(value, defaults[wireKey]) });
  }
  return rows;
}

/** One line of the status group: a daemon status field and its value. */
export type StatusRow = { readonly key: string; readonly value: string };

/** The status group of the settings view. */
export function statusRows(status: Status): readonly StatusRow[] {
  return [
    { key: "mode", value: status.mode },
    { key: "device", value: status.device },
    { key: "version", value: status.version },
    { key: "inputplumber_version", value: status.inputplumber_version ?? "unknown" },
    { key: "instance", value: status.instance },
  ];
}

/** The full wire key of a row, side prefix included. */
export function wireKey(row: InspectRow): string {
  return row.group === "shared" ? row.key : `${row.group}.${row.key}`;
}

/** The settings view as plain text: one `key = value` line per status field, then per row. */
export function inspectText(status: Status, rows: readonly InspectRow[]): string {
  return [
    ...statusRows(status).map((row) => `${row.key} = ${row.value}`),
    ...rows.map((row) => `${wireKey(row)} = ${row.value}`),
  ].join("\n");
}

/** Each group's title in the settings view. */
export const INSPECT_GROUPS: Readonly<Record<InspectRow["group"], string>> = {
  shared: "General",
  right: "Right pad only",
  left: "Left pad only",
};

/** The line under a pad's own settings: what the pad takes from the general ones. */
export function overridesNote(count: number): string {
  return count === 0 ? "Uses the general settings" : "Everything else as in General";
}
