import type { Bounds, Vec3 } from "../../contracts/math.ts";

/** NAV2 names the source linked box, including link padding, at an authored mover endpoint. */
export function sourceMoverBoundsMatch(authored: Bounds, linked: Bounds, origin: Vec3, endpoint: Vec3): boolean {
  return authored.min.x === linked.min.x + endpoint.x - origin.x && authored.max.x === linked.max.x + endpoint.x - origin.x
    && authored.min.y === linked.min.y + endpoint.y - origin.y && authored.max.y === linked.max.y + endpoint.y - origin.y
    && authored.min.z === linked.min.z + endpoint.z - origin.z && authored.max.z === linked.max.z + endpoint.z - origin.z;
}
