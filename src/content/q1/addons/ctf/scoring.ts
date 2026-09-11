/* quakec_ctf/combat.qc and client.qc: ordered teammate protection and CTF bonuses. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { sameActor } from "../../../../contracts/identity.ts";
import { length, vsub, vadd, vscale } from "../../foundation/types.ts";
import { CTF_FLAGS } from "./types.ts";
import type { CtfState } from "./state.ts";

function friendly(state: CtfState, target: ActorId, attacker: ActorId | null): boolean {
  return attacker !== null && !sameActor(target, attacker) && state.lastTeam(target) !== null && state.lastTeam(target) === state.lastTeam(attacker);
}
export function registerCombat(state: CtfState): undefined {
  const { game } = state;
  game.registerDamageSourceEffects("ctf:team_damage", {
    beforeQuad: (request, amount) => {
      const cause = request.attack.cause, falling = cause.kind === "q1" && cause.deathType === "falling" || cause.kind === "environment" && cause.hazard === "fall";
      return falling && state.grapplePulling(request.target) ? { kind: "cancel" } : { kind: "continue", amount };
    },
    armorAllowed: request => state.teamplay < 0 || state.startMap || !(state.teamplay & CTF_FLAGS.armorProtect) || !friendly(state, request.target, request.attack.attacker),
    protectionApplies: request => state.team(request.target) === state.lastTeam(request.target),
    beforeHealth: (request, damage) => {
      const attacker = request.attack.attacker;
      if (state.teamplay < 0 || state.startMap || !friendly(state, request.target, attacker)) return true;
      // TeamHealthDam receives full post-rune damage after the first armor and momentum commit.
      if (attacker !== null && (state.teamplay & CTF_FLAGS.reflectDamage)) game.damage(attacker, request.attack.inflictor ?? state.world.actor.id, attacker, damage, null, "direct", "ctf:reflection");
      return (state.teamplay & CTF_FLAGS.healthProtect) === 0;
    },
  }); return undefined;
}
/** Called once by the score owner before death drops; it replaces the ordinary Q1 frag decision. */
export function scoreDeath(state: CtfState, victim: ActorId, attacker: ActorId | null): undefined {
  const { game, services } = state;
  if (!game.isPlayer(victim)) return undefined;
  if (attacker === null || !game.isPlayer(attacker) || sameActor(attacker, victim)) { services.addScore(victim, -1); return undefined; }
  const team = state.team(attacker), teammates = friendly(state, victim, attacker);
  if (state.teamplay === 2 && team !== null && team === state.team(victim)) { services.addScore(attacker, -1); return undefined; }
  const penalty = state.teamplay < 0 ? -state.teamplay : teammates && (state.teamplay & CTF_FLAGS.fragPenalty) ? 1 : 0;
  if (penalty > 0) services.addScore(attacker, -penalty);
  else {
    services.addScore(attacker, 1);
    if (state.carried(victim) !== null && state.team(victim) !== team) {
      state.set(attacker, "lastFraggedCarrier", game.time);
      if (state.number(victim, "flagSince") + 2 > game.time) game.message(attacker, "$qc_ctf_carrier_no_bonus");
      else { services.addScore(attacker, 2); game.message(attacker, "$qc_ctf_kill_carrier", false, [2]); }
    }
    const teamName = team === "red" ? "$qc_ctf_redteam" : team === "blue" ? "$qc_ctf_blueteam" : "";
    let carrierBonus = false, flagBonus = false;
    if (state.number(victim, "lastHurtCarrier") + 4 > game.time && state.carried(attacker) === null) {
      services.addScore(attacker, 2); carrierBonus = true; state.announce("$qc_ks_defends_carrier_aggressive", attacker, teamName);
    }
    for (const [pass, center] of [state.body(attacker).origin, state.body(victim).origin].entries()) {
      for (const player of game.host.players()) {
        const body = state.body(player), playerCenter = vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5));
        if (!carrierBonus && !state.services.observer(player) && !sameActor(player, attacker) && state.team(player) === team && state.carried(player) !== null && length(vsub(playerCenter, center)) <= 550) {
          services.addScore(attacker, 1); carrierBonus = true; state.announce("$qc_ks_defends_carrier", attacker, teamName);
        }
      }
      const flag = team === null ? null : state.flag(team);
      const flagBody = flag === null ? null : game.body(flag);
      // Preserve the QC red-team branch precedence: its second radius pass can award a second flag bonus.
      if ((!flagBonus || team === "red" && pass === 1) && flag !== null && flag.solid !== "none" && flagBody !== null && length(vsub(vadd(flagBody.origin, vscale(vadd(flagBody.bounds.min, flagBody.bounds.max), 0.5)), center)) <= 550) {
        services.addScore(attacker, 1); flagBonus = true; state.announce("$qc_ks_defends_flag", attacker, teamName);
      }
    }
  }
  if (state.teamplay >= 0 && teammates && (state.teamplay & CTF_FLAGS.deathPenalty)) {
    game.damage(attacker, attacker, attacker, 1000, null, "direct", "ctf:teamkill"); services.addScore(attacker, 1);
  }
  return undefined;
}
