import type { JsonValue } from "../../../verification/schema/contracts.ts";
import { sourceText } from "./sources.ts";

export type OracleInput =
  | { readonly kind: "clock"; readonly classicFrames: readonly number[]; readonly rereleaseStepMs: number; readonly rereleaseFrames: number }
  | { readonly kind: "think"; readonly family: "classic" | "rerelease"; readonly now: number; readonly nextthink: number; readonly reschedule: number }
  | { readonly kind: "frame-order"; readonly deleteLaterActor: boolean; readonly spawnActor: boolean }
  | { readonly kind: "pickup"; readonly inventory: number; readonly capacity: number; readonly quantity: number; readonly targetsUsed: boolean }
  | { readonly kind: "armor"; readonly damage: number; readonly inventory: number; readonly armor: "jacket" | "combat" | "body"; readonly energy: boolean; readonly bypass: boolean }
  | { readonly kind: "cross-unit"; readonly flags: number; readonly trigger: number; readonly required: number }
  | { readonly kind: "save-fields"; readonly struct: "level_locals_t" | "edict_t" | "client_persistant_t" | "game_locals_t"; readonly fields: Readonly<Record<string, JsonValue>> }
  | { readonly kind: "flechette-default" }
  | { readonly kind: "q64-config"; readonly isN64: boolean; readonly deathmatch: boolean; readonly initialN64Physics: boolean; readonly airacceleration: number }
  | { readonly kind: "command-predicates"; readonly upmove: number; readonly buttons: number; readonly n64Physics: boolean };

export function classicTime(frame: number): number {
  // FRAMETIME is an unsuffixed double literal; level.time is a float store.
  return Math.fround(frame * 0.1);
}

export function think(input: Extract<OracleInput, { readonly kind: "think" }>): JsonValue {
  const now = input.family === "classic" ? Math.fround(input.now) : input.now;
  let nextthink = input.family === "classic" ? Math.fround(input.nextthink) : input.nextthink;
  const trace: JsonValue[] = [];
  const deadline = input.family === "classic" ? now + 0.001 : now;
  const mayContinuePhysics = nextthink <= 0 || nextthink > deadline;
  if (!mayContinuePhysics) {
    nextthink = 0;
    trace.push({ event: "think.enter", nextthink });
    nextthink = input.family === "classic" ? Math.fround(input.reschedule) : input.reschedule;
    trace.push({ event: "think.return", nextthink });
  }
  return { now, nextthink, mayContinuePhysics, trace };
}

function frameOrder(input: Extract<OracleInput, { readonly kind: "frame-order" }>): JsonValue {
  const trace: JsonValue[] = ["level.framenum++", "level.time=frame*0.1", "AI_SetSightClient"];
  const actors = [0, 1, 2, 3];
  const active = new Set(actors);
  for (const actor of actors) {
    if (!active.has(actor)) continue;
    trace.push({ event: "current_entity+old_origin", actor });
    if (actor === 1) {
      trace.push({ event: "ClientBeginServerFrame", actor });
      continue;
    }
    trace.push({ event: "G_RunEntity.enter", actor });
    if (actor === 2) {
      if (input.deleteLaterActor) {
        active.delete(3);
        trace.push({ event: "authored.delete", actor: 3 });
      }
      if (input.spawnActor) {
        actors.push(4);
        active.add(4);
        trace.push({ event: "authored.append", actor: 4 });
      }
    }
    trace.push({ event: "G_RunEntity.return", actor });
  }
  trace.push("CheckDMRules", "ClientEndServerFrames");
  return { trace };
}

type PickupCallback = () => boolean;
type TargetCallback = () => undefined;

function touchItem(pickup: PickupCallback, useTargets: TargetCallback, wasUsed: boolean, trace: JsonValue[]): { taken: boolean; targetsUsed: boolean; freed: boolean } {
  const taken = pickup();
  trace.push({ event: "Touch_Item.observes-return", taken });
  if (taken) trace.push("pickup.feedback");
  let targetsUsed = wasUsed;
  if (!targetsUsed) {
    useTargets();
    targetsUsed = true;
    trace.push("ITEM_TARGETS_USED=set");
  }
  if (!taken) return { taken, targetsUsed, freed: false };
  trace.push("G_FreeEdict");
  return { taken, targetsUsed, freed: true };
}

function pickup(input: Extract<OracleInput, { readonly kind: "pickup" }>): JsonValue {
  let inventory = input.inventory;
  const trace: JsonValue[] = [];
  const addAmmo: PickupCallback = () => {
    trace.push({ event: "Pickup_Ammo.enter", inventory });
    if (inventory === input.capacity) {
      trace.push({ event: "Pickup_Ammo.return", taken: false, inventory });
      return false;
    }
    inventory = Math.min(inventory + input.quantity, input.capacity);
    trace.push({ event: "Pickup_Ammo.return", taken: true, inventory });
    return true;
  };
  const useTargets: TargetCallback = () => {
    trace.push({ event: "G_UseTargets.enter", inventory, targetsUsed: input.targetsUsed });
    trace.push("G_UseTargets.return");
    return undefined;
  };
  return { ...touchItem(addAmmo, useTargets, input.targetsUsed, trace), inventory, trace };
}

function armor(input: Extract<OracleInput, { readonly kind: "armor" }>): JsonValue {
  const protections = { jacket: { normal: 0.3, energy: 0 }, combat: { normal: 0.6, energy: 0.3 }, body: { normal: 0.8, energy: 0.6 } };
  const protection = Math.fround(input.energy ? protections[input.armor].energy : protections[input.armor].normal);
  const absorbed = input.bypass ? 0 : Math.min(Math.ceil(Math.fround(protection * input.damage)), input.inventory);
  return { absorbed, remainingArmor: input.inventory - absorbed, remainingDamage: input.damage - absorbed, effect: absorbed === 0 ? null : "SpawnDamage" };
}

export function declaredSaveFields(text: string, struct: string): readonly string[] {
  const marker = `#define DECLARE_SAVE_STRUCT ${struct}\n`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Q2 save structure missing: ${struct}`);
  const end = text.indexOf("#undef DECLARE_SAVE_STRUCT", start);
  if (end < 0) throw new Error(`Q2 save structure unterminated: ${struct}`);
  const names: string[] = [];
  for (const match of text.slice(start, end).matchAll(/FIELD_AUTO\(\s*([^()]+?)\s*\)/g)) {
    const name = match[1];
    if (name !== undefined) names.push(name.trim());
  }
  return names;
}

function saveFields(input: Extract<OracleInput, { readonly kind: "save-fields" }>, sources: ReadonlyMap<string, string>): JsonValue {
  const selected = new Set(declaredSaveFields(sourceText(sources, "rereleaseSave"), input.struct));
  const retained: Record<string, JsonValue> = {};
  const omitted: string[] = [];
  for (const [field, value] of Object.entries(input.fields)) {
    if (selected.has(field)) retained[field] = value;
    else omitted.push(field);
  }
  return { retained, omitted };
}

function flechetteDefault(sources: ReadonlyMap<string, string>): JsonValue {
  const shared = sourceText(sources, "rereleaseShared");
  const enumBody = shared.match(/enum ammo_t : uint8_t\s*\{([^}]+)\}/)?.[1];
  if (enumBody === undefined) throw new Error("Q2 ammo_t definition missing");
  const names = Array.from(enumBody.matchAll(/\bAMMO_[A-Z]+\b/g), match => match[0]);
  const index = names.indexOf("AMMO_FLECHETTES");
  const count = names.indexOf("AMMO_MAX");
  const source = sourceText(sources, "rereleaseClient");
  const assignment = source.match(/max_ammo\[AMMO_FLECHETTES\] = (\d+);/)?.[1];
  if (index < 0 || count < 0 || assignment === undefined) throw new Error("Q2 flechette initialization missing");
  return { arrayIndex: index, arrayLength: count, defaultCapacity: Number(assignment), savedField: "max_ammo" };
}

function q64Config(input: Extract<OracleInput, { readonly kind: "q64-config" }>): JsonValue {
  const trace: JsonValue[] = [];
  let serverN64Physics = input.initialN64Physics;
  if (input.isN64 && !input.deathmatch) {
    trace.push({ event: "configstring", name: "CONFIG_N64_PHYSICS", value: "1" });
    serverN64Physics = true;
    trace.push({ event: "server.pm_config.n64_physics", value: true });
  }
  trace.push("G_InitStatusbar");
  trace.push({ event: "configstring", name: "CS_AIRACCEL", value: String(input.airacceleration) });
  trace.push({ event: "server.pm_config.airaccel", value: input.airacceleration });
  return { serverN64Physics, serverAiracceleration: input.airacceleration, trace };
}

export function commandPredicates(input: Extract<OracleInput, { readonly kind: "command-predicates" }>): JsonValue {
  return {
    classicHoldingJump: input.upmove >= 10,
    classicGroundedDuckBranch: input.upmove < 0,
    rereleaseHoldingJump: (input.buttons & 8) !== 0,
    rereleaseGroundedDuckBranch: (input.buttons & 16) !== 0 && !input.n64Physics,
  };
}

export function evaluate(input: OracleInput, sources: ReadonlyMap<string, string>): JsonValue {
  switch (input.kind) {
    case "clock": {
      const rereleaseTimesMs: number[] = [];
      let now = 0;
      for (let frame = 0; frame < input.rereleaseFrames; frame += 1) {
        now += input.rereleaseStepMs;
        rereleaseTimesMs.push(now);
      }
      return { classicTimesSeconds: input.classicFrames.map(classicTime), rereleaseTimesMs };
    }
    case "think": return think(input);
    case "frame-order": return frameOrder(input);
    case "pickup": return pickup(input);
    case "armor": return armor(input);
    case "cross-unit": {
      const flags = (input.flags | input.trigger) >>> 0;
      const satisfied = input.required === ((flags & 0xffff00ff & input.required) >>> 0);
      return { flags, satisfied, trace: satisfied ? ["flags|=trigger", "G_FreeEdict(trigger)", "G_UseTargets(target,target)", "G_FreeEdict(target)"] : ["flags|=trigger", "G_FreeEdict(trigger)"] };
    }
    case "save-fields": return saveFields(input, sources);
    case "flechette-default": return flechetteDefault(sources);
    case "q64-config": return q64Config(input);
    case "command-predicates": return commandPredicates(input);
  }
}
