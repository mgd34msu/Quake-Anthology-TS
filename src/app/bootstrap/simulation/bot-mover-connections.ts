import type { NavigationConnection, NavigationProfile } from "../../../bots/navigation/index.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { SharedSimulation } from "./runtime.ts";

/** Construction borrows actual source corner routes and shared brush bounds. */
export function applicationTrainConnections(simulation: SharedSimulation, profile: NavigationProfile): readonly NavigationConnection[] {
  const q2 = simulation.q2Source();
  if (q2 === null) return [];
  const connections: NavigationConnection[] = [];
  const movers = [...simulation.scene.queryActors(simulation.scene.modelBounds(0))].sort((left, right) => left.body.actor.slot - right.body.actor.slot);
  for (const { body, collision } of movers) {
    if (collision.shape.kind !== "model") continue;
    const entity = q2.game.entity(body.actor);
    if (entity === null) continue;
    const route = q2.movers.trainRoute(entity, q2.game);
    if (route === null) continue;
    const local = body.state.bounds;
    const riding = (origin: Vec3): Vec3 => ({ x: origin.x + (local.min.x + local.max.x) / 2,
      y: origin.y + (local.min.y + local.max.y) / 2, z: origin.z + local.max.z - profile.shape.bounds.min.z + 0.125 });
    for (const stop of route.stops) {
      const nextId = stop.next;
      const next = nextId === null ? undefined : route.stops.find(candidate => candidate.actor.equals(nextId));
      if (stop.wait < 0 || stop.teleport || next === undefined || next.teleport) continue;
      const destination = q2.game.entity(next.actor);
      const speed = q2.game.options.edition === "rerelease" && destination !== null && destination.speed !== 0 ? destination.speed : entity.speed;
      if (speed <= 0) continue;
      const travelSeconds = stop.wait + Math.hypot(next.origin.x - stop.origin.x, next.origin.y - stop.origin.y, next.origin.z - stop.origin.z) / speed;
      const atStop = (point: Vec3): Vec3 => ({ x: point.x + stop.origin.x, y: point.y + stop.origin.y, z: point.z + stop.origin.z });
      connections.push({ id: stop.actor.slot, sourceTravelType: 7, travelSeconds, from: riding(stop.origin), to: riding(next.origin), mode: "mover", hint: null,
        entity: { model: collision.shape.model, bounds: { min: atStop(local.min), max: atStop(local.max) }, raw: [entity.actor.id.slot, stop.actor.slot, next.actor.slot] } });
    }
  }
  return connections;
}
