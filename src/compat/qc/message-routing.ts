import type { ActorId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { Q1ClientVisibilityScene } from "../../world/gameplay/q1-client-visibility.ts";
import type { QcMessageDestination } from "./presentation-host.ts";

/** QW SV_Multicast uses the client origin and includes nearby PHS listeners. */
export function receivesQuakeWorldMessage(actor: ActorId, destination: QcMessageDestination,
  origin: () => Vec3, visibility: () => Pick<Q1ClientVisibilityScene, "pointLeaf" | "leafCluster" | "clusterVisible">): boolean {
  if (destination.kind === "client") return actor.equals(destination.actor);
  if (destination.kind === "signon") return false;
  if (destination.kind === "broadcast" || destination.visibility === "all") return true;
  const point = origin(), delta = { x: point.x - destination.origin.x, y: point.y - destination.origin.y, z: point.z - destination.origin.z };
  if (destination.visibility === "phs" && delta.x * delta.x + delta.y * delta.y + delta.z * delta.z <= 1024 * 1024) return true;
  const scene = visibility();
  return scene.clusterVisible(scene.leafCluster(scene.pointLeaf(destination.origin)), scene.leafCluster(scene.pointLeaf(point)), destination.visibility);
}
