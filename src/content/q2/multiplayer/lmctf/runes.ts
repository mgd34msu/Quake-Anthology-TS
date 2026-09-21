/* LM_CTF g_runes.c and Vampire g_combat.c additions. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2Think, Q2Touch } from "../../foundation/host.ts";
import { add, length, subtract, zero } from "../../foundation/fields.ts";
import { angleVectors } from "../../foundation/weapons/vectors.ts";
import { LMCTF_RUNES, lmctfPlayer, lmctfToss } from "./types.ts";
import type { LmctfContext, LmctfRune, LmctfRuneDefinition } from "./types.ts";

const bounds = { min: { x: -15, y: -15, z: -15 }, max: { x: 15, y: 15, z: 15 } };
export class LmctfRunes {
  private forward = true;
  constructor(readonly context: LmctfContext, readonly redFlag: (game: Q2GameServices) => Q2Entity | null) {
    for (const rune of LMCTF_RUNES) context.hooks.items.register({ kind: "custom", classname: rune.classname, model: rune.model, icon: rune.icon,
      name: rune.name, sound: "items/pkup.wav", rotate: false, respawn: 0, capacity: 1, quantity: 1, coopStay: false, droppable: false,
      pickup: (entity, game, player) => { this.pickup(entity, game, player.id); return false; },
      use: (player, game) => this.drop(player.id, game) });
  }
  get callbacks(): Q2CallbackDefinitions { return { think: { "lmctf:Rune_Think": this.think, "lmctf:Drop_Rune_Think": this.droppedThink }, touch: { "lmctf:Rune_Touch": this.touch, "lmctf:Rune_DropTouch": this.dropTouch } }; }
  capture(): { readonly forward: boolean } { return { forward: this.forward }; }
  restore(saved: { readonly forward: boolean }): undefined { this.forward = saved.forward; return undefined; }
  held(actor: ActorId, game: Q2GameServices): LmctfRune | null {
    const entity = game.entity(this.context.states.get(actor)?.rune ?? null); return entity === null ? null : LMCTF_RUNES.find(rune => rune.classname === entity.classname)?.kind ?? null;
  }
  private definition(entity: Q2Entity): LmctfRuneDefinition {
    const definition = LMCTF_RUNES.find(rune => rune.classname === entity.classname); if (definition === undefined) throw new Error(`Unknown LMCTF rune ${entity.classname}`); return definition;
  }
  private randomSpot(game: Q2GameServices): Q2Entity | null {
    for (const classname of ["item_health_small", "item_health_large", "item_health"]) {
      const spots = [...game.entities.values()].filter(entity => entity.classname === classname);
      if (spots.length > 0) return spots[Math.max(0, Math.min(20, Math.trunc(game.host.random() * spots.length)) - 1)] ?? null;
    }
    return null;
  }
  private farthestSpot(game: Q2GameServices): Q2Entity | null {
    const entities = [...game.entities.values()]; let best: Q2Entity | null = null, distance = 0;
    for (const [index, spot] of entities.entries()) if (spot.classname === "item_health") {
      let nearest = 9999999;
      for (const definition of LMCTF_RUNES) {
        // G_Find starts after the health edict and uses only the first of each rune.
        const rune = entities.slice(index + 1).find(entity => entity.classname === definition.classname);
        if (rune !== undefined) nearest = Math.min(nearest, length(subtract(game.body(spot).origin, game.body(rune).origin)));
      }
      if (nearest > distance) { best = spot; distance = nearest; }
    }
    return best ?? this.randomSpot(game);
  }
  private visible(entity: Q2Entity, game: Q2GameServices): undefined {
    entity.visible = true; entity.serverFlags &= ~1; entity.spawnflags = 0x10000; entity.model = this.definition(entity).model;
    game.motion(entity, "toss"); game.solid(entity, "trigger"); return game.show(entity);
  }
  private toss(entity: Q2Entity, game: Q2GameServices): undefined {
    this.visible(entity, game); entity.touch = this.touch;
    const origin = game.body(entity).origin, destination = add(origin, { x: 0, y: 0, z: 48 }), owner = entity.owner;
    entity.owner = null;
    const velocity = { x: -2000 + game.host.random() * 4000, y: -2000 + game.host.random() * 4000, z: 800 + game.host.random() * 200 };
    const trace = game.host.trace({ start: origin, end: destination, bounds, ignore: owner, mask: 3 });
    game.move(entity, { bounds, origin: trace.fraction < 1 || trace.allSolid ? origin : destination, velocity, ground: null });
    entity.timestamp = game.host.now(); return game.schedule(entity, 0.1, this.think);
  }
  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    const definition = LMCTF_RUNES.find(rune => rune.classname === entity.classname); if (definition === undefined) return false;
    entity.model = definition.model; entity.count = definition.bit;
    if (definition.kind === "vampire") { entity.effects |= 0x400; entity.renderFlags |= 1024; }
    game.sourceCallbacks.register(this.callbacks); this.toss(entity, game); return true;
  }
  postSpawn(game: Q2GameServices): undefined {
    for (const definition of LMCTF_RUNES) if ((this.context.rules.runes & definition.bit) !== 0) {
      const spot = this.farthestSpot(game) ?? this.redFlag(game); if (spot === null) continue;
      const rune = game.create(definition.classname); game.move(rune, { origin: game.body(spot).origin }); this.spawn(rune, game);
    }
    return undefined;
  }
  private readonly think: Q2Think = (entity, game) => {
    if (entity.solid !== "none") switch (this.definition(entity).kind) {
      case "damage": entity.frame += this.forward ? 1 : -1; if (entity.frame >= 5) this.forward = false; else if (entity.frame <= 0) this.forward = true; break;
      case "haste": entity.frame = entity.frame >= 1 && entity.frame <= 15 ? entity.frame + 1 : 5; break;
      case "regen": entity.frame = (entity.frame + 1) % 14; break;
      case "resist": case "vampire": entity.frame = (entity.frame + 1) % 15; break;
    }
    game.show(entity); game.schedule(entity, 0.1, this.think);
    if (entity.timestamp + 30 < game.host.now()) {
      const spot = this.randomSpot(game) ?? this.redFlag(game); if (spot !== null) { game.move(entity, { origin: game.body(spot).origin }); this.toss(entity, game); }
      entity.timestamp = game.host.now();
    }
    return undefined;
  };
  private readonly touch: Q2Touch = (entity, game, contact) => { this.pickup(entity, game, contact.other); return undefined; };
  private readonly dropTouch: Q2Touch = (entity, game, contact) => entity.owner?.equals(contact.other) ? undefined : this.touch(entity, game, contact);
  private readonly droppedThink: Q2Think = (entity, game) => { entity.owner = null; entity.touch = this.touch; return game.schedule(entity, 0.1, this.think); };
  pickup(entity: Q2Entity, game: Q2GameServices, actor: ActorId): boolean {
    const state = this.context.states.get(actor), player = game.entity(actor), common = this.context.hooks.player(actor);
    if (state === undefined || player === null || common === null || common.spectator || (game.host.combat.read(actor)?.health ?? 0) <= 0 || entity.solid !== "trigger") return false;
    if (state.rune !== null) { entity.touch = this.touch; game.schedule(entity, 0.1, this.think); return false; }
    const definition = this.definition(entity);
    if (!game.host.inventory.entries(actor).some(entry => entry.item === definition.item)) game.host.inventory.configure(player.actor, { item: definition.item, count: 0, capacity: 1 });
    game.host.inventory.give(player.actor, definition.item, 1); state.rune = entity.actor.id; entity.owner = actor; entity.visible = false; entity.serverFlags |= 1;
    game.cancel(entity); game.solid(entity, "none"); game.motion(entity, "stationary"); game.move(entity, { velocity: zero }); game.show(entity); game.sound(entity, "misc/power1.wav", 3);
    game.host.emit({ kind: "pickup", player: actor, item: definition.item, name: definition.name, icon: definition.icon }); return true;
  }
  drop(actor: ActorId, game: Q2GameServices): boolean {
    const state = this.context.states.get(actor), player = game.entity(actor), rune = game.entity(state?.rune ?? null);
    if (state === undefined || player === null || rune === null) return false;
    game.host.inventory.consume(player.actor, this.definition(rune).item, 1); state.rune = null;
    this.visible(rune, game); rune.owner = actor; rune.touch = this.dropTouch;
    // The source computes random velocity before ctf_TossEnt overwrites it.
    game.host.random(); game.host.random(); game.host.random();
    lmctfToss(rune, player, game, angleVectors(game.host.playerViewState(actor)?.viewAngles ?? game.body(player).angles).forward);
    rune.timestamp = game.host.now(); game.schedule(rune, 1, this.droppedThink); game.sound(player, "misc/power2.wav", 3); return true;
  }
  damage(actor: ActorId | null, amount: number, game: Q2GameServices): number {
    return actor !== null && this.held(actor, game) === "damage" ? Math.trunc(Math.fround(amount * 1.75)) : amount;
  }
  afterPowerArmor(actor: ActorId, take: number, game: Q2GameServices): number {
    if (this.held(actor, game) !== "resist") return take;
    const entity = game.entity(actor); if (entity !== null) game.sound(entity, "ctf/resist.wav", 3);
    return Math.trunc(Math.fround(take / 1.75));
  }
  afterHealth(target: ActorId, attacker: ActorId | null, take: number, game: Q2GameServices): undefined {
    if (attacker === null || attacker.equals(target) || take === 0 || this.held(attacker, game) !== "vampire") return undefined;
    const victim = game.entity(target), source = game.entity(attacker), health = game.host.combat.read(attacker)?.health;
    if (source === null || health === undefined) return undefined;
    const shift = game.host.isPlayer(target) ? 1 : victim?.classname === "bodyque" ? 2 : 0; if (shift === 0) return undefined;
    game.host.combat.setHealth(source.actor, Math.min(250, health + (take >> shift))); return game.sound(source, "brain/brnatck3.wav", 3);
  }
  playerFrame(entity: Q2Entity, game: Q2GameServices): undefined {
    if (this.held(entity.actor.id, game) !== "regen") return undefined;
    const combat = game.host.combat.read(entity.actor.id); if (combat === null) return undefined;
    const state = lmctfPlayer(this.context, entity.actor.id), heartRate = Math.min(25, Math.max(5, Math.trunc(combat.health / 5))), frame = Math.round(game.host.now() * 10);
    if (frame < state.regenFrame + heartRate) return undefined;
    state.regenFrame = frame; let sound = false;
    if (combat.health < entity.maxHealth + 25) { game.host.combat.setHealth(entity.actor, Math.min(entity.maxHealth + 25, Math.trunc(combat.health + Math.fround(heartRate / 3)))); sound = true; }
    const armor = combat.armor.regular;
    if (armor.kind === "none" || armor.points === 0) {
      game.host.combat.setRegularArmor(entity.actor, { kind: "q2", points: Math.trunc(heartRate / 4), normalProtection: 0.3, energyProtection: 0,
        item: "q2:item_armor_jacket" }); sound = true;
    } else if (armor.points < 200) { game.host.combat.setRegularPoints(entity.actor, Math.min(200, Math.trunc(armor.points + Math.fround(heartRate / 3)))); sound = true; }
    return sound ? game.sound(entity, "ctf/regen.wav", 3) : undefined;
  }
  weaponFrame(entity: Pick<Q2Entity, "actor">, game: Q2GameServices, firing: boolean, repeat: () => undefined): undefined {
    const rune = this.held(entity.actor.id, game);
    if (rune === "haste") {
      if (firing) game.sound(entity, "player/lava1.wav", 3);
      if ((this.context.hooks.weapons.states.get(entity.actor.id)?.frame ?? 0) !== 0) return repeat();
    } else if (rune === "damage" && firing) return game.sound(entity, "ctf/strength.wav", 3);
    return undefined;
  }
}
