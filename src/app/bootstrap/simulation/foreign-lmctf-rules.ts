// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { TouchContact } from "../../../contracts/world.ts";
import type { Q1WeaponRules } from "../../../content/q1/foundation/extensions.ts";
import { parseEntities } from "../../../formats/q3-map/index.ts";
import {
  balancedTeam,
  entityOrigin,
  foreignMatchMode,
  mapFamily,
  zeroVelocity,
  type ForeignMatchHost,
  type ForeignMatchSpawns,
  type ForeignMatchStrategy,
} from "./foreign-match-host.ts";

type Team = 1 | 2;
interface FlagState {
  actor: OwnedActor | null;
  home: Vec3;
  carrier: ActorId | null;
  droppedAt: number | null;
}
interface RuneState {
  actor: OwnedActor | null;
  holder: ActorId | null;
}

const RUNE_KINDS = ["damage", "haste", "resist", "regen", "vampire"] as const;
const RUNE_MODELS: Readonly<Record<string, string>> = {
  damage: "models/ctf/damage/tris.md2",
  haste: "models/ctf/haste/tris.md2",
  resist: "models/ctf/resist/tris.md2",
  regen: "models/ctf/regen/tris.md2",
  vampire: "models/ctf/resist/tris.md2",
};

/**
 * Flag CTF over unified actors on any world whose own source does not already run it. Two modes
 * share the flag, team and capture rules: LMCTF (match provider q2:lmctf, Loki's Minions CTF with
 * auto-balanced teams, dropped-flag return and the five runes) and shared flag CTF (q1:ctf).
 * Haste reaches each arsenal through its own haste input (Q3 weapon environment, Q2 weapon input,
 * Q1 halved weapon delays); original QC/QVM binaries keep their own internal timing.
 */
export class FlagMatchRules implements ForeignMatchStrategy {
  #teams = new Map<ActorId, Team>();
  #flags = new Map<Team, FlagState>();
  #runes = new Map<string, RuneState>();
  #health = new Map<ActorId, number>();
  #regenAt = new Map<ActorId, number>();
  #spots: { readonly flags: ReadonlyMap<string, Vec3>; readonly health: readonly Vec3[] } | null = null;
  #prepared = false;

  constructor(
    private readonly host: ForeignMatchHost,
    private readonly spawns: ForeignMatchSpawns,
  ) {}

  get lmctf(): boolean {
    return foreignMatchMode(this.host, "q2:lmctf");
  }
  /** Shared flag-CTF on any world whose own source does not already run it. */
  get ctf(): boolean {
    return this.host.recipe.match.provider === "q1:ctf" && this.host.mode === "deathmatch" && this.host.sourceKind !== "q1";
  }
  get mode(): "lmctf" | "ctf" | null {
    return this.lmctf ? "lmctf" : this.ctf ? "ctf" : null;
  }

  flag(team: Team): FlagState | undefined {
    return this.#flags.get(team);
  }
  rune(kind: string): RuneState | undefined {
    return this.#runes.get(kind);
  }
  team(actor: ActorId): Team | undefined {
    return this.#teams.get(actor);
  }

  active(): boolean {
    return this.mode !== null;
  }
  /** Plain flag CTF carries no rune or token state beyond the flags, which a restart rebuilds. */
  blocksCheckpoint(): boolean {
    return this.lmctf;
  }
  release(actor: ActorId): void {
    this.#teams.delete(actor);
    this.#health.delete(actor);
    this.#regenAt.delete(actor);
  }

  runeHeld(actor: ActorId): string | null {
    for (const [kind, rune] of this.#runes) if (rune.holder?.equals(actor) === true) return kind;
    return null;
  }

  haste(actor: ActorId): boolean {
    return this.lmctf && this.runeHeld(actor) === "haste";
  }

  /** Native LMCTF runs the weapon cycle twice per frame under haste; the Q1
   * arsenal expresses the same doubling as halved attack/frame delays. */
  q1HasteRules(): Q1WeaponRules {
    return {
      id: "q2:lmctf/haste",
      attackDelay: (_game, player, delay) => (this.haste(player.actor.id) ? delay / 2 : delay),
      frameDelay: (_game, player, delay) => (this.haste(player.actor.id) ? delay / 2 : delay),
    };
  }

  /** Damage runes: Damage multiplies outgoing by 1.75, Resist divides incoming by 1.75, Vampire returns half the health damage dealt. */
  registerCombat(): void {
    if (!this.lmctf) return;
    const { combat, actors } = this.host;
    combat.damageOperation.register({
      provider: "q2:lmctf",
      id: "q2:lmctf/runes",
      order: 0,
      kind: "transform",
      transform: request => {
        let amount = request.amount;
        const attacker = request.attack.attacker ?? null;
        if (attacker !== null && this.runeHeld(attacker) === "damage") amount = Math.trunc(Math.fround(amount * 1.75));
        if (this.runeHeld(request.target) === "resist") amount = Math.trunc(Math.fround(amount / 1.75));
        if (attacker !== null && !attacker.equals(request.target) && amount > 0 && this.runeHeld(attacker) === "vampire") {
          const owned = actors.resolveOwned(attacker),
            health = combat.read(attacker)?.health;
          if (owned !== null && health !== undefined) combat.setHealth(owned, Math.min(250, health + (amount >> 1)));
        }
        return amount === request.amount ? request : { ...request, amount };
      },
    });
  }

  /** Flag bases and rune spots come from the retained entity lump, like Tag spawns. */
  #origins(): { readonly flags: ReadonlyMap<string, Vec3>; readonly health: readonly Vec3[] } {
    if (this.#spots !== null) return this.#spots;
    const flags = new Map<string, Vec3>(),
      health: Vec3[] = [];
    for (const entity of parseEntities(this.host.entityLump)) {
      const classname = entity.get("classname") ?? "";
      const origin = entityOrigin(entity);
      if (origin === null) continue;
      if (
        (classname === "info_flag_red" || classname === "info_flag_blue" || classname === "item_flag_team1" || classname === "item_flag_team2") &&
        !flags.has(classname)
      )
        flags.set(classname, origin);
      else if (classname.startsWith("item_health")) health.push(origin);
    }
    this.#spots = { flags, health };
    return this.#spots;
  }

  #flagHome(team: Team): Vec3 | null {
    const authored = this.#origins().flags.get(
      this.mode === "ctf" ? (team === 1 ? "item_flag_team1" : "item_flag_team2") : team === 1 ? "info_flag_red" : "info_flag_blue",
    );
    if (authored !== undefined) return authored;
    // Native LMCTF synthesizes bases from the deathmatch spawns farthest apart.
    const spots = this.spawns.origins();
    const first = spots[0];
    if (first === undefined) return null;
    let farthest = first,
      farthestDistance = -1;
    for (const spot of spots) {
      const distance = Math.hypot(spot.x - first.x, spot.y - first.y, spot.z - first.z);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = spot;
      }
    }
    if (team === 1) return farthest;
    let other = first,
      otherDistance = -1;
    for (const spot of spots) {
      const distance = Math.hypot(spot.x - farthest.x, spot.y - farthest.y, spot.z - farthest.z);
      if (distance > otherDistance) {
        otherDistance = distance;
        other = spot;
      }
    }
    return other;
  }

  #spawnFlag(team: Team, origin: Vec3): void {
    const state = this.#flags.get(team);
    if (state === undefined) return;
    const host = this.host,
      ctf = this.mode === "ctf";
    const actor = host.actors.allocate(
      host.recipe.match.provider,
      ctf ? (team === 1 ? "q1:item_flag_team1" : "q1:item_flag_team2") : team === 1 ? "q2:item_flag_team1" : "q2:item_flag_team2",
    );
    const bounds = ctf ? { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 74 } } : { min: { x: -15, y: -15, z: -15 }, max: { x: 15, y: 15, z: 33 } };
    host.physics.bodies.create(actor, {
      origin: { x: origin.x, y: origin.y, z: origin.z },
      velocity: zeroVelocity,
      angles: zeroVelocity,
      bounds,
      ground: null,
    });
    host.physics.setSolid(actor, "trigger", null, mapFamily(host));
    host.callbacks.bind(actor, { think: null, touch: contact => this.#flagTouched(team, contact), use: null, pain: null, die: null });
    host.bindModel(
      actor,
      ctf
        ? { content: host.recipe.match.content, path: "progs/flag.mdl", family: "q1", skin: team - 1, effects: team === 1 ? 32 : 16 }
        : { content: host.recipe.match.content, path: team === 1 ? "players/male/flag1.md2" : "players/male/flag2.md2" },
    );
    host.physics.bodies.link(actor);
    state.actor = actor;
  }

  #flagTouched(team: Team, contact: TouchContact): undefined {
    const host = this.host,
      state = this.#flags.get(team);
    if (state === undefined || state.actor === null || !contact.self.id.equals(state.actor.id)) return undefined;
    const player = contact.other;
    if (!host.isPlayer(player) || (host.combat.read(player)?.health ?? 0) <= 0) return undefined;
    const playerTeam = this.#teams.get(player);
    if (playerTeam === undefined) return undefined;
    if (playerTeam === team) {
      const carried = this.#flags.get(team === 1 ? 2 : 1);
      if (carried?.carrier?.equals(player) === true) {
        // Capture: carrier scores 5, every teammate scores the 10-point team bonus.
        host.addScore(player, 5);
        for (const [ally, allyTeam] of this.#teams) if (allyTeam === team) host.addScore(ally, 10);
        this.#takeFlag(player);
        carried.carrier = null;
        carried.droppedAt = null;
        this.#spawnFlag(team === 1 ? 2 : 1, carried.home);
      } else if (state.droppedAt !== null) {
        // Own dropped flag returns home on touch.
        host.actors.release(state.actor);
        state.actor = null;
        state.droppedAt = null;
        this.#spawnFlag(team, state.home);
        host.addScore(player, 1);
      }
      return undefined;
    }
    // Enemy pickup.
    host.actors.release(state.actor);
    state.actor = null;
    state.carrier = player;
    state.droppedAt = null;
    const owned = host.actors.resolveOwned(player);
    if (owned !== null && this.mode === "lmctf") host.inventory.give(owned, "q2:flag", 1);
    return undefined;
  }

  #takeFlag(actor: ActorId): void {
    const host = this.host,
      owned = host.actors.resolveOwned(actor);
    if (owned !== null && this.mode === "lmctf") host.inventory.consume(owned, "q2:flag", host.inventory.count(actor, "q2:flag"));
  }

  #spawnRune(kind: string, origin: Vec3): void {
    const state = this.#runes.get(kind);
    if (state === undefined) return;
    const host = this.host;
    const actor = host.actors.allocate(host.recipe.match.provider, `q2:${kind}_rune`);
    const bounds = { min: { x: -15, y: -15, z: -15 }, max: { x: 15, y: 15, z: 15 } };
    host.physics.bodies.create(actor, {
      origin: { x: origin.x, y: origin.y, z: origin.z + 16 },
      velocity: zeroVelocity,
      angles: zeroVelocity,
      bounds,
      ground: null,
    });
    host.physics.setSolid(actor, "trigger", null, mapFamily(host));
    host.callbacks.bind(actor, { think: null, touch: contact => this.#runeTouched(kind, contact), use: null, pain: null, die: null });
    host.bindModel(actor, { content: host.recipe.match.content, path: RUNE_MODELS[kind] ?? "models/ctf/resist/tris.md2" });
    host.physics.bodies.link(actor);
    state.actor = actor;
  }

  #runeTouched(kind: string, contact: TouchContact): undefined {
    const host = this.host,
      state = this.#runes.get(kind);
    if (state === undefined || state.actor === null || !contact.self.id.equals(state.actor.id)) return undefined;
    const player = contact.other;
    if (!host.isPlayer(player) || (host.combat.read(player)?.health ?? 0) <= 0 || this.runeHeld(player) !== null) return undefined;
    host.actors.release(state.actor);
    state.actor = null;
    state.holder = player;
    const owned = host.actors.resolveOwned(player);
    if (owned !== null) host.inventory.give(owned, `q2:${kind}_rune`, 1);
    return undefined;
  }

  #prepare(): void {
    this.#prepared = true;
    for (const team of [1, 2] satisfies readonly Team[]) {
      const home = this.#flagHome(team);
      if (home !== null) {
        this.#flags.set(team, { actor: null, home, carrier: null, droppedAt: null });
        this.#spawnFlag(team, home);
      }
    }
    if (this.mode !== "lmctf") return;
    // Runes scatter over health spots by farthest-point sampling (native
    // Rune_Spawn uses health edicts); deathmatch spawns are the fallback.
    const spots = [...this.#origins().health];
    const pool = spots.length !== 0 ? spots : [...this.spawns.origins()];
    const chosen: Vec3[] = [];
    for (const kind of RUNE_KINDS) {
      this.#runes.set(kind, { actor: null, holder: null });
      let best: Vec3 | null = null,
        bestDistance = -1;
      for (const spot of pool) {
        if (chosen.some(other => other.x === spot.x && other.y === spot.y && other.z === spot.z)) continue;
        let nearest = Infinity;
        for (const other of chosen) nearest = Math.min(nearest, Math.hypot(spot.x - other.x, spot.y - other.y, spot.z - other.z));
        if (nearest > bestDistance) {
          bestDistance = nearest;
          best = spot;
        }
      }
      if (best !== null) {
        chosen.push(best);
        this.#spawnRune(kind, best);
      }
    }
  }

  tick(): void {
    if (this.mode === null) return;
    if (!this.#prepared) this.#prepare();
    const host = this.host,
      players = host.players(),
      now = host.timeSeconds;
    // Auto-balanced team assignment; the shared combat team drives friendly
    // fire and team presentation on the foreign world.
    for (const actor of players) {
      if (this.#teams.has(actor)) continue;
      const team = balancedTeam(this.#teams);
      this.#teams.set(actor, team);
      const owned = host.actors.resolveOwned(actor);
      if (owned !== null) host.combat.setTraits(owned, { team: team === 1 ? "red" : "blue" });
    }
    for (const [team, flag] of this.#flags) {
      if (flag.droppedAt !== null && flag.actor !== null && now - flag.droppedAt >= 30) {
        host.actors.release(flag.actor);
        flag.actor = null;
        flag.droppedAt = null;
        this.#spawnFlag(team, flag.home);
      }
      const carrier = flag.carrier;
      if (carrier !== null && !players.some(actor => actor.equals(carrier))) {
        this.#takeFlag(carrier);
        flag.carrier = null;
        this.#spawnFlag(team, flag.home);
      }
    }
    for (const [kind, rune] of this.#runes) {
      const holder = rune.holder;
      if (holder !== null && !players.some(actor => actor.equals(holder))) {
        const owned = host.actors.resolveOwned(holder);
        if (owned !== null) host.inventory.consume(owned, `q2:${kind}_rune`, 1);
        rune.holder = null;
        const spot = this.spawns.farthest();
        if (spot !== null) this.#spawnRune(kind, spot);
      }
    }
    for (const actor of players) {
      // Regen rune: native heart-rate cadence heals toward max health + 25.
      if (this.runeHeld(actor) === "regen") {
        const combat = host.combat.read(actor),
          owned = host.actors.resolveOwned(actor);
        if (combat !== null && owned !== null && combat.health > 0) {
          const heartRate = Math.min(25, Math.max(5, Math.trunc(combat.health / 5))),
            frame = Math.round(now * 10);
          if (frame >= (this.#regenAt.get(actor) ?? 0) + heartRate) {
            this.#regenAt.set(actor, frame);
            if (combat.health < 125) host.combat.setHealth(owned, Math.min(125, Math.trunc(combat.health + Math.fround(heartRate / 3))));
          }
        }
      }
      const health = host.combat.read(actor)?.health ?? 0,
        previous = this.#health.get(actor);
      this.#health.set(actor, health);
      if (previous === undefined || previous <= 0 || health > 0) continue;
      // Death drops the carried flag and held rune at the corpse.
      const origin = host.physics.bodies.read(actor)?.origin;
      for (const [team, flag] of this.#flags) {
        if (flag.carrier?.equals(actor) !== true) continue;
        this.#takeFlag(actor);
        flag.carrier = null;
        flag.droppedAt = now;
        if (origin !== undefined && origin !== null) this.#spawnFlag(team, origin);
        else this.#spawnFlag(team, flag.home);
      }
      for (const [kind, rune] of this.#runes) {
        if (rune.holder?.equals(actor) !== true) continue;
        const owned = host.actors.resolveOwned(actor);
        if (owned !== null) host.inventory.consume(owned, `q2:${kind}_rune`, 1);
        rune.holder = null;
        if (origin !== undefined && origin !== null) this.#spawnRune(kind, origin);
      }
    }
  }
}
