/* Original Rogue dm_tag.c. Shared inventory and scoring remain authoritative. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { SavedActorId } from "../../../../contracts/session.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2Think, Q2Touch } from "../../foundation/host.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2ItemModule } from "../../foundation/items.ts";
import { add, scale, zero } from "../../foundation/fields.ts";
import { angleVectors } from "../../foundation/weapons/vectors.ts";

export interface Q2TagHooks {
  readonly items: Q2ItemModule;
  selectSpawn(entity: Q2Entity, game: Q2GameServices): { readonly origin: Vec3; readonly angles: Vec3 };
  farthestSpawn(game: Q2GameServices): Q2Entity | null;
  addScore(actor: ActorId, amount: number): undefined;
}
export interface Q2TagCheckpoint { readonly token: SavedActorId | null; readonly owner: SavedActorId | null; readonly count: number; }

export class Q2Tag implements Q2SpawnModule {
  private token: ActorId | null = null;
  private owner: ActorId | null = null;
  private count = 0;
  constructor(readonly hooks: Q2TagHooks) {
    hooks.items.register({ kind: "custom", classname: "dm_tag_token", name: "Tag Token", icon: "i_tagtoken", model: "models/items/tagtoken/tris.md2",
      sound: "items/pkup.wav", rotate: true, respawn: 0, capacity: 32767, quantity: 1, coopStay: false, droppable: false, use: null,
      pickup: (entity, game, player) => {
        this.token = entity.actor.id; this.owner = player.id; this.count = 0;
        game.host.inventory.give(player, "q2:dm_tag_token", 1);
        const owner = game.entity(player.id); if (owner !== null) this.bonus(owner, game);
        return true;
      } });
  }
  get callbacks(): Q2CallbackDefinitions { return { think: { Tag_Respawn: this.respawn, Tag_MakeTouchable: this.makeTouchable }, touch: { Tag_TouchItem: this.touch } }; }
  capture(): Q2TagCheckpoint {
    const save = (actor: ActorId | null): SavedActorId | null => actor === null ? null : { slot: actor.slot, generation: actor.generation };
    return { token: save(this.token), owner: save(this.owner), count: this.count };
  }
  restore(game: Q2GameServices, saved: Q2TagCheckpoint): undefined {
    const restore = (actor: SavedActorId | null): ActorId | null => actor === null ? null : game.host.actors.resolveSaved(actor)?.id ?? game.host.actors.referenceSaved(actor);
    this.token = restore(saved.token); this.owner = restore(saved.owner); this.count = saved.count; return undefined;
  }
  ownerActor(): ActorId | null { return this.owner; }
  effects(actor: ActorId): number { return actor === this.owner ? 0x20000000 : 0; }
  dogTag(actor: ActorId): string | null { return actor === this.owner ? "tag3" : null; }
  changeDamage(target: ActorId, attacker: ActorId | null, damage: number): number {
    return target !== this.owner && attacker !== this.owner ? Math.trunc(damage * 3 / 4) : damage;
  }
  playerDeath(entity: Q2Entity, game: Q2GameServices): undefined {
    return this.token !== null && entity.actor.id === this.owner ? this.drop(entity, game) : undefined;
  }
  disconnect(entity: Q2Entity, game: Q2GameServices): undefined { return this.playerDeath(entity, game); }

  score(attacker: Q2Entity, victim: Q2Entity, game: Q2GameServices, change: number, meansOfDeath: number): undefined {
    if (this.token !== null && this.owner !== null) {
      if (change > 0 && attacker.actor.id === this.owner) {
        change = 3;
        if (++this.count === 5) {
          game.host.inventory.give(attacker.actor, "q2:item_quad", 1); this.hooks.items.use(attacker.actor, "q2:item_quad", game); this.count = 0;
        }
      } else if (victim.actor.id === this.owner && attacker.actor.id !== this.owner) {
        change = 5;
        const mod = meansOfDeath & ~0x8000000;
        if ([49, 53, 54, 55].includes(mod) || (game.host.combat.read(attacker.actor.id)?.health ?? 0) <= 0) this.drop(victim, game);
        else { this.bonus(attacker, game); this.owner = attacker.actor.id; this.count = 0; }
      }
    }
    return this.hooks.addScore(attacker.actor.id, change);
  }

  private bonus(entity: Q2Entity, game: Q2GameServices): undefined {
    const health = game.host.combat.read(entity.actor.id)?.health ?? 0, maximum = entity.maxHealth || 100;
    if (health < maximum) game.host.combat.setHealth(entity.actor, Math.min(maximum, health + 200));
    const armor = game.create("item_armor_body"); armor.spawnflags |= 0x10000;
    this.hooks.items.spawn(armor, game);
    if (game.host.actors.isLive(armor.actor.id)) this.hooks.items.touch(armor, game, entity.actor.id);
    return game.host.actors.isLive(armor.actor.id) ? game.remove(armor) : undefined;
  }

  private readonly touch: Q2Touch = (entity, game, contact) => this.hooks.items.touch(entity, game, contact.other);
  private readonly respawn: Q2Think = (entity, game) => {
    const spot = this.hooks.farthestSpawn(game);
    return spot === null ? game.schedule(entity, 1, this.respawn) : game.move(entity, { origin: game.body(spot).origin });
  };
  private readonly makeTouchable: Q2Think = (entity, game) => {
    entity.touch = this.touch;
    const token = game.entity(this.token);
    return token === null ? undefined : game.schedule(token, (game.host.pointContents(game.body(entity).origin) & 24) !== 0 ? 3 : 30, this.respawn);
  };

  drop(entity: Q2Entity, game: Q2GameServices): undefined {
    this.count = 0; this.owner = null;
    const token = game.create("dm_tag_token"); this.token = token.actor.id; token.spawnflags = 0x10000;
    this.hooks.items.spawn(token, game);
    token.effects = 1 | 0x20000000; token.renderFlags = 512; token.owner = entity.actor.id; token.touch = null;
    const bounds = { min: { x: -15, y: -15, z: -15 }, max: { x: 15, y: 15, z: 15 } }, body = game.body(entity);
    const forward = angleVectors(game.host.playerViewState(entity.actor.id)?.viewAngles ?? body.angles).forward;
    const origin = game.host.trace({ start: body.origin, end: add(add(body.origin, scale(forward, 24)), { x: 0, y: 0, z: -16 }), bounds, ignore: entity.actor.id, mask: 1 }).end;
    game.move(token, { origin, bounds, velocity: { ...scale(forward, 100), z: 300 } });
    game.solid(token, "trigger"); game.motion(token, "toss"); game.show(token); game.schedule(token, 1, this.makeTouchable);
    game.host.inventory.consume(entity.actor, "q2:dm_tag_token", 1); return undefined;
  }

  postSpawn(game: Q2GameServices): undefined {
    for (const entity of game.entities.values()) if (entity.classname === "dm_tag_token") return undefined;
    const token = game.create("dm_tag_token"), spot = this.hooks.selectSpawn(token, game);
    game.move(token, { origin: spot.origin, angles: spot.angles, velocity: zero }); this.spawn(token, game); return undefined;
  }
  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    if (entity.classname !== "dm_tag_token") return false;
    if (game.options.mode !== "deathmatch") { game.remove(entity); return true; }
    game.sourceCallbacks.register(this.callbacks); this.token = entity.actor.id; this.count = 0;
    entity.model = "models/items/tagtoken/tris.md2"; entity.count = 1;
    this.hooks.items.spawn(entity, game); entity.effects |= 0x20000000; game.show(entity); return true;
  }
}
