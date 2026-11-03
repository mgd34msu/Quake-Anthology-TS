// SPDX-License-Identifier: GPL-2.0-or-later
import type { ExecutableRecipe, MonsterDefinitionReference } from "../../../contracts/content.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { AuthoredMonster } from "../../../content/monsters/authored.ts";
import { setMonsterRoute } from "../../../content/q1/base/monsters.ts";
import type { SessionActorRegistry } from "../../../world/actors/index.ts";
import type { SharedSceneQueries } from "../../../world/collision/index.ts";
import type { ActorExecution } from "./actor-execution.ts";
import type { SharedPhysics } from "./physics.ts";
import { providerTiming } from "./players.ts";
import type { SelectedMonsterBehavior, SelectedMonsterSource } from "./monster-runtime.ts";

/** What a creature source family contributes to monster admission: its trace rules, medium contents and route control. */
interface MonsterSourceStrategy {
  tracePolicy():
    | { readonly kind: "q1"; readonly move: "normal"; readonly hull: null }
    | { readonly kind: "q2"; readonly contentsMask: number; readonly leafContents: "merged" };
  /** Liquid class bits of the contents at an origin: Q2 CONTENTS_WATER/SLIME/LAVA mask, or the Q1 equivalent mapped to the same bits. */
  medium(origin: Vec3): number;
  setRoute(actor: ActorId, goal: ActorId | null, pauseUntil: number): undefined;
}

function monsterSourceStrategy(source: SelectedMonsterSource): MonsterSourceStrategy {
  if (source.kind === "q2")
    return {
      tracePolicy: () => ({ kind: "q2", contentsMask: 1, leafContents: "merged" }),
      medium: origin => source.game.host.pointContents(origin) & 56,
      setRoute: (actor, goal, pauseUntil) => source.monsters.setRoute(actor, goal, pauseUntil),
    };
  return {
    tracePolicy: () => ({ kind: "q1", move: "normal", hull: null }),
    medium: origin => {
      const contents = source.game.host.contents(origin);
      return contents === "water" ? 32 : contents === "slime" ? 16 : contents === "lava" ? 8 : 0;
    },
    setRoute: (actor, goal, pauseUntil) => {
      const entity = source.game.entity(actor);
      if (entity === null) throw new Error("Selected Q1 route actor has no source continuation");
      return setMonsterRoute(source.game, entity, goal, pauseUntil);
    },
  };
}

/** What a running creature's execution contributes: continuation after dormancy and its enemy links. */
interface MonsterExecutionStrategy {
  resume(activator: ActorId | null): void;
  enemy(): ActorId | null;
  oldEnemy(): ActorId | null;
}

function monsterExecutionStrategy(actor: ActorId, entry: ActorExecution | undefined, isLive: (actor: ActorId) => boolean): MonsterExecutionStrategy {
  if (entry?.kind === "q1")
    return {
      resume: activator => {
        const start = entry.entity.think;
        entry.services.cancel(entry.entity);
        start?.();
        if (isLive(actor) && activator !== null) entry.entity.use?.(null, activator);
      },
      enemy: () => entry.entity.monster?.enemy ?? null,
      oldEnemy: () => entry.entity.monster?.oldEnemy ?? null,
    };
  if (entry?.kind === "q2")
    return {
      resume: activator => {
        const start = entry.entity.think;
        entry.services.cancel(entry.entity);
        start?.(entry.entity, entry.services);
        if (isLive(actor) && activator !== null) entry.entity.use?.(entry.entity, entry.services, null, activator);
      },
      enemy: () => entry.entity.enemy,
      oldEnemy: () => entry.readMonster()?.oldEnemy ?? null,
    };
  return {
    resume: () => {
      throw new Error("Activated monster has no creature source continuation");
    },
    enemy: () => null,
    oldEnemy: () => null,
  };
}

export interface MonsterAdmissionServices {
  readonly recipe: ExecutableRecipe;
  readonly actors: SessionActorRegistry;
  readonly physics: SharedPhysics;
  readonly scene: SharedSceneQueries;
  execution(actor: ActorId): ActorExecution | undefined;
  sourceFor(definition: MonsterDefinitionReference): SelectedMonsterSource;
  definitionOf(actor: ActorId): MonsterDefinitionReference | undefined;
}

/** The creature-source half of selected-monster admission, shared by every map program that hosts it. */
export class MonsterAdmission implements Pick<SelectedMonsterBehavior, "enemy" | "oldEnemy" | "setRoute" | "resume"> {
  constructor(private readonly services: MonsterAdmissionServices) {}

  strategy(definition: MonsterDefinitionReference): MonsterSourceStrategy & { readonly source: SelectedMonsterSource } {
    const source = this.services.sourceFor(definition);
    return { ...monsterSourceStrategy(source), source };
  }

  /** The shared body of a started monster and whether it begins embedded in solid world. */
  probe(
    entry: AuthoredMonster,
    definition: MonsterDefinitionReference,
  ): {
    readonly body: NonNullable<ReturnType<SharedPhysics["bodies"]["read"]>>;
    readonly strategy: MonsterSourceStrategy & { readonly source: SelectedMonsterSource };
    readonly solid: boolean;
  } {
    const { recipe, scene, physics } = this.services;
    const body = physics.bodies.read(entry.actor.id);
    if (body === null) throw new Error("Started selected monster has no shared body");
    const strategy = this.strategy(definition);
    const trace = scene.geometryTrace({
      start: body.origin,
      end: body.origin,
      shape: { kind: "box", bounds: body.bounds },
      target: { kind: "world" },
      passActor: entry.actor.id,
      numeric: providerTiming(recipe, definition.source.provider).numeric,
      policy: strategy.tracePolicy(),
    });
    return { body, strategy, solid: trace.startSolid || trace.allSolid };
  }

  /** The query a relocation search runs with for this monster's source. */
  query(entry: AuthoredMonster, definition: MonsterDefinitionReference, strategy: MonsterSourceStrategy) {
    return {
      target: { kind: "world" as const },
      passActor: entry.actor.id,
      numeric: providerTiming(this.services.recipe, definition.source.provider).numeric,
      policy: strategy.tracePolicy(),
    };
  }

  obstructed(entry: AuthoredMonster, definition: MonsterDefinitionReference): Error {
    return new Error(
      `Selected monster placement obstructed in ${this.services.recipe.map.geometry.requestedPath}: source ${entry.sourceOrdinal} ${entry.classname} -> ${definition.source.provider}/${definition.classname}`,
    );
  }

  resume = (actor: ActorId, activator: ActorId | null): undefined => {
    monsterExecutionStrategy(actor, this.services.execution(actor), candidate => this.services.actors.isLive(candidate)).resume(activator);
    return undefined;
  };

  enemy = (actor: ActorId): ActorId | null => monsterExecutionStrategy(actor, this.services.execution(actor), () => false).enemy();
  oldEnemy = (actor: ActorId): ActorId | null => monsterExecutionStrategy(actor, this.services.execution(actor), () => false).oldEnemy();

  setRoute = (actor: ActorId, goal: ActorId | null, pauseUntil: number): undefined => {
    const definition = this.services.definitionOf(actor);
    if (definition === undefined) throw new Error("Selected route actor has no creature definition");
    return this.strategy(definition).setRoute(actor, goal, pauseUntil);
  };
}
