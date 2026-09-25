import type { ModCallbackInput, ModSourceCall } from "../../../contracts/mod-callbacks.ts";
import { validateQcSourceCall, qcSourceValueType } from "../../../compat/qc/source-call.ts";
import type { QcMachine, QcFunctionExecution } from "../../../compat/qc/machine.ts";
import { QcProgramError, type QcProgram } from "../../../compat/qc/program.ts";

export type QcDamageRole = "self" | "inflictor" | "attacker" | "amount";
export type QcDamageRoleLocation = { readonly kind: "argument"; readonly index: number; readonly frameWord: number }
  | { readonly kind: "global"; readonly word: number };
export interface QcDamageCallLayout {
  readonly functionIndex: number;
  readonly parameters: readonly ("entity" | "float" | "vector" | "string" | "function")[];
  readonly roles: Readonly<Record<QcDamageRole, readonly QcDamageRoleLocation[]>>;
  readonly declaration?: ModSourceCall;
}
export type QcDamageCallValues = Readonly<Record<QcDamageRole, number>>;
const roles: readonly QcDamageRole[] = ["self", "inflictor", "attacker", "amount"];
const inputs = new Set<ModCallbackInput>([...roles, "knockback", "point", "direction", "normal", "time"]);
function isRole(input: ModCallbackInput): input is QcDamageRole { return input === "self" || input === "inflictor" || input === "attacker" || input === "amount"; }

/** An original source call supplies semantic roles; their positions are not a game-wide ABI. */
export function qcDamageCallLayout(program: QcProgram, declaration?: ModSourceCall): QcDamageCallLayout {
  const reject = (reason: string): never => { throw new QcProgramError(`Unsupported QC damage call: ${reason}`, program.source); };
  const fn = program.functionNamed(declaration?.function ?? "T_Damage");
  if (fn.firstStatement <= 0 || fn.namedBuiltin) reject("requires an original bytecode function");
  if (declaration !== undefined) validateQcSourceCall(program, declaration, inputs, "combat damage");
  const parameters: QcDamageCallLayout["parameters"][number][] = [], locations: Record<QcDamageRole, QcDamageRoleLocation[]> = { self: [], inflictor: [], attacker: [], amount: [] };
  let word = fn.parameterStart;
  for (const [index, size] of fn.parameterSizes.entries()) {
    const type = program.globals.find(global => global.offset === word && global.type !== "void")?.type;
    if (type !== "entity" && type !== "float" && type !== "vector" && type !== "string" && type !== "function") return reject("untyped original parameter");
    if (size !== (type === "vector" ? 3 : 1)) reject("original parameter width");
    const value = declaration?.arguments[index], role = declaration === undefined ? roles[index] : value?.kind === "input" && isRole(value.name) ? value.name : undefined;
    if (value !== undefined && qcSourceValueType(value) !== type) reject("declaration differs from original parameter types");
    if (role !== undefined) {
      if (type !== (role === "amount" ? "float" : "entity")) reject(`invalid ${role} parameter type`);
      locations[role].push({ kind: "argument", index, frameWord: word });
    }
    parameters.push(type); word += size;
  }
  for (const global of declaration?.globals ?? []) {
    const definition = program.globalsByName.get(global.name);
    if (definition === undefined) return reject("missing declared global");
    const width = definition.type === "vector" ? 3 : 1;
    if (definition.offset < 28 || definition.offset < fn.parameterStart + fn.localWords && definition.offset + width > fn.parameterStart)
      reject("declared global overlaps call staging or the callee frame");
    if (global.value.kind === "input" && isRole(global.value.name)) locations[global.value.name].push({ kind: "global", word: definition.offset });
  }
  const globals = new Map<number, QcDamageRole>();
  for (const role of roles) {
    if (locations[role].length === 0) reject(`missing ${role} input`);
    for (const location of locations[role]) if (location.kind === "global") {
      const previous = globals.get(location.word);
      if (previous !== undefined && previous !== role) reject("distinct damage roles overlap one source global");
      globals.set(location.word, role);
    }
  }
  return { functionIndex: fn.index, parameters, roles: locations, ...(declaration === undefined ? {} : { declaration }) };
}
/** Exact positional ABI of the two pinned original programs. */
export function standardQcDamageCallLayout(functionIndex: number, parameterStart: number): QcDamageCallLayout {
  const argument = (index: number): readonly QcDamageRoleLocation[] => [{ kind: "argument", index, frameWord: parameterStart + index }];
  return { functionIndex, parameters: ["entity", "entity", "entity", "float"],
    roles: { self: argument(0), inflictor: argument(1), attacker: argument(2), amount: argument(3) } };
}
function stagingWord(location: QcDamageRoleLocation): number { return location.kind === "argument" ? 4 + location.index * 3 : location.word; }
export function readQcDamageCall(machine: QcMachine, layout: QcDamageCallLayout): QcDamageCallValues {
  const read = (role: QcDamageRole): number => {
    let captured: number | undefined;
    for (const location of layout.roles[role]) {
      const word = stagingWord(location), value = role === "amount" ? machine.globals.float(word) : machine.globals.int(word);
      if (captured !== undefined && !Object.is(captured, value)) throw new QcProgramError(`Original QC ${role} aliases disagree`);
      captured = value;
    }
    if (captured === undefined) throw new QcProgramError(`Missing qualified QC ${role}`);
    return captured;
  };
  return { self: read("self"), inflictor: read("inflictor"), attacker: read("attacker"), amount: read("amount") };
}

/** Change only transformed semantic inputs; keep original extra arguments and source context intact. */
export function projectQcDamageCall(machine: QcMachine, layout: QcDamageCallLayout, captured: QcDamageCallValues,
  effective: QcDamageCallValues, execute: QcFunctionExecution): undefined {
  const saved = new Map<number, number>();
  try {
    return execute(vm => {
      for (const role of roles) {
        const value = role === "amount" ? Math.fround(effective[role]) : effective[role];
        for (const location of layout.roles[role]) {
          const word = stagingWord(location);
          const current = location.kind === "argument" ? captured[role] : role === "amount" ? vm.globals.float(word) : vm.globals.int(word);
          if (Object.is(current, value)) continue;
          if (location.kind === "global" && !saved.has(word)) saved.set(word, vm.globals.int(word));
          if (role === "amount") vm.globals.setFloat(word, value); else vm.globals.setInt(word, value);
        }
      }
      return undefined;
    });
  } finally { for (const [word, value] of saved) machine.globals.setInt(word, value); }
}
