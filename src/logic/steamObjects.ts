// Readers for Steam's undocumented frontend objects, which arrive as `unknown`: a missing field or method reads as
// `undefined` instead of throwing. A getter of Steam's can still throw; callers decide what that means.

/** The `key` property of `value`, or `undefined` when `value` is not an object. */
export function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/** Call `target.method(argument)`, or give `undefined` when `target` has no such method. */
export function callMethod(target: unknown, method: string, argument: unknown): unknown {
  if (typeof target !== "object" || target === null) return undefined;
  const fn: unknown = Reflect.get(target, method);
  return typeof fn === "function" ? Reflect.apply(fn, target, [argument]) : undefined;
}
