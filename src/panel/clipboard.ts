/**
 * Put `text` on the clipboard.
 *
 * @param target - The document the user acted in. Steam UI workaround: the panel renders in Steam's menu window, not in
 *   the plugin's own context, and a copy only works from the document that has focus.
 * @returns Whether the text was copied.
 */
export async function copyText(text: string, target: Document): Promise<boolean> {
  const area = target.createElement("textarea");
  area.value = text;
  area.readOnly = true;
  area.style.position = "fixed";
  area.style.opacity = "0";
  target.body.appendChild(area);
  try {
    area.select();
    // Steam UI workaround: deprecated, but tried first since it needs no clipboard permission, which Steam's browser
    // may not grant; the async clipboard API is the fallback.
    if (target.execCommand("copy")) return true;
  } catch {
    // Falls through to the async clipboard API.
  } finally {
    area.remove();
  }
  try {
    await target.defaultView?.navigator.clipboard.writeText(text);
    return target.defaultView !== null;
  } catch {
    return false;
  }
}
