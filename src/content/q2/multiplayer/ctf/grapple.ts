import { Q2_CTF_GRAPPLE, Q2_RERELEASE_CTF_GRAPPLE, fireCtfGrappleWeapon, stepCtfGrappleWeapon, ctfGrappleWeaponShouldReset } from "../../equipment/grapple-weapon.ts";
import type { SharedGrappleControl } from "../../../../contracts/equipment.ts";
import { CtfGrappleState } from "../../equipment/grapple-services.ts";
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { TouchContact } from "../../../../contracts/world.ts";
import type { Q2Entity, Q2GameServices } from "../../foundation/host.ts";
import { nativeGrappleHooks } from "./native-grapple-hooks.ts";
import type { Q2WeaponContext } from "../../foundation/weapons/index.ts";
import { q2WeaponRecoil } from "../../foundation/weapons/presentation.ts";
import { Q2CtfGrappleEquipment } from "../../equipment/ctf-grapple.ts";
import type { Q2CtfContext } from "./types.ts";
export { Q2_CTF_GRAPPLE } from "../../equipment/grapple-weapon.ts";

export class Q2CtfGrapple {
  readonly equipment: Q2CtfGrappleEquipment | null;
  private readonly inactiveStates = new Map<ActorId, CtfGrappleState>();
  get nativeEnabled(): boolean { return this.equipment !== null; }
  constructor(readonly context: Q2CtfContext, readonly shared: SharedGrappleControl | null = null) {
    this.equipment = shared !== null && !(shared.selection.kind === "enabled" && shared.selection.binding === "slot" && shared.selection.mechanic === "q2-ctf" && shared.nativeSlot("q2-ctf")) ? null : new Q2CtfGrappleEquipment(nativeGrappleHooks(context.hooks), (owner, target) => {
      const team = context.states.get(owner)?.team;
      return owner.equals(target) || team === undefined || team === 0 || context.states.get(target)?.team !== team;
    }, actor => ({ flySpeed: 650, pullSpeed: 650, damage: 10, playersCollide: context.hooks.weapons.inputs.get(actor)?.playersCollide !== false }));
  }
  get states() { return this.equipment?.states ?? this.inactiveStates; }
  state(actor: ActorId) { return this.equipment?.state(actor) ?? new CtfGrappleState(); }
  get callbacks() { return this.equipment?.callbacks ?? {}; }
  reset(player: Pick<Q2Entity, "actor">, game: Q2GameServices): undefined { return this.equipment !== null ? this.equipment.reset(player.actor.id, game) : this.shared?.release(player.actor.id); }
  offhand(player: Q2Entity, game: Q2GameServices, pressed: boolean): undefined { return this.equipment !== null ? this.equipment.offhand(player.actor.id, game, pressed) : this.command(player, pressed); }
  touch(hook: Q2Entity, game: Q2GameServices, contact: TouchContact): undefined { return this.equipment?.touch(hook, game, contact); }
  fireGrapple(player: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3, damage = 10, speed = 650, effects = 0): boolean {
    return this.equipment?.fireGrapple(player.actor.id, game, start, direction, damage, speed, effects) ?? false;
  }
  playerFrame(player: Q2Entity, game: Q2GameServices, binding: "weapon-slot" | "offhand" = "weapon-slot"): undefined {
    const weapon = this.context.hooks.weapons.states.get(player.actor.id);
    if (weapon !== undefined && ctfGrappleWeaponShouldReset(weapon, binding === "weapon-slot" && weapon.weapon === "grapple", weapon.pending !== null || weapon.primaryHandoff === "holstering" || game.options.edition === "rerelease" && this.context.hooks.weapons.inputs.get(player.actor.id)?.holster === true)) {
      if (game.options.edition === "rerelease" && weapon.primaryHandoff === "active") weapon.pending = weapon.weapon;
      return this.reset(player, game);
    }
    return this.equipment?.playerFrame(player.actor.id, game);
  }
  command(player: Q2Entity, pressed: boolean): undefined {
    if (this.shared?.selection.kind === "enabled" && this.shared.selection.binding === "offhand") return this.shared.input(player.actor.id, pressed);
    return undefined;
  }
  register(): undefined {
    const { weapons, items } = this.context.hooks;
    if (this.nativeEnabled) weapons.register({ definition: this.shared?.selection.kind === "enabled" && this.shared.selection.edition === "rerelease" ? Q2_RERELEASE_CTF_GRAPPLE : Q2_CTF_GRAPPLE, fire: context => this.fire(context), think: context => this.weaponFrame(context) });
    items.register({ kind: "custom", classname: "weapon_grapple", model: "", icon: "w_grapple", name: "Grapple", sound: "misc/w_pkup.wav", rotate: false, respawn: 0,
      capacity: 1, quantity: 0, coopStay: true, droppable: false, pickup: () => false,
      use: (actor, game) => { const entity = game.entity(actor.id); return this.nativeEnabled && entity !== null && weapons.requestWeapon(entity, game, "grapple") === "selected"; } });
    return undefined;
  }

  fire(context: Q2WeaponContext): undefined {
    if (this.equipment === null) return undefined;
    return fireCtfGrappleWeapon(context.self.actor.id, context.game, this.equipment, context.state, context.game.options.edition, {
      kick: (origin, pitch) => this.context.hooks.weapons.kick(context, origin,
        { ...q2WeaponRecoil(context.state, context.game.options.edition, context.now).kickAngles, x: pitch }),
    });
  }

  private weaponFrame(original: Q2WeaponContext): undefined {
    if (this.equipment === null) return undefined;
    const edition = original.game.options.edition;
    const context: Q2WeaponContext = { ...original, rerelease: edition === "rerelease", definition: edition === "rerelease" ? Q2_RERELEASE_CTF_GRAPPLE : Q2_CTF_GRAPPLE };
    const { state, self, game, input } = context, weapons = this.context.hooks.weapons;
    return stepCtfGrappleWeapon(state, this.equipment.state(self.actor.id), {
      attack: input.attack, changeRequested: state.pending !== null || state.primaryHandoff === "holstering", holster: input.holster, latchedHolster: false,
    }, edition, {
      reset: () => this.reset(self, game),
      prepareDrop: () => { if (edition === "rerelease" && state.primaryHandoff === "active") state.pending ??= state.weapon; return undefined; },
      generic: () => edition === "rerelease" ? weapons.genericRerelease(context) : weapons.genericClassic(context),
    });
  }
}
