/* Quake WinQuake/pr_cmds.c spatial builtins. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { Bounds } from "../../contracts/math.ts";
import type { NumericProfile } from "../../contracts/numeric.ts";
import type { SceneQueries, TraceResult } from "../../contracts/scene.ts";
import type { QcHostBuiltinName } from "./builtins.ts";
import type { QcBuiltin, QcMachine } from "./machine.ts";
import type { QcEntityMemory } from "./memory.ts";
import type { QcProgram } from "./program.ts";

export interface QcSpatialWorld {
  readonly options: {
    readonly program: QcProgram;
    readonly entities: QcEntityMemory;
    readonly scene: Pick<SceneQueries, "trace" | "pointContents">;
    readonly numeric: NumericProfile;
    readonly model: (name: string) => { readonly index: number; readonly bounds: Bounds } | null;
  };
  actor(slot: number): OwnedActor;
  reference(actor: ActorId): number;
  isFreeEntity(slot: number): boolean;
  prepareEntities?(): void;
  link(slot: number): void;
}

/** Identical source builtins can address either owned edicts or projected shared actors. */
export function createQcSpatialBindings(world: QcSpatialWorld): ReadonlyMap<QcHostBuiltinName, QcBuiltin> {
  const options = world.options, host = new Map<QcHostBuiltinName, QcBuiltin>();
  const install = (name: QcHostBuiltinName, builtin: QcBuiltin): void => {
    host.set(name, vm => {
      if (vm.entities !== options.entities || vm.program !== options.program) return vm.fail("world builtin belongs to another QC machine");
      return builtin(vm);
    });
  };
    install("setorigin", vm => {
      const slot = options.entities.slot(vm.argInt(0));
      vm.setEntityVector(vm.argInt(0), "origin", vm.argVector(1));
      world.link(slot);
    });
    install("setsize", vm => { setSize(vm, options.entities.slot(vm.argInt(0)), { min: vm.argVector(1), max: vm.argVector(2) }); });
    install("setmodel", vm => {
      const model = options.model(vm.argString(1));
      if (model === null) return vm.fail(`no precache: ${vm.argString(1)}`);
      const slot = options.entities.slot(vm.argInt(0));
      vm.setEntityInt(vm.argInt(0), "model", vm.argInt(1));
      vm.setEntityFloat(vm.argInt(0), "modelindex", model.index);
      setSize(vm, slot, model.bounds);
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
        numeric: options.numeric, passActor: vm.argInt(3) === 0 ? null : world.actor(options.entities.slot(vm.argInt(3))).id });
      writeTrace(vm, trace);
    });
    install("findradius", vm => {
      world.prepareEntities?.();
      const center = vm.argVector(0), radius = vm.argFloat(1), n = vm.numeric;
      let chain = 0;
      for (let slot = 1; slot < options.entities.count; slot++) {
        if (world.isFreeEntity(slot)) continue;
        const reference = options.entities.reference(slot);
        if (vm.entityFloat(reference, "solid") === 0) continue;
        const origin = vm.entityVector(reference, "origin"), min = vm.entityVector(reference, "mins"), max = vm.entityVector(reference, "maxs");
        const distance = (c: number, o: number, a: number, b: number) => n.subtract(c, n.add(o, n.multiply(n.add(a, b), 0.5)));
        const x = distance(center.x, origin.x, min.x, max.x), y = distance(center.y, origin.y, min.y, max.y), z = distance(center.z, origin.z, min.z, max.z);
        if (n.squareRoot(n.add(n.add(n.multiply(x, x), n.multiply(y, y)), n.multiply(z, z))) > radius) continue;
        vm.setEntityInt(reference, "chain", chain); chain = reference;
      }
      vm.returnInt(chain);
    });
    install("droptofloor", vm => {
      const reference = vm.globals.int(vm.globalOffset("self")), slot = options.entities.slot(reference), origin = vm.entityVector(reference, "origin");
      const trace = options.scene.trace({ start: origin, end: { ...origin, z: vm.numeric.subtract(origin.z, 256) },
        shape: { kind: "box", bounds: { min: vm.entityVector(reference, "mins"), max: vm.entityVector(reference, "maxs") } }, target: { kind: "world" },
        policy: { kind: "q1", move: "normal", hull: null }, numeric: options.numeric, passActor: world.actor(slot).id });
      if (trace.fraction === 1 || trace.allSolid) { vm.returnFloat(0); return; }
      vm.setEntityVector(reference, "origin", trace.end);
      world.link(slot);
      vm.setEntityFloat(reference, "flags", Math.trunc(vm.entityFloat(reference, "flags")) | 512);
      vm.setEntityInt(reference, "groundentity", hitReference(trace));
      vm.returnFloat(1);
    });
  function setSize(vm: QcMachine, slot: number, bounds: Bounds): void {
    const { min, max } = bounds;
    if (min.x > max.x || min.y > max.y || min.z > max.z) return vm.fail("backwards mins/maxs");
    const reference = options.entities.reference(slot);
    vm.setEntityVector(reference, "mins", min); vm.setEntityVector(reference, "maxs", max);
    vm.setEntityVector(reference, "size", { x: vm.numeric.subtract(max.x, min.x), y: vm.numeric.subtract(max.y, min.y), z: vm.numeric.subtract(max.z, min.z) });
    world.link(slot);
  }
  function hitReference(trace: TraceResult): number { return trace.hit.kind === "actor" ? world.reference(trace.hit.actor) : 0; }
  function writeTrace(vm: QcMachine, trace: TraceResult): void {
    if (trace.kind !== "q1") return vm.fail("QC traceline requires Q1 source trace fields");
    const scalar = (name: string, value: number) => vm.globals.setFloat(vm.globalOffset(name), value);
    scalar("trace_allsolid", trace.allSolid ? 1 : 0); scalar("trace_startsolid", trace.startSolid ? 1 : 0);
    scalar("trace_fraction", trace.fraction); scalar("trace_inwater", trace.inWater ? 1 : 0); scalar("trace_inopen", trace.inOpen ? 1 : 0);
    scalar("trace_plane_dist", trace.sourcePlane.distance);
    vm.globals.setVector(vm.globalOffset("trace_endpos"), trace.end); vm.globals.setVector(vm.globalOffset("trace_plane_normal"), trace.sourcePlane.normal);
    vm.globals.setInt(vm.globalOffset("trace_ent"), hitReference(trace));
  }
  return host;
}
