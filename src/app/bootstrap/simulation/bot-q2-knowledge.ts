import type { ActorId } from "../../../contracts/identity.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { BotState } from "../../../bots/behavior/q3/ai-state.ts";
import { BotInventory } from "../../../bots/behavior/q3/ai-definitions.ts";
import type { WeaponInfo } from "../../../bots/behavior/library/weapons.ts";
import { DAMAGE_TYPE_IMPACT, DAMAGE_TYPE_RADIAL } from "../../../bots/behavior/library/weapons.ts";
import type { Q2WeaponDefinition } from "../../../content/q2/foundation/weapons/types.ts";
import type { SharedSimulation } from "./runtime.ts";
import { createBotArsenalKnowledge } from "../../../bots/behavior/q3/arsenal-knowledge.ts";

interface Ballistics {
  readonly damage: number;
  readonly speed: number;
  readonly range: number;
  readonly radius: number;
  readonly horizontal: number;
  readonly vertical: number;
  readonly count: number;
  readonly cycle: number;
  readonly gravity: number;
  readonly bounce: number;
  readonly detonation: number;
  readonly lift: number;
}
interface Entry { readonly slot: number; readonly definition: Q2WeaponDefinition; readonly ballistics: Ballistics; readonly info: WeaponInfo; }
const zero = { x: 0, y: 0, z: 0 };

/** p_weapon callbacks provide these unpowered shot values; random damage uses its arithmetic mean. */
function ballistics(name: string, rerelease: boolean, deathmatch: boolean): Ballistics | null {
  const shot = (damage: number, speed: number, range: number, radius: number, horizontal: number, vertical: number, count: number, cycle: number): Ballistics =>
    ({ damage, speed, range, radius, horizontal, vertical, count, cycle, gravity: 0, bounce: 0, detonation: 0, lift: 0 });
  switch (name) {
    case "blaster": return shot(rerelease || deathmatch ? 15 : 10, rerelease ? 1500 : 1000, rerelease ? 3000 : 2000, 0, 0, 0, 1, 0.5);
    case "shotgun": return shot(4, 0, 8192, 0, 500, 500, 12, 1.2);
    case "supershotgun": return shot(6, 0, 8192, 0, 1000, 500, 20, 1.2);
    case "machinegun": return shot(8, 0, 8192, 0, 300, 500, 1, 0.1);
    case "chaingun": return shot(deathmatch ? 6 : 8, 0, 8192, 0, 300, 500, 3, 0.1);
    case "grenadelauncher": return { ...shot(120, 600, 1500, 160, 0, 0, 1, 1.2), gravity: 1, bounce: 1.5, detonation: 2.5, lift: 200 };
    case "rocketlauncher": return shot(109.5, 650, 8000, 120, 0, 0, 1, 0.9);
    case "hyperblaster": return shot(deathmatch ? 15 : 20, 1000, 2000, 0, 0, 0, 1, 0.1);
    case "railgun": return shot(deathmatch ? 100 : rerelease ? 125 : 150, 0, 8192, 0, 0, 0, 1, 1.6);
    case "ionripper": return shot(deathmatch ? 30 : 50, 500, 1500, 0, Math.tan(Math.PI / 180) * 8192, 0, 1, 0.3);
    case "phalanx": return shot(74.5, 725, 8000, 120, Math.tan(1.5 * Math.PI / 180) * 8192, 0, 2, 1.6);
    case "etf_rifle": return shot(10, rerelease ? 1150 : 750, 8000, 0, 0, 0, 1, 0.1);
    case "heatbeam": return shot(15, 0, 8192, 0, 0, 0, 1, 0.1);
    default: return null;
  }
}
function weaponInfo(definition: Q2WeaponDefinition, slot: number, shot: Ballistics, rerelease: boolean): WeaponInfo {
  const offset = definition.name === "blaster" || definition.name === "hyperblaster" ? { x: 24, y: 8, z: -8 }
    : definition.name === "ionripper" ? { x: 16, y: 7, z: -8 }
    : definition.name === "etf_rifle" ? { x: 15, y: 8, z: -8 }
    : definition.name === "heatbeam" ? { x: 7, y: 2, z: -3 }
    : definition.name === "railgun" ? { x: 0, y: 7, z: -8 }
    : definition.name === "rocketlauncher" ? { x: 8, y: 8, z: -8 }
    : definition.name === "grenadelauncher" ? { x: 8, y: rerelease ? 0 : 8, z: -8 }
    : { x: 0, y: definition.name === "phalanx" ? 8 : rerelease ? 0 : 8, z: -8 };
  return { valid: true, number: slot, name: definition.name, model: definition.viewModel, level: 0, weaponInventoryIndex: 64 + slot,
    flags: 0, projectile: definition.name, projectileCount: shot.count, horizontalSpread: Math.atan(shot.horizontal / 8192) * 180 / Math.PI / 6, verticalSpread: Math.atan(shot.vertical / 8192) * 180 / Math.PI / 6,
    speed: shot.speed, acceleration: 0, recoil: zero, offset, angleOffset: zero, extraZVelocity: shot.lift,
    ammoAmount: definition.quantity, ammoInventoryIndex: 96 + slot, activate: definition.activateLast * 0.1, reload: shot.cycle, spinUp: definition.name === "chaingun" ? 1 : 0, spinDown: 0,
    projectileInfo: { name: definition.name, model: "", flags: 0, gravity: shot.gravity, damage: shot.damage, radius: shot.radius,
      visibleDamage: 0, damageType: DAMAGE_TYPE_IMPACT | (shot.radius > 0 ? DAMAGE_TYPE_RADIAL : 0), healthIncrease: 0,
      push: 0, detonation: shot.detonation, bounce: shot.bounce, bounceFriction: 0, bounceStop: 0 } };
}

export function createQ2BotKnowledge(options: { readonly simulation: Pick<SharedSimulation, "q2WeaponSource" | "inventory" | "combat">; readonly actorForClient: (client: number) => ActorId | null }) {
  const source = options.simulation.q2WeaponSource();
  if (source === null) throw new Error("Q2 bot weapon knowledge requires a selected Q2 arsenal");
  const definitions = source.weapons.registeredDefinitions(), entries = new Map<number, Entry>(), uncoveredWeapons: string[] = [];
  for (const [index, definition] of definitions.entries()) {
    const shot = ballistics(definition.name, source.game.options.edition === "rerelease", source.game.options.mode === "deathmatch");
    if (shot === null || shot.gravity > 0) { uncoveredWeapons.push(definition.name); continue; }
    const slot = index + 1; entries.set(slot, { slot, definition, ballistics: shot, info: weaponInfo(definition, slot, shot, source.game.options.edition === "rerelease") });
  }
  const inventory = options.simulation.inventory;
  const canUse = (actor: ActorId, entry: Entry): boolean => inventory.count(actor, entry.definition.item) > 0
    && (entry.definition.ammo === null || inventory.count(actor, entry.definition.ammo) >= entry.definition.quantity);
  const actorsForHandle = new Map<number, ActorId>();
  const knowledge = createBotArsenalKnowledge({
    updateInventory(state: BotState): void {
      const actor = options.actorForClient(state.client), combat = actor === null ? null : options.simulation.combat.read(actor);
      if (actor === null) actorsForHandle.delete(state.ws); else actorsForHandle.set(state.ws, actor);
      for (let index = 0; index < 200; index++) state.inventory[index] = 0;
      state.inventory[BotInventory.HEALTH] = combat?.health ?? 0;
      state.inventory[BotInventory.ARMOR] = combat === null || combat.armor.kind === "none" ? 0 : combat.armor.points;
      for (const entry of entries.values()) {
        state.inventory[entry.info.weaponInventoryIndex] = actor === null ? 0 : Number(inventory.count(actor, entry.definition.item) > 0);
        state.inventory[entry.info.ammoInventoryIndex] = actor === null || entry.definition.ammo === null ? 0 : inventory.count(actor, entry.definition.ammo);
      }
    },
    candidates: (_library, handle) => {
      const actor = actorsForHandle.get(handle);
      return [...entries.values()].map(entry => ({ info: entry.info, maximumRange: entry.ballistics.range, melee: false, personalityRole: null,
        supply: { weapon: entry.definition.item, owned: actor !== undefined && inventory.count(actor, entry.definition.item) > 0,
          ammo: entry.definition.ammo === null ? null : { item: entry.definition.ammo, perShot: entry.definition.quantity } } }));
    },
  });
  return { knowledge, uncoveredWeapons,
    resolveWeapon(client: number, decisionSlot: number): ItemId | null {
      const actor = options.actorForClient(client), entry = entries.get(decisionSlot);
      return actor !== null && entry !== undefined && canUse(actor, entry) ? entry.definition.item : null;
    },
    sourceWeapon(client: number): number {
      const actor = options.actorForClient(client), current = actor === null ? null : source.weapons.states.get(actor)?.weapon;
      return [...entries.values()].find(entry => entry.definition.name === current)?.slot ?? 0;
    },
  };
}
