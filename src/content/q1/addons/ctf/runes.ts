/* quakec_ctf/items.qc, combat.qc and client.qc rune effects. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { ItemId } from "../../../../contracts/gameplay.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { vadd } from "../../foundation/types.ts";
import { CTF_RUNES } from "./types.ts";
import type { CtfRune } from "./types.ts";
import { runeItem } from "./state.ts";
import type { CtfState } from "./state.ts";

export const CTF_HASTE_INTERVALS: Readonly<Partial<Record<ItemId, number>>> = {
  "q1:weapon/axe": 0.3, "q1:weapon/shotgun": 0.3, "q1:weapon/supershotgun": 0.4,
  "q1:weapon/grenadelauncher": 0.3, "q1:weapon/rocketlauncher": 0.4,
};
export const CTF_HASTE_NAIL_SPEED = 2000;

function nextRuneSpawn(state: CtfState): Q1Actor {
  const spots = [...state.game.entities.values()].filter(entity => entity.classname === "info_player_deathmatch");
  const previous = state.world.references.get("ctf.runeSpawn"), ordinal = spots.findIndex(spot => previous !== undefined && previous !== null && spot.actor.id.equals(previous));
  const spot = spots[(ordinal + 1) % spots.length]; if (spot === undefined) throw new Error("CTF has no info_player_deathmatch to spawn a rune");
  state.world.references.set("ctf.runeSpawn", spot.actor.id); return spot;
}
function droppedRune(state: CtfState, rune: CtfRune, origin: import("../../../../contracts/math.ts").Vec3): Q1Actor {
  const { game } = state, item = game.create(`item_rune_${rune}`), ordinal = CTF_RUNES.indexOf(rune);
  item.model = `progs/end${ordinal + 1}.mdl`; item.solid = "trigger"; item.movement = "toss"; item.movementFlags |= 256; item.fields.set("ctf.rune", rune);
  game.setBody(item, { origin: vadd(origin, { x: 0, y: 0, z: -24 }), velocity: { x: -500 + game.host.random() * 1000, y: -500 + game.host.random() * 1000, z: 400 },
    bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 56 } } });
  item.touch = game.named.touch(item, "ctf:rune_touch"); game.link(item); game.schedule(item, 120, game.named.action(item, "ctf:rune_respawn")); return item;
}
function kind(item: Q1Actor): CtfRune {
  const rune = CTF_RUNES.find(rune => rune === item.text("ctf.rune")); if (rune === undefined) throw new Error("CTF rune lost its source kind"); return rune;
}
export function dropRune(state: CtfState, actor: ActorId): undefined {
  const rune = state.rune(actor); if (rune === null) return undefined;
  droppedRune(state, rune, state.body(actor).origin); state.grant(actor, runeItem(rune), 0); state.services.haste(actor, false); return state.update(actor);
}
export function regenerate(state: CtfState, actor: ActorId): undefined {
  const { game } = state, rune = state.rune(actor);
  state.services.haste(actor, rune === "haste");
  if (rune !== "regeneration" || state.number(actor, "regenTime") >= game.time || game.health(actor) <= 0) return undefined;
  let delay = 0;
  if (game.health(actor) < 150) { game.host.combat.setHealth(state.owner(actor), Math.min(150, game.health(actor) + 5)); delay += 0.5; }
  const armor = game.host.combat.read(actor)?.armor.regular;
  if (armor !== undefined && armor.kind !== "none" && armor.points < 150 && (armor.kind !== "q1" || armor.absorption > 0)) {
    game.host.combat.setRegularPoints(state.owner(actor), Math.min(150, armor.points + 5)); delay += 0.5;
  }
  state.set(actor, "regenTime", game.time + delay);
  if (delay > 0 && state.number(actor, "regenSound") < game.time) { state.set(actor, "regenSound", game.time + 1); game.sound(state.owner(actor), "rune/rune4.wav", "body"); }
  return undefined;
}
export function startRunes(state: CtfState): undefined {
  if (state.startMap || state.world.number("ctf.runesSpawned") !== 0) return undefined;
  state.context.setNumber(state.world, "ctf.runesSpawned", 1);
  const timer = state.game.create("ctf_rune_spawn"); return state.game.schedule(timer, 0.1, state.game.named.action(timer, "ctf:rune_spawn"));
}
export function registerRunes(state: CtfState): undefined {
  const { game } = state;
  game.named.register("ctf:rune_touch", { touch: (_game, item, actor) => {
    if (!game.isPlayer(actor) || game.health(actor) <= 0 || state.services.observer(actor)) return undefined;
    if (state.rune(actor) !== null) { if (state.number(actor, "runeNotice") < game.time) { game.message(actor, "$qc_already_have_rune"); state.set(actor, "runeNotice", game.time + 5); } return undefined; }
    const rune = kind(item), ordinal = CTF_RUNES.indexOf(rune); state.grant(actor, runeItem(rune), 1);
    game.message(actor, `$qc_rune${ordinal + 1}_hud`); game.sound(state.owner(actor), "weapons/lock4.wav", "item"); game.effect("pickup", state.body(actor).origin, actor);
    if (state.teamplay === 0 && rune !== "regeneration" || state.teamplay === 2147483648 && rune === "regeneration") state.announce(`$qc_got_rune${ordinal + 1}`, actor);
    game.remove(item); return state.update(actor);
  } });
  game.named.register("ctf:rune_respawn", { action: (_game, item) => { droppedRune(state, kind(item), game.body(nextRuneSpawn(state)).origin); return game.remove(item); } });
  game.named.register("ctf:rune_spawn", { action: (_game, timer) => {
    for (let count = game.host.random() * 10; count > 0; count--) nextRuneSpawn(state);
    for (const rune of CTF_RUNES) droppedRune(state, rune, game.body(nextRuneSpawn(state)).origin);
    return game.remove(timer);
  } });
  game.registerDamageSourceEffects("ctf:runes", { afterQuad: (request, initial) => {
    const actor = request.attack.attacker; let amount = initial;
    if (actor !== null && state.rune(actor) === "strength") amount = Math.fround(amount * 2);
    if (state.rune(request.target) === "resistance") {
      amount = Math.fround(amount / 2);
      if (state.number(request.target, "resistanceSound") < game.time) { state.set(request.target, "resistanceSound", game.time + 1); game.sound(state.owner(request.target), "rune/rune1.wav", "body"); }
    }
    if (actor !== null && game.isPlayer(actor) && state.carried(request.target) !== null && state.lastTeam(actor) !== state.lastTeam(request.target) && state.lastTeam(request.target) !== null)
      state.set(actor, "lastHurtCarrier", game.time);
    return { kind: "continue", amount };
  } }); return undefined;
}
