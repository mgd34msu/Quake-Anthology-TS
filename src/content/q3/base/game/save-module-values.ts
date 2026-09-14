import type { CvarSnapshot } from "../../../../core/cvars/index.ts";
import { SaveReader } from "../../../../persistence/value.ts";
import type { EntityPool } from "./entities.ts";
import type { GameEntity } from "./state.ts";

export function readModuleEntity(reader: SaveReader, pool: EntityPool): GameEntity {
  const slot = reader.integer(0);
  if (slot > 1023) return reader.fail("module source entity slot exceeds table extent");
  const entity = pool.get(slot);
  if (entity === undefined) return reader.fail("module references an absent source entity slot");
  return entity;
}

export function captureModuleCvar(value: CvarSnapshot) {
  return { name: value.name, value: value.value, resetValue: value.resetValue, latchedValue: value.latchedValue ?? null,
    flags: value.flags, modified: value.modified, modificationCount: value.modificationCount,
    numericValue: value.numericValue, integerValue: value.integerValue };
}

export function readModuleCvar(reader: SaveReader): CvarSnapshot {
  return { name: reader.field("name").string(), value: reader.field("value").string(), resetValue: reader.field("resetValue").string(),
    latchedValue: reader.field("latchedValue").nullable(value => value.string()) ?? undefined,
    flags: reader.field("flags").integer(), modified: reader.field("modified").boolean(), modificationCount: reader.field("modificationCount").integer(),
    numericValue: reader.field("numericValue").number(), integerValue: reader.field("integerValue").integer() };
}
