/* quakec_ctf/weapons.qc and player.qc, joined to the selected source arsenal. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { length, WEAPONS } from "../../foundation/types.ts";
import type { CtfState } from "./state.ts";
import { CTF_FLAGS } from "./types.ts";
import { fireHook } from "./grapple.ts";
import { CTF_HASTE_INTERVALS, CTF_HASTE_NAIL_SPEED } from "./runes.ts";
import { CTF_RUNES } from "./types.ts";
import { runeItem } from "./state.ts";

export interface CtfCharacterPose { readonly axePose: boolean; readonly frame: number | null; }
/** Q1 model frames only; foreign character controllers use their own grapple animation mapping. */
export function characterPose(state: CtfState, actor: ActorId): CtfCharacterPose {
  const selected = state.services.input(actor).grappleSelected;
  if (!selected) return { axePose: state.services.selectedWeapon(actor) === "q1:weapon/axe", frame: null };
  const frame = state.number(actor, "hookWeaponFrame"), hook = state.hook(actor);
  return { axePose: true, frame: frame === 2 ? 137 : frame === 3 ? hook !== null && state.game.time < hook.number("ctf.fired") + 0.1 ? 138 : 139 : frame === 4 ? 73 : frame === 5 ? 140 : null };
}

export function spawnArsenal(state: CtfState, actor: ActorId): undefined {
  const { game } = state, player = game.player(actor); if (player === null) return undefined;
  for (const kind of player.powerups.keys()) game.host.powerup(player.actor, kind, 0); player.powerups.clear();
  state.grant(actor, "q1:key/silver", 0); state.grant(actor, "q1:key/gold", 0);
  for (const rune of CTF_RUNES) state.grant(actor, runeItem(rune), 0);
  for (const weapon of WEAPONS) state.grant(actor, game.weaponItem(weapon), weapon === "axe" || weapon === "shotgun" && !state.startMap ? 1 : 0);
  state.grant(actor, "q1:ammo/shells", state.startMap ? 0 : 40, 100);
  state.grant(actor, "q1:ammo/nails", 0, 200); state.grant(actor, "q1:ammo/rockets", 0, 100); state.grant(actor, "q1:ammo/cells", 0, 100);
  state.grant(actor, "q1:ctf/weapon/grapple", !state.startMap && !(state.teamplay & CTF_FLAGS.disableGrapple) ? 1 : 0);
  game.host.combat.setArmor(player.actor, state.startMap ? { kind: "none" } : { kind: "q1", points: 50, absorption: 0.3, item: "q1:item_armor1" });
  game.selectWeapon(player.actor, state.startMap ? "axe" : "shotgun"); return undefined;
}

function weaponFrame(state: CtfState, actor: ActorId, frame: number): undefined {
  state.set(actor, "hookWeaponFrame", frame);
  const player = state.game.player(actor); if (player !== null) player.weaponFrame = frame;
  return state.game.host.emit({ kind: "weapon", player: actor, weapon: "ctf:grapple", viewModel: "progs/v_star.mdl", frame, punch: 0 });
}
function hasteSound(state: CtfState, actor: ActorId): undefined {
  if (state.number(actor, "hasteSound") < state.game.time) { state.set(actor, "hasteSound", state.game.time + 1); state.game.sound(state.owner(actor), "rune/rune3.wav", "body"); }
  return undefined;
}
export function grappleAttack(state: CtfState, actor: ActorId): boolean {
  if (state.teamplay & CTF_FLAGS.disableGrapple) return false;
  const { game } = state;
  if (state.number(actor, "hookAttackFinished") > game.time) return false;
  state.set(actor, "hookAttackFinished", game.time + 0.1);
  const player = game.player(actor); if (player !== null) player.attackFinished = Math.fround(game.time + 0.1);
  if (state.hook(actor) !== null) { weaponFrame(state, actor, length(state.body(actor).velocity) >= 750 ? 4 : 3); return true; }
  if (state.context.playerReference(actor, "ctf.hookAnimation") !== null) return true;
  const timer = game.create("ctf_hook_animation"); timer.owner = actor;
  state.context.setPlayerReference(actor, "ctf.hookAnimation", timer.actor.id); weaponFrame(state, actor, 2);
  game.schedule(timer, 0.1, game.named.action(timer, "ctf:hook_launch_frame")); return true;
}
export function registerArsenal(state: CtfState): undefined {
  const { game } = state;
  game.named.register("ctf:hook_launch_frame", { action: (_runtime, timer) => {
    const actor = timer.owner;
    if (actor !== null && game.host.actors.isLive(actor)) {
      state.context.setPlayerReference(actor, "ctf.hookAnimation", null);
      if (game.health(actor) > 0 && state.services.input(actor).grappleSelected) { weaponFrame(state, actor, 3); fireHook(state, actor); }
    }
    return game.remove(timer);
  } });
  game.registerWeapon({ id: "ctf:grapple", item: "q1:ctf/weapon/grapple", ammo: null, model: "progs/v_star.mdl", rank: 0,
    available: () => (state.teamplay & CTF_FLAGS.disableGrapple) === 0, bestAvailable: () => false,
    fire: (_runtime, player) => grappleAttack(state, player.actor.id),
    animate: (_runtime, player) => {
      const hook = state.hook(player.actor.id), current = state.number(player.actor.id, "hookWeaponFrame");
      if (hook !== null) { const next = length(state.body(player.actor.id).velocity) >= 750 ? 4 : 3; if (current !== next) weaponFrame(state, player.actor.id, next); }
      else if (state.context.playerReference(player.actor.id, "ctf.hookAnimation") === null && current !== 0) {
        if (current !== 5) { weaponFrame(state, player.actor.id, 5); state.set(player.actor.id, "hookReleaseTime", game.time + 0.1); }
        else if (game.time >= state.number(player.actor.id, "hookReleaseTime")) weaponFrame(state, player.actor.id, 0);
      }
      return undefined;
    },
  });
  game.registerWeaponRules({ id: "ctf:rune_weapons",
    beforeFire: (_runtime, player) => {
      if (state.rune(player.actor.id) !== "strength" || state.number(player.actor.id, "strengthSound") >= game.time) return undefined;
      state.set(player.actor.id, "strengthSound", game.time + 1);
      const quad = player.powerups.get("quad") ?? 0;
      return game.sound(player.actor, quad > game.time ? "rune/rune22.wav" : "rune/rune2.wav", "body");
    },
    attackDelay: (_runtime, player, delay) => {
      if (state.rune(player.actor.id) !== "haste") return delay;
      const source = CTF_HASTE_INTERVALS[game.weaponItem(player.weapon)]; if (source === undefined) return delay;
      hasteSound(state, player.actor.id); return source;
    },
    nailSpeed: (_runtime, player, speed) => { if (state.rune(player.actor.id) !== "haste") return speed; hasteSound(state, player.actor.id); return CTF_HASTE_NAIL_SPEED; },
  });
  game.registerPickupRules({ id: "ctf:weapon_pickups",
    weaponAmmoGrant: (_runtime, _player, _weapon, amount) => game.options.coop && (state.teamplay & CTF_FLAGS.dropItems) !== 0 ? 0 : amount,
    autoSwitch: (_runtime, player, owned) => !state.services.isBot(player.actor.id) && !(player.weapon === "ctf:grapple" && player.attackHeld) && player.autoSwitch !== "never" && (player.autoSwitch !== "new" || !owned),
    weaponRank: weapon => {
      const rank = ["lightning", "rocketlauncher", "supernailgun", "grenadelauncher", "supershotgun", "nailgun"].indexOf(weapon);
      return rank < 0 ? 7 : rank + 1;
    },
  }); return undefined;
}
