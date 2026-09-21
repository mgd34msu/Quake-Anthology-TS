import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { NumericOperations } from "../../../contracts/numeric.ts";
import { dropQ1Punch } from "../../../content/q1/foundation/entity-services.ts";
import { savedActorId, readSavedActor } from "../../../persistence/save-image.ts";
import { readVector } from "../../../persistence/shared.ts";
import type { SaveReader } from "../../../persistence/value.ts";
import type { SessionActorRegistry } from "../../../world/actors/index.ts";

export interface Q1PunchOwner { read(): Vec3; write(angles: Vec3): void; }
const zero: Vec3 = { x: 0, y: 0, z: 0 };

/** One original-style Q1 field per player. Bound fields remain saved by their source. */
export class Q1PlayerPunch {
  private readonly local = new Map<OwnedActor, Vec3>();
  constructor(private readonly actors: SessionActorRegistry, private readonly source: (actor: ActorId) => Q1PunchOwner | null) {
    actors.onRelease(actor => { this.local.delete(actor); return undefined; });
  }
  private owner(actor: ActorId): { actor: OwnedActor; source: Q1PunchOwner | null } {
    const current = this.actors.resolveOwned(actor);
    if (current === null) throw new Error("Q1 punch references a retired actor");
    const source = this.source(current.id), pending = this.local.get(current);
    if (source !== null && pending !== undefined) { source.write(pending); this.local.delete(current); }
    return { actor: current, source };
  }
  read(actor: ActorId): Vec3 {
    const owner = this.owner(actor); return owner.source?.read() ?? this.local.get(owner.actor) ?? zero;
  }
  write(actor: ActorId, value: Vec3): undefined {
    const angles = { x: Math.fround(value.x), y: Math.fround(value.y), z: Math.fround(value.z) }, owner = this.owner(actor);
    if (owner.source !== null) owner.source.write(angles); else this.local.set(owner.actor, angles);
    return undefined;
  }
  advance(actor: ActorId, elapsed: number, numeric: NumericOperations): Vec3 {
    const current = this.read(actor);
    if (current.x === 0 && current.y === 0 && current.z === 0) return current;
    const punch = dropQ1Punch(current, elapsed, numeric); this.write(actor, punch); return punch;
  }
  capture() {
    for (const actor of [...this.local.keys()]) this.owner(actor.id);
    return [...this.local].map(([actor, angles]) => ({ actor: savedActorId(actor.id), angles }));
  }
  restore(reader: SaveReader): void {
    this.local.clear(); if (reader.value === undefined) return;
    reader.list(entry => {
      const actor = this.actors.resolveSaved(readSavedActor(entry.field("actor")));
      if (actor === null || this.local.has(actor) || this.source(actor.id) !== null) return entry.fail("Saved Q1 punch has no unique fallback owner");
      this.local.set(actor, readVector(entry.field("angles")));
    });
  }
}
