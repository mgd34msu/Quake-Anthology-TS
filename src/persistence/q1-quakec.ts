import type { QcMachine } from "../compat/qc/machine.ts";
import { applyQcEntityPairs, applyQcGlobalPairs, saveQcEntityPairs, saveQcGlobalPairs } from "../compat/qc/save.ts";
import type { QcTextPair } from "../compat/qc/save.ts";
import type { Q1SaveData } from "./q1.ts";
import { SaveFormatError } from "./value.ts";

export type Q1SaveHeader = Omit<Q1SaveData, "globals" | "entities">;
export interface Q1QuakeCSaveHost {
  /** Unlink old entities and prepare the original host's free flags before record loading. */
  begin(entityCount: number): undefined;
  /** Update host metadata and link a non-free edict without executing its spawn function. */
  entity(slot: number, free: boolean): undefined;
  /** Restore server time, spawn parameters, light styles and other header-owned state. */
  finish(header: Q1SaveHeader): undefined;
}
export interface Q1UnknownSaveFields {
  readonly globals: readonly QcTextPair[];
  readonly entities: readonly { readonly slot: number; readonly fields: readonly QcTextPair[] }[];
}

export function captureQ1QuakeCSave(machine: QcMachine, header: Q1SaveHeader, isFree: (slot: number) => boolean): Q1SaveData {
  // The VM checks both interpreted and host-builtin reentry, which depth alone cannot do.
  machine.snapshot();
  return { ...header, globals: saveQcGlobalPairs(machine), entities: Array.from({ length: machine.entities.count }, (_, slot) => saveQcEntityPairs(machine, slot, isFree(slot))) };
}

/** Apply after loading the matching progs and map baseline, as Host_Loadgame_f does. */
export function restoreQ1QuakeCSave(machine: QcMachine, save: Q1SaveData, host: Q1QuakeCSaveHost): Q1UnknownSaveFields {
  machine.snapshot();
  if (save.entities.length < 1 || save.entities.length > machine.entities.capacity) throw new SaveFormatError("q1.entities", "saved edict count exceeds the selected guest capacity");
  host.begin(save.entities.length);
  machine.entities.setCount(save.entities.length);
  // Saved entity references may point forward, so install the complete source count first.
  const globals = applyQcGlobalPairs(machine, save.globals);
  const entities: { readonly slot: number; readonly fields: readonly QcTextPair[] }[] = [];
  for (const [slot, pairs] of save.entities.entries()) {
    machine.entities.at(slot).bytes.fill(0);
    const parsed = applyQcEntityPairs(machine, slot, pairs);
    if (parsed.unknown.length !== 0) entities.push({ slot, fields: parsed.unknown });
    host.entity(slot, parsed.empty);
  }
  const { globals: savedGlobals, entities: savedEntities, ...header } = save;
  // Keep the header separate from source record arrays for host-owned restoration.
  void savedGlobals; void savedEntities;
  host.finish(header);
  return { globals, entities };
}
