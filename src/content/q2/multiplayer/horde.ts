import type { ActorId } from "../../../contracts/identity.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q2Entity, Q2FoundationHost, Q2GameServices, Q2SpawnModule } from "../foundation/host.ts";

/** Wave roster by tier. Classnames are base Q2 monsters so horde runs on
 * every Q2 program/edition without mission-pack registrations. */
const WAVE_POOLS: readonly (readonly string[])[] = [
  ["monster_soldier", "monster_soldier", "monster_gunner"],
  ["monster_soldier", "monster_infantry", "monster_gunner", "monster_berserk"],
  ["monster_gunner", "monster_infantry", "monster_berserk", "monster_parasite", "monster_flyer"],
  ["monster_infantry", "monster_berserk", "monster_gladiator", "monster_hover", "monster_mutant"],
  ["monster_gladiator", "monster_tank", "monster_medic", "monster_brain", "monster_mutant"],
];
const TOTAL_WAVES = 15;
const POINT_CLASSNAMES: ReadonlySet<string> = new Set([
  "info_monster_start", "info_monster_start_flying", "info_monster_start_ranged", "info_monster_start_boss",
]);

/** The part of the Q2 game services the wave logic reads, so tests supply typed doubles instead of the full entity services. */
export interface Q2HordeGame {
  readonly entities: { values(): Iterable<Q2Entity> };
  readonly host: {
    readonly actors: Pick<Q2FoundationHost["actors"], "resolveSaved" | "referenceSaved">;
    readonly combat: { read(actor: ActorId): { readonly health: number } | null | undefined };
    trace(request: Parameters<Q2FoundationHost["trace"]>[0]): Pick<ReturnType<Q2FoundationHost["trace"]>, "startSolid" | "hit">;
    emit: Q2FoundationHost["emit"];
  };
  body(entity: Pick<Q2Entity, "actor">): { readonly origin: Vec3 };
  solid: Q2GameServices["solid"];
  schedule(entity: Q2Entity, delaySeconds: number, think: Q2HordeThink): undefined;
  spawn: Q2GameServices["spawn"];
}
type Q2HordeThink = (entity: Q2Entity, game: Q2HordeGame) => undefined;

const MONSTER_BOUNDS = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };
const MASK_MONSTERSOLID = 0x2020003;
/**
 * Unified Horde for Quake II sources: authored `horde_manager` maps spawn
 * escalating waves at `info_monster_start*` points on any Q2 program or
 * edition, including custom games. Mirrors the Q1 horde wave structure
 * (quota per wave, short intermission, fifteen waves).
 */
export class Q2Horde implements Q2SpawnModule {
  manager: Q2Entity | null = null;
  wave = 0;
  private points: Q2Entity[] = [];
  private spawnedThisWave = 0;
  private intermissionTicks = 0;
  private readonly waveMonsters = new Set<ActorId>();

  private readonly think: Q2HordeThink = (entity, game) => {
    this.tick(game);
    if (this.wave <= TOTAL_WAVES) game.schedule(entity, 0.5, this.think);
    return undefined;
  };
  readonly callbacks = { think: { "q2:horde/manager": this.think } };

  spawn(entity: Q2Entity, game: Q2HordeGame): boolean {
    if (entity.classname === "horde_manager") {
      this.manager = entity;
      game.solid(entity, "none");
      game.schedule(entity, 1, this.think);
      return true;
    }
    if (POINT_CLASSNAMES.has(entity.classname)) {
      this.points.push(entity);
      game.solid(entity, "none");
      return true;
    }
    return false;
  }

  capture(): { wave: number; spawned: number; intermission: number; monsters: SavedActorId[] } {
    return { wave: this.wave, spawned: this.spawnedThisWave, intermission: this.intermissionTicks,
      monsters: [...this.waveMonsters].map(id => ({ slot: id.slot, generation: id.generation })) };
  }

  restore(game: Q2HordeGame, saved: { wave: number; spawned: number; intermission: number; monsters: readonly SavedActorId[] }): undefined {
    this.wave = saved.wave; this.spawnedThisWave = saved.spawned; this.intermissionTicks = saved.intermission;
    this.waveMonsters.clear();
    for (const savedId of saved.monsters) {
      this.waveMonsters.add(game.host.actors.resolveSaved(savedId)?.id ?? game.host.actors.referenceSaved(savedId));
    }
    // Manager/point entities are re-spawned from the restored world state;
    // re-acquire them so waves resume after a save load.
    for (const entity of game.entities.values()) {
      if (entity.classname === "horde_manager") { this.manager = entity; game.schedule(entity, 1, this.think); }
      else if (POINT_CLASSNAMES.has(entity.classname) && !this.points.includes(entity)) this.points.push(entity);
    }
    return undefined;
  }

  private playersAlive(game: Q2HordeGame): boolean {
    for (const entity of game.entities.values())
      if (entity.classname === "player" && (game.host.combat.read(entity.actor.id)?.health ?? 0) > 0) return true;
    return false;
  }

  private aliveCount(game: Q2HordeGame): number {
    let alive = 0;
    for (const id of this.waveMonsters) {
      const health = game.host.combat.read(id)?.health;
      if (health === null || health === undefined || health <= 0) this.waveMonsters.delete(id); else alive++;
    }
    return alive;
  }

  private waveQuota(): number { return Math.min(4 + this.wave * 2, 24); }

  private tick(game: Q2HordeGame): void {
    if (this.manager === null || this.points.length === 0 || this.wave > TOTAL_WAVES) return;
    if (!this.playersAlive(game)) return;
    const alive = this.aliveCount(game);
    if (this.spawnedThisWave >= this.waveQuota()) {
      if (alive > 0) return;
      // Wave cleared: brief intermission, then advance.
      if (++this.intermissionTicks < 10) return;
      this.intermissionTicks = 0;
      this.wave++;
      this.spawnedThisWave = 0;
      if (this.wave > TOTAL_WAVES) game.host.emit({ kind: "print", actor: null, level: "high", text: "Horde complete: all waves cleared.\n" });
      return;
    }
    if (this.wave === 0) this.wave = 1;
    const fallbackPool = WAVE_POOLS[0];
    if (fallbackPool === undefined) return;
    const pool = WAVE_POOLS[Math.min(WAVE_POOLS.length - 1, Math.trunc((this.wave - 1) / 3))] ?? fallbackPool;
    const batch = Math.min(4, this.waveQuota() - this.spawnedThisWave, Math.max(0, 12 - alive));
    let spawned = 0;
    for (let index = 0; index < batch; index++) {
      const point = this.points[(this.spawnedThisWave + index) % this.points.length];
      const classname = pool[(this.spawnedThisWave + index) % pool.length];
      if (point === undefined || classname === undefined) continue;
      const origin = game.body(point).origin;
      const occupied = game.host.trace({ start: origin, end: origin, bounds: MONSTER_BOUNDS, ignore: point.actor.id, mask: MASK_MONSTERSOLID });
      if (occupied.startSolid || occupied.hit.kind === "actor") break;
      const monster = game.spawn({ classname, ordinal: -1, values: new Map([["origin", `${origin.x} ${origin.y} ${origin.z}`], ["angle", "0"]]) });
      this.waveMonsters.add(monster.actor.id);
      spawned++;
    }
    this.spawnedThisWave += spawned;
  }
}
