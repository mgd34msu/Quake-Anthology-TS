import type { ActorId } from "../../../../contracts/identity.ts";
import type { ActorTraceResult } from "../world.ts";
import type { EntityPool } from "./entities.ts";
import type { GameEntity } from "./state.ts";

/** Native numbers are a projection; support identity belongs to the shared body. */
export function groundNumber(ground: ActorId | null, entities: EntityPool): number {
  return ground === null ? 1023 : entities.options.records.nativeByActor(ground)?.slot ?? 1023;
}

export function writeGround(entity: GameEntity, ground: ActorId | null, entities: EntityPool): void {
  entity.binding.body.write({ ...entity.binding.body.read(), ground });
  entity.s.groundEntityNum = groundNumber(ground, entities);
}

export function traceGround(entity: GameEntity, hit: ActorTraceResult["hit"], entities: EntityPool): void {
  writeGround(entity, hit.kind === "actor" ? hit.actor : hit.kind === "world" ? entities.at(1022).actor.id : null, entities);
}

/** -1 retains G_RunItem's delayed lost-support continuation, not an actor identity. */
export function loseGround(entity: GameEntity): void {
  entity.binding.body.write({ ...entity.binding.body.read(), ground: null });
  entity.s.groundEntityNum = -1;
}

export function rides(entity: GameEntity, support: GameEntity): boolean {
  return entity.binding.body.read().ground?.equals(support.actor.id) === true;
}
