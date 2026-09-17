import { SharedSceneQueries } from "../../src/world/collision/index.ts";
import { Q3_BINARY32_PROFILE } from "../../src/core/numeric.ts";
import type { Bounds } from "../../src/contracts/math.ts";
import type { BspChild, BspNode, BspPlane, Q1WorldGeometry } from "../../src/contracts/scene.ts";
import { expect, test } from "bun:test";
import { geometryTransmission, type AudioGeometryTrace } from "../../src/audio/geometry.ts";
import { UnifiedAudio } from "../../src/audio/engine.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { AudioListener, SoundAsset, SoundFamily } from "../../src/audio/types.ts";
import type { Vec3 } from "../../src/contracts/math.ts";

const clear: AudioGeometryTrace = () => ({ fraction: 1, startSolid: false, allSolid: false });
const start = { x: 0, y: 0, z: 0 }, end = { x: 256, y: 0, z: 0 };
test("geometry transmission preserves clear paths and distinguishes thin thick and solid obstruction", () => {
  expect(geometryTransmission(start, end, clear)).toBe(1);
  expect(geometryTransmission(start, start, () => { throw new Error("Coincident point should not trace"); })).toBe(1);
  const wall = (width: number): AudioGeometryTrace => (from, to) => ({ fraction: Math.abs((from.x < to.x ? 128 - width / 2 : 128 + width / 2) - from.x) / Math.abs(to.x - from.x), startSolid: false, allSolid: false });
  expect(geometryTransmission(start, end, wall(0))).toBe(0.5);
  expect(geometryTransmission(start, end, wall(64))).toBe(0.25);
  expect(geometryTransmission(start, end, wall(128))).toBe(0.125);
  expect(geometryTransmission(start, end, () => ({ fraction: 0, startSolid: true, allSolid: true }))).toBe(0.03125);
});
const identity = createIdentityOwner("geometry-audio"), actor = identity.actor(1, 0);
const sound: SoundAsset = { name: "geometry-tone", resource: "resource:geometry-tone", pcm: { samples: new Int16Array(2048).fill(12000), channels: 1, sampleRate: 44100, frameCount: 2048, loopStart: null } };
const listener = (seat: number, origin: Vec3): AudioListener => ({ seat: identity.seat(seat), actor: null, origin,
  axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], gain: 1, underwater: false });
const peak = (pcm: Int16Array): number => pcm.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);

test("shared spatial voices update obstruction once per endpoint per frame and leave local effects untouched", () => {
  for (const family of ["q1", "q2", "q3"] satisfies readonly SoundFamily[]) {
    using audio = new UnifiedAudio({ milliseconds: () => 1000, random: () => 0 });
    let blocked = false, calls = 0;
    audio.setGeometryTransmission(() => { calls++; return blocked ? 0.25 : 1; });
    audio.setListeners([listener(0, start)]);
    const fire = (local: boolean): void => { audio.play({ sound, family, actor: null, audience: { kind: "world" },
      origin: local ? { kind: "local" } : { kind: "fixed", position: end }, channel: 0, volume: 1, attenuation: 1 }); audio.endLoopFrame(); };
    fire(false); audio.setListeners([listener(0, start)]); const open = peak(audio.mix(32));
    expect(open).toBeGreaterThan(0);
    blocked = true; audio.setListeners([listener(0, start)]); const behind = peak(audio.mix(32));
    expect(behind).toBeGreaterThan(0); expect(behind).toBeLessThan(open * 0.3);
    const beforePaint = calls; audio.mix(32); audio.mix(32); expect(calls).toBe(beforePaint);
    blocked = false; audio.setListeners([listener(0, start)]); expect(peak(audio.mix(32))).toBe(open);
    audio.stopAll(); fire(true); const localOpen = peak(audio.mix(32));
    blocked = true; audio.setListeners([listener(0, start)]); expect(peak(audio.mix(32))).toBe(localOpen);
  }
});

test("geometry is per listener and remains attached after retained mixer round reset", () => {
  using audio = new UnifiedAudio({ milliseconds: () => 1000, random: () => 0 });
  const visited: number[] = [];
  audio.setGeometryTransmission((local, position) => { visited.push(local.origin.y); return local.origin.y === 0 && position.x > 0 ? 0.25 : 1; });
  for (let round = 0; round < 2; round++) {
    audio.setListeners([listener(0, start), listener(1, { x: 0, y: 1, z: 0 })]);
    audio.updateActor(actor, end);
    audio.loop({ sound, family: "q3", actor, origin: { kind: "actor", actor }, audience: { kind: "world" }, volume: 1, attenuation: 1, velocity: start, frameNumber: round, lifetime: "frame" });
    audio.endLoopFrame(); expect(peak(audio.mix(32))).toBeGreaterThan(0);
    expect(visited).toContain(0); expect(visited).toContain(1); visited.length = 0;
    audio.resetRound();
  }
});

const zero: Vec3 = { x: 0, y: 0, z: 0 };
const bounds: Bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
function cube(): Q1WorldGeometry {
  const normals: readonly Vec3[] = [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }];
  const planes: BspPlane[] = normals.map(normal => ({ normal, distance: 1, type: 3, signbits: 0 }));
  const nodes: BspNode[] = normals.map((_normal, i) => {
    const children: readonly [BspChild, BspChild] = [{ kind: "leaf", index: 1 }, i === 5 ? { kind: "leaf", index: 0 } : { kind: "node", index: i + 1 }];
    return { plane: i, children, bounds, faces: { first: 0, count: 0 } };
  });
  return { kind: "q1-bsp", format: "bsp29", entities: "", planes, nodes, vertices: [], edges: [], surfaceEdges: [],
    leaves: [-2, -1].map(contents => ({ contents, bounds, faces: { first: 0, count: 0 }, visibilityOffset: null, ambientSound: [0, 0, 0, 0] })),
    leafFaces: [], textures: [], textureInfo: [], faces: [], models: [{ bounds, origin: zero, headnodes: [0, -1, -1, -1], visibleLeaves: 1, faces: { first: 0, count: 0 } }],
    clipnodes: [], visibility: new Uint8Array(), lighting: { kind: "luminance8", samples: new Uint8Array() }, decoupledLightmaps: null, brushList: null, extensions: [] };
}

test("geometry replacement traces real foreign BSP and moving linked blockers with shared solid policy", () => {
  const scene = new SharedSceneQueries(cube());
  const trace: AudioGeometryTrace = (start, end) => scene.trace({ start, end, shape: { kind: "point" }, target: { kind: "world" }, passActor: null,
    numeric: Q3_BINARY32_PROFILE, policy: { kind: "q2", contentsMask: 3, leafContents: "merged" } });
  const from = { x: -128, y: 0, z: 128 }, to = { x: 128, y: 0, z: 128 };
  expect(geometryTransmission({ x: -128, y: 0, z: 0 }, { x: 128, y: 0, z: 0 }, trace)).toBeLessThan(0.5);
  expect(geometryTransmission(from, to, trace)).toBe(1);
  const door = identity.actor(4, 0), origin = { x: 0, y: 0, z: 128 };
  const bounds = { min: { x: -32, y: -64, z: -64 }, max: { x: 32, y: 64, z: 64 } };
  scene.link({ actor: door, state: { origin, angles: zero, velocity: zero, bounds, ground: null },
    absoluteBounds: { min: { x: -32, y: -64, z: 64 }, max: { x: 32, y: 64, z: 192 } }, linkCount: 1 },
    { family: "q3", shape: { kind: "box" }, contents: 1, owner: null, role: "solid", monster: false, deadMonster: false });
  const closedDoor = geometryTransmission(from, to, trace);
  expect(closedDoor).toBeGreaterThan(0.2); expect(closedDoor).toBeLessThanOrEqual(0.25);
  scene.unlink(door); expect(geometryTransmission(from, to, trace)).toBe(1);
});

test("geometry option defaults off and menu edits the documented archived canonical value", async () => {
  const { CvarRegistry, CvarFlag } = await import("../../src/core/cvars/index.ts");
  const { registerSharedClientSettings } = await import("../../src/app/bootstrap/shared-setting-cvars.ts");
  const { bindAudioGeometrySettings } = await import("../../src/ui/settings/index.ts");
  const cvars = new CvarRegistry({ dialect: "q3", context: { session: identity.session, origin: { kind: "local-console" } } });
  cvars.register("r_gamma", "1", CvarFlag.Archive); registerSharedClientSettings(cvars);
  const binding = bindAudioGeometrySettings(cvars)[0];
  if (binding?.kind !== "toggle") throw new Error("Geometry toggle missing");
  expect(binding.read()).toBe(false); expect(cvars.find("s_geometryAcoustics")?.flags).toBe(CvarFlag.Archive);
  binding.write(true); expect(cvars.variableString("s_geometryAcoustics")).toBe("1");
  cvars.set("s_geometryAcoustics", "0"); expect(binding.read()).toBe(false);
});
