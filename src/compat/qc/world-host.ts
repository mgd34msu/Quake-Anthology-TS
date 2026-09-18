/* Quake WinQuake/pr_cmds.c spatial builtins. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { Bounds } from "../../contracts/math.ts";
import type { NumericOperations, NumericProfile } from "../../contracts/numeric.ts";
import type { BodyState } from "../../contracts/world.ts";
import type { SceneQueries, TraceResult } from "../../contracts/scene.ts";
import type { BodyStateBinding } from "../../world/actors/body.ts";
import type { SessionActorRegistry, SharedBodyTable, SourceActorSlots } from "../../world/actors/index.ts";
import type { QcHostBuiltinName } from "./builtins.ts";
import { createQcActorBindings } from "./entity-host.ts";
import type { QcBuiltin, QcMachine } from "./machine.ts";
import type { QcEntityMemory } from "./memory.ts";
import type { QcProgram } from "./program.ts";
import { QcProgramError } from "./program.ts";

export interface QcWorldHostOptions {
  readonly program: QcProgram;
  readonly entities: QcEntityMemory;
  readonly actors: SessionActorRegistry;
  readonly slots: SourceActorSlots;
  /** Existing link hooks must install Q1 bounds/collision metadata without touching triggers. */
  readonly bodies: SharedBodyTable;
  readonly scene: Pick<SceneQueries, "trace" | "pointContents">;
  readonly numeric: NumericProfile;
  /** Lookup only: setmodel must fail unless the source model was precached. */
  readonly model: (name: string) => { readonly index: number; readonly bounds: Bounds } | null;
  /** The application owns surrogate source slots for actors supplied by other modules. */
  readonly foreignReference: (actor: ActorId) => number;
  readonly admit?: (actor: OwnedActor, slot: number) => undefined;
}

/** WinQuake/world.c SV_LinkEdict expands items horizontally and other edicts on all axes. */
export function qcLinkBounds(state: BodyState, flags: number, numeric: NumericOperations): Bounds {
  const item = (Math.trunc(flags) & 256) !== 0, xy = item ? 15 : 1, z = item ? 0 : 1;
  const low = (origin: number, bound: number, padding: number) => numeric.subtract(numeric.add(origin, bound), padding);
  const high = (origin: number, bound: number, padding: number) => numeric.add(numeric.add(origin, bound), padding);
  return { min: { x: low(state.origin.x, state.bounds.min.x, xy), y: low(state.origin.y, state.bounds.min.y, xy), z: low(state.origin.z, state.bounds.min.z, z) },
    max: { x: high(state.origin.x, state.bounds.max.x, xy), y: high(state.origin.y, state.bounds.max.y, xy), z: high(state.origin.z, state.bounds.max.z, z) } };
}

/** QC words remain authoritative; spatial snapshots change only at source link calls. */
export class QcWorldHost {
  readonly host: ReadonlyMap<QcHostBuiltinName, QcBuiltin>;
  readonly isFreeEntity: (slot: number) => boolean;
  constructor(readonly options: QcWorldHostOptions) {
    const actors = createQcActorBindings(options.entities, options.actors, options.slots);
    const host = new Map(actors.host);
    this.isFreeEntity = actors.isFreeEntity ?? (() => { throw new Error("Missing QC source lifetime storage"); });
    const install = (name: QcHostBuiltinName, builtin: QcBuiltin): void => {
      host.set(name, vm => {
        if (vm.entities !== options.entities || vm.program !== options.program) return vm.fail("world builtin belongs to another QC machine");
        return builtin(vm);
      });
    };
    const spawn = host.get("spawn");
    if (spawn === undefined) throw new Error("Missing QC source spawn binding");
    install("spawn", vm => { spawn(vm); this.actor(options.entities.slot(vm.globals.int(1))); });
    install("setorigin", vm => {
      const slot = options.entities.slot(vm.argInt(0));
      options.entities.at(slot).setVector(this.field("origin"), vm.argVector(1));
      this.link(slot);
    });
    install("setsize", vm => { this.setSize(vm, options.entities.slot(vm.argInt(0)), { min: vm.argVector(1), max: vm.argVector(2) }); });
    install("setmodel", vm => {
      const model = options.model(vm.argString(1));
      if (model === null) return vm.fail(`no precache: ${vm.argString(1)}`);
      const slot = options.entities.slot(vm.argInt(0)), fields = options.entities.at(slot);
      fields.setInt(this.field("model"), vm.argInt(1));
      fields.setFloat(this.field("modelindex"), model.index);
      this.setSize(vm, slot, model.bounds);
    });
    install("pointcontents", vm => {
      const result = options.scene.pointContents({ point: vm.argVector(0), target: { kind: "world" },
        policy: { kind: "q1", move: "normal", hull: null }, numeric: options.numeric, passActor: null });
      if (result.kind !== "q1") return vm.fail("QC pointcontents requires Q1 source contents");
      vm.returnFloat(result.contents);
    });
    install("traceline", vm => {
      const mode = Math.trunc(vm.argFloat(2));
      const trace = options.scene.trace({ start: vm.argVector(0), end: vm.argVector(1), shape: { kind: "point" }, target: { kind: "world" },
        policy: { kind: "q1", move: mode === 1 ? "no-monsters" : mode === 2 ? "missile" : "normal", hull: null },
        numeric: options.numeric, passActor: this.actor(options.entities.slot(vm.argInt(3))).id });
      this.writeTrace(vm, trace);
    });
    install("findradius", vm => {
      const center = vm.argVector(0), radius = vm.argFloat(1), n = vm.numeric;
      let chain = 0;
      for (let slot = 1; slot < options.entities.count; slot++) {
        if (this.isFreeEntity(slot)) continue;
        const fields = options.entities.at(slot);
        if (fields.float(this.field("solid")) === 0) continue;
        const origin = fields.vector(this.field("origin")), min = fields.vector(this.field("mins")), max = fields.vector(this.field("maxs"));
        const distance = (c: number, o: number, a: number, b: number) => n.subtract(c, n.add(o, n.multiply(n.add(a, b), 0.5)));
        const x = distance(center.x, origin.x, min.x, max.x), y = distance(center.y, origin.y, min.y, max.y), z = distance(center.z, origin.z, min.z, max.z);
        if (n.squareRoot(n.add(n.add(n.multiply(x, x), n.multiply(y, y)), n.multiply(z, z))) > radius) continue;
        fields.setInt(this.field("chain"), chain); chain = options.entities.reference(slot);
      }
      vm.returnInt(chain);
    });
    install("droptofloor", vm => {
      const slot = options.entities.slot(vm.globals.int(vm.globalOffset("self"))), fields = options.entities.at(slot), origin = fields.vector(this.field("origin"));
      const trace = options.scene.trace({ start: origin, end: { ...origin, z: vm.numeric.subtract(origin.z, 256) },
        shape: { kind: "box", bounds: { min: fields.vector(this.field("mins")), max: fields.vector(this.field("maxs")) } }, target: { kind: "world" },
        policy: { kind: "q1", move: "normal", hull: null }, numeric: options.numeric, passActor: this.actor(slot).id });
      if (trace.fraction === 1 || trace.allSolid) { vm.returnFloat(0); return; }
      fields.setVector(this.field("origin"), trace.end);
      this.link(slot);
      fields.setFloat(this.field("flags"), Math.trunc(fields.float(this.field("flags"))) | 512);
      fields.setInt(this.field("groundentity"), this.hitReference(trace));
      vm.returnFloat(1);
    });
    this.host = host;
  }
  private field(name: string): number {
    const definition = this.options.program.fieldsByName.get(name);
    if (definition === undefined) throw new QcProgramError(`missing entity field ${name}`);
    return definition.offset;
  }
  reference(actor: ActorId): number {
    if (!this.options.actors.isLive(actor)) throw new QcProgramError("cannot encode a stale actor as a QC entity");
    const source = this.options.actors.sourceOf(actor);
    return source !== null && source.provider === this.options.slots.options.provider
      ? this.options.entities.reference(source.slot) : this.options.foreignReference(actor);
  }
  /** May be called by the application when it opens map/client slots before execution. */
  actor(slot: number): OwnedActor {
    if (this.isFreeEntity(slot)) throw new QcProgramError("world builtin references a free source edict");
    const actor = this.options.slots.at(slot) ?? this.options.slots.bindExisting(slot, "quakec:edict");
    if (this.options.bodies.read(actor.id) === null) {
      this.options.bodies.bind(actor, this.body(slot));
      this.options.admit?.(actor, slot);
    }
    return actor;
  }
  private body(slot: number): BodyStateBinding {
    const fields = this.options.entities.at(slot);
    const origin = this.field("origin"), angles = this.field("angles"), velocity = this.field("velocity"), mins = this.field("mins"), maxs = this.field("maxs");
    const flags = this.field("flags"), ground = this.field("groundentity");
    return {
      read: () => ({ origin: fields.vector(origin), angles: fields.vector(angles), velocity: fields.vector(velocity),
        bounds: { min: fields.vector(mins), max: fields.vector(maxs) },
        ground: (Math.trunc(fields.float(flags)) & 512) === 0 ? null : this.options.slots.at(this.options.entities.slot(fields.int(ground)))?.id ?? null }),
      write: state => {
        fields.setVector(origin, state.origin); fields.setVector(angles, state.angles); fields.setVector(velocity, state.velocity);
        fields.setVector(mins, state.bounds.min); fields.setVector(maxs, state.bounds.max);
        fields.setFloat(flags, state.ground === null ? Math.trunc(fields.float(flags)) & ~512 : Math.trunc(fields.float(flags)) | 512);
        // Source airborne motion clears onground without erasing the previous ground word.
        if (state.ground !== null) fields.setInt(ground, this.reference(state.ground));
        return undefined;
      },
      linked: body => {
        fields.setVector(this.field("absmin"), body.absoluteBounds.min);
        fields.setVector(this.field("absmax"), body.absoluteBounds.max);
        return undefined;
      },
    };
  }
  link(slot: number): void {
    if (slot === 0 || this.isFreeEntity(slot)) return;
    const actor = this.actor(slot);
    this.options.bodies.link(actor);
  }
  private setSize(vm: QcMachine, slot: number, bounds: Bounds): void {
    const { min, max } = bounds;
    if (min.x > max.x || min.y > max.y || min.z > max.z) return vm.fail("backwards mins/maxs");
    const fields = this.options.entities.at(slot);
    fields.setVector(this.field("mins"), min); fields.setVector(this.field("maxs"), max);
    fields.setVector(this.field("size"), { x: vm.numeric.subtract(max.x, min.x), y: vm.numeric.subtract(max.y, min.y), z: vm.numeric.subtract(max.z, min.z) });
    this.link(slot);
  }
  private hitReference(trace: TraceResult): number { return trace.hit.kind === "actor" ? this.reference(trace.hit.actor) : 0; }
  private writeTrace(vm: QcMachine, trace: TraceResult): void {
    if (trace.kind !== "q1") return vm.fail("QC traceline requires Q1 source trace fields");
    const scalar = (name: string, value: number) => vm.globals.setFloat(vm.globalOffset(name), value);
    scalar("trace_allsolid", trace.allSolid ? 1 : 0); scalar("trace_startsolid", trace.startSolid ? 1 : 0);
    scalar("trace_fraction", trace.fraction); scalar("trace_inwater", trace.inWater ? 1 : 0); scalar("trace_inopen", trace.inOpen ? 1 : 0);
    scalar("trace_plane_dist", trace.sourcePlane.distance);
    vm.globals.setVector(vm.globalOffset("trace_endpos"), trace.end); vm.globals.setVector(vm.globalOffset("trace_plane_normal"), trace.sourcePlane.normal);
    vm.globals.setInt(vm.globalOffset("trace_ent"), this.hitReference(trace));
  }
}
