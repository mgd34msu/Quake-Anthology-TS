/* Zoid's original CTF 1.09b g_ctf.c techs, using shared items and combat. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import type { ItemId } from "../../../../contracts/gameplay.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2Think } from "../../foundation/host.ts";
import { add, movedir, scale } from "../../foundation/fields.ts";
import { q2EntitiesNamed } from "../../base/player/spawns.ts";
import { ctfPlayer } from "./types.ts";
import type { Q2CtfContext } from "./types.ts";

const techs = [
  { classname: "item_tech1", model: "resistance", icon: "tech1", name: "Disruptor Shield" },
  { classname: "item_tech2", model: "strength", icon: "tech2", name: "Power Amplifier" },
  { classname: "item_tech3", model: "haste", icon: "tech3", name: "Time Accel" },
  { classname: "item_tech4", model: "regeneration", icon: "tech4", name: "AutoDoc" },
];
const timeout = 60;

export class Q2CtfTechs {
  constructor(readonly context: Q2CtfContext) {}
  get callbacks(): Q2CallbackDefinitions { return { think: { TechThink: this.think, SpawnTechs: this.spawnTechs } }; }
  register(): undefined {
    for (const tech of techs) this.context.hooks.items.register({ kind: "custom", consoleGive: "individual-only", classname: tech.classname,
      model: `models/ctf/${tech.model}/tris.md2`, icon: tech.icon, name: tech.name, sound: "items/pkup.wav",
      rotate: true, respawn: 0, capacity: 1, quantity: 0, coopStay: false, droppable: true, use: null,
      pickup: (entity, game, player) => this.pickup(entity, game, player) });
    return undefined;
  }
  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    return techs.some(tech => tech.classname === entity.classname) && this.context.hooks.items.spawn(entity, game);
  }
  private has(actor: ActorId | null, game: Q2GameServices, ordinal: number): boolean {
    return actor !== null && this.context.states.has(actor) && game.host.inventory.count(actor, `q2:item_tech${ordinal}`) > 0;
  }
  private pickup(entity: Q2Entity, game: Q2GameServices, player: OwnedActor): boolean {
    if (this.context.match.phase === "setup" || this.context.match.phase === "pregame") return false;
    const state = ctfPlayer(this.context, player.id), now = game.host.now();
    if (techs.some(tech => game.host.inventory.count(player.id, `q2:${tech.classname}`) > 0)) {
      if (now - state.lastTechMessage > 2) { state.lastTechMessage = now; game.host.emit({ kind: "centerprint", actor: player.id, text: "You already have a TECH powerup." }); }
      return false;
    }
    game.host.inventory.give(player, `q2:${entity.classname}`, 1); state.regenTime = now; return true;
  }
  private findSpawn(game: Q2GameServices): Q2Entity | null {
    const spots = q2EntitiesNamed(game, "info_player_deathmatch");
    let index = -1, remaining = Math.min(15, Math.floor(game.host.random() * 16));
    // G_Find(NULL) restarts. Passing the final edict returns NULL for one iteration.
    while (remaining-- > 0) index = index + 1 === spots.length ? -1 : index + 1;
    return spots[index < 0 ? 0 : index] ?? null;
  }
  private create(classname: string, spot: Q2Entity, game: Q2GameServices): Q2Entity {
    const entity = game.create(classname), items = this.context.hooks.items;
    if (!items.spawn(entity, game)) throw new Error(`Unregistered CTF tech ${classname}`);
    const touch = items.callbacks.touch?.["Touch_Item"];
    if (touch === undefined) throw new Error("CTF techs require the shared Touch_Item callback");
    entity.spawnflags = 0x10000; entity.effects = 1; entity.renderFlags = 512; entity.owner = entity.actor.id; entity.touch = touch;
    const forward = movedir({ x: 0, y: Math.min(359, Math.floor(game.host.random() * 360)), z: 0 });
    const velocity = scale(forward, 100);
    game.move(entity, { origin: add(game.body(spot).origin, { x: 0, y: 0, z: 16 }), velocity: { ...velocity, z: 300 },
      bounds: { min: { x: -15, y: -15, z: -15 }, max: { x: 15, y: 15, z: 15 } } }, false);
    game.solid(entity, "trigger"); game.motion(entity, "toss"); game.schedule(entity, timeout, this.think); game.show(entity); return entity;
  }
  private readonly think: Q2Think = (entity, game) => {
    const spot = this.findSpawn(game);
    if (spot === null) return game.schedule(entity, timeout, this.think);
    this.create(entity.classname, spot, game); return game.remove(entity);
  };
  private spawnAll(game: Q2GameServices): undefined {
    for (const tech of techs) { const spot = this.findSpawn(game); if (spot !== null) this.create(tech.classname, spot, game); }
    return undefined;
  }
  private readonly spawnTechs: Q2Think = (entity, game) => { this.spawnAll(game); return game.remove(entity); };
  setup(game: Q2GameServices): undefined {
    if ((game.options.deathmatchFlags & 524288) !== 0) return undefined;
    return game.schedule(game.create("ctf_tech_spawn"), 2, this.spawnTechs);
  }
  reset(game: Q2GameServices): undefined {
    for (const entity of [...game.entities.values()]) if (techs.some(tech => tech.classname === this.context.hooks.items.itemDefinition(entity)?.classname)) game.remove(entity);
    return this.spawnAll(game);
  }
  /** CTFRespawnTech also removes the old actor when no spawn point is available. */
  respawn(entity: Q2Entity, game: Q2GameServices): undefined {
    const spot = this.findSpawn(game); if (spot !== null) this.create(entity.classname, spot, game); return game.remove(entity);
  }
  drop(entity: Q2Entity, game: Q2GameServices, dead = false): undefined {
    for (const tech of techs) {
      const item: ItemId = `q2:${tech.classname}`, count = game.host.inventory.count(entity.actor.id, item);
      if (count === 0) continue;
      // Original CTFDeadDropTech still calls Drop_Item, not Drop_Player_Item.
      const dropped = this.context.hooks.items.drop(entity, game, item, { playerDeath: false });
      if (dropped === null) continue;
      if (dead) { dropped.owner = null; game.move(dropped, { velocity: { x: Math.min(599, Math.floor(game.host.random() * 600)) - 300,
        y: Math.min(599, Math.floor(game.host.random() * 600)) - 300, z: game.body(dropped).velocity.z } }); }
      // Replacing drop_make_touchable preserves the original manual owner's exclusion.
      game.schedule(dropped, timeout, this.think); game.host.inventory.consume(entity.actor, item, count);
    }
    return undefined;
  }
  private sound(entity: Pick<Q2Entity, "actor">, game: Q2GameServices, name: string): undefined {
    const volume = this.context.hooks.weapons.silencerShots(entity.actor.id) > 0 ? 0.2 : 1;
    return game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin, path: `ctf/${name}.wav`, channel: 2, volume, attenuation: 1, reliable: false, loop: "once" });
  }
  strength(actor: ActorId | null, game: Q2GameServices, damage: number): number { return damage !== 0 && this.has(actor, game, 2) ? damage * 2 : damage; }
  resistance(actor: ActorId, game: Q2GameServices, take: number): number {
    if (take === 0 || !this.has(actor, game, 1)) return take;
    const entity = game.entity(actor); if (entity !== null) this.sound(entity, game, "tech1"); return Math.trunc(take / 2);
  }
  haste(actor: ActorId, game: Q2GameServices): boolean { return this.has(actor, game, 3); }
  strengthSound(entity: Pick<Q2Entity, "actor">, game: Q2GameServices): boolean {
    if (!this.has(entity.actor.id, game, 2)) return false;
    const state = ctfPlayer(this.context, entity.actor.id);
    if (state.techSoundTime < game.host.now()) {
      state.techSoundTime = game.host.now() + 1;
      this.sound(entity, game, this.context.hooks.items.playerPowerups(entity.actor.id).quadUntil > game.host.now() ? "tech2x" : "tech2");
    }
    return true;
  }
  hasteSound(entity: Pick<Q2Entity, "actor">, game: Q2GameServices): undefined {
    if (!this.haste(entity.actor.id, game)) return undefined;
    const state = ctfPlayer(this.context, entity.actor.id);
    if (state.techSoundTime < game.host.now()) { state.techSoundTime = game.host.now() + 1; this.sound(entity, game, "tech3"); }
    return undefined;
  }
  hasRegeneration(actor: ActorId, game: Q2GameServices): boolean { return this.has(actor, game, 4); }
  regenerate(entity: Q2Entity, game: Q2GameServices): undefined {
    if (!this.hasRegeneration(entity.actor.id, game)) return undefined;
    const state = ctfPlayer(this.context, entity.actor.id), now = game.host.now(), current = game.host.combat.read(entity.actor.id);
    if (current === null || state.regenTime >= now) return undefined;
    state.regenTime = now; let noise = false;
    if (current.health < 150) { game.host.combat.setHealth(entity.actor, Math.min(150, current.health + 5)); state.regenTime += 0.5; noise = true; }
    const armor = current.armor;
    if (armor.kind !== "none" && armor.points > 0 && armor.points < 150) { game.host.combat.setArmor(entity.actor, { ...armor, points: Math.min(150, armor.points + 5) }); state.regenTime += 0.5; noise = true; }
    if (noise && state.techSoundTime < now) { state.techSoundTime = now + 1; this.sound(entity, game, "tech4"); }
    return undefined;
  }
}
