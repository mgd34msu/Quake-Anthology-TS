/* Camera files and cubic B-splines adapted from Q3 code/splines/splines.cpp.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Vec3 } from "../contracts/math.ts";
import { add3, length3, normalize3, scale3, sub3 } from "../core/math.ts";
export interface CameraVelocity { readonly start: number; readonly duration: number; readonly speed: number; }
interface PositionFields { readonly name: string; readonly time: number; readonly baseVelocity: number; readonly velocities: readonly CameraVelocity[]; }
export type CameraPosition = PositionFields & ({ readonly kind: "fixed"; readonly point: Vec3 }
  | { readonly kind: "interpolated"; readonly start: Vec3; readonly end: Vec3 }
  | { readonly kind: "spline"; readonly granularity: number; readonly points: readonly Vec3[] });
export interface CameraEvent { readonly type: number; readonly param: string; readonly time: number; }
export interface CameraDefinition {
  readonly seconds: number; readonly position: CameraPosition; readonly targets: readonly CameraPosition[];
  readonly events: readonly CameraEvent[]; readonly fov: { readonly value: number; readonly start: number; readonly end: number; readonly time: number };
}
const zero: Vec3 = { x: 0, y: 0, z: 0 };
class Tokens {
  private index = 0;
  private readonly tokens: readonly string[];
  constructor(text: string) { this.tokens = text.match(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"[^"\r\n]*"|[{}()]|[^\s{}()]+/g)?.filter(token => !token.startsWith("//") && !token.startsWith("/*")) ?? []; }
  peek(): string | undefined { return this.tokens[this.index]; }
  next(): string { const value = this.tokens[this.index++]; if (value === undefined) throw new Error("Unexpected end of camera file"); return value.startsWith('"') ? value.slice(1, -1) : value; }
  expect(value: string): void { if (this.next().toLowerCase() !== value) throw new Error(`Expected camera token ${value}`); }
  number(): number { const token = this.next(), value = Number(token); if (token.trim() === "" || !Number.isFinite(value)) throw new Error(`Invalid camera number ${token}`); return value; }
  vector(): Vec3 { this.expect("("); const point = { x: this.number(), y: this.number(), z: this.number() }; this.expect(")"); return point; }
}
function position(tokens: Tokens, kind: "fixed" | "interpolated" | "spline"): CameraPosition {
  tokens.expect("{");
  let name = "position", time = 0, baseVelocity = 0, point = zero, start = zero, end = zero, granularity = 0.025;
  const velocities: CameraVelocity[] = [], points: Vec3[] = [];
  while (tokens.peek() !== "}") {
    const key = tokens.next().toLowerCase();
    switch (key) {
      case "name": name = tokens.next(); break;
      case "type": tokens.number(); break;
      case "time": time = tokens.number(); break;
      case "basevelocity": baseVelocity = tokens.number(); break;
      case "velocity": velocities.push({ start: tokens.number(), duration: tokens.number(), speed: tokens.number() }); break;
      case "pos": point = tokens.vector(); break;
      case "startpos": start = tokens.vector(); break;
      case "endpos": end = tokens.vector(); break;
      case "target": {
        tokens.expect("{");
        while (tokens.peek() !== "}") {
          if (tokens.peek() === "(") points.push(tokens.vector());
          else { const property = tokens.next().toLowerCase(); if (property === "granularity") granularity = tokens.number(); else if (property === "name") tokens.next(); else throw new Error(`Unknown spline property ${property}`); }
        }
        tokens.expect("}"); break;
      }
      default: throw new Error(`Unknown camera position property ${key}`);
    }
  }
  tokens.expect("}");
  if (time < 0 || velocities.some(value => value.start < 0 || value.duration < 0 || value.speed < 0)) throw new Error("Negative camera timing or speed");
  const fields = { name, time, baseVelocity, velocities };
  if (kind === "fixed") return { ...fields, kind, point };
  if (kind === "interpolated") return { ...fields, kind, start, end };
  if (granularity < 0.0001 || granularity > 1 || points.length < 4) throw new Error("Spline requires four points and granularity between 0.0001 and 1");
  return { ...fields, kind, granularity, points };
}
export function parseCamera(text: string): CameraDefinition {
  const tokens = new Tokens(text); if (["camera", "camerapathdef"].includes(tokens.peek()?.toLowerCase() ?? "")) tokens.next(); tokens.expect("{");
  let seconds = 30, camera: CameraPosition | null = null;
  let value = 90, start = 90, end = 90, time = 0;
  const targets: CameraPosition[] = [], events: CameraEvent[] = [];
  while (tokens.peek() !== "}") {
    const key = tokens.next().toLowerCase();
    if (key === "time") seconds = tokens.number();
    else if (key === "camera_fixed" || key === "camera_interpolated" || key === "camera_spline") camera = position(tokens, key === "camera_fixed" ? "fixed" : key === "camera_interpolated" ? "interpolated" : "spline");
    else if (key === "target_fixed" || key === "target_interpolated" || key === "target_spline") targets.push(position(tokens, key === "target_fixed" ? "fixed" : key === "target_interpolated" ? "interpolated" : "spline"));
    else if (key === "event") {
      let type = 0, param = "", eventTime = 0; tokens.expect("{");
      while (tokens.peek() !== "}") { const field = tokens.next().toLowerCase(); if (field === "type") type = tokens.number(); else if (field === "param") param = tokens.next(); else if (field === "time") eventTime = tokens.number(); else throw new Error(`Unknown camera event property ${field}`); }
      tokens.expect("}"); if (!Number.isInteger(type) || type < 0 || type > 9 || eventTime < 0) throw new Error("Invalid camera event");
      if (type === 1 && (!Number.isFinite(Number(param)) || Number(param) < 0)) throw new Error("Invalid camera wait duration");
      events.push({ type, param, time: eventTime });
    } else if (key === "fov") {
      tokens.expect("{");
      while (tokens.peek() !== "}") { const field = tokens.next().toLowerCase(); if (field === "fov") value = tokens.number(); else if (field === "startfov") start = tokens.number(); else if (field === "endfov") end = tokens.number(); else if (field === "time") time = tokens.number(); else throw new Error(`Unknown camera FOV property ${field}`); }
      tokens.expect("}");
    } else throw new Error(`Unknown camera property ${key}`);
  }
  tokens.expect("}");
  if (tokens.peek() !== undefined || camera === null || seconds <= 0 || time < 0 || [value, start, end].some(fov => fov <= 0 || fov >= 180)) throw new Error("Invalid camera definition");
  for (const event of events) if (event.type === 4 && !targets.some(target => target.name === event.param)) throw new Error(`Unknown camera target ${event.param}`);
  return { seconds, position: camera, targets, events, fov: { value, start, end, time } };
}
function quote(value: string): string { if (/["\r\n]/.test(value)) throw new Error("Camera names cannot contain quotes or newlines"); return `"${value}"`; }
function vector(value: Vec3): string { return `( ${value.x} ${value.y} ${value.z} )`; }
export function serializeCamera(camera: CameraDefinition): string {
  const write = (path: CameraPosition, prefix: string): string => `${prefix}_${path.kind} {\nname ${quote(path.name)}\ntime ${path.time}\nbaseVelocity ${path.baseVelocity}\n`
    + path.velocities.map(item => `velocity ${item.start} ${item.duration} ${item.speed}\n`).join("")
    + (path.kind === "fixed" ? `pos ${vector(path.point)}\n` : path.kind === "interpolated" ? `startPos ${vector(path.start)}\nendPos ${vector(path.end)}\n`
      : `target {\ngranularity ${path.granularity}\n${path.points.map(vector).join("\n")}\n}\n`) + "}\n";
  return `cameraPathDef {\ntime ${camera.seconds}\n${write(camera.position, "camera")}${camera.targets.map(target => write(target, "target")).join("")}`
    + camera.events.map(event => `event {\ntype ${event.type}\nparam ${quote(event.param)}\ntime ${event.time}\n}\n`).join("")
    + `fov {\nfov ${camera.fov.value}\nstartFOV ${camera.fov.start}\nendFOV ${camera.fov.end}\ntime ${camera.fov.time}\n}\n}\n`;
}
function splinePoints(path: Extract<CameraPosition, { readonly kind: "spline" }>): readonly Vec3[] {
  const result: Vec3[] = [], f = Math.fround;
  for (let i = 3; i < path.points.length; i++) for (let t = 0; t < 1.001; t = f(t + path.granularity)) {
    const weights = [f((1 - t) ** 3 / 6), f((3 * t ** 3 - 6 * t ** 2 + 4) / 6), f((-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6), f(t ** 3 / 6)];
    let point = zero;
    for (let j = 0; j < 4; j++) { const source = path.points[i - 3 + j], weight = weights[j]; if (source === undefined || weight === undefined) throw new Error("Invalid spline control span"); point = { x: f(point.x + f(source.x * weight)), y: f(point.y + f(source.y * weight)), z: f(point.z + f(source.z * weight)) }; }
    result.push(point);
  }
  return result;
}
class PositionPlayback {
  private startTime = 0;
  private lastTime = 0;
  private traveled = 0;
  private readonly points: readonly Vec3[];
  private readonly distances: readonly number[];
  private readonly distance: number;
  constructor(readonly path: CameraPosition, private duration: number, private readonly velocities: readonly CameraVelocity[] = path.velocities) {
    this.points = path.kind === "spline" ? splinePoints(path) : path.kind === "fixed" ? [path.point] : [path.start, path.end];
    const distances = [0]; let distance = 0;
    for (let i = 1; i < this.points.length; i++) { const previous = this.points[i - 1], current = this.points[i]; if (previous !== undefined && current !== undefined) distance += length3(sub3(current, previous)); distances.push(distance); }
    this.distance = distance; this.distances = distances;
  }
  start(time: number, duration = this.duration): void { this.startTime = time; this.lastTime = time; this.traveled = 0; this.duration = duration; }
  sample(time: number): Vec3 {
    const path = this.path;
    if (path.kind === "fixed") return path.point;
    if (path.kind === "interpolated") {
      const elapsed = time - this.startTime, velocity = this.velocities.find(item => elapsed >= item.start && elapsed <= item.start + item.duration)?.speed ?? this.distance / (this.duration / 1000);
      this.traveled += Math.max(0, time - this.lastTime) / 1000 * velocity; this.lastTime = time;
      const fraction = this.distance === 0 ? 0 : Math.max(0, Math.min(1, this.traveled / this.distance));
      return add3(scale3(path.start, 1 - fraction), scale3(path.end, fraction));
    }
    const desired = this.duration === 0 ? this.distance : (time - this.startTime) / this.duration * this.distance;
    let index = this.distances.findIndex(distance => distance >= desired); if (index < 0) index = this.points.length - 1;
    const low = this.points[index - 1], high = this.points[index + 1], lo = this.distances[index - 1], hi = this.distances[index + 1];
    if (low !== undefined && high !== undefined && lo !== undefined && hi !== undefined && hi > lo) { const fraction = (desired - lo) / (hi - lo); return add3(scale3(low, 1 - fraction), scale3(high, fraction)); }
    return this.points[index] ?? zero;
  }
}
export interface CameraSample { readonly origin: Vec3; readonly direction: Vec3; readonly fov: number; readonly events: readonly CameraEvent[]; }
export class CameraPlayback {
  private readonly camera: PositionPlayback;
  private readonly targets: readonly PositionPlayback[];
  private readonly triggered = new Set<CameraEvent>();
  private activeTarget = 0;
  private stopped = false;
  private readonly totalMilliseconds: number;
  private lastTime: number;
  constructor(readonly definition: CameraDefinition, readonly startTime: number) {
    const waits = definition.events.filter(event => event.type === 1);
    this.totalMilliseconds = definition.seconds * 1000 + waits.reduce((sum, event) => sum + Number(event.param) * 1000, 0);
    this.camera = new PositionPlayback(definition.position, definition.seconds * 1000, [...definition.position.velocities, ...waits.map(event => ({ start: event.time, duration: Number(event.param) * 1000, speed: 0 }))]);
    this.camera.start(startTime); this.lastTime = startTime;
    this.targets = definition.targets.map(target => new PositionPlayback(target, target.time || this.totalMilliseconds));
    for (const target of this.targets) target.start(startTime);
    const changes = definition.events.filter(event => event.type === 4); let timeSoFar = 0;
    for (const [index, event] of changes.entries()) { const duration = changes[index + 1]?.time ?? this.totalMilliseconds - timeSoFar;
      const targetIndex = definition.targets.findIndex(target => target.name === event.param), target = this.targets[targetIndex];
      if (target !== undefined) { target.start(startTime, duration); this.activeTarget = targetIndex; } timeSoFar += duration; }
  }
  sample(time: number): CameraSample | null {
    if (!Number.isFinite(time) || time < this.lastTime) throw new RangeError("Camera playback requires a monotonic clock"); this.lastTime = time;
    if (this.stopped || Math.trunc((time - this.startTime) / 1000) > this.totalMilliseconds / 1000) return null;
    const events: CameraEvent[] = [];
    for (const event of this.definition.events) if (!this.triggered.has(event) && time >= this.startTime + event.time) {
      this.triggered.add(event); events.push(event);
      if (event.type === 9) { this.stopped = true; return null; }
      if (event.type === 4) { this.activeTarget = this.definition.targets.findIndex(target => target.name === event.param); this.targets[this.activeTarget]?.start(this.startTime + event.time); }
    }
    const origin = this.camera.sample(time), target = this.targets[this.activeTarget]?.sample(time) ?? origin;
    const fov = this.definition.fov, fraction = fov.time === 0 ? 0 : Math.max(0, Math.min(1, (time - this.startTime) / fov.time));
    return { origin, direction: normalize3(sub3(target, origin)), fov: fov.time === 0 ? fov.value : fov.start + (fov.end - fov.start) * fraction, events };
  }
}
