import type { QcModObjectiveStorage } from "../../contracts/mod-callbacks.ts";
import type { QcMachine } from "./machine.ts";
import type { QcWords } from "./memory.ts";
import type { QcProgram } from "./program.ts";

export function validateQcObjectiveStorage(program: QcProgram, storage: QcModObjectiveStorage, type: "float" | "entity"): void {
  if (typeof storage === "string") {
    if (program.globalsByName.get(storage)?.type !== type) throw new Error(`Objective global ${storage} requires original ${type} storage`);
    return;
  }
  if (program.globalsByName.get(storage.global)?.type !== "entity") throw new Error("Objective field requires an original global entity reference");
  for (const name of storage.indirections) if (program.fieldsByName.get(name)?.type !== "entity") throw new Error(`Objective selector ${name} requires an original entity field`);
  if (program.fieldsByName.get(storage.field)?.type !== type) throw new Error(`Objective field ${storage.field} requires original ${type} storage`);
}

export function resolveQcObjectiveStorage(machine: Pick<QcMachine, "globals" | "entities" | "globalOffset" | "fieldOffset">,
  storage: QcModObjectiveStorage, current: (reference?: number) => void): { readonly words: QcWords; readonly offset: number; readonly reference: number | null } {
  current();
  if (typeof storage === "string") return { words: machine.globals, offset: machine.globalOffset(storage), reference: null };
  let reference = machine.globals.int(machine.globalOffset(storage.global));
  for (const name of storage.indirections) {
    current(reference);
    reference = machine.entities.fromReference(reference).int(machine.fieldOffset(name));
  }
  current(reference);
  return { words: machine.entities.fromReference(reference), offset: machine.fieldOffset(storage.field), reference };
}
