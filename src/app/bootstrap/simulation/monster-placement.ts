import type { Q2Entity, Q2GameServices, Q2SpawnFields } from "../../../content/q2/foundation/host.ts";
import type { Q2MonsterDefinition } from "../../../content/q2/foundation/monsters/types.ts";
import { add, integerField, vectorField } from "../../../content/q2/foundation/fields.ts";
import { monsterSolidMask } from "../../../content/q2/foundation/monsters/ai.ts";
import type { MonsterDefinitionReference, ResolvedMap } from "../../../contracts/content.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { BodyState } from "../../../contracts/world.ts";
import type { Q1Entity } from "../../../formats/q1-map/index.ts";
import { q1EntityValue } from "../../../formats/q1-map/index.ts";
import { parseVector } from "../../../content/q1/foundation/entity.ts";
import type { Q1Actor } from "../../../content/q1/foundation/entity.ts";
import { baseSpecies } from "../../../content/q1/base/species.ts";

function sameVector(left: Vec3, right: Vec3): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

/** Native Q1 flying startup accepts its authored overlap through SV_movestep's fraction check. */
export function preservesAuthoredQ1Placement(input: {
  readonly map: ResolvedMap;
  readonly authored: Q1Entity | undefined;
  readonly definition: MonsterDefinitionReference;
  readonly entity: Q1Actor;
  readonly body: BodyState;
}): boolean {
  const { map, authored, definition, entity, body } = input;
  if (map.entities.provider !== "q1:official" || (definition.source.provider !== "q1:monsters/classic/id1" && definition.source.provider !== "q1:monsters/rerelease/id1")
    || map.entities.content !== definition.source.content || map.geometryContent !== definition.source.content || authored === undefined) return false;
  const classname = q1EntityValue(authored, "classname");
  if (classname !== definition.classname || entity.classname !== classname) return false;
  const species = baseSpecies.find(species => species.classnames.includes(classname));
  if (species === undefined || species.movement !== "fly" || entity.movement !== "step" || (entity.movementFlags & 3) !== 1
    || entity.model !== `progs/${species.model}.mdl`) return false;
  return sameVector(body.bounds.min, species.bounds.min) && sameVector(body.bounds.max, species.bounds.max)
    && sameVector(body.origin, parseVector(q1EntityValue(authored, "origin") ?? ""));
}

export function preservesAuthoredQ2Placement(input: {
  readonly map: ResolvedMap;
  readonly authored: Q2SpawnFields | undefined;
  readonly definition: MonsterDefinitionReference;
  readonly native: Q2MonsterDefinition | null;
  readonly game: Q2GameServices;
  readonly entity: Q2Entity;
  readonly body: BodyState;
}): boolean {
  const { map, authored, definition, native, game, entity, body } = input;
  if (map.entities.provider !== "q2:official" || definition.source.provider !== "q2:monsters/classic/baseq2"
    || map.entities.content !== definition.source.content || map.geometryContent !== definition.source.content
    || game.options.edition !== "classic" || authored === undefined || native === null
    || authored.classname !== definition.classname || entity.classname !== authored.classname) return false;
  if ((native.locomotion ?? "walk") !== "walk" || entity.motion !== "step" || (entity.flags & 3) !== 0
    || entity.model !== native.model || entity.scale !== 1 || entity.gravity !== 1 || !sameVector(entity.gravityVector, { x: 0, y: 0, z: -1 })
    || (integerField(authored, "spawnflags") & ~0x1f00) !== entity.spawnflags || (entity.spawnflags & 2) !== 0
    || !sameVector(body.bounds.min, native.bounds.min) || !sameVector(body.bounds.max, native.bounds.max)) return false;
  const start = add(vectorField(authored, "origin"), { x: 0, y: 0, z: 1 });
  const floor = game.host.trace({ start, end: add(start, { x: 0, y: 0, z: -256 }), bounds: body.bounds,
    ignore: entity.actor.id, mask: monsterSolidMask(game) });
  return floor.fraction !== 1 && !floor.allSolid && floor.hit.kind === "world" && sameVector(body.origin, floor.end);
}
