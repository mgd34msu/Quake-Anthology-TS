/* Q2 gl_warp.c ClipSkyPolygon, MakeSkyVec and R_DrawSkyBox. GPL-2.0-or-later. */
import type { Vec3, Vec4 } from "../../contracts/math.ts";
import type { RendererImage, RenderOperation } from "../../contracts/render.ts";
import type { MaterialGeometry } from "../../materials/geometry.ts";
import { skyVector } from "../../materials/sky.ts";
import { add3, dot3, normalize3OrZero, rotatePointAroundVector, scale3, sub3 } from "../../core/math.ts";

export interface Q2SkyView {
  /** Faces in SKY_FACE_SUFFIXES order: rt, lf, bk, ft, up, dn. */
  readonly images: readonly RendererImage[];
  readonly rotation: number;
  readonly autoRotate: boolean;
  readonly axis: Vec3;
}
interface FaceBounds { minS: number; minT: number; maxS: number; maxT: number; }
const planes: readonly Vec3[] = [{ x: 1, y: 1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: 0, y: -1, z: 1 },
  { x: 0, y: 1, z: 1 }, { x: 1, y: 0, z: 1 }, { x: -1, y: 0, z: 1 }];
function at<T>(values: readonly T[], index: number): T {
  const value = values[index]; if (value === undefined) throw new RangeError(`Q2 sky index ${index} outside ${values.length}`); return value;
}
function projectPolygon(points: readonly Vec3[], bounds: readonly FaceBounds[]): void {
  let sum = { x: 0, y: 0, z: 0 }; for (const point of points) sum = add3(sum, point);
  const x = Math.abs(sum.x), y = Math.abs(sum.y), z = Math.abs(sum.z);
  const face = x > y && x > z ? sum.x < 0 ? 1 : 0 : y > z && y > x ? sum.y < 0 ? 3 : 2 : sum.z < 0 ? 5 : 4;
  const range = at(bounds, face);
  for (const point of points) {
    let divisor: number, s: number, t: number;
    switch (face) {
      case 0: divisor = point.x; s = -point.y; t = point.z; break;
      case 1: divisor = -point.x; s = point.y; t = point.z; break;
      case 2: divisor = point.y; s = point.x; t = point.z; break;
      case 3: divisor = -point.y; s = -point.x; t = point.z; break;
      case 4: divisor = point.z; s = -point.y; t = -point.x; break;
      case 5: divisor = -point.z; s = -point.y; t = point.x; break;
      default: throw new RangeError("Invalid Q2 sky face");
    }
    if (divisor < 0.001) continue;
    s = Math.fround(s / divisor); t = Math.fround(t / divisor);
    range.minS = Math.min(range.minS, s); range.minT = Math.min(range.minT, t);
    range.maxS = Math.max(range.maxS, s); range.maxT = Math.max(range.maxT, t);
  }
}
function clipPolygon(points: readonly Vec3[], stage: number, bounds: readonly FaceBounds[]): void {
  if (points.length > 62) throw new RangeError("Q2 sky polygon exceeds MAX_CLIP_VERTS");
  if (stage === 6) { projectPolygon(points, bounds); return; }
  const normal = at(planes, stage), distances = points.map(point => dot3(point, normal));
  const sides = distances.map(distance => distance > 0.1 ? 1 : distance < -0.1 ? -1 : 0);
  if (!sides.includes(1) || !sides.includes(-1)) { clipPolygon(points, stage + 1, bounds); return; }
  const front: Vec3[] = [], back: Vec3[] = [];
  for (let index = 0; index < points.length; index++) {
    const point = at(points, index), next = (index + 1) % points.length, side = at(sides, index), nextSide = at(sides, next);
    if (side >= 0) front.push(point); if (side <= 0) back.push(point);
    if (side === 0 || nextSide === 0 || side === nextSide) continue;
    const distance = at(distances, index), fraction = Math.fround(distance / Math.fround(distance - at(distances, next)));
    const intersection = add3(point, scale3(sub3(at(points, next), point), fraction)); front.push(intersection); back.push(intersection);
  }
  clipPolygon(front, stage + 1, bounds); clipPolygon(back, stage + 1, bounds);
}

export function q2SkySides(geometry: MaterialGeometry, origin: Vec3, sky: Q2SkyView, seconds: number,
  project: (point: Vec3) => Vec4): readonly RenderOperation[] {
  if (sky.images.length !== 6) throw new Error("Q2 sky requires six registered images");
  const bounds: FaceBounds[] = Array.from({ length: 6 }, () => ({ minS: 9999, minT: 9999, maxS: -9999, maxT: -9999 }));
  for (let index = 0; index < geometry.indices.length; index += 3)
    clipPolygon([0, 1, 2].map(offset => sub3(at(geometry.vertices, at(geometry.indices, index + offset)).position, origin)), 0, bounds);
  const visible = (range: FaceBounds): boolean => range.minS < range.maxS && range.minT < range.maxT;
  if (!bounds.some(visible)) return [];
  const angle = sky.autoRotate ? seconds * sky.rotation : sky.rotation, axis = normalize3OrZero(sky.axis);
  const rotate = angle !== 0 && dot3(axis, axis) !== 0, seam = sky.rotation !== 0 ? 1 / 256 : 1 / 512;
  const coordinate = (value: number): number => Math.max(seam, Math.min(1 - seam, (value + 1) * 0.5));
  const operations: RenderOperation[] = [];
  for (const [face, clipped] of bounds.entries()) {
    const range = sky.rotation !== 0 ? { minS: -1, minT: -1, maxS: 1, maxT: 1 } : clipped;
    if (!visible(range)) continue;
    const vertex = (s: number, t: number) => {
      const point = skyVector(face, s, t, 2300), direction = rotate ? rotatePointAroundVector(axis, point, angle) : point;
      return { position: project(add3(origin, direction)), texCoord: { x: coordinate(s), y: 1 - coordinate(t) } };
    };
    operations.push({ kind: "sky-side", image: at(sky.images, face), color: { x: 1, y: 1, z: 1, w: 1 },
      strips: [[vertex(range.minS, range.minT), vertex(range.minS, range.maxT), vertex(range.maxS, range.minT), vertex(range.maxS, range.maxT)]] });
  }
  return operations;
}
