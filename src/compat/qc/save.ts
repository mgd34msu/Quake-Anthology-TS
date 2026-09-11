/* Quake pr_edict.c entity/global save fields. GPL-2.0-or-later. */
import { quakeAtof } from "../../core/cvars/numbers.ts";
import { cvarValueText } from "../../core/cvars/numbers.ts";
import type { QcMachine } from "./machine.ts";
import type { QcWords } from "./memory.ts";
import type { QcDefinition } from "./program.ts";

export interface QcTextPair { readonly key: string; readonly value: string; }
export interface QcEntityParseResult {
  readonly empty: boolean;
  readonly unknown: readonly QcTextPair[];
  readonly retained: readonly QcTextPair[];
}
function newString(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index++) {
    const character = text.charAt(index);
    if (character === "\\") {
      index++;
      result += text.charAt(index) === "n" ? "\n" : "\\";
    } else result += character;
  }
  return result;
}
export function parseQcValue(machine: QcMachine, words: QcWords, definition: QcDefinition, text: string): void {
  const offset = definition.offset;
  switch (definition.type) {
    case "string": words.setInt(offset, machine.strings.allocate(newString(text))); break;
    case "float": words.setFloat(offset, quakeAtof(text)); break;
    case "vector": {
      let start = 0;
      for (let component = 0; component < 3; component++) {
        const space = text.indexOf(" ", start);
        const end = space < 0 ? text.length : space;
        words.setFloat(offset + component, quakeAtof(text.slice(start, end)));
        start = end + 1;
      }
      break;
    }
    case "entity": words.setInt(offset, machine.entities.reference(Math.trunc(quakeAtof(text)))); break;
    case "function": words.setInt(offset, machine.program.functionNamed(text).index); break;
    case "field": {
      const field = machine.program.fieldsByName.get(text);
      if (field === undefined) machine.fail(`cannot find field ${text}`);
      // Original ED_ParseEpair reads the global word at this field definition's offset.
      words.setInt(offset, machine.globals.int(field.offset));
      break;
    }
    case "void": break;
    case "pointer": case "opaque": machine.fail(`text parsing is unavailable for QC type ${definition.nativeType} (${definition.name}); restore raw state instead`);
  }
}
/** The map/save tokenizer supplies source-order pairs, including duplicate keys. */
export function applyQcEntityPairs(machine: QcMachine, slot: number, pairs: readonly QcTextPair[]): QcEntityParseResult {
  const words = machine.entities.at(slot);
  if (slot !== 0) words.bytes.fill(0);
  const unknown: QcTextPair[] = [];
  const retained: QcTextPair[] = [];
  for (const pair of pairs) {
    const angle = pair.key === "angle";
    let key = angle ? "angles" : pair.key === "light" ? "light_lev" : pair.key;
    if (machine.program.api.kind === "q1-netquake") key = key.replace(/ +$/, "");
    if (key.startsWith("_")) continue;
    retained.push({ key, value: pair.value });
    const definition = machine.program.fieldsByName.get(key);
    if (definition === undefined) { unknown.push({ key, value: pair.value }); continue; }
    parseQcValue(machine, words, definition, angle ? `0 ${pair.value} 0` : pair.value);
  }
  return { empty: pairs.length === 0, unknown, retained };
}
export function applyQcGlobalPairs(machine: QcMachine, pairs: readonly QcTextPair[]): readonly QcTextPair[] {
  const unknown: QcTextPair[] = [];
  for (const pair of pairs) {
    const definition = machine.program.globalsByName.get(pair.key);
    if (definition === undefined) unknown.push(pair);
    else parseQcValue(machine, machine.globals, definition, pair.value);
  }
  return unknown;
}
function savedValue(machine: QcMachine, words: QcWords, definition: QcDefinition): string {
  const offset = definition.offset;
  switch (definition.type) {
    case "string": return machine.strings.get(words.int(offset));
    case "float": return cvarValueText(words.float(offset), false);
    case "vector": return `${cvarValueText(words.float(offset), false)} ${cvarValueText(words.float(offset + 1), false)} ${cvarValueText(words.float(offset + 2), false)}`;
    case "entity": return String(machine.entities.slot(words.int(offset)));
    case "function": return machine.program.functionAt(words.int(offset)).name;
    case "field": {
      const field = machine.program.fields.find(candidate => candidate.offset === words.int(offset));
      if (field === undefined) return machine.fail(`cannot save field offset ${words.int(offset)}`);
      return field.name;
    }
    case "void": return "void";
    case "pointer": case "opaque": return machine.fail(`text saving is unavailable for QC type ${definition.nativeType} (${definition.name}); save raw state instead`);
  }
}
export function saveQcGlobalPairs(machine: QcMachine): readonly QcTextPair[] {
  return machine.program.globals.filter(definition => definition.save && ["string", "float", "entity"].includes(definition.type))
    .map(definition => ({ key: definition.name, value: savedValue(machine, machine.globals, definition) }));
}
export function saveQcEntityPairs(machine: QcMachine, slot: number, free: boolean): readonly QcTextPair[] {
  if (free) return [];
  const words = machine.entities.at(slot);
  const result: QcTextPair[] = [];
  for (const definition of machine.program.fields.slice(1)) {
    if (definition.name.charAt(definition.name.length - 2) === "_") continue;
    const count = definition.type === "vector" ? 3 : 1;
    let nonzero = false;
    for (let component = 0; component < count; component++) if (words.int(definition.offset + component) !== 0) nonzero = true;
    if (nonzero) result.push({ key: definition.name, value: savedValue(machine, words, definition) });
  }
  return result;
}
