/* Quake COM_Parse entity syntax. Copyright (C) 1996 Id Software, Inc.
 * GPL-2.0-or-later. Backslash interpretation belongs to the entity provider. */
import type { Q1Entity } from "./types.ts";

type EntityToken = { readonly kind: "open" | "close" } | { readonly kind: "text"; readonly value: string };

export function parseQ1Entities(text: string): readonly Q1Entity[] {
  let position = 0;
  const token = (): EntityToken | null => {
    while (position < text.length) {
      const character = text.charAt(position);
      if (character === "\0") return null;
      if (character <= " ") { position++; continue; }
      if (text.startsWith("//", position)) {
        const end = text.indexOf("\n", position + 2);
        position = end < 0 ? text.length : end + 1;
        continue;
      }
      break;
    }
    if (position >= text.length) return null;
    const first = text.charAt(position++);
    if (first === "{") return { kind: "open" };
    if (first === "}") return { kind: "close" };
    if (first === '"') {
      const start = position;
      while (position < text.length && text.charAt(position) !== '"' && text.charAt(position) !== "\0") position++;
      if (position >= text.length || text.charAt(position) === "\0") throw new Error(`Entity text:${start}: unterminated quote`);
      return { kind: "text", value: text.slice(start, position++) };
    }
    const start = position - 1;
    while (position < text.length && text.charAt(position) > " "
      && text.charAt(position) !== "{" && text.charAt(position) !== "}") position++;
    return { kind: "text", value: text.slice(start, position) };
  };
  const entities: Q1Entity[] = [];
  for (let first = token(); first !== null; first = token()) {
    if (first.kind !== "open") throw new Error(`Entity text:${position}: expected opening brace`);
    const properties: { key: string; value: string }[] = [];
    for (;;) {
      const key = token();
      if (key?.kind === "close") break;
      if (key === null || key.kind !== "text") throw new Error(`Entity text:${position}: expected key or closing brace`);
      const value = token();
      if (value === null || value.kind !== "text") throw new Error(`Entity text:${position}: expected value for ${key.value}`);
      properties.push({ key: key.value, value: value.value });
    }
    entities.push({ properties });
  }
  return entities;
}

export function q1EntityValue(entity: Q1Entity, key: string): string | null {
  let value: string | null = null;
  for (const property of entity.properties) if (property.key === key) value = property.value;
  return value;
}
