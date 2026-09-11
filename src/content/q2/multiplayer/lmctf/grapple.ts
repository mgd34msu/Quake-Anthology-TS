import type { Q2WeaponDefinition } from "../../foundation/weapons/types.ts";
import type { ActorId } from "../../../../contracts/identity.ts";
import { scale } from "../../foundation/fields.ts";
import { angleVectors } from "../../foundation/weapons/vectors.ts";
import { nativeGrappleHooks } from "../ctf/native-grapple-hooks.ts";
import type { Q2Entity, Q2GameServices } from "../../foundation/host.ts";
import { LmctfGrappleEquipment } from "../../equipment/lmctf-grapple.ts";
import { lmctfActive, lmctfPrint } from "./types.ts";
import type { LmctfContext } from "./types.ts";

export const hookDefinition: Q2WeaponDefinition = { name: "lmctf:hook", item: "q2:weapon_hook", classname: "weapon_hook", ammo: null, quantity: 0, warning: 0,
  viewModel: "models/weapons/v_hook/tris.md2", worldModel: "models/objects/debris2/tris.md2", playerModel: 11,
  activateLast: 9, fireLast: 13, idleLast: 34, deactivateLast: 38, pauses: [14, 18, 26, 30], fires: [8, 9, 10, 11], repeating: true };

export class LmctfGrapple {
  readonly equipment: LmctfGrappleEquipment;
  constructor(readonly context: LmctfContext) {
    this.equipment = new LmctfGrappleEquipment(nativeGrappleHooks(context.hooks, false), {
      canAttach: (owner, target, game) => {
        const classname = game.entity(target)?.classname ?? "";
        if (!game.host.isPlayer(target) && classname !== "bodyque" && classname !== "worldspawn" && !classname.startsWith("func") && !classname.startsWith("info_flag") && !target.equals(game.host.worldActor())) return false;
        const team = context.states.get(owner)?.team;
        return team === undefined || team === 0 || context.states.get(target)?.team !== team;
      },
      canDamage: target => (context.rules.ctfFlags & 64) === 0 || context.hooks.player(target) === null,
      playerHit: (target, game) => lmctfActive(context, game, target),
    }, actor => {
      const weapon = context.hooks.weapons.states.get(actor);
      if (weapon?.weapon === "lmctf:hook" && weapon.phase === "firing") weapon.phase = "ready";
      return undefined;
    });
    context.hooks.items.register({ kind: "weapon", classname: "weapon_hook", ammo: null, model: hookDefinition.worldModel, icon: "w_blaster", name: "Grappling Hook",
      sound: "misc/w_pkup.wav", rotate: false, respawn: 0, coopStay: true });
    context.hooks.weapons.register({ definition: hookDefinition, fire: current => this.fire(current.self, current.game),
      think: (current, weapons) => {
        if (current.state.phase === "activating") current.state.frame++;
        if (current.state.pending !== null && current.state.phase !== "dropping") { current.state.phase = "dropping"; current.state.frame = 36; return undefined; }
        if (!current.input.attack && !current.state.latchedAttack && !this.state(current.self.actor.id).hookHeld) this.abort(current.self, current.game);
        return weapons.genericClassic(current);
      } });
  }
  get states() { return this.equipment.states; }
  state(actor: ActorId) { return this.equipment.state(actor); }
  get callbacks() { return this.equipment.callbacks; }
  gravityScale(actor: ActorId): 0 | 1 { return this.equipment.gravityScale(actor); }
  abort(player: Q2Entity, game: Q2GameServices): undefined {
    return this.equipment.abort(player.actor.id, game);
  }
  fire(player: Q2Entity, game: Q2GameServices): undefined {
    const weapon = this.context.hooks.weapons.states.get(player.actor.id), launching = this.state(player.actor.id).hookState === 0;
    if (weapon !== undefined) {
      weapon.sourceFiring = launching;
      if (launching) {
        const basis = angleVectors(game.host.playerViewState(player.actor.id)?.viewAngles ?? game.body(player).angles);
        weapon.kickOrigin = scale(basis.forward, -2); weapon.kickAngles = { ...weapon.kickAngles, x: -1 };
      }
    }
    return this.equipment.fire(player.actor.id, game);
  }
  command(player: Q2Entity, game: Q2GameServices, pressed: boolean): undefined {
    const state = this.state(player.actor.id), common = this.context.hooks.player(player.actor.id), weapon = this.context.hooks.weapons.states.get(player.actor.id);
    if (common === null || common.noclip || common.spectator) return undefined;
    if ((this.context.rules.ctfFlags & 16) !== 0) {
      if (weapon?.weapon === "lmctf:hook") { state.hookHeld = pressed; if (pressed) weapon.latchedAttack = true; else this.abort(player, game); return undefined; }
      if (!pressed) return this.abort(player, game);
      if (state.hook !== null) return undefined;
      if (game.host.inventory.count(player.actor.id, "q2:weapon_hook") === 0) return lmctfPrint(game, "You have no hook.\n", player.actor.id);
      if ((this.context.hooks.weapons.inputs.get(player.actor.id)?.quadUntil ?? 0) > game.host.now()) game.sound(player, "items/damage3.wav", 3);
      return this.fire(player, game);
    }
    if (pressed) this.context.hooks.weapons.requestWeapon(player, game, "lmctf:hook"); return undefined;
  }
}
