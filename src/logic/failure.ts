/** What a render failure shows: an Error's name and message, or anything else thrown as text. */
export function failureText(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message === "" ? thrown.name : `${thrown.name}: ${thrown.message}`;
  return String(thrown);
}
