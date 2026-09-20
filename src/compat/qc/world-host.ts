/* Quake WinQuake/pr_cmds.c spatial builtins. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { Bounds } from "../../contracts/math.ts";
import type { NumericOperations, NumericProfile } from "../../contracts/numeric.ts";
import type { BodyState } from "../../contracts/world.ts";
import type { SceneQueries } from "../../contracts/scene.ts";
import type { BodyStateBinding } from "../../world/actors/body.ts";
import type { SessionActorRegistry, SharedBodyTable, SourceActorSlots } from "../../world/actors/index.ts";
import type { QcHostBuiltinName } from "./builtins.ts";
import { createQcActorBindings } from "./entity-host.ts";
import type { QcBuiltin } from "./machine.ts";
import type { QcEntityMemory } from "./memory.ts";
import type { QcProgram } from "./program.ts";
import { createQcBodyBinding } from "./actor-state.ts";
import { createQcSpatialBindings } from "./spatial-host.ts";
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
    for (const [name, builtin] of createQcSpatialBindings(this)) host.set(name, builtin);
    this.host = host;
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
    return createQcBodyBinding(this.options.program, this.options.entities, slot, {
      reference: actor => this.reference(actor), actor: reference => this.options.slots.at(this.options.entities.slot(reference))?.id ?? null,
    });
  }
  link(slot: number): void {
    if (slot === 0 || this.isFreeEntity(slot)) return;
    const actor = this.actor(slot);
    this.options.bodies.link(actor);
  }
}
