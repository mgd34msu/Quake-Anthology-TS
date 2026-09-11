/* quakec_ctf/hook.qc: Threewave grapple mechanics over shared actors. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { BodyState, TouchContact } from "../../../contracts/world.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "../../../persistence/value.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import type { Q1EntityServices } from "../foundation/entity-services.ts";
import { POINT, ZERO, length, normalize, vadd, vscale, vsub, vectors } from "../foundation/types.ts";

export interface ThreewaveGrappleInput {
  readonly held: boolean;
  readonly release: boolean;
  readonly jump: boolean;
  readonly viewAngles: Vec3;
  readonly teleportUntil: number;
}
export interface ThreewaveGrappleHost {
  input(actor: ActorId): ThreewaveGrappleInput;
  aim(actor: ActorId, forward: Vec3): Vec3;
  anchor(actor: ActorId): { readonly solid: boolean; readonly centered: boolean; readonly player: boolean };
  canAttach(owner: ActorId, target: ActorId): boolean;
  canPulse(owner: ActorId, target: ActorId): boolean;
  canDamage(target: ActorId, owner: ActorId): boolean;
}
export interface ThreewaveGrappleState {
  pulling: boolean;
  weaponFrame: number;
  attackFinished: number;
  releaseTime: number;
  animation: ActorId | null;
}

/** Equipment owns continuation state; the selected input and map supply only observations and policy. */
export class ThreewaveGrapple {
  private readonly states = new Map<ActorId, ThreewaveGrappleState>();
  constructor(readonly game: Q1EntityServices, readonly host: ThreewaveGrappleHost) {
    game.named.register("ctf:hook_touch", { touch: (_game, hook, actor, _normal, surface) => this.touch(hook, actor, surface) });
    game.named.register("ctf:hook_pull", { action: (_game, hook) => this.pull(hook) });
    game.named.register("ctf:hook_flying", { action: (_game, hook) => {
      const owner = hook.owner;
      if (owner === null || !game.host.actors.isLive(owner) || game.time >= hook.number("ctf.fired") + 5) return this.vanish(hook);
      if (host.input(owner).release) return this.vanish(hook);
      return game.schedule(hook, 0.1, game.named.action(hook, "ctf:hook_flying"));
    } });
    game.host.actors.onRelease(actor => {
      this.release(actor.id); this.states.delete(actor.id);
      for (const link of game.entities.values()) if (link.classname === "ctf_hook_link" && link.owner !== null && sameActor(link.owner, actor.id)) game.remove(link);
      for (const [owner, state] of this.states) {
        if (state.animation !== null && sameActor(state.animation, actor.id)) state.animation = null;
        if (this.hook(owner) === null) state.pulling = false;
      }
      return undefined;
    });
    game.registerStateExtension({ id: "q1:equipment:threewave-grapple", capture: () => encodeCheckpointValue([...this.states].map(([actor, state]) => ({
      actor: { slot: actor.slot, generation: actor.generation }, ...state,
      animation: state.animation === null ? null : { slot: state.animation.slot, generation: state.animation.generation },
    }))), restore: bytes => {
      this.states.clear();
      new SaveReader(decodeCheckpointValue(bytes), "threewave-grapple").list(reader => {
        const owner = reader.field("actor"), actor = game.host.actors.resolveSaved({ slot: owner.field("slot").integer(0), generation: owner.field("generation").integer(0) });
        if (actor === null) return reader.fail("missing grapple owner");
        const animation = reader.field("animation").nullable(value => game.host.actors.referenceSaved({ slot: value.field("slot").integer(0), generation: value.field("generation").integer(0) }));
        this.states.set(actor.id, { pulling: reader.field("pulling").boolean(), weaponFrame: reader.field("weaponFrame").number(),
          attackFinished: reader.field("attackFinished").number(), releaseTime: reader.field("releaseTime").number(), animation });
        return undefined;
      }); return undefined;
    } });
  }
  state(actor: ActorId): ThreewaveGrappleState {
    this.owner(actor);
    let state = this.states.get(actor);
    if (state === undefined) { state = { pulling: false, weaponFrame: 0, attackFinished: 0, releaseTime: 0, animation: null }; this.states.set(actor, state); }
    return state;
  }
  pulling(actor: ActorId): boolean { return this.states.get(actor)?.pulling ?? false; }
  hook(actor: ActorId): Q1Actor | null {
    return [...this.game.entities.values()].find(entity => entity.classname === "ctf_hook" && entity.owner !== null && sameActor(entity.owner, actor)) ?? null;
  }
  release(actor: ActorId): undefined {
    const state = this.states.get(actor), animation = this.game.entity(state?.animation ?? null);
    if (state !== undefined) { state.animation = null; state.pulling = false; }
    if (animation !== null) this.game.remove(animation);
    const hook = this.hook(actor); if (hook === null) return undefined;
    this.game.host.bodies.detach(hook.actor);
    for (const link of this.game.entities.values()) if (link.classname === "ctf_hook_link" && link.owner !== null && sameActor(link.owner, hook.actor.id)) this.game.remove(link);
    return this.game.remove(hook);
  }
  private owner(actor: ActorId): OwnedActor {
    const owner = this.game.host.actors.resolveOwned(actor); if (owner === null) throw new Error("Grapple owner is no longer admitted"); return owner;
  }
  private body(actor: ActorId): BodyState {
    const body = this.game.host.bodies.read(actor); if (body === null) throw new Error("Grapple actor has no shared body"); return body;
  }
  private vanish(hook: Q1Actor): undefined {
    if (hook.owner !== null) return this.release(hook.owner);
    return this.game.remove(hook);
  }
  private pull(hook: Q1Actor): undefined {
    const { game, host } = this, owner = hook.owner, enemy = hook.references.get("ctf.enemy");
    if (owner === null || !game.host.actors.isLive(owner) || enemy === undefined || enemy === null || !game.host.actors.isLive(enemy)) return this.vanish(hook);
    const input = host.input(owner), target = host.anchor(enemy);
    this.state(owner).pulling = true;
    if (input.release || input.teleportUntil > game.time || game.health(owner) <= 0 || !target.solid) return this.vanish(hook);
    const enemyBody = this.body(enemy), enemyCombat = game.host.combat.read(enemy);
    if (enemyCombat?.canTakeDamage && host.canPulse(owner, enemy)) {
      if (!host.canDamage(enemy, owner)) return this.vanish(hook);
      game.sound(hook, "blob/land1.wav", "weapon"); game.damage(enemy, hook.actor.id, owner, 1, null, "direct", "ctf:grapple");
      if (!game.live(hook) || !game.host.actors.isLive(owner) || !game.host.actors.isLive(enemy)) return this.vanish(hook);
      const spray = { x: 100 * (game.host.random() * 2 - 1), y: 100 * (game.host.random() * 2 - 1), z: 100 * (game.host.random() * 2 - 1) + 50 };
      game.host.emit({ kind: "particles", origin: game.body(hook).origin, direction: vscale(spray, 0.1), color: 73, count: 40 });
    }
    if (target.centered) game.setBody(hook, { velocity: ZERO, origin: vadd(enemyBody.origin, vscale(vadd(enemyBody.bounds.min, enemyBody.bounds.max), 0.5)) });
    else game.setBody(hook, { velocity: enemyBody.velocity });
    const body = this.body(owner), basis = vectors(body.angles);
    const relative = vsub(game.body(hook).origin, vadd(body.origin, vadd(vscale(basis.up, input.jump ? 0 : 16), vscale(basis.forward, 16))));
    const distance = length(relative), velocity = vscale(normalize(relative), distance <= 100 ? distance * 10 : 1000);
    const traveled = length(vsub(body.origin, hook.vector("ctf.lastOrigin")));
    if (traveled > 10 && hook.number("style") === 3) hook.fields.set("style", "2");
    if (traveled < 10 && hook.number("style") === 2) hook.fields.set("style", "3");
    const actor = this.owner(owner); game.host.bodies.write(actor, { ...body, velocity }); game.host.bodies.link(actor);
    hook.fields.set("ctf.lastOrigin", `${Math.fround(body.origin.x)} ${Math.fround(body.origin.y)} ${Math.fround(body.origin.z)}`); game.link(hook);
    return game.schedule(hook, 0.1, game.named.action(hook, "ctf:hook_pull"));
  }
  touch(hook: Q1Actor, other: ActorId, surface?: TouchContact["surface"]): undefined {
    const { game, host } = this, owner = hook.owner;
    if (owner === null || !game.host.actors.isLive(owner)) return this.vanish(hook);
    if (sameActor(owner, other)) return undefined;
    if (((surface?.nativeFlags ?? 0) & 4) !== 0 || game.host.contents(game.body(hook).origin) === "sky") return this.vanish(hook);
    if (!host.canAttach(owner, other)) return undefined;
    const target = host.anchor(other), combat = game.host.combat.read(other);
    if (combat?.canTakeDamage) {
      if (!target.player) game.sound(hook, "player/axhit2.wav", "weapon");
      game.damage(other, hook.actor.id, owner, 10, "ctf:grapple", "direct", "ctf:grapple");
      if (!game.live(hook) || !game.host.actors.isLive(owner) || !game.host.actors.isLive(other)) return this.vanish(hook);
      game.host.emit({ kind: "particles", origin: game.body(hook).origin, direction: vscale(game.body(hook).velocity, 0.1), color: 73, count: 20 });
    } else { game.sound(hook, "player/axhit2.wav", "weapon"); hook.angularVelocity = ZERO; }
    if (!host.input(owner).held) return this.vanish(hook);
    const body = this.body(other);
    if (target.centered) game.setBody(hook, { origin: vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5)), velocity: ZERO });
    else game.setBody(hook, { velocity: body.velocity });
    game.host.bodies.attach(hook.actor, { anchor: other, follow: target.centered ? { kind: "center" }
      : { kind: "translation", offset: vsub(game.body(hook).origin, body.origin) } });
    hook.references.set("ctf.enemy", other); hook.fields.set("style", "2");
    hook.touch = null; game.link(hook); return game.schedule(hook, 0.1, game.named.action(hook, "ctf:hook_pull"));
  }
  fire(actor: ActorId): boolean {
    const { game, host } = this;
    if (this.hook(actor) !== null || game.health(actor) <= 0) return false;
    const owner = this.owner(actor), body = this.body(actor), forward = vectors(host.input(actor).viewAngles).forward, direction = host.aim(actor, forward);
    this.state(actor);
    const hook = game.create("ctf_hook");
    hook.owner = actor; hook.movement = "fly"; hook.solid = "bbox"; hook.model = "progs/star.mdl"; hook.angularVelocity = { x: 0, y: 0, z: -500 };
    hook.touch = game.named.touch(hook, "ctf:hook_touch"); hook.fields.set("ctf.fired", String(Math.fround(game.time)));
    const yaw = Math.atan2(direction.y, direction.x) * 180 / Math.PI, pitch = Math.atan2(direction.z, Math.hypot(direction.x, direction.y)) * 180 / Math.PI;
    game.setBody(hook, { origin: vadd(body.origin, vadd(vscale(forward, 16), { x: 0, y: 0, z: 16 })), bounds: POINT,
      velocity: vscale(direction, 800), angles: { x: pitch, y: yaw < 0 ? yaw + 360 : yaw, z: 0 } }); game.link(hook);
    game.sound(owner, "weapons/chain1.wav", "weapon"); game.schedule(hook, 0.1, game.named.action(hook, "ctf:hook_flying")); return true;
  }
  trail(actor: ActorId): undefined {
    const hook = this.hook(actor); if (hook === null) return undefined;
    const body = this.game.body(hook), offset = vscale(vectors(body.angles).forward, -7);
    return this.game.host.emit({ kind: "beam", style: "grapple", actor: hook.actor.id, start: vadd(body.origin, { ...offset, z: -offset.z }), end: vadd(this.body(actor).origin, { x: 0, y: 0, z: 16 }) });
  }
}
