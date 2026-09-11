/* Zoid's original Quake II CTF 1.09b g_ctf.c grapple. GPL-2.0-or-later.
 * This selected source program keeps original rules on maps from every edition. */
import type { Vec3 } from "../../../contracts/math.ts";
import type { TouchContact } from "../../../contracts/world.ts";
import type { Q2CallbackDefinitions } from "../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2Touch } from "../foundation/host.ts";
import { add, length, normalize, scale, subtract, zero } from "../foundation/fields.ts";
import { angleVectors, vectorAngles } from "../foundation/weapons/vectors.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import { CtfGrappleState, grappleBody, grappleVelocity } from "./grapple-services.ts";
import type { GrappleHooks } from "./grapple-services.ts";

const MOD_GRAPPLE = 34;

export class Q2CtfGrappleEquipment {
  readonly states = new Map<ActorId, CtfGrappleState>();
  constructor(readonly hooks: GrappleHooks, readonly canDamage: (owner: ActorId, target: ActorId) => boolean = () => true) {}
  private readonly boundGames = new WeakSet<Q2GameServices>();
  bind(game: Q2GameServices): undefined {
    if (this.boundGames.has(game)) return undefined;
    this.boundGames.add(game);
    game.host.actors.onRelease(actor => {
      const owned = this.states.get(actor.id);
      if (owned !== undefined) {
        this.states.delete(actor.id);
        const hook = game.entity(owned.grapple);
        if (hook !== null && game.host.actors.isLive(hook.actor.id)) { game.cancel(hook); game.remove(hook); }
      }
      for (const [owner, state] of this.states) {
        if (state.grapple === null || !state.grapple.equals(actor.id)) continue;
        state.grapple = null; state.grappleState = "fly"; state.grappleReleaseTime = game.host.now();
        if (game.host.actors.isLive(owner)) this.hooks.setGrapplePrediction(owner, false);
      }
      return undefined;
    });
    return undefined;
  }
  state(actor: ActorId): CtfGrappleState {
    const found = this.states.get(actor);
    if (found !== undefined) return found;
    const created = new CtfGrappleState(); this.states.set(actor, created); return created;
  }
  private readonly sourceTouch: Q2Touch = (hook, game, contact) => this.touch(hook, game, contact);
  get callbacks(): Q2CallbackDefinitions { return { touch: { CTFGrappleTouch: this.sourceTouch } }; }

  sound(entity: ActorId, owner: ActorId, game: Q2GameServices, file: string, reliable = false): undefined {
    return game.host.emit({ kind: "sound", actor: entity, origin: grappleBody(entity, game).origin, path: `weapons/grapple/${file}.wav`, channel: 1,
      volume: this.hooks.volume(owner), attenuation: 1, reliable, loop: "once" });
  }

  /** CTFPlayerResetGrapple accepts the existing player actor. */
  reset(player: ActorId, game: Q2GameServices): undefined {
    const source = this.states.get(player), hook = source === undefined ? null : game.entity(source.grapple);
    if (hook !== null) return this.resetHook(hook, game);
    if (source !== undefined && source.grapple !== null) {
      source.grapple = null; source.grappleState = "fly"; source.grappleReleaseTime = game.host.now();
      this.hooks.setGrapplePrediction(player, false);
    }
    return undefined;
  }
  private resetHook(hook: Q2Entity, game: Q2GameServices): undefined {
    const owner = hook.owner;
    if (owner === null) return game.remove(hook);
    const source = this.states.get(owner);
    if (source === undefined || source.grapple === null) return game.remove(hook);
    if (game.host.actors.isLive(owner) && game.host.bodies.read(owner) !== null) this.sound(owner, owner, game, "grreset", true);
    source.grapple = null; source.grappleState = "fly"; source.grappleReleaseTime = game.host.now();
    this.hooks.setGrapplePrediction(owner, false); return game.remove(hook);
  }

  touch(hook: Q2Entity, game: Q2GameServices, contact: TouchContact): undefined {
    const owner = hook.owner;
    if (owner === null || !game.host.actors.isLive(owner) || game.host.bodies.read(owner) === null) return this.resetHook(hook, game);
    const source = this.state(owner);
    if (contact.other === owner || source.grappleState !== "fly") return undefined;
    if (contact.surface !== null && (contact.surface.nativeFlags & 4) !== 0) return this.resetHook(hook, game);
    game.move(hook, { velocity: zero });
    this.hooks.noise(owner, game, game.body(hook).origin, "impact");
    if (game.host.combat.read(contact.other)?.canTakeDamage === true) {
      game.damage(contact.other, hook, owner, hook.damage, 1, zero, game.body(hook).origin, contact.plane?.normal ?? zero, MOD_GRAPPLE, 0, "q2:weapon_grapple");
      if (!game.host.actors.isLive(hook.actor.id) || !game.host.actors.isLive(owner)) return undefined;
      return this.resetHook(hook, game);
    }
    source.grappleState = "pull"; hook.enemy = contact.other; game.solid(hook, "none");
    this.sound(owner, owner, game, "grpull", true);
    this.sound(hook.actor.id, owner, game, "grhit");
    return game.host.emit({ kind: "effect", effect: "sparks", origin: game.body(hook).origin, direction: contact.plane?.normal ?? zero, count: 0, color: 0 });
  }

  offhand(player: ActorId, game: Q2GameServices, pressed: boolean): undefined {
    if (!pressed) return this.reset(player, game);
    if (this.state(player).grapple !== null) return undefined;
    const pose = this.hooks.pose(player, game), axes = angleVectors(pose.angles), hand = pose.hand;
    const start = add(add(add(grappleBody(player, game).origin, scale(axes.forward, 24)), scale(axes.right, hand === "left" ? -8 : hand === "center" ? 0 : 8)), { x: 0, y: 0, z: pose.viewHeight - 6 });
    this.sound(player, player, game, "grfire", true);
    this.fireGrapple(player, game, start, axes.forward);
    if (!game.host.actors.isLive(player)) return undefined;
    return this.hooks.noise(player, game, start, "weapon");
  }

  fireGrapple(owner: ActorId, game: Q2GameServices, start: Vec3, direction: Vec3, damage = 10, speed = 650, effects = 0): boolean {
    this.bind(game);
    const source = this.state(owner);
    if (source.grapple !== null) return false;
    const hook = game.create("grapple"), normalized = normalize(direction);
    hook.clipMask = 0x6000003;
    hook.projectile = true; hook.effects = effects; hook.model = "models/weapons/grapple/hook/tris.md2"; hook.owner = owner; hook.touch = this.sourceTouch; hook.damage = damage;
    game.move(hook, { origin: start, angles: vectorAngles(normalized), velocity: scale(normalized, speed), bounds: { min: zero, max: zero } }, false);
    source.grapple = hook.actor.id; source.grappleState = "fly"; game.solid(hook, "box"); game.motion(hook, "fly-missile"); game.show(hook);
    const trace = game.host.trace({ start: grappleBody(owner, game).origin, end: start, bounds: null, ignore: hook.actor.id, mask: hook.clipMask });
    if (trace.fraction < 1) {
      game.move(hook, { origin: add(start, scale(normalized, -10)) });
      const other = trace.hit.kind === "actor" ? trace.hit.actor : game.host.worldActor();
      this.touch(hook, game, { self: hook.actor, other, plane: null, surface: null });
      return false;
    }
    return true;
  }

  private cable(hook: Q2Entity, owner: ActorId, game: Q2GameServices): undefined {
    const origin = grappleBody(owner, game).origin, end = game.body(hook).origin;
    const pose = this.hooks.pose(owner, game), axes = angleVectors(pose.angles), hand = pose.hand;
    const start = add(add(add(origin, scale(axes.forward, 16)), scale(axes.right, hand === "left" ? -16 : hand === "center" ? 0 : 16)), { x: 0, y: 0, z: pose.viewHeight - 8 });
    if (length(subtract(start, end)) < 64) return undefined;
    return this.hooks.emit({ kind: "grapple-cable", actor: owner, start: origin, end, offset: subtract(start, origin) });
  }

  /** CTFGrapplePull accepts the hook; the session calls playerFrame once after movement. */
  pull(hook: Q2Entity, game: Q2GameServices): undefined {
    const owner = hook.owner; if (owner === null || !game.host.actors.isLive(owner) || game.host.bodies.read(owner) === null) return this.resetHook(hook, game);
    const pose = this.hooks.pose(owner, game);
    if (hook.enemy !== null) {
      const anchor = this.hooks.anchor(hook.enemy, game), body = game.host.bodies.read(hook.enemy);
      if (body === null || anchor === "none") return this.resetHook(hook, game);
      if (anchor === "box" || anchor === "player" || anchor === "corpse") game.move(hook, { origin: add(body.origin, scale(add(body.bounds.min, body.bounds.max), 0.5)) });
      else game.move(hook, { velocity: body.velocity });
      if (game.host.combat.read(hook.enemy)?.canTakeDamage === true && this.canDamage(owner, hook.enemy)) {
        game.damage(hook.enemy, hook, owner, 1, 1, game.body(hook).velocity, game.body(hook).origin, zero, MOD_GRAPPLE, 0, "q2:weapon_grapple");
        if (!game.host.actors.isLive(hook.actor.id) || !game.host.actors.isLive(owner)) return undefined;
        this.sound(hook.actor.id, owner, game, "grhurt");
      }
      if (this.hooks.dead(hook.enemy) || game.host.combat.read(hook.enemy)?.health !== undefined && (game.host.combat.read(hook.enemy)?.health ?? 0) <= 0 && hook.enemy !== game.host.worldActor()) return this.resetHook(hook, game);
    }
    this.cable(hook, owner, game);
    const source = this.state(owner);
    if (source.grappleState === "fly") return undefined;
    const body = grappleBody(owner, game), direction = subtract(game.body(hook).origin, add(body.origin, { x: 0, y: 0, z: pose.viewHeight }));
    if (source.grappleState === "pull" && length(direction) < 64) {
      source.grappleState = "hang";
      this.hooks.setGrapplePrediction(owner, true); this.sound(owner, owner, game, "grhang", true);
    }
    const velocity = scale(normalize(direction), 650);
    return grappleVelocity(owner, game, add(velocity, scale(pose.gravityVector, pose.gravity * this.hooks.gravity() * game.host.frameSeconds())));
  }

  playerFrame(player: ActorId, game: Q2GameServices): undefined {
    const state = this.states.get(player), hook = state === undefined ? null : game.entity(state.grapple);
    return hook === null ? undefined : this.pull(hook, game);
  }
}
