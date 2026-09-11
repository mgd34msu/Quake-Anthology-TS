/* quakec_mg3/defs.qc return codes and ai.qc call contract. GPL-2.0-or-later.
 * The closed rerelease engine's path algorithm is unavailable. This implementation
 * follows shared, movement-admitted navigation, then commits only source walkMove. */
import type { OwnedActor } from "../../../../../contracts/identity.ts";
import { sameActor } from "../../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../../contracts/math.ts";
import type { NavigationRuntime } from "../../../../../bots/navigation/runtime.ts";
import type { NavigationRoute } from "../../../../../bots/navigation/types.ts";
import { SaveReader, encodeCheckpointValue, decodeCheckpointValue } from "../../../../../persistence/value.ts";
import type { Q1Foundation } from "../../../foundation/runtime.ts";
import type { BaseMonster } from "../../../base/monsters.ts";
import { length, vsub, yawFor } from "../../../foundation/types.ts";

export const Mg3PathResult = { ERROR: 0, REACHED_GOAL: 1, REACHED_PATH_END: 2, MOVE_BLOCKED: 3, IN_PROGRESS: 4 } satisfies Readonly<Record<string, number>>;
export interface Mg3MonsterNavigationHost {
  /** Return this actual actor's selected movement profile, shape and collision exclusion. */
  forActor(actor: OwnedActor): NavigationRuntime | null;
}
interface Path { readonly goal: Vec3; readonly route: NavigationRoute; cursor: number; }
const registrations = new WeakMap<Q1Foundation, Mg3MonsterNavigation>();
function point(reader: SaveReader): Vec3 {
  return { x: reader.field("x").number(), y: reader.field("y").number(), z: reader.field("z").number() };
}
class Mg3MonsterNavigation {
  readonly paths = new Map<OwnedActor, Path>();
  constructor(readonly game: Q1Foundation, readonly host: Mg3MonsterNavigationHost) {
    game.host.actors.onRelease(actor => { this.paths.delete(actor); return undefined; });
    game.registerStateExtension({ id: "mg3:monster-navigation", capture: () => encodeCheckpointValue([...this.paths].map(([actor, path]) => ({
      actor: { slot: actor.id.slot, generation: actor.id.generation }, goal: path.goal, cursor: path.cursor,
      map: path.route.map.digest, nodes: path.route.nodes, edges: path.route.edges.map(edge => edge.id), points: path.route.points,
      seconds: path.route.travelSeconds, generation: path.route.generation,
    }))), restore: bytes => {
      this.paths.clear();
      new SaveReader(decodeCheckpointValue(bytes), "mg3:monster-navigation").list(reader => {
        const saved = reader.field("actor"), actor = game.host.actors.resolveSaved({ slot: saved.field("slot").integer(0), generation: saved.field("generation").integer(0) });
        if (actor === null) return reader.fail("missing navigation actor");
        const runtime = this.runtime(actor);
        if (runtime === null || runtime.graph.map.digest !== reader.field("map").string()) return reader.fail("saved navigation map is unavailable");
        const route: NavigationRoute = { map: runtime.graph.map,
          nodes: reader.field("nodes").list(value => { const id = value.integer(0); if (runtime.node(id) === null) return value.fail("missing navigation node"); return id; }),
          edges: reader.field("edges").list(value => { const id = value.integer(0), edge = runtime.graph.edges.find(edge => edge.id === id); return edge ?? value.fail("missing navigation edge"); }),
          points: reader.field("points").list(point), travelSeconds: reader.field("seconds").number(), generation: reader.field("generation").integer(0) };
        const cursor = reader.field("cursor").integer(0);
        if (cursor > route.points.length) return reader.fail("navigation cursor exceeds route");
        this.paths.set(actor, { goal: point(reader.field("goal")), route, cursor }); return undefined;
      }); return undefined;
    }, clone: (source, target) => {
      const path = this.paths.get(source.actor);
      if (path !== undefined) this.paths.set(target.actor, { ...path }); return undefined;
    } });
  }
  runtime(actor: OwnedActor): NavigationRuntime | null {
    const runtime = this.host.forActor(actor); if (runtime === null) return null;
    if (!runtime.graph.profile.monster || runtime.world.passActor === null || !sameActor(runtime.world.passActor, actor.id)) {
      throw new Error("MG3 pathfinding requires the canonical monster profile and self collision exclusion");
    }
    return runtime;
  }
  walk(monster: BaseMonster, distance: number, goal: Vec3): number {
    const actor = monster.entity.actor, runtime = this.runtime(actor);
    if (runtime === null) { this.paths.delete(actor); return Mg3PathResult.ERROR; }
    const close = (point: Vec3): boolean => length(vsub(point, monster.origin)) <= 1;
    if (close(goal)) { this.paths.delete(actor); return Mg3PathResult.REACHED_GOAL; }
    let path = this.paths.get(actor);
    if (path === undefined || length(vsub(goal, path.goal)) > 1 || !runtime.routeStillValid(path.route)) {
      // walkpathtogoal commits walking only; jumps and source triggers require their own actions.
      const result = runtime.route({ start: monster.origin, goal, edgeFilter: edge => edge.mode === "walk" || edge.mode === "drop" || edge.mode === "swim" });
      if (result.kind !== "route") { this.paths.delete(actor); return Mg3PathResult.ERROR; }
      path = { goal: { ...goal }, route: result.route, cursor: 0 }; this.paths.set(actor, path);
    }
    let next = path.route.points[path.cursor];
    while (next !== undefined && close(next)) { path.cursor++; next = path.route.points[path.cursor]; }
    if (next === undefined) { this.paths.delete(actor); return Mg3PathResult.REACHED_PATH_END; }
    const offset = vsub(next, monster.origin), horizontal = Math.hypot(offset.x, offset.y), step = Math.min(Math.abs(distance), horizontal);
    if (step === 0 || !this.game.host.walkMove(actor, yawFor(offset), Math.sign(distance) * step)) {
      this.paths.delete(actor); return Mg3PathResult.MOVE_BLOCKED;
    }
    return Mg3PathResult.IN_PROGRESS;
  }
}

/** Install with the map runtime before source checkpoint restore or the first Horde think. */
export function registerMg3MonsterNavigation(game: Q1Foundation, host: Mg3MonsterNavigationHost): undefined {
  if (registrations.has(game)) throw new Error("MG3 monster navigation is already registered");
  registrations.set(game, new Mg3MonsterNavigation(game, host)); return undefined;
}
export function walkMg3PathToGoal(monster: BaseMonster, distance: number, goal: Vec3): number {
  const navigation = registrations.get(monster.game);
  if (navigation === undefined) throw new Error("MG3 walkpathtogoal requires the selected shared navigation host");
  return navigation.walk(monster, Math.fround(distance), goal);
}
