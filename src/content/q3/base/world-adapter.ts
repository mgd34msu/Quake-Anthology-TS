import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { TraceQuery } from "../../../contracts/scene.ts";
import { Q3_BINARY32_PROFILE } from "../../../core/numeric.ts";
import type { SharedBodyTable } from "../../../world/actors/body.ts";
import type { ActorCollision, SharedSceneQueries } from "../../../world/collision/index.ts";
import { traceActorBody } from "../../../world/collision/body.ts";
import type { Q3EntityRecords } from "./records.ts";
import type { GameEntity } from "./game/state.ts";
import type { ActorSpatialQueries, ActorTraceQuery, ActorTraceResult, LinkState, ServerTraceQuery, ServerTraceResult, ServerWorld } from "./world.ts";

export interface Q3WorldAdapterHost {
  readonly queries: SharedSceneQueries;
  readonly bodies: SharedBodyTable;
  /** Update collision metadata before the shared body owner's link hook publishes it. */
  collision(actor: OwnedActor, collision: ActorCollision): undefined;
  curves(): boolean;
  playerCurveClip(): boolean;
}

/** Q3 source query words project onto the same geometry and actor index used by every provider. */
export class Q3WorldAdapter implements ServerWorld, ActorSpatialQueries {
  constructor(readonly host: Q3WorldAdapterHost, readonly records: Q3EntityRecords) {}

  private actor(number: number): ActorId | null {
    if (number === 1022 || number === 1023 || number < 0) return null;
    const entity = this.records.get(number);
    return entity?.inuse ? entity.actor.id : null;
  }

  private query(input: ActorTraceQuery): TraceQuery {
    return { start: input.start, end: input.end, target: { kind: "world" },
      shape: input.shape.kind === "point" ? input.shape : { kind: input.shape.kind, bounds: { min: input.shape.mins, max: input.shape.maxs } },
      passActor: input.passActor, numeric: Q3_BINARY32_PROFILE,
      policy: { kind: "q3", contentsMask: input.mask, curves: this.host.curves(), playerCurveClip: this.host.playerCurveClip() } };
  }

  trace(input: ServerTraceQuery): ServerTraceResult {
    const result = this.traceActor({ ...input, passActor: this.actor(input.passEntityNum) });
    let entityNum = result.hit.kind === "none" ? 1023 : 1022;
    if (result.hit.kind === "actor") {
      const entity = this.records.byActor(result.hit.actor);
      if (entity === null) throw new Error("Shared collision actor has no Q3 source projection");
      entityNum = entity.slot;
    }
    return { fraction: result.fraction, end: result.end, entityNum, contact: result.contact,
      solidity: result.solidity, contents: result.contents, surfaceFlags: result.surfaceFlags };
  }

  traceActor(input: ActorTraceQuery): ActorTraceResult {
    const result = this.host.queries.trace(this.query(input));
    if (result.kind !== "q3") throw new Error("Shared scene did not adapt a Q3 trace policy");
    return { fraction: result.fraction, end: result.end, hit: result.hit, contact: result.contact,
      solidity: result.allSolid ? "all-solid" : result.startSolid ? "start-solid" : "clear", contents: result.contents, surfaceFlags: result.surfaceFlags };
  }

  areaActors(bounds: Bounds, maximum: number): readonly ActorId[] {
    return this.host.queries.queryActors(bounds).slice(0, maximum).map(actor => actor.body.actor);
  }

  areaEntities(bounds: Bounds, maximum = 1024): readonly number[] {
    const output: number[] = [];
    for (const actor of this.areaActors(bounds, maximum)) {
      const entity = this.records.byActor(actor);
      if (entity === null) throw new Error("Shared spatial actor has no Q3 source projection");
      output.push(entity.slot);
    }
    return output;
  }

  pointContents(point: Vec3, passEntityNum: number): number {
    const query = this.query({ start: point, end: point, shape: { kind: "point" }, passActor: this.actor(passEntityNum), mask: -1 });
    const result = this.host.queries.pointContents({ ...query, point });
    if (result.kind !== "q3") throw new Error("Shared scene did not adapt Q3 point contents");
    return result.contents;
  }

  linkState(number: number): LinkState | undefined {
    const actor = this.actor(number), linked = actor === null ? null : this.host.bodies.linked(actor);
    return linked === null ? undefined : { linked: true, linkcount: linked.linkCount, absbounds: linked.absoluteBounds };
  }

  link(entity: GameEntity): void {
    entity.r.clearBoundsOverrides();
    const byte = (value: number): number => Math.max(1, Math.min(255, Math.trunc(value)));
    entity.s.solid = entity.r.model.kind === "inline" ? 0xffffff : (entity.r.contents & (1 | 0x2000000)) === 0 ? 0
      : (byte(Math.fround(entity.r.maxs.z + 32)) << 16) | (byte(-entity.r.mins.z) << 8) | byte(entity.r.maxs.x);
    const shape = entity.r.model.kind === "inline" ? { kind: "model", model: entity.r.model.index } satisfies ActorCollision["shape"] : entity.r.model;
    this.host.collision(entity.actor, { family: "q3", shape, contents: entity.r.contents,
      owner: this.actor(entity.r.ownerNum), role: entity.r.contents === 0x40000000 ? "trigger" : "solid", monster: false, deadMonster: false });
    this.host.bodies.link(entity.actor, entity.r.currentOrigin); entity.r.captureLink();
  }

  unlink(number: number): void { const entity = this.records.get(number); if (entity?.inuse) { entity.r.captureLink(); this.host.bodies.unlink(entity.actor); } }

  entityContact(bounds: Bounds, number: number, capsule = false): boolean {
    const entity = this.records.get(number);
    if (entity === undefined || !entity.inuse) return false;
    return this.contactActor(bounds, entity.actor.id, capsule);
  }

  contactActor(bounds: Bounds, actor: ActorId, capsule = false): boolean {
    const spatial = this.host.queries.spatial.get(actor), body = this.host.bodies.read(actor);
    if (spatial === null || body === null) return false;
    const origin = { x: 0, y: 0, z: 0 };
    const query = this.query({ start: origin, end: origin, shape: { kind: capsule ? "capsule" : "box", mins: bounds.min, maxs: bounds.max }, passActor: null, mask: -1 });
    if (spatial.collision.shape.kind === "model") return this.host.queries.geometryTrace({ ...query,
      target: { kind: "model", model: spatial.collision.shape.model, origin: body.origin, angles: body.angles } }).startSolid;
    return traceActorBody(query, { body: { ...spatial.body, state: body }, collision: spatial.collision }).startSolid;
  }
}
