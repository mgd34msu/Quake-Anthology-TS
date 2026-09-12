/* Rogue GRAPPLE.QC / grapple.qc, by Zoid under contract to id Software. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import type { Q1EntityServices } from "../foundation/entity-services.ts";
import type { Q1PlayerState } from "../foundation/types.ts";
import { POINT, ZERO, length, normalize, vadd, vscale, vsub, weaponItem } from "../foundation/types.ts";
import { missionReference, setMissionReference, velocityAngles } from "./types.ts";

export class RogueGrapple {
  constructor(readonly game: Q1EntityServices) {
    game.registerWeapon({ id: "rogue:grapple", model: "progs/v_grpple.mdl", ammo: null, rank: 12, fire: (_runtime, player) => this.fire(player), animate: (_runtime, player) => {
      if (this.hook(player.actor.id) === null || player.weaponFrame !== 1 || game.time < player.weaponAnimationAt + 0.1) return undefined;
      player.weaponFrame = 2; return this.presentation(player);
    } });
    game.registerPlayerExtension({ id: "rogue:grapple", attach: (runtime, player) => {
      runtime.host.inventory.configure(player.actor, { item: weaponItem("rogue:grapple"), count: runtime.options.deathmatch !== 0 && (runtime.options.teamplay ?? 0) >= 4 ? 1 : 0, capacity: 1 }); return undefined;
    }, frame: (_runtime, player) => this.service(player) });
    game.named.register("rogue:grapple-reset", { action: (_runtime, hook) => this.reset(hook) });
    game.named.register("rogue:grapple-anchor", { touch: (_runtime, hook, other) => this.anchor(hook, other) });
    game.named.register("rogue:grapple-track", { action: (_runtime, hook) => this.track(hook) });
  }
  private hook(owner: ActorId): Q1Actor | null {
    return [...this.game.entities.values()].find(entity => entity.classname === "hook" && entity.owner !== null && sameActor(entity.owner, owner)) ?? null;
  }
  private presentation(player: Q1PlayerState, punch = 0): undefined {
    this.game.weaponPunch(player, punch); return this.game.host.emit({ kind: "weapon", player: player.actor.id, weapon: "rogue:grapple", viewModel: "progs/v_grpple.mdl", frame: player.weaponFrame, punch });
  }
  private fire(player: Q1PlayerState): boolean {
    const game = this.game; player.attackFinished = Math.fround(game.time + 0.1);
    if (this.hook(player.actor.id) !== null) { player.weaponFrame = 2; this.presentation(player); return true; }
    const body = game.host.bodies.read(player.actor.id); if (body === null) return false;
    const forward = game.makeVectors(player.viewAngles).forward, hook = game.create("hook");
    hook.owner = player.actor.id; hook.movement = "flymissile"; hook.solid = "bbox"; hook.model = "progs/hook.mdl"; hook.frame = 1; hook.projectileWeapon = "rogue:grapple";
    hook.touch = game.named.touch(hook, "rogue:grapple-anchor");
    game.setBounds(hook, POINT); game.setBody(hook, { origin: vadd(vadd(body.origin, vscale(forward, 16)), { x: 0, y: 0, z: 16 }), velocity: vscale(forward, 800), angles: velocityAngles(forward) }); game.link(hook);
    game.schedule(hook, 2, game.named.action(hook, "rogue:grapple-reset")); game.sound(player.actor, "weapons/chain1.wav", "weapon");
    player.weaponFrame = 1; player.weaponAnimationAt = game.time; player.continuousFiring = false; this.presentation(player, -2); return true;
  }
  private reset(hook: Q1Actor): undefined {
    const player = hook.owner === null ? null : this.game.player(hook.owner);
    if (player !== null) { player.weaponFrame = 0; player.attackFinished = Math.fround(this.game.time + 0.25); player.weaponAnimationAt = -1; if (player.weapon === "rogue:grapple") this.presentation(player); }
    return this.game.remove(hook);
  }
  private anchor(hook: Q1Actor, other: ActorId): undefined {
    const game = this.game, player = hook.owner === null ? null : game.player(hook.owner);
    if (player === null) return this.reset(hook);
    if (sameActor(other, player.actor.id)) return undefined;
    if (game.host.contents(game.body(hook).origin) === "sky") return this.reset(hook);
    if (game.isPlayer(other)) {
      const targetTeam = game.host.combat.read(other)?.team, ownerTeam = game.host.combat.read(player.actor.id)?.team;
      if (targetTeam === ownerTeam) return this.reset(hook);
      game.sound(hook, "player/axhit1.wav", "weapon"); game.damage(other, hook.actor.id, player.actor.id, 10, "rogue:grapple");
    } else {
      game.sound(hook, "player/axhit2.wav", "weapon"); if (game.host.combat.read(other)?.canTakeDamage) game.damage(other, hook.actor.id, player.actor.id, 1, "rogue:grapple");
      game.setBody(hook, { velocity: ZERO }); hook.angularVelocity = ZERO;
    }
    hook.frame = 2; game.sound(player.actor, "weapons/tink1.wav", "weapon");
    if (!player.attackHeld) return this.reset(hook);
    hook.count = 1; hook.solid = "none"; hook.touch = null; setMissionReference(hook, "rogue:target", other);
    const body = game.host.bodies.read(player.actor.id); if (body !== null) game.host.bodies.write(player.actor, { ...body, ground: null });
    game.link(hook); return game.schedule(hook, 0, game.named.action(hook, "rogue:grapple-track"));
  }
  private track(hook: Q1Actor): undefined {
    const game = this.game, player = hook.owner === null ? null : game.player(hook.owner), target = missionReference(game, hook, "rogue:target");
    if (player === null || game.health(player.actor.id) <= 0 || target === null || game.isPlayer(target) && game.health(target) <= 0) return this.reset(hook);
    const body = game.host.bodies.read(target); if (body === null) return this.reset(hook);
    if (game.isPlayer(target)) {
      if ((game.player(target)?.teleportUntil ?? 0) > game.time) return this.reset(hook);
      game.setOrigin(hook, body.origin); game.sound(hook, "pendulum/hit.wav", "weapon"); game.damage(target, hook.actor.id, player.actor.id, 1, "rogue:grapple");
      game.host.random(); game.host.random(); game.host.random(); game.effect("blood", body.origin, target, 20);
    }
    if (game.entity(target)?.solid === "slidebox" || game.isPlayer(target)) game.setBody(hook, { origin: vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5)), velocity: ZERO });
    else game.setBody(hook, { velocity: body.velocity });
    return game.schedule(hook, 0.1, game.named.action(hook, "rogue:grapple-track"));
  }
  private service(player: Q1PlayerState): undefined {
    const game = this.game, hook = this.hook(player.actor.id), body = game.host.bodies.read(player.actor.id); if (hook === null || body === null) return undefined;
    const origin = game.body(hook).origin, distance = length(vsub(origin, body.origin));
    if (hook.count === 1) {
      if (!player.attackHeld && player.weapon === "rogue:grapple" || player.teleportUntil > game.time) return this.reset(hook);
      const basis = game.makeVectors(body.angles), direction = vsub(origin, vadd(vadd(body.origin, vscale(basis.up, player.jumpHeld ? 0 : 16)), vscale(basis.forward, 16))), speed = length(direction);
      game.host.bodies.write(player.actor, { ...body, velocity: vscale(normalize(direction), speed <= 100 ? speed * 10 : 1000), ground: null });
    }
    if (distance > 50) game.host.emit({ kind: "beam", style: "grapple", actor: hook.actor.id, start: origin, end: vadd(body.origin, { x: 0, y: 0, z: 16 }) });
    return undefined;
  }
}
