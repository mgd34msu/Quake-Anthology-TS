import type { ActorId } from "../../contracts/identity.ts";
import type { ModCallbackInput, ModCallbackValue, ModRuntimeValue, ModSourceCall } from "../../contracts/mod-callbacks.ts";
import type { QcMachine } from "./machine.ts";
import type { QcWords } from "./memory.ts";
import type { QcProgram, QcValueType } from "./program.ts";

export function qcSourceValueType(value: ModCallbackValue): QcValueType {
  if (value.kind !== "input") return value.kind;
  switch (value.name) {
    case "self": case "other": case "activator": case "attacker": case "inflictor": return "entity";
    case "point": case "direction": case "normal": case "view-angles": return "vector";
    case "item": return "string";
    default: return "float";
  }
}
export function validateQcSourceCall(program: QcProgram, call: ModSourceCall, available: ReadonlySet<ModCallbackInput>, label: string): void {
  for (const value of [...call.arguments, ...call.globals.map(global => global.value)]) if (value.kind === "input" && !available.has(value.name))
    throw new Error(`Mod ${label} cannot read ${value.name}`);
  const fn = program.functionNamed(call.function);
  if (fn.index === 0 || fn.firstStatement <= 0 || fn.parameterSizes.length !== call.arguments.length
    || fn.parameterSizes.some((size, index) => { const value = call.arguments[index]; return value === undefined || size !== (qcSourceValueType(value) === "vector" ? 3 : 1); }))
    throw new Error(`Mod callback ${call.function} has an incompatible source signature`);
  const globals = new Set<string>();
  for (const global of call.globals) {
    if (globals.has(global.name) || program.globalsByName.get(global.name)?.type !== qcSourceValueType(global.value))
      throw new Error(`Mod callback global ${global.name} is duplicated or has an incompatible type`);
    globals.add(global.name);
  }
}
export function writeQcSourceValue(machine: QcMachine, words: QcWords, offset: number, value: ModRuntimeValue, reference: (actor: ActorId | null) => number): void {
  switch (value.kind) {
    case "float": if (!Number.isFinite(Math.fround(value.value))) throw new Error("Mod callback number exceeds binary32 range"); words.setFloat(offset, value.value); break;
    case "vector":
      if (![value.value.x, value.value.y, value.value.z].every(component => Number.isFinite(Math.fround(component)))) throw new Error("Mod callback vector exceeds binary32 range");
      words.setVector(offset, value.value); break;
    case "string": words.setInt(offset, machine.strings.setEngine(`mod-value:${value.value}`, value.value, Math.max(128, value.value.length + 1))); break;
    case "actor": words.setInt(offset, reference(value.value)); break;
  }
}
/** Stage the declared original ABI only for this invocation, including nested calls and faults. */
export function withQcSourceCall(machine: QcMachine, call: ModSourceCall, inputs: ReadonlyMap<ModCallbackInput, ModRuntimeValue>,
  reference: (actor: ActorId | null) => number, execute: (argumentCount: number) => number): number {
  const resolve = (value: ModCallbackValue): ModRuntimeValue => {
    if (value.kind !== "input") return value;
    const input = inputs.get(value.name);
    if (input === undefined) throw new Error(`Gameplay callback ${call.function} has no ${value.name} input`);
    return input;
  };
  const args = call.arguments.map(resolve), globals = call.globals.map(global => ({ definition: machine.program.globalsByName.get(global.name), value: resolve(global.value) }));
  const staging = machine.globals.bytes.slice(4, 112), savedGlobals = globals.map(({ definition }) => {
    if (definition === undefined) throw new Error("Missing validated callback global");
    return { offset: definition.offset * 4, bytes: machine.globals.bytes.slice(definition.offset * 4, (definition.offset + (definition.type === "vector" ? 3 : 1)) * 4) };
  });
  try {
    for (const [index, value] of args.entries()) writeQcSourceValue(machine, machine.globals, 4 + index * 3, value, reference);
    for (const { definition, value } of globals) if (definition !== undefined) writeQcSourceValue(machine, machine.globals, definition.offset, value, reference);
    return execute(args.length);
  } finally {
    machine.globals.bytes.set(staging, 4);
    for (const global of savedGlobals) machine.globals.bytes.set(global.bytes, global.offset);
  }
}
