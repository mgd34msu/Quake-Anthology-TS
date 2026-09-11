export type ScalarOperator = "add" | "subtract" | "multiply" | "divide" | "bit-and" | "bit-or";
export interface CallbackGlobals { readonly time: number; readonly self: number; readonly other: number }
export type ThinkEffect = { readonly kind: "retain" } | { readonly kind: "remove" }
  | { readonly kind: "reschedule"; readonly nextThink: number };
export type Q1Input =
  | { readonly kind: "scalar-program"; readonly initial: number;
      readonly operations: readonly { readonly operator: ScalarOperator; readonly operand: number }[] }
  | { readonly kind: "run-think"; readonly serverTime: number; readonly frameTime: number;
      readonly nextThink: number; readonly entity: number; readonly globals: CallbackGlobals; readonly effect: ThinkEffect }
  | { readonly kind: "mg1-hub"; readonly serverFlags: number }
  | { readonly kind: "mg3-counter"; readonly serverFlags: number; readonly count: number;
      readonly coop: boolean; readonly spawnFlags: number; readonly activator: number; readonly entity: number };

export type Q1Output =
  | { readonly kind: "scalar-program"; readonly values: readonly number[]; readonly bits: readonly string[] }
  | { readonly kind: "run-think"; readonly ran: boolean; readonly continuePhysics: boolean;
      readonly nextThink: number; readonly free: boolean; readonly globals: CallbackGlobals;
      readonly callbackEntry: (CallbackGlobals & { readonly nextThink: 0 }) | null }
  | { readonly kind: "mg1-hub"; readonly requiredMask: 31; readonly presentMask: number;
      readonly calls: readonly ("remove(self)" | "trigger_changelevel()")[] }
  | { readonly kind: "mg3-counter"; readonly removed: boolean; readonly count: number;
      readonly use: "rune_counter_use" | null; readonly runes: number | null;
      readonly callback: { readonly name: "SUB_UseTargets"; readonly self: number; readonly activator: number } | null };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new Error("Expected an object");
  return value;
}

function fields(value: Record<string, unknown>, expected: readonly string[]): void {
  for (const key of Object.keys(value)) if (!expected.includes(key)) throw new Error(`Unexpected field ${key}`);
  for (const key of expected) if (!(key in value)) throw new Error(`Missing field ${key}`);
}

function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Expected a finite number");
  return value;
}

function storedFloat(value: unknown): number {
  const result = Math.fround(finite(value));
  if (!Number.isFinite(result)) throw new Error("Value exceeds finite binary32 scope");
  return result;
}

function intOperand(value: unknown): number {
  const result = storedFloat(value);
  if (result < -2147483648 || result >= 2147483648) throw new Error("Float-to-int conversion exceeds signed int32 scope");
  return Math.trunc(result);
}

function entityId(value: unknown): number {
  const result = finite(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Expected a nonnegative entity identifier");
  return result;
}

function globals(value: unknown): CallbackGlobals {
  const item = object(value);
  fields(item, ["time", "self", "other"]);
  return { time: storedFloat(item["time"]), self: entityId(item["self"]), other: entityId(item["other"]) };
}

function effect(value: unknown): ThinkEffect {
  const item = object(value);
  switch (item["kind"]) {
    case "retain": fields(item, ["kind"]); return { kind: "retain" };
    case "remove": fields(item, ["kind"]); return { kind: "remove" };
    case "reschedule": fields(item, ["kind", "nextThink"]); return { kind: "reschedule", nextThink: storedFloat(item["nextThink"]) };
    default: throw new Error("Unknown think callback effect");
  }
}

function operation(value: unknown): { readonly operator: ScalarOperator; readonly operand: number } {
  const item = object(value);
  fields(item, ["operator", "operand"]);
  const operator = item["operator"];
  if (operator !== "add" && operator !== "subtract" && operator !== "multiply" && operator !== "divide"
    && operator !== "bit-and" && operator !== "bit-or") throw new Error("Unknown scalar operator");
  const operand = storedFloat(item["operand"]);
  if (operator === "divide" && operand === 0) throw new Error("Division by zero exceeds finite oracle scope");
  return { operator, operand };
}

export function parseQ1Input(value: unknown): Q1Input {
  const item = object(value);
  switch (item["kind"]) {
    case "scalar-program": {
      fields(item, ["kind", "initial", "operations"]);
      const raw = item["operations"];
      if (!isArray(raw)) throw new Error("Expected scalar operations array");
      if (raw.length > 1024) throw new Error("Scalar program exceeds 1024-operation capture scope");
      return { kind: "scalar-program", initial: storedFloat(item["initial"]), operations: raw.map(operation) };
    }
    case "run-think": {
      fields(item, ["kind", "serverTime", "frameTime", "nextThink", "entity", "globals", "effect"]);
      const serverTime = finite(item["serverTime"]), frameTime = finite(item["frameTime"]);
      if (serverTime < 0 || frameTime < 0 || !Number.isFinite(serverTime + frameTime)) throw new Error("Invalid server frame interval");
      storedFloat(serverTime);
      return { kind: "run-think", serverTime, frameTime, nextThink: storedFloat(item["nextThink"]),
        entity: entityId(item["entity"]), globals: globals(item["globals"]), effect: effect(item["effect"]) };
    }
    case "mg1-hub":
      fields(item, ["kind", "serverFlags"]);
      return { kind: "mg1-hub", serverFlags: intOperand(item["serverFlags"]) };
    case "mg3-counter": {
      fields(item, ["kind", "serverFlags", "count", "coop", "spawnFlags", "activator", "entity"]);
      const coop = item["coop"];
      if (typeof coop !== "boolean") throw new Error("Expected coop boolean");
      return { kind: "mg3-counter", serverFlags: intOperand(item["serverFlags"]), count: storedFloat(item["count"]),
        coop, spawnFlags: intOperand(item["spawnFlags"]), activator: entityId(item["activator"]), entity: entityId(item["entity"]) };
    }
    default: throw new Error("Unknown Q1 oracle input kind");
  }
}

function floatBits(value: number): string {
  const buffer = new ArrayBuffer(4), view = new DataView(buffer);
  view.setFloat32(0, value, false);
  return view.getUint32(0, false).toString(16).padStart(8, "0");
}

function scalar(input: Extract<Q1Input, { readonly kind: "scalar-program" }>): Q1Output {
  let value = input.initial;
  const values = [value], bits = [floatBits(value)];
  for (const { operator, operand } of input.operations) {
    switch (operator) {
      case "add": value += operand; break;
      case "subtract": value -= operand; break;
      case "multiply": value *= operand; break;
      case "divide": value /= operand; break;
      case "bit-and": value = intOperand(value) & intOperand(operand); break;
      case "bit-or": value = intOperand(value) | intOperand(operand); break;
      default: { const exhaustive: never = operator; throw new Error(`Unknown operator ${exhaustive}`); }
    }
    value = storedFloat(value);
    values.push(value);
    bits.push(floatBits(value));
  }
  return { kind: "scalar-program", values, bits };
}

function runThink(input: Extract<Q1Input, { readonly kind: "run-think" }>): Q1Output {
  if (input.nextThink <= 0 || input.nextThink > input.serverTime + input.frameTime) {
    return { kind: "run-think", ran: false, continuePhysics: true, nextThink: input.nextThink,
      free: false, globals: input.globals, callbackEntry: null };
  }
  const time = input.nextThink < input.serverTime ? Math.fround(input.serverTime) : input.nextThink;
  const callbackEntry: CallbackGlobals & { readonly nextThink: 0 } = { time, self: input.entity, other: 0, nextThink: 0 };
  const callbackGlobals = { time, self: input.entity, other: 0 };
  return { kind: "run-think", ran: true, continuePhysics: input.effect.kind !== "remove",
    nextThink: input.effect.kind === "reschedule" ? input.effect.nextThink : input.effect.kind === "remove" ? -1 : 0,
    free: input.effect.kind === "remove", globals: callbackGlobals, callbackEntry };
}

export function runQ1Oracle(value: unknown): Q1Output {
  const input = parseQ1Input(value);
  switch (input.kind) {
    case "scalar-program": return scalar(input);
    case "run-think": return runThink(input);
    case "mg1-hub": {
      const presentMask = input.serverFlags & 31;
      return { kind: input.kind, requiredMask: 31, presentMask,
        calls: [presentMask === 31 ? "trigger_changelevel()" : "remove(self)"] };
    }
    case "mg3-counter": {
      if (input.coop && (input.spawnFlags & 131072) !== 0 || !input.coop && (input.spawnFlags & 32768) !== 0) {
        return { kind: input.kind, removed: true, count: input.count, use: null, runes: null, callback: null };
      }
      const count = input.count === 0 ? 2 : input.count;
      let runes = 0;
      for (const bit of [1, 2, 4, 8]) if ((input.serverFlags & bit) !== 0) runes++;
      return { kind: input.kind, removed: false, count, use: "rune_counter_use", runes,
        callback: runes >= count ? { name: "SUB_UseTargets", self: input.entity, activator: input.activator } : null };
    }
    default: { const exhaustive: never = input; throw new Error(`Unknown input ${exhaustive}`); }
  }
}
