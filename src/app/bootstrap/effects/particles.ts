/* Source particle constructors from Quake r_part.c and Quake II cl_fx.c.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Vec3 } from "../../../contracts/math.ts";
import type { SceneParticle } from "../../../contracts/scene.ts";
import { add3, anglesToAxis, cross3, dot3, length3, normalize3OrZero, scale3, sub3 } from "../../../core/math.ts";
import { advanceQ1Particle, sampleQ2Particle } from "../../../render/scene/particles/legacy.ts";
import type { Q1ParticleState, Q2ParticleState } from "../../../render/scene/particles/legacy.ts";
import { SourceRandom } from "../simulation/random.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
const gravity: Vec3 = { x: 0, y: 0, z: -40 };
export class SourceParticles {
  private q1: Q1ParticleState[] = [];
  private q2: Q2ParticleState[] = [];
  constructor(readonly random: SourceRandom, readonly capacity = 4096) {}
  private rand(): number { return this.random.nextInteger(); }
  private unit(): number { return (this.rand() & 32767) / 32767; }
  private signed(): number { return 2 * this.unit() - 1; }
  private xyz(value: () => number): Vec3 { return { x: value(), y: value(), z: value() }; }
  private first(particle: Q1ParticleState): boolean { if (this.q1.length === this.capacity) return false; this.q1.push(particle); return true; }
  private second(particle: Q2ParticleState): boolean { if (this.q2.length === this.capacity) return false; this.q2.push(particle); return true; }
  clear(): void { this.q1 = []; this.q2 = []; }
  sample(seconds: number, elapsed: number): { readonly q1: readonly SceneParticle[]; readonly q2: readonly SceneParticle[] } {
    this.q1 = this.q1.filter(particle => particle.die >= seconds);
    const q1: SceneParticle[] = this.q1.slice().reverse().map(particle => ({ kind: "indexed", origin: particle.origin, paletteIndex: particle.color, alpha: 1, size: 1 }));
    this.q1 = this.q1.map(particle => advanceQ1Particle(particle, elapsed, 800));
    const q2: SceneParticle[] = [], retained: Q2ParticleState[] = [];
    for (const particle of this.q2) { const sample = sampleQ2Particle(particle, seconds * 1000); if (sample !== null) { q2.unshift(sample); if (particle.alphaVelocity !== -10000) retained.push(particle); } }
    this.q2 = retained;
    return { q1, q2 };
  }
  q1Impact(origin: Vec3, direction: Vec3, color: number, count: number, seconds: number): void {
    if (count === 1024) { this.q1Explosion(origin, seconds, false); return; }
    for (let i = 0; i < count; i++) {
      const die = seconds + 0.1 * (this.rand() % 5), shade = (color & ~7) + (this.rand() & 7);
      if (!this.first({ origin: add3(origin, this.xyz(() => (this.rand() & 15) - 8)), velocity: scale3(direction, 15),
        die, color: shade, ramp: 0, type: "slow-gravity" })) return;
    }
  }
  q1Explosion(origin: Vec3, seconds: number, blob: boolean): void {
    for (let i = 0; i < 1024; i++) {
      const die = seconds + (blob ? 1 + (this.rand() & 8) * 0.05 : 5);
      const ramp = blob ? 0 : this.rand() & 3, color = blob ? (i & 1 ? 66 : 150) + this.rand() % 6 : 111;
      const component = (base: number): readonly [number, number] => [base + this.rand() % 32 - 16, this.rand() % 512 - 256];
      const x = component(origin.x), y = component(origin.y), z = component(origin.z);
      if (!this.first({ origin: { x: x[0], y: y[0], z: z[0] }, velocity: { x: x[1], y: y[1], z: z[1] }, color, ramp, die,
        type: blob ? i & 1 ? "blob" : "blob2" : i & 1 ? "explode" : "explode2" })) return;
    }
  }
  q1ColorExplosion(origin: Vec3, seconds: number, colorStart: number, colorLength: number): void {
    if (!Number.isInteger(colorStart) || colorStart < 0 || colorStart > 255 || !Number.isInteger(colorLength) || colorLength < 1 || colorLength > 255)
      throw new Error("Invalid Quake colored explosion palette range");
    for (let i = 0; i < 512 && this.q1.length < this.capacity; i++) {
      const component = (base: number): readonly [number, number] => [base + this.rand() % 32 - 16, this.rand() % 512 - 256];
      const x = component(origin.x), y = component(origin.y), z = component(origin.z);
      this.first({ origin: { x: x[0], y: y[0], z: z[0] }, velocity: { x: x[1], y: y[1], z: z[1] },
        color: colorStart + i % colorLength, ramp: 0, die: seconds + 0.3, type: "blob" });
    }
  }
  q1Splash(origin: Vec3, seconds: number, lava: boolean): void {
    const step = lava ? 1 : 4;
    for (let i = -16; i < 16; i += step) for (let j = -16; j < 16; j += step) for (let k = lava ? 0 : -24; k < (lava ? 1 : 32); k += 4) {
      const die = seconds + (lava ? 2 + (this.rand() & 31) * 0.02 : 0.2 + (this.rand() & 7) * 0.02), color = (lava ? 224 : 7) + (this.rand() & 7);
      const direction = lava ? { x: j * 8 + (this.rand() & 7), y: i * 8 + (this.rand() & 7), z: 256 } : { x: j * 8, y: i * 8, z: k * 8 };
      const point = lava ? { x: origin.x + direction.x, y: origin.y + direction.y, z: origin.z + (this.rand() & 63) }
        : add3(origin, { x: i + (this.rand() & 3), y: j + (this.rand() & 3), z: k + (this.rand() & 3) });
      if (!this.first({ origin: point, velocity: scale3(normalize3OrZero(direction), 50 + (this.rand() & 63)), color, die, ramp: 0, type: "slow-gravity" })) return;
    }
  }
  q2Impact(origin: Vec3, direction: Vec3, color: number, count: number, seconds: number, variant: "normal" | "fixed" | "up" | "blaster" = "normal"): void {
    for (let i = 0; i < count; i++) {
      const shade = color + (variant === "fixed" || variant === "up" ? 0 : this.rand() & 7), distance = this.rand() & (variant === "normal" ? 31 : variant === "blaster" ? 15 : 7);
      const component = (base: number, dir: number): readonly [number, number] => [base + (this.rand() & 7) - 4 + distance * dir,
        variant === "blaster" ? dir * 30 + this.signed() * 40 : this.signed() * 20];
      const x = component(origin.x, direction.x), y = component(origin.y, direction.y), z = component(origin.z, direction.z);
      if (!this.second({ spawnMilliseconds: seconds * 1000, origin: { x: x[0], y: y[0], z: z[0] }, velocity: { x: x[1], y: y[1], z: z[1] },
        acceleration: variant === "up" ? scale3(gravity, -1) : gravity, color: shade, alpha: 1, alphaVelocity: -1 / (0.5 + this.unit() * 0.3) })) return;
    }
  }
  q2Explosion(origin: Vec3, seconds: number, bfg: boolean): void {
    for (let i = 0; i < 256; i++) {
      const color = (bfg ? 0xd0 : 0xe0) + (this.rand() & 7);
      const component = (base: number): readonly [number, number] => [base + this.rand() % 32 - 16, this.rand() % 384 - 192];
      const x = component(origin.x), y = component(origin.y), z = component(origin.z);
      if (!this.second({ spawnMilliseconds: seconds * 1000, origin: { x: x[0], y: y[0], z: z[0] }, velocity: { x: x[1], y: y[1], z: z[1] },
        acceleration: gravity, color, alpha: 1, alphaVelocity: -0.8 / (0.5 + this.unit() * 0.3) })) return;
    }
  }
  q2ColorExplosion(origin: Vec3, seconds: number, color: number, run: number): void {
    for (let i = 0; i < 128 && this.q2.length < this.capacity; i++) {
      const shade = color + this.rand() % run;
      const component = (base: number): readonly [number, number] => [base + this.rand() % 32 - 16, this.rand() % 256 - 128];
      const x = component(origin.x), y = component(origin.y), z = component(origin.z);
      this.second({ spawnMilliseconds: seconds * 1000, origin: { x: x[0], y: y[0], z: z[0] }, velocity: { x: x[1], y: y[1], z: z[1] },
        acceleration: gravity, color: shade, alpha: 1, alphaVelocity: -0.4 / (0.6 + this.unit() * 0.2) });
    }
  }
  /** q2repro newfx.c CL_BerserkSlamParticles. */
  q2BerserkSlam(origin: Vec3, direction: Vec3, seconds: number): void {
    const initial = { x: direction.z, y: -direction.x, z: direction.y };
    const right = normalize3OrZero(sub3(initial, scale3(direction, dot3(initial, direction)))), up = cross3(right, direction);
    for (let i = 0; i < 700 && this.q2.length < this.capacity; i++) {
      const color = 110 + 2 * (this.rand() & 3);
      const velocity = add3(add3(scale3(direction, this.unit() * 192), scale3(right, this.signed() * 192)), scale3(up, this.signed() * 192));
      this.second({ spawnMilliseconds: seconds * 1000, origin, velocity, acceleration: zero, color, alpha: 1,
        alphaVelocity: -1 / (0.5 + this.unit() * 0.3) });
    }
  }
  q2Steam(origin: Vec3, direction: Vec3, color: number, count: number, magnitude: number, seconds: number, smoke = false): boolean {
    const initial = { x: direction.z, y: -direction.x, z: direction.y };
    const right = normalize3OrZero(sub3(initial, scale3(direction, dot3(initial, direction)))), up = cross3(right, direction);
    for (let i = 0; i < count; i++) {
      if (this.q2.length === this.capacity) return false;
      const shade = color + (this.rand() & 7), point = add3(origin, this.xyz(() => magnitude * 0.1 * this.signed()));
      const velocity = add3(add3(scale3(direction, magnitude), scale3(right, this.signed() * magnitude / 3)), scale3(up, this.signed() * magnitude / 3));
      this.second({ spawnMilliseconds: seconds * 1000, origin: point, velocity, acceleration: smoke ? zero : scale3(gravity, 0.5),
        color: shade, alpha: 1, alphaVelocity: -1 / (0.5 + this.unit() * 0.3) });
    }
    return true;
  }
  q2ForceWall(start: Vec3, end: Vec3, color: number, seconds: number): void {
    const delta = sub3(end, start), length = length3(delta), direction = normalize3OrZero(delta);
    for (let distance = 0; distance < length && this.q2.length < this.capacity; distance += 4) {
      if (this.unit() <= 0.3) continue;
      const alphaVelocity = -1 / (3 + this.unit() * 0.5);
      const origin = add3(add3(start, scale3(direction, distance)), this.xyz(() => this.signed() * 3));
      this.second({ spawnMilliseconds: seconds * 1000, origin, velocity: { x: 0, y: 0, z: -40 - this.signed() * 10 },
        acceleration: zero, color, alpha: 1, alphaVelocity });
    }
  }
  q2TrackerTrail(start: Vec3, end: Vec3, seconds: number): void {
    const delta = sub3(end, start), length = length3(delta), direction = normalize3OrZero(delta);
    const horizontal = Math.hypot(direction.x, direction.y);
    const axis = anglesToAxis({ x: -Math.atan2(direction.z, horizontal) * 180 / Math.PI,
      y: horizontal === 0 ? 0 : Math.atan2(direction.y, direction.x) * 180 / Math.PI, z: 0 });
    for (let distance = 0; distance < length && this.q2.length < this.capacity; distance += 3) {
      const point = add3(start, scale3(direction, distance));
      this.second({ spawnMilliseconds: seconds * 1000, origin: add3(point, scale3(axis[2], 8 * Math.cos(dot3(point, axis[0])))),
        velocity: { x: 0, y: 0, z: 5 }, acceleration: zero, color: 0, alpha: 1, alphaVelocity: -2 });
    }
  }
  q2TrackerShell(origin: Vec3, seconds: number): void {
    for (let i = 0; i < 300 && this.q2.length < this.capacity; i++) this.second({ spawnMilliseconds: seconds * 1000,
      origin: add3(origin, scale3(normalize3OrZero(this.xyz(() => this.signed())), 40)), velocity: zero,
      acceleration: zero, color: 0, alpha: 1, alphaVelocity: -10000 });
  }
  q2Respawn(origin: Vec3, seconds: number, kind: "item" | "login" | "logout" | "respawn"): void {
    const logout = kind !== "item", baseColor = kind === "login" ? 0xd0 : kind === "logout" ? 0x40 : kind === "respawn" ? 0xe0 : 0xd4;
    for (let i = 0; i < (logout ? 500 : 64); i++) {
      const color = baseColor + (this.rand() & (logout ? 7 : 3));
      const point = logout ? add3(origin, { x: -16 + this.unit() * 32, y: -16 + this.unit() * 32, z: -24 + this.unit() * 56 }) : add3(origin, this.xyz(() => this.signed() * 8));
      if (!this.second({ spawnMilliseconds: seconds * 1000, origin: point, velocity: this.xyz(() => this.signed() * (logout ? 20 : 8)),
        acceleration: scale3(gravity, logout ? 1 : 0.2), color, alpha: 1, alphaVelocity: -1 / (1 + this.unit() * 0.3) })) return;
    }
  }
  q2Teleport(origin: Vec3, seconds: number): void {
    for (let i = -16; i <= 16; i += 4) for (let j = -16; j <= 16; j += 4) for (let k = -16; k <= 32; k += 4) {
      const color = 7 + (this.rand() & 7), alphaVelocity = -1 / (0.3 + (this.rand() & 7) * 0.02);
      const point = add3(origin, { x: i + (this.rand() & 3), y: j + (this.rand() & 3), z: k + (this.rand() & 3) });
      if (!this.second({ spawnMilliseconds: seconds * 1000, origin: point, velocity: scale3(normalize3OrZero({ x: j * 8, y: i * 8, z: k * 8 }), 50 + (this.rand() & 63)),
        acceleration: gravity, color, alpha: 1, alphaVelocity })) return;
    }
  }
  q2BigTeleport(origin: Vec3, seconds: number): void {
    const colors = [16, 104, 168, 144];
    for (let i = 0; i < 4096 && this.q2.length < this.capacity; i++) {
      const color = colors[this.rand() & 3]; if (color === undefined) throw new Error("Invalid source teleport color");
      const angle = Math.PI * 2 * ((this.rand() & 1023) / 1023), distance = this.rand() & 31;
      const x = Math.cos(angle), y = Math.sin(angle), velocityX = x * (70 + (this.rand() & 63)), velocityY = y * (70 + (this.rand() & 63));
      this.second({ spawnMilliseconds: seconds * 1000, origin: { x: origin.x + x * distance, y: origin.y + y * distance, z: origin.z + 8 + this.rand() % 90 },
        velocity: { x: velocityX, y: velocityY, z: -100 + (this.rand() & 31) }, acceleration: { x: -x * 100, y: -y * 100, z: 160 },
        color, alpha: 1, alphaVelocity: -0.3 / (0.5 + this.unit() * 0.3) });
    }
  }
  q2Teleporter(origin: Vec3, seconds: number): void {
    for (let i = 0; i < 8 && this.q2.length < this.capacity; i++) {
      const component = (base: number): readonly [number, number] => [base - 16 + (this.rand() & 31), this.signed() * 14];
      const x = component(origin.x), y = component(origin.y);
      this.second({ spawnMilliseconds: seconds * 1000, origin: { x: x[0], y: y[0], z: origin.z - 8 + (this.rand() & 7) },
        velocity: { x: x[1], y: y[1], z: 80 + (this.rand() & 7) }, acceleration: gravity, color: 0xdb, alpha: 1, alphaVelocity: -0.5 });
    }
  }
  q2BlasterTrail(start: Vec3, end: Vec3, seconds: number, green: boolean): void {
    const delta = sub3(end, start), length = length3(delta), direction = normalize3OrZero(delta);
    for (let distance = 0; distance < length && this.q2.length < this.capacity; distance += 5) {
      const alphaVelocity = -1 / (0.3 + this.unit() * 0.2), origin = add3(start, scale3(direction, distance));
      const component = (base: number): readonly [number, number] => [base + this.signed(), this.signed() * 5];
      const x = component(origin.x), y = component(origin.y), z = component(origin.z);
      this.second({ spawnMilliseconds: seconds * 1000, origin: { x: x[0], y: y[0], z: z[0] }, velocity: { x: x[1], y: y[1], z: z[1] },
        acceleration: zero, color: green ? 0xd0 : 0xe0, alpha: 1, alphaVelocity });
    }
  }
  q2DiminishingTrail(start: Vec3, end: Vec3, seconds: number, count: number, kind: "rocket" | "smoke" | "blood" | "green-blood"): number {
    const delta = sub3(end, start), length = length3(delta), direction = normalize3OrZero(delta);
    const originScale = count > 900 ? 4 : count > 800 ? 2 : 1, velocityScale = count > 900 ? 15 : count > 800 ? 10 : 5;
    const blood = kind === "blood" || kind === "green-blood";
    for (let distance = 0; distance < length && this.q2.length < this.capacity; distance += 0.5) {
      if ((this.rand() & 1023) < count) {
        const alphaVelocity = -1 / (1 + this.unit() * (blood ? 0.4 : 0.2)), color = (blood ? kind === "blood" ? 0xe8 : 0xdb : 4) + (this.rand() & 7);
        const point = add3(start, scale3(direction, distance));
        const component = (base: number): readonly [number, number] => [base + this.signed() * originScale, this.signed() * velocityScale];
        const x = component(point.x), y = component(point.y), z = component(point.z);
        this.second({ spawnMilliseconds: seconds * 1000, origin: { x: x[0], y: y[0], z: z[0] }, velocity: { x: x[1], y: y[1], z: z[1] - (blood ? 40 : 0) },
          acceleration: blood ? zero : { x: 0, y: 0, z: 20 }, color, alpha: 1, alphaVelocity });
      }
      count = Math.max(100, count - 5);
    }
    if (kind === "rocket") for (let distance = 0; distance < length && this.q2.length < this.capacity; distance++) {
      if ((this.rand() & 7) !== 0) continue;
      const alphaVelocity = -1 / (1 + this.unit() * 0.2), color = 0xdc + (this.rand() & 3), point = add3(start, scale3(direction, distance));
      const component = (base: number): readonly [number, number] => [base + this.signed() * 5, this.signed() * 20];
      const x = component(point.x), y = component(point.y), z = component(point.z);
      this.second({ spawnMilliseconds: seconds * 1000, origin: { x: x[0], y: y[0], z: z[0] }, velocity: { x: x[1], y: y[1], z: z[1] },
        acceleration: gravity, color, alpha: 1, alphaVelocity });
    }
    return count;
  }
  q2Rail(start: Vec3, end: Vec3, seconds: number): void {
    const delta = sub3(end, start), length = length3(delta), direction = normalize3OrZero(delta);
    const initial = { x: direction.z, y: -direction.x, z: direction.y }, right = normalize3OrZero(sub3(initial, scale3(direction, dot3(initial, direction)))), up = cross3(right, direction);
    for (let i = 0; i < length; i++) {
      const radial = add3(scale3(right, Math.cos(i * 0.1)), scale3(up, Math.sin(i * 0.1)));
      const alphaVelocity = -1 / (1 + this.unit() * 0.2), color = 0x74 + (this.rand() & 7);
      if (!this.second({ spawnMilliseconds: seconds * 1000, origin: add3(add3(start, scale3(direction, i)), scale3(radial, 3)), velocity: scale3(radial, 6),
        acceleration: zero, color, alpha: 1, alphaVelocity })) return;
    }
    for (let i = 0; i < length; i += 0.75) {
      const alphaVelocity = -1 / (0.6 + this.unit() * 0.2), color = this.rand() & 15;
      const point = add3(start, scale3(direction, i));
      const component = (base: number): readonly [number, number] => [base + this.signed() * 3, this.signed() * 3];
      const x = component(point.x), y = component(point.y), z = component(point.z);
      if (!this.second({ spawnMilliseconds: seconds * 1000, origin: { x: x[0], y: y[0], z: z[0] }, velocity: { x: x[1], y: y[1], z: z[1] }, acceleration: zero, color, alpha: 1, alphaVelocity })) return;
    }
  }
  q2Bubbles(start: Vec3, end: Vec3, seconds: number): void {
    const delta = sub3(end, start), length = length3(delta), direction = normalize3OrZero(delta);
    for (let i = 0; i < length; i += 32) {
      const alphaVelocity = -1 / (1 + this.unit() * 0.2), color = 4 + (this.rand() & 7), point = add3(start, scale3(direction, i));
      const component = (base: number): readonly [number, number] => [base + this.signed() * 2, this.signed() * 5];
      const x = component(point.x), y = component(point.y), z = component(point.z);
      if (!this.second({ spawnMilliseconds: seconds * 1000, origin: { x: x[0], y: y[0], z: z[0] }, velocity: { x: x[1], y: y[1], z: z[1] + 6 }, acceleration: zero, color, alpha: 1, alphaVelocity })) return;
    }
  }
}
