/* runes.qc, Rogue Entertainment / ZOID. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from "../../../../persistence/value.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1Foundation } from "../../foundation/runtime.ts";
import { later, number } from "./common.ts";

interface RuneState { rune: number; notice: number; earthNoise: number; blackNoise: number; hellNoise: number; regeneration: number; }
export class RogueRunes {
  private readonly players = new Map<OwnedActor, RuneState>();
  constructor(private readonly game: Q1Foundation, private readonly gamecfg: () => number) {
    game.host.actors.onRelease(actor => { this.players.delete(actor); return undefined; });
    game.registerStateExtension({ id: "rogue:runes", capture: () => encodeCheckpointValue([...this.players].map(([actor, state]) => ({ actor: { slot: actor.id.slot, generation: actor.id.generation }, ...state }))), restore: bytes => {
      this.players.clear(); const reader = new SaveReader(decodeCheckpointValue(bytes), "rogue:runes");
      reader.list(value => { const ref = value.field("actor"), actor = game.host.actors.resolveSaved({ slot: ref.field("slot").integer(0), generation: ref.field("generation").integer(0) });
        if (actor === null) return ref.fail("missing rune carrier");
        this.players.set(actor, { rune: value.field("rune").integer(0), notice: value.field("notice").number(), earthNoise: value.field("earthNoise").number(), blackNoise: value.field("blackNoise").number(), hellNoise: value.field("hellNoise").number(), regeneration: value.field("regeneration").number() }); return undefined;
      }); return undefined;
    } });
    game.named.register("rogue:rune_respawn", { action: (g, e) => { g.setBody(e, { origin: this.spawnPoint(), velocity: this.velocity() }); g.link(e); return later(g, e, 120, "rogue:rune_respawn"); } });
    game.named.register("rogue:rune_touch", { touch: (g, e, other) => {
      if (!g.isPlayer(other) || g.health(other) <= 0) return undefined; const state = this.state(other);
      if (state.rune !== 0) { if (state.notice < g.time) g.host.emit({ kind: "message", player: other, text: "$qc_already_have_rune", center: true }); state.notice = g.time + 5; return undefined; }
      state.rune |= e.number("rune"); const owner = g.host.actors.resolveOwned(other); if (owner === null) return undefined;
      g.sound(owner, "weapons/pkup.wav", "item"); g.host.emit({ kind: "message", player: other, text: (state.rune & 1) !== 0 ? "$qc_rune_resistance" : (state.rune & 2) !== 0 ? "$qc_rune_strength" : (state.rune & 4) !== 0 ? "$qc_rune_haste" : "$qc_rune_regeneration", center: true });
      return g.remove(e);
    } });
    game.named.register("rogue:rune_spawn", { action: (g, e) => { g.remove(e); for (const rune of [1, 2, 4, 8]) this.spawn(rune, this.spawnPoint()); return undefined; } });
    game.registerDamageSourceEffects("rogue:runes", {
      afterQuad: (request, amount) => ({ kind: "continue", amount: game.options.deathmatch !== 0 && request.attack.attacker !== null ? this.damage(request.attack.attacker, amount) : amount }),
      afterArmor: (request, take) => game.options.deathmatch !== 0 ? this.resistance(request.target, take) : take,
    });
    game.registerWeaponRules({ id: "rogue:runes", beforeFire: (_g, player) => this.attackSound(player.actor.id), attackDelay: (_g, player, delay) => {
      switch (player.weapon) {
        case "axe": case "shotgun": case "supershotgun": case "grenadelauncher": case "rocketlauncher": case "rogue:multi-grenade": case "rogue:multi-rocket": case "rogue:plasma": return this.attackDelay(player.actor.id, delay);
        default: return delay;
      }
    } });
  }
  private state(actor: ActorId): RuneState {
    const owner = this.game.host.actors.resolveOwned(actor); if (owner === null) throw new Error("Rune operation needs a live actor");
    const found = this.players.get(owner); if (found !== undefined) return found;
    const state = { rune: 0, notice: 0, earthNoise: 0, blackNoise: 0, hellNoise: 0, regeneration: 0 }; this.players.set(owner, state); return state;
  }
  private spawnPoint(): Vec3 {
    const game = this.game, world = game.world; if (world === null) throw new Error("Rune spawn requires worldspawn");
    const points = [...game.entities.values()].filter(entity => entity.classname === "info_player_deathmatch" && game.live(entity));
    if (points.length === 0) throw new Error("Rogue runes require an info_player_deathmatch spawn");
    const previous = game.entity(world.references.get("rogue:rune_spawn_spot") ?? null), index = previous === null ? -1 : points.indexOf(previous);
    const next = points[(index + 1) % points.length]; if (next === undefined) throw new Error("Missing rune spawn point");
    world.references.set("rogue:rune_spawn_spot", next.actor.id); return game.body(next).origin;
  }
  private velocity(): Vec3 { return { x: -300 + this.game.host.random() * 600, y: -300 + this.game.host.random() * 600, z: 300 }; }
  private spawn(rune: number, origin: Vec3): Q1Actor {
    const game = this.game, item = game.create("rogue_rune"); number(item, "rune", rune); item.movementFlags = 256; item.solid = "trigger"; item.movement = "toss";
    item.model = `progs/end${(rune & 1) !== 0 ? 1 : (rune & 2) !== 0 ? 2 : (rune & 4) !== 0 ? 3 : 4}.mdl`;
    game.setBody(item, { origin, velocity: this.velocity(), bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 56 } } });
    item.touch = game.named.touch(item, "rogue:rune_touch"); later(game, item, 120, "rogue:rune_respawn"); game.link(item); return item;
  }
  frame(actor: ActorId): undefined {
    const game = this.game, world = game.world;
    if (game.options.deathmatch !== 0 && (this.gamecfg() & 1) !== 0 && world !== null && world.number("rogue:runes_spawned") === 0) {
      number(world, "rogue:runes_spawned", 1); later(game, game.create("rogue_rune_spawner"), 0.1, "rogue:rune_spawn");
    }
    const state = this.state(actor); if ((state.rune & 8) === 0 || state.regeneration >= game.time || game.health(actor) >= 100) return undefined;
    const owner = game.host.actors.resolveOwned(actor); if (owner === null) return undefined;
    game.sound(owner, "runes/end4.wav", "item"); game.host.combat.setHealth(owner, Math.min(100, game.health(actor) + 5)); state.regeneration = game.time + 1; return undefined;
  }
  drop(actor: ActorId): undefined { const state = this.state(actor), body = this.game.host.bodies.read(actor); if (body === null) return undefined; for (const rune of [1, 2, 4, 8]) if ((state.rune & rune) !== 0) this.spawn(rune, body.origin); state.rune = 0; return undefined; }
  damage(actor: ActorId, amount: number): number { return (this.state(actor).rune & 2) !== 0 ? Math.fround(amount * 2) : amount; }
  resistance(actor: ActorId, amount: number): number {
    const state = this.state(actor); if ((state.rune & 1) === 0) return amount;
    if (state.earthNoise < this.game.time) { this.noise(actor, 1); state.earthNoise = this.game.time + 1; } return Math.fround(amount / 2);
  }
  attackSound(actor: ActorId): undefined { const state = this.state(actor); if ((state.rune & 2) !== 0 && state.blackNoise < this.game.time) { this.noise(actor, 2); state.blackNoise = this.game.time + 1; } return undefined; }
  attackDelay(actor: ActorId, delay: number): number {
    const state = this.state(actor); if ((state.rune & 4) === 0) return delay;
    if (state.hellNoise < this.game.time) { this.noise(actor, 3); state.hellNoise = this.game.time + 1; } return Math.fround(Math.fround(delay * 2) / 3);
  }
  hasRegeneration(actor: ActorId): boolean { return (this.state(actor).rune & 8) !== 0; }
  private noise(actor: ActorId, rune: number): undefined { const owner = this.game.host.actors.resolveOwned(actor); return owner === null ? undefined : this.game.sound(owner, `runes/end${rune}.wav`, "item"); }
}
