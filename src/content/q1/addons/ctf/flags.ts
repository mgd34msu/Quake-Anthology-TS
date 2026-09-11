/* quakec_ctf/teamplay.qc flag state, carrier offsets and capture assists. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { sameActor } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { ZERO, vadd, vsub, vscale, vectors } from "../../foundation/types.ts";
import { CTF_FLAG_BOUNDS } from "./types.ts";
import type { CtfState } from "./state.ts";
import { opposite, teamNumber } from "./state.ts";

export function returnFlag(state: CtfState, flag: Q1Actor, announce = true): undefined {
  const { game } = state, team = state.flagTeam(flag);
  flag.movement = "toss"; flag.solid = "trigger"; flag.count = 0; flag.owner = null;
  game.setBody(flag, { origin: flag.vector("ctf.base"), angles: flag.mangle }); game.link(flag);
  game.sound(flag, "items/itembk2.wav");
  if (announce) for (const player of game.host.players()) game.message(player, state.team(player) === team ? "$qc_ctf_your_returned" : "$qc_ctf_enemy_returned");
  return undefined;
}
export function dropFlag(state: CtfState, actor: ActorId): undefined {
  const flag = state.carried(actor); if (flag === null) return undefined;
  state.announce(state.lastTeam(actor) === "red" ? "$qc_ks_blue_dropped" : "$qc_ks_red_dropped", actor); state.services.log(actor, "FLAG-DROP");
  flag.count = 2; flag.movement = "toss"; flag.solid = "trigger";
  flag.movementFlags = 256 | 131072;
  state.context.setNumber(flag, "ctf.return", state.game.time + 15);
  state.game.setBody(flag, { origin: vsub(state.body(actor).origin, { x: 0, y: 0, z: 24 }), velocity: { x: 0, y: 0, z: 300 }, bounds: CTF_FLAG_BOUNDS });
  state.game.link(flag); return state.update();
}
export function touchFlag(state: CtfState, flag: Q1Actor, actor: ActorId): undefined {
  const { game } = state, team = state.team(actor), own = state.flagTeam(flag);
  if (flag.solid !== "trigger" || !game.isPlayer(actor) || game.health(actor) <= 0 || state.services.observer(actor) || team === null || team !== state.lastTeam(actor)) return undefined;
  if (team === own) {
    if (flag.count === 0) {
      if (state.carried(actor) === null) return undefined;
      state.announce(team === "red" ? "$qc_ks_blue_captured" : "$qc_ks_red_captured", actor); state.services.log(actor, "FLAG-CAPTURE");
      state.grant(actor, "q1:key/silver", 0); state.grant(actor, "q1:key/gold", 0);
      state.context.setNumber(state.world, "ctf.lastCapture", game.time); state.context.setNumber(state.world, "ctf.lastCaptureTeam", teamNumber(team));
      game.sound(state.owner(actor), "misc/flagcap.wav", "voice", 0); state.services.addCapture(team); state.services.addScore(actor, 15);
      for (const player of game.host.players()) {
        state.set(player, "killed", 0);
        if (state.lastTeam(player) === team) {
          if (!sameActor(player, actor)) state.services.addScore(player, 10);
          if (state.number(player, "lastReturned") + 4 > game.time) { state.announce("$qc_ks_assist", player); state.services.addScore(player, 1); }
          if (state.number(player, "lastFraggedCarrier") + 6 > game.time) { state.announce("$qc_ks_assist_carrier", player); state.services.addScore(player, 2); }
        } else state.set(player, "lastHurtCarrier", -5);
        game.message(player, state.lastTeam(player) === team ? "$qc_ctf_team_captured" : "$qc_ctf_your_captured");
      }
      for (const color of [team, opposite(team)]) { const home = state.flag(color); if (home !== null) returnFlag(state, home, false); }
    } else {
      state.announce(team === "red" ? "$qc_ks_red_returned" : "$qc_ks_blue_returned", actor); state.services.log(actor, "FLAG-RECOVERY");
      state.services.addScore(actor, 1); state.set(actor, "lastReturned", game.time); game.sound(state.owner(actor), "doors/runetry.wav", "item"); returnFlag(state, flag);
    }
    return state.update();
  }
  state.announce("$qc_ks_blue_picked_up", actor); state.services.log(actor, "FLAG-PICKUP");
  game.message(actor, "$qc_ctf_have_flag"); game.sound(state.owner(actor), "misc/flagtk.wav", "item");
  state.grant(actor, own === "red" ? "q1:key/gold" : "q1:key/silver", 1); state.set(actor, "flagSince", game.time);
  flag.count = 1; flag.movement = "noclip"; flag.solid = "none"; flag.owner = actor; game.link(flag);
  for (const player of game.host.players()) if (!sameActor(player, actor)) game.message(player, state.team(player) === team ? "$qc_ctf_your_has" : "$qc_ctf_your_taken");
  return state.update();
}

function flagThink(state: CtfState, flag: Q1Actor): undefined {
  const { game } = state;
  game.schedule(flag, 0.1, game.named.action(flag, "ctf:flag_think"));
  if (flag.count === 0) return undefined;
  if (flag.count === 2) {
    // QC stores time+15 at drop, then compares time-super_time>15: the authored delay is 30 seconds.
    if (game.time - flag.number("ctf.return") > 15) returnFlag(state, flag);
    return state.update();
  }
  if (flag.count !== 1) throw new Error("CTF flag has an invalid source state");
  const actor = flag.owner;
  if (actor === null || !game.host.actors.isLive(actor)) return returnFlag(state, flag);
  if (game.health(actor) <= 0) return dropFlag(state, actor);
  const body = state.body(actor), frame = state.services.input(actor).frame, basis = vectors(body.angles);
  let distance = 14;
  if (frame >= 29 && frame <= 34) distance += [2, 8, 12, 11, 10, 4][frame - 29] ?? 0;
  else if (frame >= 35 && frame <= 40) distance += [2, 10, 10, 8, 4, 2][frame - 35] ?? 0;
  else if (frame >= 103 && frame <= 118) distance += frame <= 106 ? 6 : 7;
  const forward = { ...basis.forward, z: -basis.forward.z };
  game.setBody(flag, { origin: vadd(vsub(vadd(body.origin, { x: 0, y: 0, z: -16 }), vscale(forward, distance)), vscale(basis.right, 22)),
    angles: vadd(body.angles, { x: 0, y: 0, z: -45 }) }); game.link(flag);
  return game.schedule(flag, 0.01, game.named.action(flag, "ctf:flag_think"));
}

export function registerFlags(state: CtfState): undefined {
  const { game } = state;
  game.named.register("ctf:flag_touch", { touch: (_game, flag, actor) => touchFlag(state, flag, actor) });
  game.named.register("ctf:flag_think", { action: (_game, flag) => flagThink(state, flag) });
  game.named.register("ctf:place_flag", { action: (_game, flag) => {
    const body = game.body(flag), start = vadd(body.origin, { x: 0, y: 0, z: 6 });
    const floor = game.host.trace({ start, end: vsub(start, { x: 0, y: 0, z: 256 }), bounds: body.bounds, ignore: flag.actor.id, monsters: true });
    if (floor.allSolid || floor.fraction === 1) return game.remove(flag);
    flag.solid = "trigger"; flag.movement = "toss"; flag.movementFlags = 256 | 131072; flag.count = 0; flag.mangle = body.angles; flag.effects |= 8;
    flag.touch = game.named.touch(flag, "ctf:flag_touch"); state.context.setVector(flag, "ctf.base", floor.end);
    game.setBody(flag, { origin: floor.end, velocity: ZERO, ground: floor.actor }); game.link(flag);
    return game.schedule(flag, 0.1, game.named.action(flag, "ctf:flag_think"));
  } });
  for (const [index, name] of ["item_flag_team1", "item_flag_team2"].entries()) game.registerSpawn(name, (_game, flag) => {
    flag.model = "progs/flag.mdl"; flag.skin = index; flag.effects = index === 0 ? 32 : 16;
    game.setBounds(flag, CTF_FLAG_BOUNDS); return game.schedule(flag, 0.2, game.named.action(flag, "ctf:place_flag"));
  });
  return undefined;
}
