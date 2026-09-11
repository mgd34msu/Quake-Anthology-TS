/* MD5 v10 mesh, animation, scales and skinning adapted from the Q1/Q2
 * rerelease ports and q2repro refresh/models.c and mesh.c. GPL-2.0-or-later. */
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import type { Md5Joint, Md5Model, ModelVertex, SkeletonJointPose } from "../../contracts/scene.ts";
import { add3, scale3, vec3 } from "../../core/math.ts";
import { at, indexedRecords, ModelTokens } from "./text.ts";
import { conjugateQuaternion, md5Quaternion, multiplyQuaternion, normalizeQuaternion, rotateQuaternion, rotateQuaternionAxis, slerpQuaternion } from "./quaternion.ts";

export type Md5Mesh = Md5Model["meshes"][number];
export interface Md5MeshFile {
  readonly source: string;
  readonly commandLine: string;
  readonly joints: readonly Md5Joint[];
  /** Mesh joint positions are already in model space. */
  readonly bindPose: readonly SkeletonJointPose[];
  readonly meshes: readonly Md5Mesh[];
}
export interface Md5HierarchyJoint extends Md5Joint { readonly flags: number; readonly startIndex: number; }
export interface Md5AnimationFrame {
  readonly bounds: Bounds;
  readonly components: readonly number[];
  readonly localJoints: readonly SkeletonJointPose[];
  readonly joints: readonly SkeletonJointPose[];
}
export interface Md5Animation {
  readonly source: string;
  readonly commandLine: string;
  readonly frameRate: number;
  readonly hierarchy: readonly Md5HierarchyJoint[];
  readonly baseFrame: readonly SkeletonJointPose[];
  readonly frames: readonly Md5AnimationFrame[];
  readonly scaleSource: string | null;
  readonly diagnostics: readonly string[];
}
export interface DecodedMd5Model extends Md5Model {
  readonly meshSource: string;
  readonly meshCommandLine: string;
  readonly meshJoints: readonly Md5Joint[];
  readonly bindPose: readonly SkeletonJointPose[];
  readonly animation: Md5Animation;
}
export interface Md5ScaleSource { readonly source: string; readonly text: string; }

function header(tokens: ModelTokens): string {
  tokens.expect("MD5Version"); tokens.expect("10"); tokens.expect("commandline");
  return tokens.token();
}

function readMesh(tokens: ModelTokens, joints: readonly SkeletonJointPose[]): Md5Mesh {
  tokens.expect("mesh"); tokens.expect("{"); tokens.expect("shader");
  const shader = tokens.token();
  tokens.expect("numverts");
  const vertexCount = tokens.integer(0, 65535);
  const vertices = indexedRecords(tokens, vertexCount, "vert", () => {
    tokens.expect("(");
    const texCoord = { x: tokens.float(), y: tokens.float() };
    tokens.expect(")");
    return { texCoord, normal: vec3(0, 0, 0), weights: { first: tokens.integer(), count: tokens.integer() } };
  });
  tokens.expect("numtris");
  const triangleCount = tokens.integer(0, 65535);
  const triangles = indexedRecords(tokens, triangleCount, "tri", () => [tokens.integer(0, vertexCount - 1), tokens.integer(0, vertexCount - 1), tokens.integer(0, vertexCount - 1)]);
  tokens.expect("numweights");
  const weightCount = tokens.integer(0, 1048576);
  const weights = indexedRecords(tokens, weightCount, "weight", () => {
    const joint = tokens.integer(0, joints.length - 1);
    const bias = tokens.float();
    if (bias < 0 || bias > 1) tokens.fail(`weight bias ${bias} outside 0..1`);
    return { joint, bias, position: tokens.vector() };
  });
  tokens.expect("}");
  for (const vertex of vertices) {
    if (vertex.weights.first > weightCount - vertex.weights.count) tokens.fail("vertex weight range exceeds mesh weights");
  }
  const mesh = { shader, vertices, indices: triangles.flat(), weights };
  return { ...mesh, vertices: computeNormals(mesh, joints) };
}

export function parseMd5Mesh(text: string, source = "<md5mesh>"): Md5MeshFile {
  const tokens = new ModelTokens(text, source);
  const commandLine = header(tokens);
  tokens.expect("numJoints"); const jointCount = tokens.integer(1, 256);
  tokens.expect("numMeshes"); const meshCount = tokens.integer(1, 32);
  tokens.expect("joints"); tokens.expect("{");
  const joints: Md5Joint[] = [];
  const bindPose: SkeletonJointPose[] = [];
  for (let i = 0; i < jointCount; i++) {
    // Mesh parent order is metadata; model-space bind joints need no hierarchy traversal.
    joints.push({ name: tokens.token(), parent: tokens.integer(-1, jointCount - 1), scalePositions: false });
    bindPose.push({ position: tokens.vector(), orientation: md5Quaternion(tokens.vector()), scale: 1 });
  }
  tokens.expect("}");
  const meshes = Array.from({ length: meshCount }, () => readMesh(tokens, bindPose));
  tokens.end();
  return { source, commandLine, joints, bindPose, meshes };
}

function vectorNormal(value: Vec3): Vec3 {
  const length = Math.sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
  return length === 0 ? value : scale3(value, 1 / length);
}

function computeNormals(mesh: Md5Mesh, bindPose: readonly SkeletonJointPose[]): Md5Mesh["vertices"] {
  const positions = mesh.vertices.map(vertex => {
    let position = vec3(0, 0, 0);
    for (let i = 0; i < vertex.weights.count; i++) {
      const weight = at(mesh.weights, vertex.weights.first + i, "weight");
      const joint = at(bindPose, weight.joint, "joint");
      const rotated = rotateQuaternion(joint.orientation, weight.position);
      const world = add3(joint.position, rotated);
      position = vec3(position.x + world.x * weight.bias, position.y + world.y * weight.bias, position.z + world.z * weight.bias);
    }
    return position;
  });
  const normals = new Map<string, Vec3>();
  const key = (p: Vec3): string => `${p.x}|${p.y}|${p.z}`;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = at(positions, at(mesh.indices, i, "index"), "position");
    const b = at(positions, at(mesh.indices, i + 1, "index"), "position");
    const c = at(positions, at(mesh.indices, i + 2, "index"), "position");
    const d1 = vectorNormal(vec3(c.x - a.x, c.y - a.y, c.z - a.z));
    const d2 = vectorNormal(vec3(b.x - a.x, b.y - a.y, b.z - a.z));
    const normal = vectorNormal(vec3(d1.y * d2.z - d1.z * d2.y, d1.z * d2.x - d1.x * d2.z, d1.x * d2.y - d1.y * d2.x));
    const angle = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y + d1.z * d2.z)));
    const weighted = scale3(normal, angle);
    for (const p of [a, b, c]) normals.set(key(p), add3(normals.get(key(p)) ?? vec3(0, 0, 0), weighted));
  }
  for (const [position, normal] of normals) normals.set(position, vectorNormal(normal));
  return mesh.vertices.map((vertex, index) => {
    const worldNormal = normals.get(key(at(positions, index, "position"))) ?? vec3(0, 0, 0);
    let normal = vec3(0, 0, 0);
    for (let i = 0; i < vertex.weights.count; i++) {
      const weight = at(mesh.weights, vertex.weights.first + i, "weight");
      const joint = at(bindPose, weight.joint, "joint");
      const local = rotateQuaternion(conjugateQuaternion(joint.orientation), worldNormal);
      normal = vec3(normal.x + weight.bias * local.x, normal.y + weight.bias * local.y, normal.z + weight.bias * local.z);
    }
    return { ...vertex, normal };
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectEntries(value: unknown): [string, unknown][] | null {
  if (!isObject(value)) return null;
  return Object.entries(value);
}

/** Optional scale failures are diagnostics, matching q2repro's fallback to unit scales. */
function parseScales(source: Md5ScaleSource | null, hierarchy: readonly Md5HierarchyJoint[], frameCount: number): {
  readonly hierarchy: readonly Md5HierarchyJoint[]; readonly scales: ReadonlyMap<string, number>; readonly diagnostics: readonly string[];
} {
  const scales = new Map<string, number>();
  const scalePositions = new Set<number>();
  const diagnostics: string[] = [];
  if (source !== null) {
    let root: unknown;
    try { root = JSON.parse(source.text); } catch { root = null; }
    const entries = objectEntries(root);
    if (entries === null) diagnostics.push(`${source.source}: Invalid JSON scale object`);
    else for (const [name, entry] of entries) {
      const joint = hierarchy.findIndex(value => value.name === name);
      const values = objectEntries(entry);
      if (values === null) { diagnostics.push(`${source.source}: Invalid scale entry for ${name}`); break; }
      if (joint < 0) { diagnostics.push(`${source.source}: No such joint ${name}`); continue; }
      for (const [key, value] of values) {
        if (key === "scale_positions") { if (value === true) scalePositions.add(joint); }
        else {
          const frame = Number(key);
          if (key.length > 0 && Number.isInteger(frame) && frame >= 0 && frame < frameCount && typeof value === "number" && Number.isFinite(Math.fround(value))) {
            scales.set(`${frame}:${joint}`, Math.fround(value));
          } else diagnostics.push(`${source.source}: Invalid frame scale ${name}/${key}`);
        }
      }
    }
  }
  return { hierarchy: hierarchy.map((joint, index) => ({ ...joint, scalePositions: scalePositions.has(index) })), scales, diagnostics };
}

export function parseMd5Anim(text: string, source = "<md5anim>", scaleSource: Md5ScaleSource | null = null): Md5Animation {
  const tokens = new ModelTokens(text, source);
  const commandLine = header(tokens);
  tokens.expect("numFrames"); const frameCount = tokens.integer(1, 65535);
  tokens.expect("numJoints"); const jointCount = tokens.integer(1, 256);
  tokens.expect("frameRate"); const frameRate = tokens.integer(1, 1000);
  tokens.expect("numAnimatedComponents"); const componentCount = tokens.integer(0, jointCount * 6);
  tokens.expect("hierarchy"); tokens.expect("{");
  const rawHierarchy: Md5HierarchyJoint[] = [];
  for (let i = 0; i < jointCount; i++) {
    const name = tokens.token();
    const parent = tokens.integer(-1, i - 1);
    const flags = tokens.integer(0, 63);
    const startIndex = tokens.integer(0, componentCount);
    let count = 0;
    for (let bit = 0; bit < 6; bit++) if ((flags & (1 << bit)) !== 0) count++;
    if (startIndex + count > componentCount) tokens.fail("animated joint components exceed frame");
    rawHierarchy.push({ name, parent, flags, startIndex, scalePositions: false });
  }
  tokens.expect("}"); tokens.expect("bounds"); tokens.expect("{");
  const bounds = Array.from({ length: frameCount }, () => ({ min: tokens.vector(), max: tokens.vector() }));
  tokens.expect("}"); tokens.expect("baseframe"); tokens.expect("{");
  const baseFrame = Array.from({ length: jointCount }, () => ({ position: tokens.vector(), orientation: md5Quaternion(tokens.vector()), scale: 1 }));
  tokens.expect("}");
  const { hierarchy, scales, diagnostics } = parseScales(scaleSource, rawHierarchy, frameCount);
  const rawFrames = indexedRecords(tokens, frameCount, "frame", () => {
    tokens.expect("{");
    const frame = Array.from({ length: componentCount }, () => tokens.float());
    tokens.expect("}");
    return frame;
  });
  tokens.end();
  const frames = rawFrames.map((components, frame) => {
    const localJoints: SkeletonJointPose[] = [];
    const joints: SkeletonJointPose[] = [];
    for (let i = 0; i < jointCount; i++) {
      const info = at(hierarchy, i, "hierarchy joint");
      const base = at(baseFrame, i, "base joint");
      let component = info.startIndex;
      const animated = (bit: number, fallback: number): number => (info.flags & bit) === 0 ? fallback : at(components, component++, "animated component");
      const position = vec3(animated(1, base.position.x), animated(2, base.position.y), animated(4, base.position.z));
      const orientation = md5Quaternion(vec3(animated(8, base.orientation.x), animated(16, base.orientation.y), animated(32, base.orientation.z)));
      const scale = scales.get(`${frame}:${i}`) ?? 1;
      localJoints.push({ position, orientation, scale });
      const scaledPosition = info.scalePositions ? scale3(position, scale) : position;
      if (info.parent < 0) joints.push({ position: scaledPosition, orientation, scale });
      else {
        const parent = at(joints, info.parent, "parent joint");
        joints.push({ position: add3(parent.position, rotateQuaternion(parent.orientation, scaledPosition)), orientation: normalizeQuaternion(multiplyQuaternion(parent.orientation, orientation)), scale });
      }
    }
    return { bounds: at(bounds, frame, "frame bounds"), components, localJoints, joints };
  });
  return { source, commandLine, frameRate, hierarchy, baseFrame, frames, scaleSource: scaleSource?.source ?? null, diagnostics };
}

export function createMd5Model(mesh: Md5MeshFile, animation: Md5Animation, skinSelection: Md5Model["skinSelection"] = { kind: "mesh-shaders" }): DecodedMd5Model {
  if (mesh.joints.length !== animation.hierarchy.length) throw new RangeError(`${mesh.source}: mesh and animation joint counts differ`);
  return { kind: "md5", meshSource: mesh.source, meshCommandLine: mesh.commandLine, meshJoints: mesh.joints,
    bindPose: mesh.bindPose, animation, joints: animation.hierarchy, meshes: mesh.meshes,
    frameRate: animation.frameRate, frames: animation.frames, skinSelection };
}

/** Interpolate positions and orientations; Q2 uses the new frame's scale directly. */
export function sampleMd5Pose(model: Md5Model, frame: number, previousFrame = frame, backLerp = 0): readonly SkeletonJointPose[] {
  if (!Number.isInteger(frame) || frame < 0 || !Number.isInteger(previousFrame) || previousFrame < 0 || !Number.isFinite(backLerp)) throw new RangeError("Invalid MD5 frame selection");
  const current = at(model.frames, frame % model.frames.length, "MD5 frame").joints;
  if (backLerp === 0 || frame === previousFrame) return current;
  const previous = at(model.frames, previousFrame % model.frames.length, "MD5 previous frame").joints;
  return current.map((joint, index) => {
    const old = at(previous, index, "previous joint");
    const position = vec3(old.position.x * backLerp + joint.position.x * (1 - backLerp), old.position.y * backLerp + joint.position.y * (1 - backLerp), old.position.z * backLerp + joint.position.z * (1 - backLerp));
    return { position, orientation: slerpQuaternion(old.orientation, joint.orientation, backLerp), scale: joint.scale };
  });
}

export function skinMd5Mesh(mesh: Md5Mesh, joints: readonly SkeletonJointPose[]): readonly ModelVertex[] {
  return mesh.vertices.map(vertex => {
    let position = vec3(0, 0, 0);
    let normal = vec3(0, 0, 0);
    for (let i = 0; i < vertex.weights.count; i++) {
      const weight = at(mesh.weights, vertex.weights.first + i, "weight");
      const joint = at(joints, weight.joint, "joint");
      const rotated = rotateQuaternionAxis(joint.orientation, weight.position);
      const point = vec3(joint.position.x + joint.scale * rotated.x, joint.position.y + joint.scale * rotated.y, joint.position.z + joint.scale * rotated.z);
      const direction = rotateQuaternionAxis(joint.orientation, vertex.normal);
      position = vec3(position.x + weight.bias * point.x, position.y + weight.bias * point.y, position.z + weight.bias * point.z);
      normal = vec3(normal.x + weight.bias * direction.x, normal.y + weight.bias * direction.y, normal.z + weight.bias * direction.z);
    }
    return { position, normal };
  });
}
