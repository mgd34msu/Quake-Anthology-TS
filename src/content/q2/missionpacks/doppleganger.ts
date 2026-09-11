/* Rogue g_newdm.c/g_items.c decoy creation, animation, and sphere retaliation. GPL-2.0-or-later. */
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q2CallbackDefinitions } from "../foundation/callbacks.ts";
import type { Q2Die, Q2Entity, Q2GameServices, Q2Pain, Q2Think } from "../foundation/host.ts";
import type { Q2Weapons } from "../foundation/weapons/index.ts";
import { add, length, scale, subtract, zero } from "../foundation/fields.ts";
import { angleVectors, vectorAngles } from "../foundation/weapons/vectors.ts";
import { findRogueSpawnPoint, checkRogueGroundSpawnPoint, rogueSpawnGrow, rogueSpawnCallbacks } from "./monsters/spawn.ts";
import type { Q2MissionPackSpheres } from "./spheres.ts";
import { explode } from "./projectiles/common.ts";

export class Q2MissionPackDoppleganger {
  constructor(readonly spheres: Q2MissionPackSpheres, readonly weapons: Q2Weapons) {}

  get callbacks(): Q2CallbackDefinitions {
    return { think: { ...rogueSpawnCallbacks.think, doppleganger_timeout: this.timeout, body_think: this.bodyThink },
      pain: { doppleganger_pain: this.pain }, die: { doppleganger_die: this.die } };
  }

  use(owner: Q2Entity, game: Q2GameServices): boolean {
    const body = game.body(owner), angles = this.weapons.inputs.get(owner.actor.id)?.angles ?? body.angles;
    const forward = angleVectors({ x: 0, y: angles.y, z: 0 }).forward;
    const point = findRogueSpawnPoint(game, add(body.origin, scale(forward, 48)), body.bounds, 32);
    if (point === null || !checkRogueGroundSpawnPoint(game, point, body.bounds, 64, -1)) return false;
    if (!game.host.inventory.consume(owner.actor, "q2:item_doppleganger", 1)) return false;
    rogueSpawnGrow(game, point, 0); this.fire(owner, game, point, forward); return true;
  }

  private readonly timeout: Q2Think = (entity, game) => {
    const body = game.entity(entity.teamChain);
    if (body !== null) explode(body, game);
    return explode(entity, game);
  };

  private readonly pain: Q2Pain = (entity, _game, reaction) => { entity.enemy = reaction.attacker; return undefined; };

  private readonly die: Q2Die = (entity, game, reaction) => {
    const enemy = entity.enemy === null ? null : game.host.bodies.read(entity.enemy);
    if (enemy !== null && entity.enemy !== entity.teamMaster) {
      const sphere = this.spheres.launch(entity, game, length(subtract(enemy.origin, game.body(entity).origin)) > 768 ? "hunter" : "vengeance", true);
      sphere.pain?.(sphere, game, { self: sphere.actor, attacker: reaction.attacker, damage: 0, kick: 0 });
    }
    return this.timeout(entity, game);
  };

  private readonly bodyThink: Q2Think = (entity, game) => {
    const angles = game.body(entity).angles, yaw = (Math.trunc(angles.y * 65536 / 360) & 65535) * (360 / 65536);
    if (Math.abs(entity.pos1.y - yaw) < 2) {
      if (entity.timestamp < game.host.now() && game.host.random() < 0.1) {
        entity.pos1 = { ...entity.pos1, y: game.host.random() * 350 }; entity.timestamp = game.host.now() + 1;
      }
    } else {
      let move = entity.pos1.y - yaw;
      if (entity.pos1.y > yaw && move >= 180) move -= 360;
      else if (entity.pos1.y <= yaw && move <= -180) move += 360;
      game.move(entity, { angles: { ...angles, y: (yaw + Math.max(-entity.speed, Math.min(entity.speed, move)) + 360) % 360 } });
    }
    if (++entity.frame > 39) entity.frame = 0;
    game.show(entity); return game.schedule(entity, 0.1, this.bodyThink);
  };

  fire(owner: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3): Q2Entity {
    game.sourceCallbacks.register(this.callbacks);
    const base = game.create("doppleganger"), angles = vectorAngles(direction);
    base.teamMaster = owner.actor.id; base.renderFlags = 0x8000; base.damageableTarget = true; base.pain = this.pain; base.die = this.die;
    game.move(base, { origin: start, angles: { ...angles, x: 0 }, velocity: zero, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } } });
    game.motion(base, "toss"); game.solid(base, "box");
    game.host.combat.create(base.actor, { health: 30, mass: 0, armor: { kind: "none" }, canTakeDamage: true, invulnerable: false, team: null });
    game.schedule(base, 30, this.timeout);
    const body = game.create("doppleganger_body");
    body.model = owner.model; body.model2 = owner.model2; body.model3 = owner.model3; body.model4 = owner.model4; body.frame = owner.frame; body.oldFrame = owner.oldFrame;
    body.skin = owner.skin; body.effects = owner.effects; body.renderFlags = owner.renderFlags; body.scale = owner.scale;
    body.teamMaster = base.actor.id; body.speed = 30;
    game.move(body, { origin: add(start, { x: 0, y: 0, z: 8 }), angles: game.body(owner).angles });
    game.show(body); game.schedule(body, game.host.frameSeconds(), this.bodyThink);
    base.teamChain = body.actor.id; return base;
  }
}
