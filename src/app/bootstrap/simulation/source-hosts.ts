import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { NumericProfile } from "../../../contracts/numeric.ts";
import type { TraceQuery } from "../../../contracts/scene.ts";
import type { Q1FoundationHost } from "../../../content/q1/foundation/types.ts";
import type { Q2FoundationHost } from "../../../content/q2/foundation/host.ts";
import type { SharedSceneQueries } from "../../../world/collision/index.ts";
import type { SourceRandom } from "./random.ts";

export interface ActorHostRuntime {
  readonly numeric: NumericProfile;
  readonly random: SourceRandom;
  now(): number;
  frameSeconds(): number;
  schedule(actor: OwnedActor, dueSeconds: number | null): undefined;
}

interface ActorHostWorld {
  readonly scene: SharedSceneQueries;
  readonly numeric: NumericProfile;
  worldActor(): ActorId | null;
  sourceOrder(first: ActorId, second: ActorId): number;
}

export function createQ1ActorHost(bindings: Omit<Q1FoundationHost, "trace" | "contents">, world: ActorHostWorld): Q1FoundationHost {
  return { ...bindings,
    trace: request => {
      const trace = world.scene.trace({ start: request.start, end: request.end, shape: { kind: "box", bounds: request.bounds }, target: { kind: "world" },
        policy: { kind: "q1", move: request.missile ? "missile" : request.monsters ? "normal" : "no-monsters", hull: null }, numeric: world.numeric, passActor: request.ignore });
      if (trace.kind !== "q1") throw new Error("Q1 actor trace returned another source representation");
      const contents = world.scene.pointContents({ point: trace.end, target: { kind: "world" }, policy: { kind: "q1", move: "normal", hull: null }, numeric: world.numeric, passActor: request.ignore });
      return { fraction: trace.fraction, end: trace.end, normal: trace.sourcePlane.normal,
        actor: trace.hit.kind === "actor" ? trace.hit.actor : trace.hit.kind === "world" ? world.worldActor() : null,
        startSolid: trace.startSolid, allSolid: trace.allSolid, sky: contents.kind === "q1" && contents.contents === -6, inOpen: trace.inOpen, inWater: trace.inWater };
    },
    contents: point => {
      const result = world.scene.pointContents({ point, target: { kind: "world" }, passActor: null,
        policy: { kind: "q1", move: "normal", hull: null }, numeric: world.numeric });
      if (result.kind !== "q1") throw new Error("Q1 actor contents returned another source representation");
      const value = result.contents;
      return value === -2 ? "solid" : value === -3 ? "water" : value === -4 ? "slime" : value === -5 ? "lava" : value === -6 ? "sky" : "empty";
    },
  };
}

type Q2WorldQuery = "trace" | "pointContents" | "inPvs" | "inPhs" | "areasConnected" | "nearby" | "inlineModelBounds";

export function createQ2ActorHost(bindings: Omit<Q2FoundationHost, Q2WorldQuery>, world: ActorHostWorld): Q2FoundationHost {
  const visible = (first: Parameters<Q2FoundationHost["inPvs"]>[0], second: Parameters<Q2FoundationHost["inPvs"]>[1], kind: "pvs" | "phs") =>
    world.scene.clusterVisible(world.scene.leafCluster(world.scene.pointLeaf(first)), world.scene.leafCluster(world.scene.pointLeaf(second)), kind);
  return { ...bindings,
    trace: request => {
      const query: TraceQuery = { start: request.start, end: request.end,
        shape: request.bounds === null ? { kind: "point" } : { kind: "box", bounds: request.bounds }, target: { kind: "world" },
        policy: { kind: "q2", contentsMask: request.mask, leafContents: "merged" }, numeric: world.numeric, passActor: request.ignore };
      return request.exclude === undefined || request.exclude.length === 0 ? world.scene.trace(query) : world.scene.traceExcluding(query, request.exclude);
    },
    pointContents: point => {
      const result = world.scene.pointContents({ point, target: { kind: "world" }, passActor: null,
        policy: { kind: "q2", contentsMask: -1, leafContents: "merged" }, numeric: world.numeric });
      if (result.kind !== "q2") throw new Error("Q2 actor contents returned another source representation");
      return result.merged;
    },
    inPvs: (first, second) => visible(first, second, "pvs"), inPhs: (first, second) => visible(first, second, "phs"),
    areasConnected: (first, second) => world.scene.areasConnected(world.scene.leafArea(world.scene.pointLeaf(first)), world.scene.leafArea(world.scene.pointLeaf(second))),
    nearby: (origin, radius) => bindings.actors.observations().map(value => value.id).filter(actor => {
      const body = bindings.bodies.read(actor);
      return body !== null && Math.hypot(body.origin.x - origin.x, body.origin.y - origin.y, body.origin.z - origin.z) <= radius;
    }).sort(world.sourceOrder),
    inlineModelBounds: model => world.scene.modelBounds(model),
  };
}
