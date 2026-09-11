import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { TouchContact } from "../../../../contracts/world.ts";
import type { Q2Entity, Q2GameServices } from "../../foundation/host.ts";
import { nativeGrappleHooks } from "./native-grapple-hooks.ts";
import type { Q2WeaponContext, Q2WeaponDefinition } from "../../foundation/weapons/index.ts";
import { add, scale } from "../../foundation/fields.ts";
import { angleVectors } from "../../foundation/weapons/vectors.ts";
import { Q2CtfGrappleEquipment } from "../../equipment/ctf-grapple.ts";
import type { Q2CtfContext } from "./types.ts";
export const Q2_CTF_GRAPPLE: Q2WeaponDefinition = {
  name: "grapple", classname: "weapon_grapple", item: "q2:weapon_grapple", ammo: null, quantity: 0, warning: 0,
  viewModel: "models/weapons/grapple/tris.md2", worldModel: "", playerModel: 12,
  activateLast: 5, fireLast: 9, idleLast: 31, deactivateLast: 36, pauses: [10, 18, 27], fires: [6], repeating: false,
};


export class Q2CtfGrapple {
  readonly equipment: Q2CtfGrappleEquipment;
  constructor(readonly context: Q2CtfContext) {
    this.equipment = new Q2CtfGrappleEquipment(nativeGrappleHooks(context.hooks), (owner, target) => {
      const team = context.states.get(owner)?.team;
      return owner.equals(target) || team === undefined || team === 0 || context.states.get(target)?.team !== team;
    });
  }
  get states() { return this.equipment.states; }
  state(actor: ActorId) { return this.equipment.state(actor); }
  get callbacks() { return this.equipment.callbacks; }
  reset(player: Q2Entity, game: Q2GameServices): undefined { return this.equipment.reset(player.actor.id, game); }
  offhand(player: Q2Entity, game: Q2GameServices, pressed: boolean): undefined { return this.equipment.offhand(player.actor.id, game, pressed); }
  touch(hook: Q2Entity, game: Q2GameServices, contact: TouchContact): undefined { return this.equipment.touch(hook, game, contact); }
  fireGrapple(player: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3, damage = 10, speed = 650, effects = 0): boolean {
    return this.equipment.fireGrapple(player.actor.id, game, start, direction, damage, speed, effects);
  }
  playerFrame(player: Q2Entity, game: Q2GameServices, binding: "weapon-slot" | "offhand" = "weapon-slot"): undefined {
    const weapon = this.context.hooks.weapons.states.get(player.actor.id);
    if (binding === "weapon-slot" && weapon?.weapon === "grapple" && weapon.pending === null && weapon.phase !== "firing" && weapon.phase !== "activating") return this.reset(player, game);
    return this.equipment.playerFrame(player.actor.id, game);
  }
  register(): undefined {
    const { weapons, items } = this.context.hooks;
    weapons.register({ definition: Q2_CTF_GRAPPLE, fire: context => this.fire(context), think: context => this.weaponFrame(context) });
    items.register({ kind: "custom", classname: "weapon_grapple", model: "", icon: "w_grapple", name: "Grapple", sound: "misc/w_pkup.wav", rotate: false, respawn: 0,
      capacity: 1, quantity: 0, coopStay: true, droppable: false, pickup: () => false,
      use: (actor, game) => { const entity = game.entity(actor.id); return entity !== null && weapons.requestWeapon(entity, game, "grapple") === "selected"; } });
    return undefined;
  }

  fire(context: Q2WeaponContext): undefined {
    const { self, game, input, state } = context, source = this.state(self.actor.id), weapons = this.context.hooks.weapons;
    if (source.grappleState !== "fly") { state.frame++; return undefined; }
    const axes = angleVectors(input.angles), start = add(add(add(game.body(self).origin, scale(axes.forward, 24)), scale(axes.right, input.hand === "left" ? -8 : input.hand === "center" ? 0 : 8)), { x: 0, y: 0, z: self.viewHeight - 6 });
    weapons.kick(context, scale(axes.forward, -2), { x: -1, y: state.kickAngles.y, z: state.kickAngles.z });
    this.equipment.sound(self.actor.id, self.actor.id, game, "grfire", true); this.fireGrapple(self, game, start, axes.forward, 10, 650, 0);
    if (!game.host.actors.isLive(self.actor.id)) return undefined;
    weapons.playerNoise(self, game, start, "weapon"); state.frame++;
    return undefined;
  }

  private weaponFrame(original: Q2WeaponContext): undefined {
    const context: Q2WeaponContext = { ...original, rerelease: false };
    const { state, self, game, input } = context, source = this.state(self.actor.id), held = input.attack;
    if (held && state.phase === "firing" && source.grapple !== null) state.frame = 9;
    if (!held && source.grapple !== null) { this.reset(self, game); if (state.phase === "firing") state.phase = "ready"; }
    if (state.pending !== null && source.grappleState !== "fly" && state.phase === "firing") {
      state.phase = "dropping"; state.frame = 32;
    }
    const before = state.phase, weapons = this.context.hooks.weapons;
    weapons.genericClassic(context);
    if (before === "activating" && state.phase === "ready" && source.grappleState !== "fly") { state.frame = held ? 5 : 9; state.phase = "firing"; }
    return undefined;
  }

}
