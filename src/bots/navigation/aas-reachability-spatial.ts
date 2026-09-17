/* Source AAS sampling and entity queries over shared assets. GPL-2.0-or-later. */
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import { add3, angleVectors, cross3, dot3, length3, normalize3, scale3, sub3, vec3 } from "../../core/math.ts";
import { nativeAtof, nativeAtoi } from "../../core/numeric.ts";
import { parseEntities } from "../../formats/q3-map/entities.ts";
import { convertContents, convertSurfaceFlags } from "../../world/collision/contents.ts";
import { aasBBoxAreas, aasTraceAreas } from "./aas.ts";
import { aasAt } from "./aas-reachability-geometry.ts";
import type { AasReachabilityOptions } from "./aas-reachability.ts";
import type { AasClientMove, AasMovementSettings, AasReachabilityWorld } from "./aas-reachability-types.ts";
import type { BotMovementPrediction } from "../behavior/q3/navigation-types.ts";

const f = Math.fround, zero = vec3(0, 0, 0);
const ma = (start: Vec3, amount: number, direction: Vec3): Vec3 => add3(start, scale3(direction, amount));
const same = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
const at = aasAt;
interface AasTrace { readonly startSolid: boolean; readonly fraction: number; readonly end: Vec3; readonly entityNum: number; readonly lastArea: number; readonly area: number; readonly plane: number; }
interface TracePiece { readonly start: Vec3; readonly end: Vec3; readonly node: number; readonly plane: number; }
interface AreaLink { readonly area: number; readonly nextArea: AreaLink | null; }
function finiteVector(point: Vec3): void { if (![point.x, point.y, point.z].every(Number.isFinite)) throw new RangeError("Non-finite AAS trace point"); }
function clearTrace(end: Vec3, lastArea: number): AasTrace { return { startSolid: false, fraction: 1, end, entityNum: 0, lastArea, area: 0, plane: 0 }; }

function decimalInteger(text: string): number {
  const prefix = /^[\t\n\v\f\r ]*([+-]?)([0-9]+)/.exec(text);
  if (prefix !== null) {
    const sign = prefix[1];
    const digits = prefix[2];
    if (sign === undefined || digits === undefined) throw new Error("Integer prefix capture is absent");
    const magnitude = BigInt(digits);
    if (magnitude > (sign === "-" ? 2147483648n : 2147483647n)) {
      throw new RangeError("AAS integer epair conversion exceeds the source-defined int32 range");
    }
  }
  return nativeAtoi(text);
}

function digit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function hexDigit(character: string | undefined): boolean {
  return digit(character) || (character !== undefined
    && ((character >= "a" && character <= "f") || (character >= "A" && character <= "F")));
}

interface ScannedFloat {
  readonly value: number;
  readonly end: number;
}

// C-locale glibc 2.44 %lf consumption, followed by native atof conversion.
// Unlike atof, an incomplete exponent/infinity/payload fails this conversion.
function scanFloat(text: string, start: number): ScannedFloat | null {
  let cursor = start;
  while (cursor < text.length && /[\t\n\v\f\r ]/.test(text.charAt(cursor))) cursor++;
  const beginning = cursor;
  if (text[cursor] === "+" || text[cursor] === "-") cursor++;
  const word = text.slice(cursor).toLowerCase();
  if (word.startsWith("inf")) {
    if (word.charAt(3) === "i") {
      if (!word.startsWith("infinity")) return null;
      cursor += 8;
    } else cursor += 3;
  } else if (word.startsWith("nan")) {
    cursor += 3;
    if (text[cursor] === "(") {
      cursor++;
      while (cursor < text.length && /[a-zA-Z0-9_]/.test(text.charAt(cursor))) cursor++;
      if (text[cursor] !== ")") return null;
      cursor++;
    }
  } else {
    const hexadecimal = word.startsWith("0x");
    if (hexadecimal) cursor += 2;
    const isDigit = hexadecimal ? hexDigit : digit;
    let digits = 0;
    while (isDigit(text[cursor])) { cursor++; digits++; }
    if (text[cursor] === ".") {
      cursor++;
      while (isDigit(text[cursor])) { cursor++; digits++; }
    }
    if (digits === 0) return null;
    const exponent = text.charAt(cursor).toLowerCase();
    if (exponent === (hexadecimal ? "p" : "e")) {
      cursor++;
      if (text[cursor] === "+" || text[cursor] === "-") cursor++;
      const exponentStart = cursor;
      while (digit(text[cursor])) cursor++;
      if (cursor === exponentStart) return null;
    }
  }
  return { value: nativeAtof(text.slice(beginning, cursor)), end: cursor };
}

export class AasReachabilityEntities {
  private readonly records: readonly ReadonlyMap<string, string>[];
  constructor(text: string) {
    this.records = parseEntities(text);
    if (this.records.length >= 2048) throw new RangeError("Too many BSP entities for AAS generation");
  }
  nextEntity(previous: number): number { const next = previous + 1; return next > 0 && next <= this.records.length ? next : 0; }
  value(entity: number, key: string, output: Uint8Array): boolean {
    if (output.length === 0) throw new RangeError("Empty BSP epair output");
    output[0] = 0;
    const value = this.records[entity - 1]?.get(key);
    if (value === undefined) return false;
    output.fill(0);
    for (let i = 0; i < Math.min(value.length, output.length - 1); i++) output[i] = value.charCodeAt(i);
    return true;
  }
  private text(entity: number, key: string): string | null { return this.records[entity - 1]?.get(key)?.split("\0", 1)[0]?.slice(0, 127) ?? null; }
  int(entity: number, key: string): { readonly found: boolean; readonly value: number } {
    const text = this.text(entity, key); return { found: text !== null, value: text === null ? 0 : decimalInteger(text) };
  }
  float(entity: number, key: string): { readonly found: boolean; readonly value: number } {
    const text = this.text(entity, key); return { found: text !== null, value: text === null ? 0 : f(nativeAtof(text)) };
  }
  vector(entity: number, key: string): { readonly found: boolean; readonly value: Vec3 } {
    const text = this.text(entity, key), value = { x: 0, y: 0, z: 0 };
    let cursor = 0;
    if (text !== null) for (const axis of ["x", "y", "z"] satisfies readonly (keyof Vec3)[]) {
      const scanned = scanFloat(text, cursor); if (scanned === null) break;
      value[axis] = f(scanned.value); cursor = scanned.end;
    }
    return { found: text !== null, value };
  }
}

export class AasReachabilitySpatial {
  constructor(private readonly options: AasReachabilityOptions, private readonly world: AasReachabilityWorld,
    private readonly entities: AasReachabilityEntities, private readonly settings: Readonly<AasMovementSettings>) {}
  readonly host = {
    pointContents: (point: Vec3): number => {
      const value = this.options.scene.pointContents({ point, target: { kind: "world" },
        policy: { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true }, numeric: this.options.profile.movement.numeric, passActor: null });
      return value.kind === "q2" ? convertContents(value.merged, "q2", "q3") : convertContents(value.contents, value.kind, "q3");
    },
    trace: (start: Vec3, end: Vec3, bounds: Bounds | null, _passEntity: number, mask: number) => {
      const trace = this.options.scene.trace({ start, end, shape: bounds === null ? { kind: "point" } : { kind: "box", bounds },
        target: { kind: "world" }, policy: { kind: "q3", contentsMask: mask, curves: true, playerCurveClip: true },
        numeric: this.options.profile.movement.numeric, passActor: null });
      const flags = trace.kind === "q2" ? trace.surface?.flags ?? 0 : trace.surfaceFlags ?? 0;
      return { ...trace, surfaceFlags: convertSurfaceFlags(flags, trace.kind, "q3") };
    },
    modelBounds: (model: number, angles: Vec3): { readonly bounds: Bounds; readonly origin: Vec3 } => {
      const record = this.options.geometry.models[model];
      if (record === undefined) throw new RangeError(`AAS reachability index ${model} outside ${this.options.geometry.models.length}`);
      let bounds = record.bounds;
      if (angles.x !== 0 || angles.y !== 0 || angles.z !== 0) {
        const radius = length3(vec3(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)), Math.max(Math.abs(bounds.min.y), Math.abs(bounds.max.y)), Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z))));
        bounds = { min: vec3(-radius, -radius, -radius), max: vec3(radius, radius, radius) };
      }
      return { bounds, origin: zero };
    },
  };
  readonly movement = {
    predictClientMovement: (request: BotMovementPrediction): { readonly success: boolean; readonly move: AasClientMove } => {
      const result = this.options.predictClientMovement({ ...request, entityNum: this.options.predictionClient });
      if (result.endArea === null) throw new Error("AAS generation prediction requires an AAS end area");
      const frames = result.stopEvent === 0 ? result.frames : Math.max(0, result.frames - 1);
      return { success: true, move: { end: result.end, velocity: result.velocity, frames, time: f(frames * request.frameTime),
        stopEvent: result.stopEvent, endArea: result.endArea } };
    },
    horizontalVelocityForJump: (zVelocity: number, start: Vec3, end: Vec3): { readonly success: boolean; readonly velocity: number } => {
      const gravity = this.settings.gravity, maximum = this.settings.maxVelocity, ascent = f(zVelocity / gravity);
      const maximumJump = f(0.5 * gravity * ascent * ascent), height = f(f(start.z + maximumJump) - end.z);
      if (height < 0) return { success: false, velocity: maximum };
      const time = f(Math.sqrt(height / (0.5 * gravity))), denominator = f(time + ascent);
      if (denominator === 0) return { success: false, velocity: maximum };
      const direction = sub3(end, start), speed = f(Math.sqrt(f(f(direction.x * direction.x) + f(direction.y * direction.y))) / denominator);
      return speed > maximum ? { success: false, velocity: maximum } : { success: true, velocity: speed };
    },
    rocketJumpZVelocity: (origin: Vec3): number => {
      const { forward, right } = angleVectors(vec3(90, 0, 0));
      const start = vec3(f(origin.x + f(f(forward.x * 8) + f(right.x * 8))), f(origin.y + f(f(forward.y * 8) + f(right.y * 8))), f(f(origin.z + 8) + f(f(f(forward.z * 8) + f(right.z * 8)) - 8)));
      const trace = this.host.trace(start, ma(start, 500, forward), null, 1, 1);
      const distance = length3(sub3(trace.end, vec3(origin.x, origin.y, origin.z + 4))), points = f(Math.max(0, f(120 - 0.5 * distance)) * 0.5);
      const direction = normalize3(sub3(origin, trace.end));
      return f(f(direction.z * (1600 * points / 200)) + this.settings.jumpVelocity);
    },
  };
  traceAreas(start: Vec3, end: Vec3, maximum: number) { return aasTraceAreas(this.world, start, end, maximum); }
  traceClientBBox(start: Vec3, end: Vec3, presence: number, _passEntity: number): AasTrace {
    const world = this.world, print = (text: string) => this.options.print?.(3, text);
    finiteVector(start); finiteVector(end);
    const stack: TracePiece[] = [{ start: vec3(start.x, start.y, start.z), end: vec3(end.x, end.y, end.z), node: 1, plane: 0 }];
    let lastArea = 0;
    const push = (piece: TracePiece): boolean => {
      stack.push(piece);
      if (stack.length < 127) return true;
      print("AAS_TraceBoundingBox: stack overflow\n");
      return false;
    };
    const overflow = (): AasTrace => ({ startSolid: false, fraction: 0, end: vec3(0, 0, 0), entityNum: 0,
      lastArea, area: 0, plane: 0 });
    while (stack.length > 0) {
      const piece = stack.pop();
      if (piece === undefined) break;
      if (piece.node <= 0) {
        if (piece.node === 0 || (at(world.settings, -piece.node).presence & presence) === 0) {
          const startSolid = same(piece.start, start), direction = startSolid ? zero : normalize3(sub3(end, start));
          const fraction = startSolid ? 0 : f(length3(sub3(piece.start, start)) / length3(sub3(end, start)));
          const hitEnd = startSolid ? piece.start : ma(piece.start, -0.125, direction);
          const plane = dot3(direction, at(world.planes, piece.plane).normal) > 0 ? piece.plane ^ 1 : piece.plane;
          return { startSolid, fraction, end: hitEnd, entityNum: 0, lastArea, area: piece.node === 0 ? 0 : -piece.node, plane };
        }
        lastArea = -piece.node;
        continue;
      }
      const node = at(world.nodes, piece.node), plane = at(world.planes, node.plane);
      let front = f(dot3(piece.start, plane.normal) - plane.distance);
      const back = f(dot3(piece.end, plane.normal) - plane.distance);
      if (front >= 0 && back >= 0) { if (!push({ ...piece, node: node.children[0] })) return overflow(); }
      else if (front < 0 && back < 0) { if (!push({ ...piece, node: node.children[1] })) return overflow(); }
      else {
        if (front === back) front = f(front - f(0.001));
        let fraction = f((front < 0 ? front + 0.125 : front - 0.125) / f(front - back));
        if (fraction < 0) fraction = f(0.001);
        else if (fraction > 1) fraction = f(0.999);
        const middle = ma(piece.start, fraction, sub3(piece.end, piece.start)), side = front < 0 ? 1 : 0;
        if (!push({ start: middle, end: piece.end, node: node.children[side === 0 ? 1 : 0], plane: node.plane })) return overflow();
        if (!push({ start: piece.start, end: middle, node: node.children[side], plane: piece.plane })) return overflow();
      }
    }
    return clearTrace(end, lastArea);
  }
  linkClientBounds(_entity: number, bounds: Bounds, presence: 2 | 4): AreaLink | null {
    const client = this.world.bboxes.find(box => box.presence === presence)?.bounds
      ?? (presence === 4 ? this.options.profile.crouchedShape?.bounds : this.options.profile.shape.bounds);
    if (client === undefined) throw new Error(`Missing AAS presence bounds ${presence}`);
    const areas = aasBBoxAreas(this.world, { min: sub3(bounds.min, client.max), max: sub3(bounds.max, client.min) });
    let head: AreaLink | null = null;
    for (let i = areas.length - 1; i >= 0; i--) head = { area: aasAt(areas, i), nextArea: head };
    return head;
  }
  bestReachableArea(origin: Vec3, bounds: Bounds): { readonly area: number; readonly origin: Vec3 } {
    let start = origin, area = this.world.pointArea(start);
    for (let i = 0; i < 5 && area === 0; i++) for (let j = 0; j < 5 && area === 0; j++)
      for (let k = -1; k <= 1 && area === 0; k++) for (let l = -1; l <= 1 && area === 0; l++) {
        start = vec3(origin.x + j * 4 * k, origin.y + j * 4 * l, origin.z + i * 4); area = this.world.pointArea(start);
      }
    if (area !== 0) {
      const end = vec3(start.x, start.y, start.z - 50); start = vec3(start.x, start.y, start.z + 0.25);
      const trace = this.traceClientBBox(start, end, 4, -1);
      if (trace.startSolid) return { area, origin: start };
      area = this.world.pointArea(trace.end); if (area !== 0) return { area, origin: trace.end };
    }
    const head = this.linkClientBounds(-1, { min: add3(origin, bounds.min), max: add3(origin, bounds.max) }, 4);
    for (let link = head; link !== null; link = link.nextArea) if ((aasAt(this.world.settings, link.area).flags & 5) !== 0) return { area: link.area, origin };
    for (let link = head; link !== null; link = link.nextArea) if (link.area !== 0) return { area: link.area, origin };
    return { area: 0, origin };
  }
  dropToFloor(origin: Vec3, bounds: Bounds): { readonly success: boolean; readonly origin: Vec3 } {
    const trace = this.host.trace(origin, vec3(origin.x, origin.y, origin.z - 100), bounds, 0, 1);
    return trace.startSolid ? { success: false, origin } : { success: true, origin: trace.end };
  }
  pointInsideFace(number: number, point: Vec3, epsilon: number): boolean {
    const face = aasAt(this.world.faces, number), normal = aasAt(this.world.planes, face.plane).normal;
    for (let i = 0; i < face.edgeCount; i++) {
      const number = aasAt(this.world.edgeIndexes, face.firstEdge + i), edge = aasAt(this.world.edges, Math.abs(number));
      const origin = aasAt(this.world.vertices, edge.vertices[number < 0 ? 1 : 0]);
      const direction = sub3(aasAt(this.world.vertices, edge.vertices[number < 0 ? 0 : 1]), origin);
      if (dot3(sub3(point, origin), cross3(direction, normal)) < -f(epsilon)) return false;
    }
    return true;
  }
  getJumpPadInfo(entity: number): { readonly start: Vec3; readonly bounds: Bounds; readonly velocity: Vec3 } | null {
    const modelBuffer = new Uint8Array(128), targetBuffer = new Uint8Array(128), nameBuffer = new Uint8Array(128);
    const text = (bytes: Uint8Array): string => Array.from(bytes.subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0)), byte => String.fromCharCode(byte)).join("");
    this.entities.value(entity, "model", modelBuffer);
    const modelName = text(modelBuffer), model = this.host.modelBounds(modelName === "" ? 0 : nativeAtoi(modelName.slice(1)), zero);
    const bounds = { min: add3(model.origin, model.bounds.min), max: add3(model.origin, model.bounds.max) }, center = scale3(add3(bounds.min, bounds.max), 0.5);
    const trace = this.traceClientBBox(vec3(center.x, center.y, center.z + 64), center, 4, -1);
    const bottom = trace.startSolid ? center : trace.end, start = vec3(bottom.x, bottom.y, bottom.z + 0.125);
    this.entities.value(entity, "target", targetBuffer);
    const targetName = text(targetBuffer);
    let target = this.entities.nextEntity(0);
    for (; target !== 0; target = this.entities.nextEntity(target)) if (this.entities.value(target, "targetname", nameBuffer) && text(nameBuffer) === targetName) break;
    if (target === 0) { this.options.print?.(1, `trigger_push without target entity ${targetName}\n`); return null; }
    const destination = this.entities.vector(target, "origin").value, height = f(destination.z - center.z);
    const time = f(Math.sqrt(height / (0.5 * f(this.settings.gravity))));
    if (time === 0) return null;
    if (!Number.isFinite(time)) throw new RangeError("Jump-pad target produces a non-finite source flight time");
    const delta = sub3(destination, center), distance = length3(delta), forward = f(f(distance / time) * f(1.1));
    const push = scale3(normalize3(delta), forward);
    return { start, bounds, velocity: vec3(push.x, push.y, time * f(this.settings.gravity)) };
  }
}
