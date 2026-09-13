import { expect, test } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { ApplicationQ3Cinematics } from "../../../src/app/bootstrap/q3-client/cinematics.ts";
import { qvmClientCinematicSyscall } from "../../../src/compat/qvm/client-cinematic-syscalls.ts";
import { QvmCgameImport } from "../../../src/compat/qvm/abi.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";
import { SceneImageRegistry } from "../../../src/render/scene/resources.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { createContentId, createContentDigest, createMountId, createMountIdentity, createMountPlanId, createResourceId } from "../../../src/contracts/content.ts";
import type { ResolvedResourceReference } from "../../../src/contracts/content.ts";
import type { OpenedResource } from "../../../src/content/mounts/index.ts";
import type { StreamPcm } from "../../../src/audio/types.ts";
import { Draw2D, TextCommandSink } from "../../../src/text/draw2d.ts";
import type { MaterialTextDraw } from "../../../src/text/draw2d.ts";

function shortRoq(): Uint8Array {
  const writer = new BinaryWriter(256); writer.u16(0x1084); writer.u32(0xffffffff); writer.u16(30);
  const chunk = (id: number, data: readonly number[], flags = 0): void => { writer.u16(id); writer.u32(data.length); writer.u16(flags); writer.bytes(Uint8Array.from(data)); };
  chunk(0x1021, [1, 2, 3, 4], 0x0102); chunk(0x1001, [8, 0, 8, 0, 8, 0, 4, 0]);
  chunk(0x1002, [0, 0, 0, 0, 128, 128, 0, 0, 0, 0], 0x0101); chunk(0x1011, [0, 128, 0]); chunk(0x1013, []);
  return writer.finish();
}
function opened(): OpenedResource {
  const bytes = shortRoq();
  const data: Omit<ResolvedResourceReference, "id"> = { requestedPath: "video/test.roq", byteLength: bytes.length, digest: createContentDigest("0".repeat(64)),
    provenance: { kind: "loose", memberPath: "video/test.roq", mount: { kind: "loose", rootPath: "/diagnostic", identity: createMountIdentity(createMountId("qvm", "movies"), createContentId({ family: "q3", edition: "test", package: "movies", revision: "1" }), 0) } },
    resolution: { kind: "default-order", plan: createMountPlanId("qvm", "movies"), rank: 0 } };
  return { bytes, reference: { ...data, id: createResourceId(data) } };
}
function fixture(open: () => Promise<OpenedResource | null> = async () => opened()) {
  const identity = createIdentityOwner("qvm-movies"), seat = identity.seat(0), images = new SceneImageRegistry({ identity: Symbol("movies"), session: identity.session, generation: 0 });
  let now = 0; const pcm: StreamPcm[] = [], resets: string[] = [], draws: MaterialTextDraw[] = [];
  const movies = new ApplicationQ3Cinematics({ provider: { mounts: { open } }, assets: { images }, print: () => {} },
    { engine: { queueStream: (_target, block) => { pcm.push(block); }, stopStream: id => { resets.push(id); }, pauseStream: () => {} } }, seat, () => now);
  const rect = { x: 0, y: 0, width: 640, height: 480 };
  const draw = new Draw2D(new TextCommandSink(seat, rect, () => {}, value => { draws.push(value); }), "pixels");
  const guest = new QvmMemory(new Uint8Array(1024)); guest.writeString(64, "test.roq", 32);
  const call = (code: QvmCgameImport, args: readonly number[]): QvmHostCall => {
    const words = new DataView(new ArrayBuffer((args.length + 1) * 4)); words.setInt32(0, code, true); args.forEach((value, index) => words.setInt32((index + 1) * 4, value, true));
    return { kind: "engine", role: "cgame", code, words, guest, memory: guest.bytes, commandArguments: null,
      invoke: () => { throw new Error("Unexpected reentry"); }, invokeAsync: async () => { throw new Error("Unexpected reentry"); } };
  };
  return { movies, pcm, resets, draws, rect, draw, call, time: (value: number) => { now = value; }, services: { cinematics: movies, draw, developerPrint: () => {} } };
}

test("guest cinematic flags drive the existing decoder, sound lane, hold status and draw extents", async () => {
  const f = fixture();
  const result = await qvmClientCinematicSyscall(f.call(QvmCgameImport.CG_CIN_PLAYCINEMATIC, [64, 1, 2, 30, 40, 4]), f.services);
  expect(result).toBe(0); expect(await f.movies.playGuest("test.roq", f.rect, 0)).toBe(0);
  expect(f.movies.runGuest(0)).toBe(1); f.time(34); f.movies.runGuest(0);
  expect(f.pcm.length).toBeGreaterThan(0); f.time(67); expect(f.movies.runGuest(0)).toBe(0);
  qvmClientCinematicSyscall(f.call(QvmCgameImport.CG_CIN_SETEXTENTS, [0, 3, 4, 50, 60]), f.services);
  qvmClientCinematicSyscall(f.call(QvmCgameImport.CG_CIN_DRAWCINEMATIC, [0]), f.services);
  expect(f.draws[0]?.rect).toEqual({ x: 3, y: 4, width: 50, height: 60 });
  expect(f.movies.stopGuest(0)).toBe(2); expect(f.movies.runGuest(0)).toBe(2); f.movies.close();
});

test("silent loops expose the actual decoder loop status and shader mode retains source clock gating", async () => {
  const f = fixture(); await f.movies.playGuest("test.roq", f.rect, 2 | 8);
  const states = [f.movies.runGuest(0)]; f.time(34); states.push(f.movies.runGuest(0)); f.time(67); states.push(f.movies.runGuest(0));
  expect(states).toEqual([1, 1, 1]); expect(f.pcm).toHaveLength(0); f.movies.close();
  const shader = fixture(); await shader.movies.playGuest("test.roq", shader.rect, 16 | 8);
  shader.movies.runGuest(0); shader.time(500);
  expect(shader.movies.runGuest(0)).toBe(1); shader.movies.close();
  const plain = fixture(); await plain.movies.playGuest("test.roq", plain.rect, 8);
  plain.movies.runGuest(0); plain.time(500); expect(plain.movies.runGuest(0)).toBe(2); plain.movies.close();
});

test("cinematic load cancellation creates no movie and unsupported system flags stay explicit", async () => {
  let complete: (value: OpenedResource | null) => void = () => { throw new Error("Load not started"); };
  const pending = new Promise<OpenedResource | null>(resolve => { complete = resolve; });
  const f = fixture(() => pending), playing = f.movies.playGuest("test.roq", f.rect, 0);
  f.movies.close(); complete(opened());
  await expect(playing).rejects.toThrow("loaded after close");
  expect(f.movies.runGuest(0)).toBe(2); expect(f.pcm).toHaveLength(0);
  const missing = fixture(async () => null); expect(await missing.movies.playGuest("absent.roq", missing.rect, 0)).toBe(-1);
  await expect(missing.movies.playGuest("test.roq", missing.rect, 1)).rejects.toThrow("attached client transition owner"); missing.movies.close();
});


test("native TypeScript preview defaults remain looping and silent", async () => {
  const f = fixture(); const asset = await f.movies.owner.prepare("test.roq");
  expect(f.movies.play(asset)?.handle.index).toBe(0);
  f.movies.run(0); f.time(34); f.movies.run(0); f.time(67);
  expect(f.movies.runGuest(0)).toBe(1); expect(f.pcm).toHaveLength(0); f.movies.close();
});
