/* quakec_ctf/weapons.qc and player.qc, joined to the selected source arsenal. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { WEAPONS } from "../../foundation/types.ts";
import type { CtfState } from "./state.ts";
import { CTF_FLAGS } from "./types.ts";
import { ThreewaveWeapon } from "../../equipment/threewave-weapon.ts";
import { CTF_HASTE_INTERVALS, CTF_HASTE_NAIL_SPEED } from "./runes.ts";
import { CTF_RUNES } from "./types.ts";
import { runeItem } from "./state.ts";

export interface CtfCharacterPose { readonly axePose: boolean; readonly frame: number | null; }
/** Q1 model frames only; foreign character controllers use their own grapple animation mapping. */
export function characterPose(state: CtfState, actor: ActorId): CtfCharacterPose {
  const selected = state.services.input(actor).grappleSelected;
  if (!state.nativeGrappleEnabled || !selected) return { axePose: state.services.selectedWeapon(actor) === "q1:weapon/axe", frame: null };
  const frame = state.grappleState(actor).weaponFrame, hook = state.hook(actor);
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
  state.grant(actor, "q1:ctf/weapon/grapple", state.nativeGrappleEnabled && !state.startMap && !(state.teamplay & CTF_FLAGS.disableGrapple) ? 1 : 0);
  game.host.combat.setArmor(player.actor, state.startMap ? { kind: "none" } : { kind: "q1", points: 50, absorption: 0.3, item: "q1:item_armor1" });
  game.selectWeapon(player.actor, state.startMap ? "axe" : "shotgun"); return undefined;
}

function weaponFrame(state: CtfState, actor: ActorId, frame: number): undefined {
  state.grappleState(actor).weaponFrame = frame;
  const player = state.game.player(actor); if (player !== null) player.weaponFrame = frame;
  return state.game.host.emit({ kind: "weapon", player: actor, weapon: "ctf:grapple", viewModel: "progs/v_star.mdl", frame, punch: 0 });
}
function hasteSound(state: CtfState, actor: ActorId): undefined {
  if (state.number(actor, "hasteSound") < state.game.time) { state.set(actor, "hasteSound", state.game.time + 1); state.game.sound(state.owner(actor), "rune/rune3.wav", "body"); }
  return undefined;
}
export function grappleAttack(state: CtfState, actor: ActorId): boolean {
  const fired = state.grappleWeapon?.attack(actor) ?? false;
  if (fired) {
    const player = state.game.player(actor);
    if (player !== null) player.attackFinished = state.grappleState(actor).attackFinished;
  }
  return fired;
}
export function registerArsenal(state: CtfState): undefined {
  const { game } = state;
  if (state.grapple !== null) {
    const weapon = new ThreewaveWeapon(state.grapple, {
      selected: actor => state.services.input(actor).grappleSelected,
      available: actor => (state.teamplay & CTF_FLAGS.disableGrapple) === 0 && !state.services.observer(actor),
      frame: (actor, frame) => weaponFrame(state, actor, frame),
    });
    state.grappleWeapon = weapon;
    game.registerWeapon({ id: "ctf:grapple", item: "q1:ctf/weapon/grapple", ammo: null, model: "progs/v_star.mdl", rank: 0,
      available: () => (state.teamplay & CTF_FLAGS.disableGrapple) === 0, bestAvailable: () => false,
      fire: (_runtime, player) => grappleAttack(state, player.actor.id), animate: (_runtime, player) => weapon.animate(player.actor.id),
    });
  }
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
