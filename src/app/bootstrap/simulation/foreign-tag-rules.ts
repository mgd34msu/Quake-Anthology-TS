// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { TouchContact } from "../../../contracts/world.ts";
import { foreignMatchMode, mapFamily, zeroVelocity, type ForeignMatchHost, type ForeignMatchSpawns, type ForeignMatchStrategy } from "./foreign-match-host.ts";

/**
 * Tag runs natively in the Q2 composition on Q2 worlds; on foreign worlds this mirrors Rogue dm_tag
 * over unified actors: one token, owner frags score 3, killing the owner scores 5 and takes the
 * token, damage between non-owners is reduced to 3/4.
 */
export class TagRules implements ForeignMatchStrategy {
  #token: OwnedActor | null = null;
  #owner: ActorId | null = null;
  #count = 0;
  #droppedAt: number | null = null;
  readonly #health = new Map<ActorId, number>();

  constructor(private readonly host: ForeignMatchHost, private readonly spawns: ForeignMatchSpawns) {}

  get token(): OwnedActor | null { return this.#token; }
  get owner(): ActorId | null { return this.#owner; }
  get count(): number { return this.#count; }
  get trackedHealth(): number { return this.#health.size; }
  tracksHealth(actor: ActorId): boolean { return this.#health.has(actor); }

  active(): boolean { return foreignMatchMode(this.host, "q2:tag"); }
  blocksCheckpoint(): boolean { return this.active(); }
  release(actor: ActorId): void { this.#health.delete(actor); }

  /** Damage between non-owners is reduced to 3/4. */
  registerCombat(): void {
    if (!this.active()) return;
    this.host.combat.damageOperation.register({ provider: "q2:tag", id: "q2:tag/damage", order: 0, kind: "transform",
      transform: request => this.#owner === null || request.target.equals(this.#owner) || request.attack.attacker?.equals(this.#owner) === true
        ? request : { ...request, amount: Math.trunc(request.amount * 3 / 4) } });
  }

  tick(): void {
    if (!this.active()) return;
    const host = this.host, players = host.players(), now = host.timeSeconds;
    if (this.#token === null && this.#owner === null) this.#spawnToken(null);
    if (this.#token !== null && this.#droppedAt !== null && now - this.#droppedAt >= 30) {
      // An untouched token returns to the spawn farthest from every player.
      const spot = this.spawns.farthest(), body = host.physics.bodies.read(this.#token.id);
      if (spot !== null && body !== null) { host.physics.bodies.write(this.#token, { ...body, origin: { x: spot.x, y: spot.y, z: spot.z + 16 }, velocity: zeroVelocity }); host.physics.bodies.link(this.#token); }
      this.#droppedAt = now;
    }
    const owner = this.#owner;
    if (owner !== null && !players.some(actor => actor.equals(owner))) {
      this.#owner = null; this.#count = 0; this.#spawnToken(null);
    }
    for (const actor of players) {
      const health = host.combat.read(actor)?.health ?? 0, previous = this.#health.get(actor);
      this.#health.set(actor, health);
      if (previous === undefined || previous <= 0 || health > 0) continue;
      const owned = host.actors.resolveOwned(actor);
      const attacker = owned === null ? null : host.lastAttacker(owned);
      const killer = attacker !== null && !attacker.equals(actor) && players.some(player => player.equals(attacker)) ? attacker : null;
      if (this.#owner !== null && actor.equals(this.#owner)) {
        this.#takeInventory(actor);
        if (killer !== null) host.addScore(killer, 4);
        if (killer !== null && (host.combat.read(killer)?.health ?? 0) > 0) {
          this.#owner = killer; this.#count = 0;
          this.#giveInventory(killer); this.#bonus(killer);
        } else {
          this.#owner = null; this.#count = 0; this.#spawnToken(actor);
        }
      } else if (killer !== null && this.#owner !== null && killer.equals(this.#owner)) {
        host.addScore(killer, 2);
        if (++this.#count === 5) { this.#count = 0; host.grantQuad(killer); }
      }
    }
  }

  #giveInventory(actor: ActorId): void {
    const owned = this.host.actors.resolveOwned(actor);
    if (owned !== null) this.host.inventory.give(owned, "q2:dm_tag_token", 1);
  }

  #takeInventory(actor: ActorId): void {
    const owned = this.host.actors.resolveOwned(actor);
    if (owned !== null) this.host.inventory.consume(owned, "q2:dm_tag_token", 1);
  }

  /** Native Tag heals the new owner and touches a body-armor pickup. */
  #bonus(actor: ActorId): void {
    const { actors, combat } = this.host;
    const owned = actors.resolveOwned(actor), state = combat.read(actor);
    if (owned === null || state === null) return;
    if (state.health < 100) combat.setHealth(owned, Math.min(100, state.health + 200));
    const regular = state.armor.regular;
    if (regular.kind === "none") {
      combat.setArmor(owned, { ...state.armor, regular: mapFamily(this.host) === "q1"
        ? { kind: "q1", points: 100, absorption: 0.3, item: "q1:item_armor1" }
        : { kind: "q3", points: 100, protection: Math.fround(0.66) } });
    } else if (regular.points < 100) combat.setArmor(owned, { ...state.armor, regular: { ...regular, points: 100 } });
  }

  #spawnToken(from: ActorId | null): void {
    const host = this.host;
    const origin = from !== null ? host.physics.bodies.read(from)?.origin : this.spawns.farthest();
    if (origin === null || origin === undefined) return;
    const actor = host.actors.allocate(host.recipe.match.provider, "q2:dm_tag_token");
    const bounds = { min: { x: -15, y: -15, z: -15 }, max: { x: 15, y: 15, z: 15 } };
    host.physics.bodies.create(actor, { origin: { x: origin.x, y: origin.y, z: origin.z + 16 }, velocity: zeroVelocity, angles: zeroVelocity, bounds, ground: null });
    host.physics.setSolid(actor, "trigger", null, mapFamily(host));
    host.callbacks.bind(actor, { think: null, touch: contact => this.#touched(contact), use: null, pain: null, die: null });
    host.bindModel(actor, { content: host.recipe.match.content, path: "models/items/tagtoken/tris.md2" });
    host.physics.bodies.link(actor);
    this.#token = actor;
    this.#droppedAt = host.timeSeconds;
  }

  #touched(contact: TouchContact): undefined {
    const host = this.host, token = this.#token;
    if (token === null || !contact.self.id.equals(token.id)) return undefined;
    // The native token is untouchable for a second after it drops.
    if (host.timeSeconds - (this.#droppedAt ?? 0) < 1) return undefined;
    const player = contact.other;
    if (!host.isPlayer(player) || (host.combat.read(player)?.health ?? 0) <= 0) return undefined;
    this.#token = null; this.#droppedAt = null;
    host.actors.release(token);
    this.#owner = player; this.#count = 0;
    this.#giveInventory(player); this.#bonus(player);
    return undefined;
  }
}
