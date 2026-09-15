import type { LocalizationCatalog } from "../../text/localization.ts";

/** Presentation keeps unknown mod keys intact; native localization retains its byte-buffer contract. */
export function q2LocalizedText(catalog: LocalizationCatalog, text: string, args: readonly string[] = []): string {
  const key = text.startsWith("$") ? text.replace(/[\r\n]+$/u, "") : text;
  const suffix = text.slice(key.length);
  const entry = key.startsWith("$") ? catalog.find(key.slice(1)) : undefined;
  if (key.startsWith("$") && entry === undefined) return text;
  if (entry === undefined) return args.length === 0 ? text : catalog.localize(text, args);
  let result = "", start = 0;
  for (const slot of entry.arguments) {
    const argument = args[slot.argIndex];
    if (argument === undefined) return text;
    const value = argument.startsWith("$") && catalog.find(argument.slice(1)) !== undefined ? catalog.localize(argument) : argument;
    result += entry.format.slice(start, slot.start) + value;
    start = slot.end;
  }
  return result + entry.format.slice(start) + suffix;
}
