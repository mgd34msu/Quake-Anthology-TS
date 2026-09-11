/* quakec_ctf/teamplay.qc explicit impulse 20/21 drops. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { sameActor } from "../../../../contracts/identity.ts";
import type { ItemId } from "../../../../contracts/gameplay.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { aim } from "../../foundation/weapons.ts";
import { vadd, vscale, vectors } from "../../foundation/types.ts";
import type { CtfState } from "./state.ts";

const ammoTypes: readonly { readonly item: ItemId; readonly limit: number; readonly weapons: readonly ItemId[] }[] = [
  { item: "q1:ammo/shells", limit: 20, weapons: ["q1:weapon/shotgun", "q1:weapon/supershotgun"] },
  { item: "q1:ammo/nails", limit: 20, weapons: ["q1:weapon/nailgun", "q1:weapon/supernailgun"] },
  { item: "q1:ammo/rockets", limit: 10, weapons: ["q1:weapon/grenadelauncher", "q1:weapon/rocketlauncher"] },
  { item: "q1:ammo/cells", limit: 20, weapons: ["q1:weapon/lightning"] },
];
const weapons: readonly { readonly item: ItemId; readonly classname: string; readonly model: string; readonly name: string }[] = [
  { item: "q1:weapon/supershotgun", classname: "weapon_supershotgun", model: "g_shot", name: "Double-barrelled Shotgun" },
  { item: "q1:weapon/nailgun", classname: "weapon_nailgun", model: "g_nail", name: "nailgun" },
  { item: "q1:weapon/supernailgun", classname: "weapon_supernailgun", model: "g_nail2", name: "Super Nailgun" },
  { item: "q1:weapon/grenadelauncher", classname: "weapon_grenadelauncher", model: "g_rock", name: "Grenade Launcher" },
  { item: "q1:weapon/rocketlauncher", classname: "weapon_rocketlauncher", model: "g_rock2", name: "Rocket Launcher" },
  { item: "q1:weapon/lightning", classname: "weapon_lightning", model: "g_light", name: "Thunderbolt" },
];
function launch(state: CtfState, actor: ActorId, item: Q1Actor): undefined {
  item.owner = actor; item.solid = "trigger"; item.movement = "bounce"; item.movementFlags |= 256;
  state.game.setBody(item, { origin: vadd(state.body(actor).origin, { x: 0, y: 0, z: 16 }),
    velocity: vscale(aim(state.game, state.owner(actor), vectors(state.services.input(actor).viewAngles).forward), 500),
    bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 56 } } });
  state.game.link(item); return state.game.schedule(item, 120, state.game.named.action(item, "SUB_Remove"));
}
export function tossAmmo(state: CtfState, actor: ActorId): undefined {
  const selected = state.services.selectedWeapon(actor), ammo = state.services.selectedAmmo(actor), inventory = state.game.host.inventory;
  if (ammo === null || inventory.count(actor, ammo) <= 0) return undefined;
  const item = state.game.create("ctf_backpack"); item.model = "progs/backpack.mdl";
  for (const type of ammoTypes) {
    if (!(selected !== null && type.weapons.includes(selected)) && type.weapons.some(weapon => inventory.count(actor, weapon) !== 0)) continue;
    const count = Math.min(type.limit, inventory.count(actor, type.item)); inventory.consume(state.owner(actor), type.item, count); state.context.setNumber(item, type.item, count);
  }
  item.touch = state.game.named.touch(item, "ctf:backpack_touch"); launch(state, actor, item); return state.services.weaponChanged(actor, null);
}
export function tossWeapon(state: CtfState, actor: ActorId): undefined {
  if (state.game.options.deathmatch !== 1) return undefined;
  const definition = weapons.find(weapon => weapon.item === state.services.selectedWeapon(actor)); if (definition === undefined) return undefined;
  const item = state.game.create(definition.classname); item.model = `progs/${definition.model}.mdl`; item.fields.set("ctf.weapon", definition.item);
  item.message = definition.name; item.touch = state.game.named.touch(item, "ctf:weapon_touch");
  state.game.host.inventory.consume(state.owner(actor), definition.item, 1); launch(state, actor, item); return state.services.weaponChanged(actor, null);
}
export function registerDrops(state: CtfState): undefined {
  const { game } = state;
  game.named.register("ctf:backpack_touch", { touch: (_runtime, item, actor) => {
    if (!game.isPlayer(actor) || game.health(actor) <= 0 || state.services.observer(actor)) return undefined;
    for (const type of ammoTypes) game.host.inventory.give(state.owner(actor), type.item, item.number(type.item));
    game.sound(state.owner(actor), "weapons/lock4.wav", "item"); game.effect("pickup", state.body(actor).origin, actor);
    state.services.weaponChanged(actor, null); return game.remove(item);
  } });
  game.named.register("ctf:weapon_touch", { touch: (_runtime, item, actor) => {
    if (!game.isPlayer(actor) || state.services.observer(actor)) return undefined;
    if (item.owner !== null && sameActor(item.owner, actor) && item.nextThink - game.time > 119) return undefined;
    const definition = weapons.find(weapon => weapon.item === item.text("ctf.weapon")); if (definition === undefined) throw new Error("CTF dropped weapon lost source kind");
    state.grant(actor, definition.item, 1); game.message(actor, "$qc_got_item", false, [item.message]);
    game.sound(state.owner(actor), "weapons/pkup.wav", "item"); game.effect("pickup", state.body(actor).origin, actor);
    state.services.weaponChanged(actor, definition.item); game.useTargets(item, actor); return game.remove(item);
  } }); return undefined;
}
