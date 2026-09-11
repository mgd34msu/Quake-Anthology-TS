import type { OwnedActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { NavigationGraph, NavigationProfile, NavigationWorld, TraversalAdmission, TraversalRequest } from "../../../bots/navigation/types.ts";
import { NavigationRuntime } from "../../../bots/navigation/runtime.ts";
import { preloadNavigation, loadPreparedNavigation } from "../../../bots/navigation/load.ts";
import { registerMg3MonsterNavigation } from "../../../content/q1/addons/monsters/ai/path.ts";
import { createQ1MonsterMovement, type Q1MonsterMovement, type Q1MonsterMoveState } from "../../../movement/q1/monsters.ts";
import type { LoadedApplicationContent } from "../content.ts";
import type { SharedSimulation } from "./runtime.ts";
import { movementProfile } from "./players.ts";

export interface ApplicationMonsterNavigation {
  install(simulation: SharedSimulation, movement: Q1MonsterMovement): undefined;
}
const zero: Vec3 = { x: 0, y: 0, z: 0 };
function distance(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

/** Preload mounted assets before the synchronous source constructor and checkpoint restore. */
export async function preloadApplicationMonsterNavigation(content: LoadedApplicationContent): Promise<ApplicationMonsterNavigation | undefined> {
  if (content.recipe.map.entities.content.split(":")[2] !== "mg3") return undefined;
  const resources = await content.forContent(content.recipe.map.geometry.provenance.mount.identity.content);
  const prepared = await preloadNavigation({ map: { name: content.recipe.map.geometry.requestedPath, format: content.world.kind,
    digest: content.recipe.map.geometry.digest }, resources,
    navigationContent: content.recipe.map.geometry.provenance.mount.identity.content,
    mapBytes: await content.mounts.read(content.recipe.map.geometry) });
  return { install(simulation, movement) {
    const source = simulation.q1Source();
    if (source === null) throw new Error("MG3 navigation requires the Q1 source world");
    const graphs = new Map<string, NavigationGraph>(), actors = new WeakMap<OwnedActor, { readonly key: string; readonly runtime: NavigationRuntime }>();
    const selected = movementProfile({ ...simulation.recipe, movement: simulation.recipe.map.entities });
    if (selected.kind !== "q1-netquake" && selected.kind !== "q1-quakeworld") throw new Error("MG3 monsters require Q1 source movement");
    registerMg3MonsterNavigation(source.game, { forActor(actor) {
      const state = movement.services.read(actor.id);
      if (state === null) return null;
      const key = JSON.stringify([state.bounds, state.flags & (1 | 2)]), cached = actors.get(actor);
      if (cached?.key === key) return cached.runtime;
      const profile: NavigationProfile = { movement: selected, shape: { kind: "box", bounds: state.bounds },
        policy: { kind: "q1", move: "normal", hull: null }, capabilities: new Set(["walk", "drop", "swim"]),
        maximumStep: 18, minimumFloorNormal: 0.7, maximumDrop: 18, team: null, monster: true };
      const begin = () => {
        let detached: Q1MonsterMoveState | null = null;
        const predictor = createQ1MonsterMovement({ ...movement.services,
          read: id => id.equals(actor.id) ? detached : movement.services.read(id),
          write: (_actor, next) => { detached = next; return undefined; }, link: () => undefined });
        return { admit(request: TraversalRequest): TraversalAdmission {
          if (request.mode !== "walk" && request.mode !== "drop" && request.mode !== "swim") return { admitted: false, reason: "MG3 path walking cannot execute this traversal" };
          const actual = movement.services.read(actor.id);
          if (actual === null) return { admitted: false, reason: "Monster was removed" };
          if (detached === null) detached = { ...actual, origin: request.from };
          if (distance(detached.origin, request.from) > 2) return { admitted: false, reason: "Monster route segments are disconnected" };
          const trajectory: Vec3[] = [detached.origin], steps = Math.ceil(distance(request.from, request.to) / 8) + 2;
          for (let index = 0; index < steps; index++) {
            const offset = { x: request.to.x - detached.origin.x, y: request.to.y - detached.origin.y }, length = Math.hypot(offset.x, offset.y);
            if (length <= 1) break;
            if (!predictor.walkMove(actor, Math.atan2(offset.y, offset.x) * 180 / Math.PI, Math.min(8, length))) return { admitted: false, reason: "Source monster walkMove blocked" };
            trajectory.push(detached.origin);
          }
          return distance(detached.origin, request.to) <= 2
            ? { admitted: true, seconds: distance(request.from, request.to) / 100, trajectory }
            : { admitted: false, reason: "Source monster walkMove did not reach the endpoint" };
        } };
      };
      const world: NavigationWorld = { scene: simulation.scene, passActor: actor.id, get revision() { return simulation.timeSeconds * 1000; },
        admit: request => begin().admit(request), beginRoute: begin, entity: () => null, hazard: () => false };
      let graph = graphs.get(key);
      if (graph === undefined) {
        // Stable topology uses model zero of the same scene; live movement checks actors and movers.
        const scene = simulation.scene, target = { kind: "model", model: 0, origin: zero, angles: zero } satisfies Parameters<typeof scene.trace>[0]["target"];
        const topology: NavigationWorld = { ...world, scene: {
          trace: query => scene.trace({ ...query, target }), pointContents: query => scene.pointContents({ ...query, target }),
          boxLeaves: (bounds, limit) => scene.boxLeaves(bounds, limit), areasConnected: (a, b) => scene.areasConnected(a, b),
          clusterVisible: (a, b, kind) => scene.clusterVisible(a, b, kind) } };
        graph = loadPreparedNavigation({ geometry: content.world, map: prepared.map, profile, world: topology }, prepared).runtime.graph;
        graphs.set(key, graph);
      }
      const runtime = new NavigationRuntime(graph, world); actors.set(actor, { key, runtime }); return runtime;
    } });
    return undefined;
  } };
}
