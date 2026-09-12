import type { ActorId } from "../../../contracts/identity.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { WeaponInfo } from "../../../bots/behavior/library/weapons.ts";
import { DAMAGE_TYPE_IMPACT, DAMAGE_TYPE_RADIAL } from "../../../bots/behavior/library/weapons.ts";
import { BotInventory } from "../../../bots/behavior/q3/ai-definitions.ts";
import { createBotArsenalKnowledge } from "../../../bots/behavior/q3/arsenal-knowledge.ts";
import type { Q1EntityServices } from "../../../content/q1/foundation/entity-services.ts";
import type { Q1BaseWeapon, Q1PlayerState, Q1Weapon } from "../../../content/q1/foundation/types.ts";
import { WEAPONS, isQ1BaseWeapon } from "../../../content/q1/foundation/types.ts";
import type { SharedSimulation } from "./runtime.ts";

interface Shot {
  readonly damage: number; readonly count: number; readonly cycle: number; readonly ammo: number;
  readonly speed: number; readonly range: number; readonly radius: number;
  readonly spreadX: number; readonly spreadY: number; readonly forward: number; readonly side: number;
}
interface Entry { readonly weapon: Q1BaseWeapon; readonly slot: number; readonly item: ItemId; readonly ammo: ItemId | null; }
const zero = { x: 0, y: 0, z: 0 };

/** progs106 weapons.qc/player.qc and foundation/weapons.ts; continuous frames fire every 0.1 seconds. */
function shot(game: Q1EntityServices, weapon: Q1BaseWeapon, player: Q1PlayerState | null): Shot {
  const row = (damage: number, count: number, cycle: number, ammo: number, speed: number, range: number, radius: number, spreadX: number, spreadY: number, forward: number, side: number): Shot =>
    ({ damage, count, cycle, ammo, speed, range, radius, spreadX, spreadY, forward, side });
  const nails = player === null ? 2 : game.host.inventory.count(player.actor.id, "q1:ammo/nails");
  const shells = player === null ? 2 : game.host.inventory.count(player.actor.id, "q1:ammo/shells");
  const nailSpeed = player === null ? 1000 : game.nailSpeed(player, 1000);
  switch (weapon) {
    case "axe": return row(20, 1, 0.5, 0, 0, 64, 0, 0, 0, 0, 0);
    case "shotgun": return row(4, 6, 0.5, 1, 0, 2048, 0, 0.04, 0.04, 10, 0);
    case "supershotgun": return shells > 1 ? row(4, 14, 0.7, 2, 0, 2048, 0, 0.14, 0.08, 10, 0) : row(4, 6, 0.7, 1, 0, 2048, 0, 0.04, 0.04, 10, 0);
    case "nailgun": return row(9, 1, 0.1, 1, nailSpeed, nailSpeed * 6, 0, 0, 0, 0, (player?.nailSide ?? 1) * 4);
    case "supernailgun": return nails >= 2 ? row(18, 1, 0.1, 2, nailSpeed, nailSpeed * 6, 0, 0, 0, 0, 0) : row(9, 1, 0.1, 1, nailSpeed, nailSpeed * 6, 0, 0, 0, 0, (player?.nailSide ?? 1) * 4);
    case "rocketlauncher": return row(110, 1, 0.8, 1, 1000, 5000, 160, 0, 0, 8, 0);
    case "lightning": return row(30, 1, 0.1, 1, 0, 600, 0, 0, 0, 0, 0);
    case "grenadelauncher": throw new Error("Q1 grenade trajectories are not admitted by bot weapon knowledge");
  }
}

export function createQ1BotKnowledge(options: {
  readonly simulation: Pick<SharedSimulation, "inventory" | "combat" | "bodies" | "q1WeaponSource">;
  readonly actorForClient: (client: number) => ActorId | null;
}) {
  const source = options.simulation.q1WeaponSource();
  if (source === null) throw new Error("Q1 bot weapon knowledge requires a selected Q1 arsenal");
  const game = source.game, inventory = options.simulation.inventory;
  const entries = new Map<number, Entry>(), uncoveredWeapons: Q1Weapon[] = [];
  const weapons = [...new Set<Q1Weapon>([...WEAPONS, ...game.registeredWeapons.keys()])];
  for (const [index, weapon] of weapons.entries()) {
    if (!isQ1BaseWeapon(weapon) || game.registeredWeapons.has(weapon) || weapon === "grenadelauncher") { uncoveredWeapons.push(weapon); continue; }
    const slot = index + 1; entries.set(slot, { weapon, slot, item: game.weaponItem(weapon), ammo: game.weaponAmmo(weapon) });
  }
  const actorsForHandle = new Map<number, ActorId>();
  const usable = (actor: ActorId, entry: Entry): boolean => {
    const player = game.player(actor); return player !== null && game.weaponAvailable(player, entry.weapon);
  };
  const knowledge = createBotArsenalKnowledge({
    updateInventory(state) {
      const actor = options.actorForClient(state.client);
      if (actor === null) actorsForHandle.delete(state.ws); else actorsForHandle.set(state.ws, actor);
      for (let index = 0; index < 200; index++) state.inventory[index] = 0;
      const combat = actor === null ? null : options.simulation.combat.read(actor);
      state.inventory[BotInventory.HEALTH] = combat?.health ?? 0;
      state.inventory[BotInventory.ARMOR] = combat === null || combat.armor.kind === "none" ? 0 : combat.armor.points;
      state.inventory[BotInventory.QUAD] = Number(actor !== null && game.powerupExpires(actor, "quad") > game.time);
      for (const entry of entries.values()) {
        state.inventory[64 + entry.slot] = actor === null ? 0 : Number(usable(actor, entry));
        state.inventory[96 + entry.slot] = actor === null || entry.ammo === null ? 0 : inventory.count(actor, entry.ammo);
      }
    },
    candidates(_library, handle) {
      const actor = actorsForHandle.get(handle), player = actor === undefined ? null : game.player(actor);
      const body = actor === undefined ? null : options.simulation.bodies.read(actor);
      return [...entries.values()].map(entry => {
        const values = shot(game, entry.weapon, player), bullets = entry.weapon === "shotgun" || entry.weapon === "supershotgun";
        const muzzleHeight = bullets && body !== null ? body.bounds.min.z + (body.bounds.max.z - body.bounds.min.z) * 0.7 : bullets ? 15.2 : 16;
        const info: WeaponInfo = { valid: true, number: entry.slot, name: entry.weapon, model: game.weaponModel(entry.weapon), level: 0,
          weaponInventoryIndex: 64 + entry.slot, flags: 0, projectile: entry.weapon, projectileCount: values.count,
          horizontalSpread: Math.atan(values.spreadX) * 180 / Math.PI / 6, verticalSpread: Math.atan(values.spreadY) * 180 / Math.PI / 6,
          speed: values.speed, acceleration: 0, recoil: zero, offset: { x: values.forward, y: values.side, z: muzzleHeight - 22 }, angleOffset: zero,
          extraZVelocity: 0, ammoAmount: values.ammo, ammoInventoryIndex: 96 + entry.slot, activate: 0,
          reload: values.cycle, spinUp: 0, spinDown: 0,
          projectileInfo: { name: entry.weapon, model: "", flags: 0, gravity: 0, damage: values.damage, radius: values.radius, visibleDamage: 0,
            damageType: DAMAGE_TYPE_IMPACT | (values.radius > 0 ? DAMAGE_TYPE_RADIAL : 0), healthIncrease: 0, push: 0, detonation: 0, bounce: 0, bounceFriction: 0, bounceStop: 0 } };
        return { info, maximumRange: values.range, melee: entry.weapon === "axe", personalityRole: null,
          supply: { weapon: entry.item, owned: actor !== undefined && inventory.count(actor, entry.item) > 0,
            ammo: entry.ammo === null ? null : { item: entry.ammo, perShot: values.ammo } } };
      });
    },
  });
  return { knowledge, uncoveredWeapons,
    resolveWeapon(client: number, decisionSlot: number): ItemId | null {
      const actor = options.actorForClient(client), entry = entries.get(decisionSlot);
      return actor !== null && entry !== undefined && usable(actor, entry) ? entry.item : null;
    },
    sourceWeapon(client: number): number {
      const actor = options.actorForClient(client), current = actor === null ? null : game.player(actor)?.weapon;
      return [...entries.values()].find(entry => entry.weapon === current)?.slot ?? 0;
    },
  };
}
