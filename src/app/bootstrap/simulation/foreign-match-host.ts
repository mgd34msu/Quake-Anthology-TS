// SPDX-License-Identifier: GPL-2.0-or-later
import type { ExecutableRecipe, ContentId } from "../../../contracts/content.ts";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { parseEntities } from "../../../formats/q3-map/index.ts";
import type { SessionActorRegistry, ActorCallbackTable } from "../../../world/actors/index.ts";
import type { GameplayAuthority, SharedInventoryTable } from "../../../world/gameplay/index.ts";
import type { SharedSceneQueries } from "../../../world/collision/index.ts";
import type { SimulationBotServices } from "./bots.ts";
import type { SharedPhysics } from "./physics.ts";
import { providerFamily } from "./players.ts";

export const zeroVelocity: Vec3 = { x: 0, y: 0, z: 0 };

/** Presentation of a match-owned actor that has no source entity of its own. */
export interface ForeignMatchModel {
  readonly content: ContentId;
  readonly path: string;
  readonly family?: "q1" | "q2";
  readonly skin?: number;
  readonly effects?: number;
}

/** The simulation services the foreign match rules run over; every one is the simulation's own store. */
export interface ForeignMatchHost {
  readonly recipe: ExecutableRecipe;
  readonly actors: SessionActorRegistry;
  readonly callbacks: ActorCallbackTable;
  readonly physics: SharedPhysics;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
  readonly scene: SharedSceneQueries;
  readonly botServices: SimulationBotServices;
  readonly mode: "singleplayer" | "coop" | "deathmatch";
  readonly maxClients: number;
  readonly entityLump: string;
  readonly timeSeconds: number;
  readonly sourceKind: string;
  players(): readonly ActorId[];
  isPlayer(actor: ActorId): boolean;
  lastAttacker(actor: OwnedActor): ActorId | null;
  addScore(actor: ActorId, amount: number): void;
  grantQuad(actor: ActorId): void;
  bindModel(actor: OwnedActor, model: ForeignMatchModel): void;
  /** Q3 native health and PERS_KILLED for a player, or null when the source is not Q3. */
  q3Native(actor: ActorId): { readonly health: number; readonly deaths: number } | null;
  disconnectPlayer(actor: ActorId): void;
}

/** One match rule set. Its state is released per actor and blocks save and same-map restart while it runs. */
export interface ForeignMatchStrategy {
  active(): boolean;
  /** True while the rules hold state a saved game or source restart could not carry. */
  blocksCheckpoint(): boolean;
  tick(): void;
  release(actor: ActorId): void;
}

/** Whether the recipe's match provider names a foreign-world mode: deathmatch on any family other than the rule's native Q2. */
export function foreignMatchMode(host: ForeignMatchHost, provider: string): boolean {
  return host.recipe.match.provider === provider && host.mode === "deathmatch" && providerFamily(host.recipe.map.entities.provider) !== "q2";
}

export function mapFamily(host: ForeignMatchHost): ReturnType<typeof providerFamily> {
  return providerFamily(host.recipe.map.entities.provider);
}

/** The finite `origin` of an entity-lump entry, or null when it has none. */
export function entityOrigin(entity: { get(key: string): string | undefined }): Vec3 | null {
  const parts = (entity.get("origin") ?? "").split(/\s+/).map(Number);
  const [x, y, z] = parts;
  if (parts.length !== 3 || x === undefined || y === undefined || z === undefined || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
    return null;
  return { x, y, z };
}

/** Auto-balance: the next player joins red unless blue is short. */
export function balancedTeam(teams: ReadonlyMap<ActorId, 1 | 2>): 1 | 2 {
  let red = 0,
    blue = 0;
  for (const team of teams.values())
    if (team === 1) red++;
    else blue++;
  return blue < red ? 2 : 1;
}

/** Deathmatch spawn origins come from the retained map entity lump: spawn entities are not shared actors in every family's world. */
export class ForeignMatchSpawns {
  #origins: readonly Vec3[] | null = null;

  constructor(private readonly host: ForeignMatchHost) {}

  origins(): readonly Vec3[] {
    if (this.#origins !== null) return this.#origins;
    const origins: Vec3[] = [],
      fallback: Vec3[] = [];
    for (const entity of parseEntities(this.host.entityLump)) {
      const classname = entity.get("classname");
      if (classname !== "info_player_deathmatch" && classname !== "info_player_start") continue;
      const origin = entityOrigin(entity);
      if (origin !== null) (classname === "info_player_deathmatch" ? origins : fallback).push(origin);
    }
    this.#origins = origins.length !== 0 ? origins : fallback;
    return this.#origins;
  }

  /** The spawn farthest from every player, lifted to stand clear of the floor. */
  farthest(): Vec3 | null {
    const playerBodies = this.host.players().flatMap(actor => {
      const body = this.host.physics.bodies.read(actor);
      return body === null ? [] : [body.origin];
    });
    let best: Vec3 | null = null,
      bestDistance = -1;
    for (const spot of this.origins()) {
      let nearest = Infinity;
      for (const origin of playerBodies) nearest = Math.min(nearest, Math.hypot(spot.x - origin.x, spot.y - origin.y, spot.z - origin.z));
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = spot;
      }
    }
    return best === null ? null : { x: best.x, y: best.y, z: best.z + 24 };
  }
}
