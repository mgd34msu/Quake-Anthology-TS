import { LMCTF_GRAPPLE, fireLmctfGrappleWeapon, releaseLmctfGrappleWeapon, stepLmctfGrappleWeapon } from "../../equipment/grapple-weapon.ts";
import type { SharedGrappleControl } from "../../../../contracts/equipment.ts";
import { LmctfGrappleState } from "../../equipment/grapple-services.ts";
import type { ActorId } from "../../../../contracts/identity.ts";
import { nativeGrappleHooks } from "../ctf/native-grapple-hooks.ts";
import type { Q2Entity, Q2GameServices } from "../../foundation/host.ts";
import { LmctfGrappleEquipment } from "../../equipment/lmctf-grapple.ts";
import { lmctfActive, lmctfPrint } from "./types.ts";
import type { LmctfContext } from "./types.ts";
import { q2WeaponRecoil, setQ2WeaponRecoil } from "../../foundation/weapons/presentation.ts";

export { LMCTF_GRAPPLE as hookDefinition } from "../../equipment/grapple-weapon.ts";

export class LmctfGrapple {
  readonly equipment: LmctfGrappleEquipment | null;
  private readonly inactiveStates = new Map<ActorId, LmctfGrappleState>();
  get nativeEnabled(): boolean { return this.equipment !== null; }
  constructor(readonly context: LmctfContext, readonly shared: SharedGrappleControl | null = null) {
    this.equipment = shared !== null && !(shared.selection.kind === "enabled" && shared.selection.binding === "slot" && shared.selection.mechanic === "q2-lmctf" && shared.nativeSlot("q2-lmctf")) ? null : new LmctfGrappleEquipment(nativeGrappleHooks(context.hooks, false), {
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
      if (weapon?.weapon === "lmctf:hook") releaseLmctfGrappleWeapon(weapon);
      return undefined;
    });
    if (!this.nativeEnabled) {
      context.hooks.items.register({ kind: "custom", classname: "weapon_hook", model: "", icon: "w_blaster", name: "Grappling Hook", sound: "misc/w_pkup.wav", rotate: false, respawn: 0,
        capacity: 1, quantity: 0, coopStay: true, droppable: false, pickup: () => false, use: () => false });
      return;
    }
    context.hooks.items.register({ kind: "weapon", classname: "weapon_hook", ammo: null, model: LMCTF_GRAPPLE.worldModel, icon: "w_blaster", name: "Grappling Hook",
      sound: "misc/w_pkup.wav", rotate: false, respawn: 0, coopStay: true });
    context.hooks.weapons.register({ definition: LMCTF_GRAPPLE, fire: current => this.fire(current.self, current.game),
      think: (current, weapons) => stepLmctfGrappleWeapon(current.state, this.state(current.self.actor.id), {
        attack: current.input.attack, changeRequested: current.state.pending !== null || current.state.primaryHandoff === "holstering", holster: current.input.holster, latchedHolster: false,
      }, { abort: () => this.abort(current.self, current.game), generic: () => weapons.genericClassic(current) }) });
  }
  get states() { return this.equipment?.states ?? this.inactiveStates; }
  state(actor: ActorId) { return this.equipment?.state(actor) ?? new LmctfGrappleState(); }
  get callbacks() { return this.equipment?.callbacks ?? {}; }
  gravityScale(actor: ActorId): 0 | 1 { return this.equipment?.gravityScale(actor) ?? 1; }
  abort(player: Pick<Q2Entity, "actor">, game: Q2GameServices): undefined {
    return this.equipment !== null ? this.equipment.abort(player.actor.id, game) : this.shared?.release(player.actor.id);
  }
  fire(player: Pick<Q2Entity, "actor">, game: Q2GameServices): undefined {
    if (this.equipment === null) return undefined;
    const weapon = this.context.hooks.weapons.states.get(player.actor.id);
    if (weapon === undefined) return this.equipment.fire(player.actor.id, game);
    return fireLmctfGrappleWeapon(player.actor.id, game, this.equipment, weapon, {
      kick: (origin, pitch) => setQ2WeaponRecoil(weapon, game.options.edition, game.host.now(), origin,
        { ...q2WeaponRecoil(weapon, game.options.edition, game.host.now()).kickAngles, x: pitch }),
    });
  }
  command(player: Q2Entity, game: Q2GameServices, pressed: boolean): undefined {
    if (!this.nativeEnabled) {
      if (this.shared?.selection.kind === "enabled" && this.shared.selection.binding === "offhand") return this.shared.input(player.actor.id, pressed);
      return undefined;
    }
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
