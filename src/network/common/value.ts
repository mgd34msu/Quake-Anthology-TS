/** Array.isArray's built-in predicate exposes unchecked element types. */
export function isUnknownArray(value: unknown): value is readonly unknown[] { return Array.isArray(value); }
export function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function isReadableStream(value: unknown): value is ReadableStream<unknown> { return value instanceof ReadableStream; }
