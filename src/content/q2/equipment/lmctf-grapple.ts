/* LM_CTF p_weapon.c hook and g_cmds.c offhand controls. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q2CallbackDefinitions } from "../foundation/callbacks.ts";
import type { Q2Die, Q2Entity, Q2GameServices, Q2Think, Q2Touch } from "../foundation/host.ts";
import { add, length, normalize, scale, subtract, zero } from "../foundation/fields.ts";
import { angleVectors, vectorAngles } from "../foundation/weapons/vectors.ts";
import { LmctfGrappleState, grappleBody, grappleVelocity } from "./grapple-services.ts";
import type { GrappleHooks } from "./grapple-services.ts";

export interface LmctfGrapplePolicy {
  canAttach(owner: ActorId, target: ActorId, game: Q2GameServices): boolean;
  canDamage(target: ActorId): boolean;
  playerHit(target: ActorId, game: Q2GameServices): boolean;
}
export class LmctfGrappleEquipment {
  readonly states = new Map<ActorId, LmctfGrappleState>();
  constructor(readonly hooks: GrappleHooks, readonly policy: LmctfGrapplePolicy = {
    canAttach: () => true, canDamage: () => true, playerHit: (actor, game) => game.host.isPlayer(actor),
  }, readonly released: (actor: ActorId) => undefined = () => undefined) {}
  private readonly boundGames = new WeakSet<Q2GameServices>();
  bind(game: Q2GameServices): undefined {
    if (this.boundGames.has(game)) return undefined;
    this.boundGames.add(game);
    game.host.actors.onRelease(actor => {
      const owned = this.states.get(actor.id);
      if (owned !== undefined) {
        this.states.delete(actor.id);
        const hook = game.entity(owned.hook);
        if (hook !== null && game.host.actors.isLive(hook.actor.id)) { game.cancel(hook); game.remove(hook); }
      }
      for (const [owner, state] of this.states) {
        if (state.hook === null || !state.hook.equals(actor.id)) continue;
        state.hook = null; state.hookState = 0; state.hookLength = 0;
        if (game.host.actors.isLive(owner)) this.released(owner);
      }
      return undefined;
    });
    return undefined;
  }
  state(actor: ActorId): LmctfGrappleState {
    const found = this.states.get(actor);
    if (found !== undefined) return found;
    const created = new LmctfGrappleState(); this.states.set(actor, created); return created;
  }
  get callbacks(): Q2CallbackDefinitions { return { think: { "lmctf:Grapple_Bolt_Think": this.think }, touch: { "lmctf:hook_touch": this.touch }, die: { "lmctf:hook_die": this.die } }; }
  abort(player: ActorId, game: Q2GameServices): undefined {
    const state = this.state(player), body = game.host.bodies.read(player);
    if (body !== null && body.ground !== null) { this.hooks.setPreviousVelocity(player, { ...this.hooks.previousVelocity(player), z: 0 }); grappleVelocity(player, game, { ...body.velocity, z: 0 }); }
    this.released(player);
    state.hookState = 0; state.hookLength = 0;
    const hook = game.entity(state.hook); state.hook = null;
    if (hook !== null) { game.cancel(hook); hook.enemy = null; game.host.bodies.detach(hook.actor); game.remove(hook); }
    return undefined;
  }
  private readonly die: Q2Die = (hook, game) => { const owner = hook.owner; return owner === null ? game.remove(hook) : this.abort(owner, game); };
  private readonly think: Q2Think = (hook, game) => {
    const state = hook.owner === null ? undefined : this.states.get(hook.owner);
    if (state === undefined) return game.remove(hook);
    if (state.hookLength <= 126) return game.cancel(hook);
    game.sound(hook, hook.enemy === null ? "weapons/grapple/gflyair.wav" : "weapons/grapple/gpulling.wav", 0);
    return game.schedule(hook, hook.enemy === null ? 0.4 : 0.8, this.think);
  };
  private readonly touch: Q2Touch = (hook, game, contact) => {
    const owner = hook.owner; if (owner === null) return game.remove(hook);
    if (!game.host.actors.isLive(owner) || game.host.bodies.read(owner) === null) return this.abort(owner, game);
    if (contact.other.equals(owner) || hook.enemy !== null && !hook.enemy.equals(contact.other)) return undefined;
    const state = this.state(owner), anchor = this.hooks.anchor(contact.other, game);
    if (anchor === "none" || anchor === "box" || (contact.surface?.nativeFlags ?? 0) & 4 || !this.policy.canAttach(owner, contact.other, game) || this.hooks.dead(contact.other, game)) return this.abort(owner, game);
    game.move(hook, { velocity: zero }); state.hookState = 2;
    if (this.policy.canDamage(contact.other)) {
      const frame = Math.round(game.host.now() * 10), repeated = hook.enemy?.equals(contact.other) ?? false;
      if (!repeated || frame % 7 === 0 && frame !== hook.count) {
        const amount = repeated ? 1 : 8;
        if (this.policy.playerHit(contact.other, game)) game.sound(hook, repeated ? "weapons/grapple/gkilling.wav" : "weapons/grapple/ghit.wav", 0);
        else if (!repeated) game.sound(hook, "weapons/grapple/ghitwall.wav", 0, 0.8);
        if (game.host.combat.read(contact.other)?.canTakeDamage === true) {
          game.damage(contact.other, hook, owner, amount, amount, zero, game.body(hook).origin, contact.plane?.normal ?? zero, 60, 4, "q2:weapon_hook");
          if (!game.host.actors.isLive(hook.actor.id) || !game.host.actors.isLive(owner)) return undefined;
        }
        if (repeated) hook.count = frame;
      }
    }
    if (this.hooks.dead(contact.other, game)) return this.abort(owner, game);
    if (hook.enemy === null) {
      const body = game.host.bodies.read(contact.other); if (body === null) return this.abort(owner, game);
      hook.enemy = contact.other; hook.pos1 = subtract(game.body(hook).origin, add(body.origin, body.bounds.min)); game.solid(hook, "trigger");
      game.host.bodies.attach(hook.actor, { anchor: contact.other, follow: { kind: "bounds-min", offset: hook.pos1 } });
    }
    game.host.emit({ kind: "effect", effect: "blaster", origin: game.body(hook).origin, direction: contact.plane?.normal ?? zero, count: 0, color: 0 }); return undefined;
  };
  private launch(player: ActorId, game: Q2GameServices, start: Vec3, direction: Vec3): Q2Entity {
    const hook = game.create("noclass"), angles = vectorAngles(direction);
    this.state(player).hook = hook.actor.id;
    hook.owner = player; hook.touch = this.touch; hook.die = this.die; hook.damage = 2; hook.maxHealth = 59; hook.model = "models/objects/ghook/tris.md2"; hook.clipMask = 0x6000003;
    game.move(hook, { origin: start, angles: { ...angles, x: angles.x + 90 }, velocity: scale(normalize(direction), 800) });
    game.solid(hook, "box"); game.motion(hook, "fly-missile"); game.host.combat.create(hook.actor, { health: 59, armor: { kind: "none" }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
    game.schedule(hook, 1, this.think); game.host.emit({ kind: "sound", actor: player, origin: grappleBody(player, game).origin, path: "weapons/grapple/grfire.wav", channel: 0, volume: 0.8, attenuation: 1, reliable: false, loop: "once" });
    const trajectory = game.host.isPlayer(player) ? game.host.weaponBehavior?.launch({ projectile: hook.actor, shooter: player, weapon: "q2:weapon_hook", role: "grapple", timeSeconds: game.host.now(), body: game.body(hook) }) ?? null : null;
    if (trajectory !== null) { game.projectTrajectory(hook, trajectory); }
    const launchOrigin = game.body(hook).origin;
    game.show(hook);
    const trace = game.host.trace({ start: grappleBody(player, game).origin, end: launchOrigin, bounds: null, ignore: player, mask: 0x6000003 });
    if (trace.fraction < 1) {
      game.move(hook, { origin: add(launchOrigin, scale(trajectory === null ? direction : normalize(trajectory.velocity), -10)) });
      const other = trace.hit.kind === "actor" ? trace.hit.actor : game.host.worldActor();
      this.touch(hook, game, { self: hook.actor, other, plane: null, surface: null });
    }
    return hook;
  }
  private draw(player: ActorId, start: Vec3, end: Vec3): undefined {
    return length(subtract(end, start)) > 64 ? this.hooks.emit({ kind: "grapple-cable", actor: player, start, end, offset: zero }) : undefined;
  }
  fire(player: ActorId, game: Q2GameServices): undefined {
    this.bind(game);
    const state = this.state(player), pose = this.hooks.pose(player, game);
    const body = grappleBody(player, game), basis = angleVectors(pose.angles), side = pose.hand === "left" ? -8 : pose.hand === "center" ? 0 : 8;
    const start = add(add(add(body.origin, scale(basis.forward, 8)), scale(basis.right, side)), { x: 0, y: 0, z: pose.viewHeight - 8 });
    if (state.hookState === 0) {
      state.hookState = 1; const hook = this.launch(player, game, start, basis.forward); state.hook = hook.actor.id;
      if (!game.host.actors.isLive(hook.actor.id)) { state.hook = null; state.hookState = 0; return undefined; }
      this.draw(player, start, game.body(hook).origin);
      return this.draw(player, start, game.body(hook).origin);
    }
    const hook = game.entity(state.hook);
    if (hook === null) { state.hookState = 0; return undefined; }
    if (state.hookState === 1) return this.draw(player, start, game.body(hook).origin);
    const target = hook.enemy === null ? null : game.host.bodies.read(hook.enemy);
    if (target !== null) game.move(hook, { origin: add(add(target.origin, target.bounds.min), hook.pos1) });
    const end = game.body(hook).origin; this.draw(player, start, end);
    const distance = Math.trunc(length(subtract(end, start))); state.hookLength = distance;
    const speed = distance > 120 ? 800 : distance > 100 ? distance * 5 : distance > 80 ? distance * 4 : distance > 40 ? distance * 3 : distance > 20 ? distance * 2 : distance > 10 ? distance : 1;
    const velocity = scale(normalize(subtract(end, start)), speed); grappleVelocity(player, game, velocity);
    return this.hooks.setPreviousVelocity(player, velocity);
  }
  gravityScale(actor: ActorId): 0 | 1 { const state = this.states.get(actor); return state?.hookState === 2 && state.hookLength < 50 ? 0 : 1; }
}
