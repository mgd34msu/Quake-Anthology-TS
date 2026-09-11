/* quakec_ctf/ctfgame.qc, server.qc, client.qc and status.qc. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { spawnMapActor, spawnTeleportFog, spawnTeledeath } from "../../foundation/spawns.ts";
import { Q1_BASE_CLASSNAMES } from "../../base/provider.ts";
import { ZERO, vadd, vscale, vectors } from "../../foundation/types.ts";
import type { CtfState } from "./state.ts";
import { startRunes } from "./runes.ts";

function voteTeleport(state: CtfState, trigger: Q1Actor, actor: ActorId): undefined {
  const { game } = state, target = game.find(trigger.target)[0]; if (target === undefined) throw new Error(`CTF vote exit has missing target ${trigger.target}`);
  const origin = game.body(target).origin, forward = vectors(target.mangle).forward, body = state.body(actor);
  spawnTeleportFog(game, body.origin); spawnTeleportFog(game, vadd(origin, vscale(forward, 32))); spawnTeledeath(game, origin, actor);
  return state.services.teleport(actor, origin, target.mangle, vscale(forward, 300), game.time + 0.7);
}
export function voteTouch(state: CtfState, trigger: Q1Actor, actor: ActorId): undefined {
  const { game } = state;
  if (!game.isPlayer(actor) || game.health(actor) <= 0 || state.services.observer(actor)) return undefined;
  if (state.number(actor, "voted") !== 0) {
    if (state.number(actor, "voted") < game.time) game.message(actor, "$qc_ctf_already_voted");
    state.set(actor, "voted", game.time + 1); return voteTeleport(state, trigger, actor);
  }
  state.set(actor, "voted", game.time + 1); game.useTargets(trigger, actor); state.announce("$qc_ctf_has_voted", actor, trigger.message); trigger.count++;
  let leader: Q1Actor | null = null;
  for (const candidate of game.entities.values()) if (candidate.classname === "trigger_voteexit" && candidate !== trigger && candidate.count > (leader?.count ?? 0)) leader = candidate;
  if (trigger.count > (leader?.count ?? 0) || trigger.count === (leader?.count ?? 0) && game.host.random() > 0.5) leader = trigger;
  state.world.references.set("ctf.voteLeader", leader?.actor.id ?? null);
  if (leader !== null && state.world.number("ctf.voteExitTime") === 0) state.context.setNumber(state.world, "ctf.voteExitTime", game.time + 60);
  return voteTeleport(state, trigger, actor);
}
function nextLevel(state: CtfState, map: string): undefined {
  state.context.setNumber(state.world, "ctf.pregameOver", 1);
  const timer = state.game.create("ctf_nextlevel"); timer.fields.set("map", map);
  return state.game.schedule(timer, 0.1, state.game.named.action(timer, "ctf:nextlevel"));
}
export function mapFrame(state: CtfState): undefined {
  if (state.game.intermission !== null || state.world.number("ctf.pregameOver") !== 0) return undefined;
  if (state.startMap) {
    const leader = state.game.entity(state.world.references.get("ctf.voteLeader") ?? null), time = state.world.number("ctf.voteExitTime");
    if (leader !== null && time !== 0 && state.game.time > time) nextLevel(state, leader.text("map"));
    return undefined;
  }
  const timeLimit = state.context.services.cvar("timelimit") * 60, captureLimit = state.context.services.cvar("fraglimit");
  const red = state.services.captures("red"), blue = state.services.captures("blue");
  if (!(timeLimit !== 0 && state.game.time >= timeLimit) && !(captureLimit !== 0 && (red >= captureLimit || blue >= captureLimit))) return undefined;
  for (const actor of state.game.host.players()) {
    if (red === blue) state.game.message(actor, "$qc_ks_match_tied", false, [red]);
    else { state.game.message(actor, red > blue ? "$qc_ks_red_won" : "$qc_ks_red_lost", false, [red]); state.game.message(actor, blue > red ? "$qc_ks_blue_won" : "$qc_ks_blue_lost", false, [blue]); }
  }
  const maps = ["ctf1", "ctf2", "ctf3", "ctf4", "ctf5", "ctf6", "ctf7", "ctf8", "ctf9"];
  return nextLevel(state, maps[(maps.indexOf(state.game.mapName) + 1) % maps.length] ?? "ctf1");
}
export function registerMaps(state: CtfState): undefined {
  const { game } = state;
  game.named.register("ctf:nextlevel", { action: (_runtime, entity) => { state.context.base.levelRules.begin(entity.text("map"), null); return game.remove(entity); } });
  game.named.register("ctf:frame", { action: () => mapFrame(state) });
  game.named.register("ctf:vote_touch", { touch: (_runtime, entity, actor) => voteTouch(state, entity, actor) });
  game.named.register("ctf:changelevel_touch", { touch: (_runtime, entity, actor) => {
    const noexit = state.context.services.cvar("noexit");
    if (!game.isPlayer(actor) || noexit === 1 || noexit === 2 && !state.startMap) return undefined;
    state.announce("$qc_exited", actor); game.useTargets(entity, actor);
    if ((entity.spawnflags & 1) !== 0 && game.options.deathmatch === 0) return game.travel(entity.text("map"), actor);
    entity.touch = null; return game.schedule(entity, 0.1, game.named.action(entity, "ctf:nextlevel"));
  } });
  game.registerSpawn("worldspawn", (runtime, world) => { spawnMapActor(runtime, world); state.context.addFrameTick(world, "ctf:frame"); return undefined; });
  game.registerSpawn("info_vote_destination", (_runtime, entity) => {
    if (entity.targetname === "") throw new Error("CTF vote destination has no targetname");
    entity.mangle = game.body(entity).angles; entity.model = ""; return game.setBody(entity, { angles: ZERO, origin: vadd(game.body(entity).origin, { x: 0, y: 0, z: 27 }) });
  });
  game.registerSpawn("trigger_voteexit", (_runtime, entity) => {
    // The released QC has an unconditional objerror here; retain its documented map behavior with the missing condition restored.
    if (entity.target === "") throw new Error("CTF vote exit has no target");
    state.context.initTrigger(entity); entity.count = 0; entity.touch = game.named.touch(entity, "ctf:vote_touch"); return game.link(entity);
  });
  game.replaceSpawn("trigger_changelevel", (_runtime, entity) => {
    if (entity.text("map") === "") throw new Error("CTF changelevel trigger has no map");
    state.context.initTrigger(entity); entity.touch = game.named.touch(entity, "ctf:changelevel_touch"); return game.link(entity);
  });
  game.registerSpawn("func_ctf_wall", (_runtime, entity) => { entity.solid = "bsp"; entity.movement = "push"; game.setBody(entity, { angles: ZERO }); return game.link(entity); });
  for (const classname of ["info_player_team1", "info_player_team2"]) game.registerSpawn(classname, () => undefined);
  game.registerSpawn("info_player_deathmatch", () => game.options.deathmatch !== 0 ? startRunes(state) : undefined);
  for (const classname of ["monster_army", "monster_dog", "monster_ogre", "monster_ogre_marksman", "monster_knight", "monster_hell_knight", "monster_wizard", "monster_demon1", "monster_shambler", "monster_zombie", "monster_tarbaby", "monster_fish", "monster_enforcer", "monster_shalrath", "monster_boss", "monster_oldone"]) {
    if (Q1_BASE_CLASSNAMES.includes(classname)) game.replaceSpawn(classname, (_runtime, entity) => game.remove(entity));
    else game.registerSpawn(classname, (_runtime, entity) => game.remove(entity));
  }
  return undefined;
}
