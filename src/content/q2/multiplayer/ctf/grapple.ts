/* Zoid's original Quake II CTF 1.09b g_ctf.c grapple. GPL-2.0-or-later.
 * This selected source program keeps original rules on maps from every edition. */
import type { Vec3 } from "../../../../contracts/math.ts";
import type { TouchContact } from "../../../../contracts/world.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2Touch } from "../../foundation/host.ts";
import { add, length, normalize, scale, subtract, zero } from "../../foundation/fields.ts";
import type { Q2WeaponContext, Q2WeaponDefinition, Q2WeaponInput } from "../../foundation/weapons/index.ts";
import { SHOT_MASK } from "../../foundation/weapons/index.ts";
import { angleVectors, vectorAngles } from "../../foundation/weapons/vectors.ts";
import { ctfPlayer } from "./types.ts";
import type { Q2CtfContext } from "./types.ts";

export const Q2_CTF_GRAPPLE: Q2WeaponDefinition = {
  name: "grapple", classname: "weapon_grapple", item: "q2:weapon_grapple", ammo: null, quantity: 0, warning: 0,
  viewModel: "models/weapons/grapple/tris.md2", worldModel: "", playerModel: 12,
  activateLast: 5, fireLast: 9, idleLast: 31, deactivateLast: 36, pauses: [10, 18, 27], fires: [6], repeating: false,
};
const MOD_GRAPPLE = 34;

export class Q2CtfGrapple {
  constructor(readonly context: Q2CtfContext) {}
  private readonly sourceTouch: Q2Touch = (hook, game, contact) => this.touch(hook, game, contact);
  get callbacks(): Q2CallbackDefinitions { return { touch: { CTFGrappleTouch: this.sourceTouch } }; }

  register(): undefined {
    const { weapons, items } = this.context.hooks;
    weapons.register({ definition: Q2_CTF_GRAPPLE, fire: context => this.fire(context), think: context => this.weaponFrame(context) });
    items.register({ kind: "custom", classname: "weapon_grapple", model: "", icon: "w_grapple", name: "Grapple", sound: "misc/w_pkup.wav", rotate: false, respawn: 0,
      capacity: 1, quantity: 0, coopStay: true, droppable: false, pickup: () => false,
      use: (actor, game) => { const entity = game.entity(actor.id); return entity !== null && weapons.requestWeapon(entity, game, "grapple") === "selected"; } });
    return undefined;
  }

  private volume(player: Q2Entity): number { return (this.context.hooks.weapons.states.get(player.actor.id)?.silencerShots ?? 0) > 0 ? 0.2 : 1; }
  private sound(entity: Q2Entity, owner: Q2Entity, game: Q2GameServices, file: string, reliable = false): undefined {
    return game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin, path: `weapons/grapple/${file}.wav`, channel: 1,
      volume: this.volume(owner), attenuation: 1, reliable, loop: "once" });
  }

  /** CTFPlayerResetGrapple accepts the existing player actor. */
  reset(player: Q2Entity, game: Q2GameServices): undefined {
    const source = this.context.states.get(player.actor.id), hook = source === undefined ? null : game.entity(source.grapple);
    return hook === null ? undefined : this.resetHook(hook, game);
  }
  private resetHook(hook: Q2Entity, game: Q2GameServices): undefined {
    const owner = game.entity(hook.owner);
    if (owner === null) return game.remove(hook);
    const source = this.context.states.get(owner.actor.id);
    if (source === undefined || source.grapple === null) return undefined;
    this.sound(owner, owner, game, "grreset", true);
    source.grapple = null; source.grappleState = "fly"; source.grappleReleaseTime = game.host.now();
    this.context.hooks.setGrapplePrediction(owner.actor.id, false); return game.remove(hook);
  }

  touch(hook: Q2Entity, game: Q2GameServices, contact: TouchContact): undefined {
    const owner = game.entity(hook.owner);
    if (owner === null) return game.remove(hook);
    const source = ctfPlayer(this.context, owner.actor.id);
    if (contact.other === owner.actor.id || source.grappleState !== "fly") return undefined;
    if (contact.surface !== null && (contact.surface.nativeFlags & 4) !== 0) return this.resetHook(hook, game);
    game.move(hook, { velocity: zero });
    this.context.hooks.weapons.playerNoise(owner, game, game.body(hook).origin, "impact");
    if (game.host.combat.read(contact.other)?.canTakeDamage === true) {
      game.damage(contact.other, hook, owner.actor.id, hook.damage, 1, zero, game.body(hook).origin, contact.plane?.normal ?? zero, MOD_GRAPPLE, 0, Q2_CTF_GRAPPLE.item);
      return this.resetHook(hook, game);
    }
    source.grappleState = "pull"; hook.enemy = contact.other; game.solid(hook, "none");
    this.sound(owner, owner, game, "grpull", true);
    this.sound(hook, owner, game, "grhit");
    return game.host.emit({ kind: "effect", effect: "sparks", origin: game.body(hook).origin, direction: contact.plane?.normal ?? zero, count: 0, color: 0 });
  }

  fire(context: Q2WeaponContext): undefined {
    const { self, game, input, state } = context, source = ctfPlayer(this.context, self.actor.id), weapons = this.context.hooks.weapons;
    if (source.grappleState !== "fly") { state.frame++; return undefined; }
    const axes = angleVectors(input.angles), start = add(add(add(game.body(self).origin, scale(axes.forward, 24)), scale(axes.right, input.hand === "left" ? -8 : input.hand === "center" ? 0 : 8)), { x: 0, y: 0, z: self.viewHeight - 6 });
    weapons.kick(context, scale(axes.forward, -2), { x: -1, y: state.kickAngles.y, z: state.kickAngles.z });
    this.sound(self, self, game, "grfire", true); this.fireGrapple(self, game, start, axes.forward, 10, 650, 0);
    weapons.playerNoise(self, game, start, "weapon"); state.frame++;
    return undefined;
  }

  fireGrapple(owner: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3, damage = 10, speed = 650, effects = 0): boolean {
    const source = ctfPlayer(this.context, owner.actor.id), hook = game.create("grapple"), normalized = normalize(direction);
    hook.clipMask = SHOT_MASK;
    hook.projectile = true; hook.effects = effects; hook.model = "models/weapons/grapple/hook/tris.md2"; hook.owner = owner.actor.id; hook.touch = this.sourceTouch; hook.damage = damage;
    game.move(hook, { origin: start, angles: vectorAngles(normalized), velocity: scale(normalized, speed), bounds: { min: zero, max: zero } }, false);
    source.grapple = hook.actor.id; source.grappleState = "fly"; game.solid(hook, "box"); game.motion(hook, "fly-missile"); game.show(hook);
    const trace = game.host.trace({ start: game.body(owner).origin, end: start, bounds: null, ignore: hook.actor.id, mask: hook.clipMask });
    if (trace.fraction < 1) {
      game.move(hook, { origin: add(start, scale(normalized, -10)) });
      const other = trace.hit.kind === "actor" ? trace.hit.actor : game.host.worldActor();
      this.touch(hook, game, { self: hook.actor, other, plane: null, surface: null });
      return false;
    }
    return true;
  }

  private weaponFrame(original: Q2WeaponContext): undefined {
    const context: Q2WeaponContext = { ...original, rerelease: false };
    const { state, self, game, input } = context, source = ctfPlayer(this.context, self.actor.id), held = input.attack;
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

  private cable(hook: Q2Entity, owner: Q2Entity, game: Q2GameServices, input: Q2WeaponInput | undefined): undefined {
    const origin = game.body(owner).origin, end = game.body(hook).origin;
    const axes = angleVectors(input?.angles ?? game.host.playerViewState(owner.actor.id)?.viewAngles ?? game.body(owner).angles);
    const hand = input?.hand ?? this.context.hooks.player(owner.actor.id)?.hand ?? "right";
    const start = add(add(add(origin, scale(axes.forward, 16)), scale(axes.right, hand === "left" ? -16 : hand === "center" ? 0 : 16)), { x: 0, y: 0, z: owner.viewHeight - 8 });
    if (length(subtract(start, end)) < 64) return undefined;
    return this.context.hooks.emit({ kind: "grapple-cable", actor: owner.actor.id, start: origin, end, offset: subtract(start, origin) });
  }

  /** CTFGrapplePull accepts the hook; the session calls playerFrame once after movement. */
  pull(hook: Q2Entity, game: Q2GameServices): undefined {
    const owner = game.entity(hook.owner); if (owner === null) return this.resetHook(hook, game);
    const weapons = this.context.hooks.weapons, weapon = weapons.states.get(owner.actor.id), input = weapons.inputs.get(owner.actor.id);
    if (weapon?.weapon === "grapple" && weapon.pending === null && weapon.phase !== "firing" && weapon.phase !== "activating") {
      return this.resetHook(hook, game);
    }
    if (hook.enemy !== null) {
      const enemy = game.entity(hook.enemy), body = game.host.bodies.read(hook.enemy);
      if (body === null || enemy?.solid === "none") return this.resetHook(hook, game);
      if (enemy?.solid === "box") game.move(hook, { origin: add(body.origin, scale(add(body.bounds.min, body.bounds.max), 0.5)) });
      else game.move(hook, { velocity: body.velocity });
      const victim = this.context.states.get(hook.enemy), source = ctfPlayer(this.context, owner.actor.id);
      if (game.host.combat.read(hook.enemy)?.canTakeDamage === true && !(victim !== undefined && victim.team === source.team && hook.enemy !== owner.actor.id)) {
        game.damage(hook.enemy, hook, owner.actor.id, 1, 1, game.body(hook).velocity, game.body(hook).origin, zero, MOD_GRAPPLE, 0, Q2_CTF_GRAPPLE.item); this.sound(hook, owner, game, "grhurt");
      }
      if (this.context.hooks.player(hook.enemy)?.dead === true || game.host.combat.read(hook.enemy)?.health !== undefined && (game.host.combat.read(hook.enemy)?.health ?? 0) <= 0 && hook.enemy !== game.host.worldActor()) return this.resetHook(hook, game);
    }
    this.cable(hook, owner, game, input);
    const source = ctfPlayer(this.context, owner.actor.id);
    if (source.grappleState === "fly") return undefined;
    const body = game.body(owner), direction = subtract(game.body(hook).origin, add(body.origin, { x: 0, y: 0, z: owner.viewHeight }));
    if (source.grappleState === "pull" && length(direction) < 64) {
      source.grappleState = "hang";
      this.context.hooks.setGrapplePrediction(owner.actor.id, true); this.sound(owner, owner, game, "grhang", true);
    }
    const velocity = scale(normalize(direction), 650);
    return game.move(owner, { velocity: add(velocity, scale(owner.gravityVector, owner.gravity * this.context.hooks.gravity() * game.host.frameSeconds())) });
  }

  playerFrame(player: Q2Entity, game: Q2GameServices): undefined {
    const state = this.context.states.get(player.actor.id), hook = state === undefined ? null : game.entity(state.grapple);
    return hook === null ? undefined : this.pull(hook, game);
  }
}
