/* quakec_ctf/teamplay.qc and observ.qc team admission. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { sameActor } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { CTF_FLAGS } from "./types.ts";
import type { CtfTeam } from "./types.ts";
import { teamNumber } from "./state.ts";
import type { CtfState } from "./state.ts";

export function setTeam(state: CtfState, actor: ActorId, team: CtfTeam | null): undefined {
  state.game.host.combat.setTraits(state.owner(actor), { team });
  state.set(actor, "lastteam", teamNumber(team));
  const color = team === null ? 0 : teamNumber(team) - 1; return state.services.colors(actor, color, color);
}
export function checkTeam(state: CtfState, actor: ActorId): undefined {
  const current = state.team(actor);
  if (state.number(actor, "lastteam") >= 0 && current !== null) { state.set(actor, "lastteam", teamNumber(current)); return undefined; }
  let red = 0, blue = 0;
  for (const player of state.game.host.players()) if (!sameActor(actor, player)) { if (state.team(player) === "red") red++; else if (state.team(player) === "blue") blue++; }
  return setTeam(state, actor, blue < red || blue === red && state.game.host.random() < 0.5 ? "blue" : "red");
}
export function checkTeamLock(state: CtfState, actor: ActorId): undefined {
  if (state.teamplay < 0) return undefined;
  if (state.services.observer(actor) || state.startMap) { if (state.number(actor, "lastteam") !== 1) state.services.colors(actor, 0, 0); state.set(actor, "lastteam", 1); return undefined; }
  if (state.number(actor, "stuffColor") !== 0) { state.set(actor, "stuffColor", 0); return state.services.colors(actor, state.number(actor, "lastteam") - 1, state.number(actor, "lastteam") - 1); }
  const current = state.team(actor), previous = state.lastTeam(actor);
  if (current === null && state.number(actor, "lastteam") === 0) state.set(actor, "lastteam", -1);
  if (teamNumber(current) === state.number(actor, "lastteam")) return undefined;
  if ((state.teamplay & CTF_FLAGS.staticTeams) && state.number(actor, "lastteam") >= 0) {
    if (previous !== null) {
      if (state.number(actor, "suicideCount") > 3) state.services.disconnect(actor);
      state.set(actor, "killed", state.number(actor, "killed") === 1 ? 1 : 2);
      state.game.host.combat.setTraits(state.owner(actor), { invulnerable: false });
      state.game.damage(actor, actor, actor, 1000, null, "direct", "ctf:teamchange");
      state.set(actor, "suicideCount", state.number(actor, "suicideCount") + 1); return setTeam(state, actor, previous);
    }
    state.set(actor, "lastteam", -50);
  }
  if (state.number(actor, "lastteam") > 0) { state.set(actor, "killed", state.number(actor, "killed") === 1 ? 1 : 2); state.game.damage(actor, actor, actor, 1000, null, "direct", "ctf:teamchange"); }
  state.services.addScore(actor, -state.services.score(actor)); return checkTeam(state, actor);
}
export function spawnPoint(state: CtfState, actor: ActorId): Q1Actor | null {
  const team = state.team(actor), entities = [...state.game.entities.values()];
  const test = entities.find(entity => entity.classname === "testplayerstart"); if (test !== undefined) return test;
  if (state.game.options.coop || state.game.options.deathmatch === 0) return state.context.base.spawnSelector.select(true);
  const classname = state.startMap && state.number(actor, "killed") !== 0 ? "info_vote_destination" :
    state.number(actor, "killed") === 0 && team !== null ? team === "red" ? "info_player_team1" : "info_player_team2" : "info_player_deathmatch";
  const spots = entities.filter(entity => entity.classname === classname), last = state.world.references.get(`ctf.spawn.${classname}`);
  const index = spots.findIndex(spot => last !== undefined && last !== null && sameActor(spot.actor.id, last));
  const spot = spots[(index + 1) % spots.length] ?? null;
  if (spot === null) return entities.find(entity => entity.classname === "info_player_deathmatch") ?? entities.find(entity => entity.classname === "info_player_start") ?? null;
  state.world.references.set(`ctf.spawn.${classname}`, spot.actor.id); return spot;
}
export function showTeamPrompt(state: CtfState, actor: ActorId): undefined {
  if (state.services.promptSupported(actor)) return state.services.prompt(actor, "$qc_ctf_intro", [
    { label: "$qc_ctf_intro_auto", impulse: 103 }, { label: "$qc_ctf_intro_red", impulse: 101 },
    { label: "$qc_ctf_intro_blue", impulse: 102 }, { label: "$qc_ctf_intro_observer", impulse: 104 },
  ]);
  return state.game.message(actor, "Welcome!\nRunning ThreeWave CTF 5.0\n\nCapture the Flag!\n\nPress 1 for RED team\nPress 2 for BLUE team\nOr press JUMP for automatic team\n");
}
export function observerImpulse(state: CtfState, actor: ActorId, forcedImpulse: number | null = null): boolean {
  const input = forcedImpulse === null ? state.services.input(actor) : { ...state.services.input(actor), impulse: forcedImpulse }, observer = state.services.observer(actor);
  if (!(input.impulse >= 100 && input.impulse <= 104) && !(!state.services.promptSupported(actor) && observer && (input.impulse >= 1 && input.impulse <= 3 || input.jump))) return false;
  if (input.impulse === 100 && (state.teamplay & CTF_FLAGS.staticTeams)) { state.game.message(actor, "$qc_ctf_teams_locked"); state.services.consumeImpulse(actor); return true; }
  if (!observer) state.game.damage(actor, actor, actor, 1000, null, "direct", "ctf:teamchange");
  state.services.setObserver(actor, false); state.set(actor, "killed", 0);
  if (input.impulse === 100 || input.impulse === 104) { setTeam(state, actor, null); state.services.setObserver(actor, true); }
  else if (input.impulse === 1 || input.impulse === 101) setTeam(state, actor, "red");
  else if (input.impulse === 2 || input.impulse === 102) setTeam(state, actor, "blue");
  else if (input.impulse === 103) { state.set(actor, "lastteam", -50); checkTeam(state, actor); }
  state.services.clearPrompt(actor);
  if (state.lastTeam(actor) !== null) state.announce(state.lastTeam(actor) === "red" ? "$qc_ks_joined_red" : "$qc_ks_joined_blue", actor);
  state.services.consumeImpulse(actor); state.set(actor, "stuffColor", 1);
  state.services.respawn(actor, spawnPoint(state, actor));
  if (input.impulse === 100) showTeamPrompt(state, actor);
  return true;
}
