import { expect, test } from "bun:test";
import { CampaignCinematic } from "../../../src/app/bootstrap/campaign-cinematic.ts";
import { CinematicPlayback, cinematicBytes } from "../../../src/media/playback.ts";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { ApplicationQ3Cinematics, type SystemCinematicHost } from "../../../src/app/bootstrap/q3-client/cinematics.ts";
import { qvmClientCinematicSyscall } from "../../../src/compat/qvm/client-cinematic-syscalls.ts";
import { QvmCgameImport } from "../../../src/compat/qvm/abi.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";
import { SceneImageRegistry } from "../../../src/render/scene/resources.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { createContentId, createContentDigest, createMountId, createMountIdentity, createMountPlanId, createResourceId } from "../../../src/contracts/content.ts";
import type { ResolvedResourceReference } from "../../../src/contracts/content.ts";
import type { OpenedResource } from "../../../src/content/mounts/index.ts";
import type { AudioStreamTarget, StreamPcm } from "../../../src/audio/types.ts";
import { Draw2D, TextCommandSink } from "../../../src/text/draw2d.ts";
import type { MaterialTextDraw } from "../../../src/text/draw2d.ts";

function shortRoq(): Uint8Array {
  const writer = new BinaryWriter(256); writer.u16(0x1084); writer.u32(0xffffffff); writer.u16(30);
  const chunk = (id: number, data: readonly number[], flags = 0): void => { writer.u16(id); writer.u32(data.length); writer.u16(flags); writer.bytes(Uint8Array.from(data)); };
  chunk(0x1021, [1, 2, 3, 4], 0x0102); chunk(0x1001, [8, 0, 8, 0, 8, 0, 4, 0]);
  chunk(0x1002, [0, 0, 0, 0, 128, 128, 0, 0, 0, 0], 0x0101); chunk(0x1011, [0, 128, 0]); chunk(0x1013, []);
  return writer.finish();
}
function opened(bytes = shortRoq()): OpenedResource {
  const data: Omit<ResolvedResourceReference, "id"> = { requestedPath: "video/test.roq", byteLength: bytes.length, digest: createContentDigest("0".repeat(64)),
    provenance: { kind: "loose", memberPath: "video/test.roq", mount: { kind: "loose", rootPath: "/diagnostic", identity: createMountIdentity(createMountId("qvm", "movies"), createContentId({ family: "q3", edition: "test", package: "movies", revision: "1" }), 0) } },
    resolution: { kind: "default-order", plan: createMountPlanId("qvm", "movies"), rank: 0 } };
  return { bytes, reference: { ...data, id: createResourceId(data) } };
}
function fixture(open: () => Promise<OpenedResource | null> = async () => opened(), system?: SystemCinematicHost) {
  const identity = createIdentityOwner("qvm-movies"), seat = identity.seat(0), images = new SceneImageRegistry({ identity: Symbol("movies"), session: identity.session, generation: 0 });
  let now = 0; const pcm: StreamPcm[] = [], resets: string[] = [], lanes: string[] = [], draws: MaterialTextDraw[] = [];
  const assets = { provider: { mounts: { open } }, assets: { images }, print: () => {} };
  const engine = { queueStream: (target: AudioStreamTarget, block: StreamPcm) => { pcm.push(block); lanes.push(target.id); }, stopStream: (id: string) => { resets.push(id); }, pauseStream: () => {} };
  const movies = new ApplicationQ3Cinematics(assets, { engine }, seat, () => now, system);
  const rect = { x: 0, y: 0, width: 640, height: 480 };
  const draw = new Draw2D(new TextCommandSink(seat, rect, () => {}, value => { draws.push(value); }), "pixels");
  const guest = new QvmMemory(new Uint8Array(1024)); guest.writeString(64, "test.roq", 32);
  const call = (code: QvmCgameImport, args: readonly number[]): QvmHostCall => {
    const words = new DataView(new ArrayBuffer((args.length + 1) * 4)); words.setInt32(0, code, true); args.forEach((value, index) => words.setInt32((index + 1) * 4, value, true));
    return { kind: "engine", role: "cgame", code, words, guest, memory: guest.bytes, commandArguments: null,
      cancelFunction: () => { throw new Error("Unexpected source cancellation"); }, invoke: () => { throw new Error("Unexpected reentry"); }, invokeAsync: async () => { throw new Error("Unexpected reentry"); } };
  };
  return { movies, pcm, resets, lanes, assets, engine, seat, draws, rect, draw, call, time: (value: number) => { now = value; }, services: { cinematics: movies, draw, developerPrint: () => {} } };
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

test("guest system cinematic delegates to the shared owner and retires its real decoder once", async () => {
  const identity = createIdentityOwner("system-cinematic"), clock = { time: 0, sample(): number { return this.time; } };
  const completed: string[] = [], active: CinematicPlayback[] = [];
  const system: SystemCinematicHost = { async open(request) {
    const playback = new CinematicPlayback(cinematicBytes("roq", shortRoq(), request.name), {
      clock, target: { kind: "seat", seat: identity.seat(0) }, loop: request.loop, hold: request.hold, silent: request.silent,
      onAudio: () => {}, onAudioReset: () => {}, onAudioPause: () => {}, onComplete: reason => { completed.push(reason); },
    });
    active.push(playback);
    return { get status() { return playback.status; }, skip() { playback.skip(); playback.close(); }, stop() { playback.close(); } };
  } };
  const f = fixture(async () => opened(), system);
  const handle = await f.movies.playGuest("test.roq", f.rect, 1 | 4 | 8);
  expect(handle).toBe(0); expect(f.movies.runGuest(handle)).toBe(1);
  const playback = active[0]; if (playback === undefined) throw new Error("Missing shared playback");
  playback.tick(); clock.time = 34; playback.tick(); clock.time = 67; playback.tick();
  expect(f.movies.runGuest(handle)).toBe(0);
  f.movies.drawGuest(handle, f.draw); expect(f.draws).toHaveLength(0);
  f.movies.stopGuest(handle); f.movies.close(); expect(completed).toEqual(["skipped"]);
});


test("distinct consumers keep guest handles while isolating shared PCM and material names", async () => {
  const f = fixture(); let time = 0;
  const second = new ApplicationQ3Cinematics(f.assets, { engine: f.engine }, f.seat, () => time);
  try {
    expect(await f.movies.playGuest("test.roq", f.rect, 4)).toBe(0);
    expect(await second.playGuest("test.roq", f.rect, 4)).toBe(0);
    f.movies.run(0); second.run(0); f.time(34); time = 34; f.movies.run(0); second.run(0);
    expect(new Set(f.lanes).size).toBe(2);
    f.movies.drawGuest(0, f.draw); second.drawGuest(0, f.draw);
    expect(new Set(f.draws.map(draw => draw.picture.name)).size).toBe(2);
    const secondLane = f.lanes.at(-1); if (secondLane === undefined) throw new Error("Missing second movie lane");
    const before = f.resets.length; f.movies.close();
    expect(f.resets.slice(before)).not.toContain(secondLane); expect(second.runGuest(0)).toBe(1);
  } finally { f.movies.close(); second.close(); }
});

test("fullscreen preparation and obsolete cleanup cannot take over a newer movie", async () => {
  const f = fixture(), takeovers: number[] = [], pauses: string[] = [];
  const engine = { ...f.engine, stopAll: () => { takeovers.push(1); }, pump: () => 0, pauseStream: (id: string) => { pauses.push(id); } };
  const renderer = { window: { drawableSize: { width: 8, height: 8 } }, execute: () => undefined };
  const request = { name: "test.roq", loop: false, hold: true, silent: false };
  let active = 1;
  const first = await CampaignCinematic.prepare(request, { mounts: { open: async () => opened() } }, { images: f.assets.assets.images }, { engine }, renderer, f.seat, () => active === 1);
  expect(takeovers).toHaveLength(0); expect(f.pcm).toHaveLength(0); first.activate(); first.frame(0, 1); first.frame(34, 2);
  expect(takeovers).toHaveLength(1); const firstLane = f.lanes.at(-1);
  active = 2;
  const next = await CampaignCinematic.prepare(request, { mounts: { open: async () => opened() } }, { images: f.assets.assets.images }, { engine }, renderer, f.seat, () => active === 2);
  expect(takeovers).toHaveLength(1); next.activate(); next.frame(0, 3); next.frame(34, 4);
  const nextLane = f.lanes.at(-1); if (nextLane === undefined) throw new Error("Missing active movie lane"); expect(nextLane).not.toBe(firstLane); expect(takeovers).toHaveLength(2);
  const stopped = f.resets.length; first.skip(); first.pause(true); first.close(5);
  expect(f.resets.slice(stopped)).not.toContain(nextLane); expect(takeovers).toHaveLength(2); expect(pauses).toHaveLength(0);
  next.pause(true); expect(pauses).toEqual([nextLane]); next.close(6); f.movies.close();
});

test("late fullscreen loads and retired system consumers stay inactive", async () => {
  const f = fixture(); let current = true, takeovers = 0;
  const pending = Promise.withResolvers<OpenedResource | null>();
  const prepare = CampaignCinematic.prepare({ name: "test.roq", loop: false, hold: false, silent: false }, { mounts: { open: () => pending.promise } },
    { images: f.assets.assets.images }, { engine: { ...f.engine, stopAll: () => { takeovers++; }, pump: () => 0 } },
    { window: { drawableSize: { width: 8, height: 8 } }, execute: () => undefined }, f.seat, () => current);
  current = false; pending.resolve(opened()); await expect(prepare).rejects.toThrow("retired request");
  expect(takeovers).toBe(0); expect(f.pcm).toHaveLength(0); expect(f.resets).toHaveLength(0);
  const gate = Promise.withResolvers<void>(); let checked = false;
  const client = fixture(async () => opened(), { open: async (_request, live) => {
    await gate.promise; checked = live();
    return { status: "stopped", skip: () => {}, stop: () => {} };
  } });
  const loading = client.movies.playGuest("test.roq", client.rect, 1);
  client.movies.close(); gate.resolve(); await expect(loading).rejects.toThrow("loaded after close"); expect(checked).toBe(false);
  f.movies.close();
});

test("stopping a pending guest handle cannot cancel its reused destination", async () => {
  const pending: { readonly gate: ReturnType<typeof Promise.withResolvers<void>>; readonly current: () => boolean; readonly index: number }[] = [];
  const stopped: number[] = [], skipped: number[] = [];
  const f = fixture(async () => opened(), { open: async (_request, current) => {
    const gate = Promise.withResolvers<void>(), index = pending.length; pending.push({ gate, current, index });
    await gate.promise;
    return { status: "playing", stop: () => { stopped.push(index); }, skip: () => { skipped.push(index); } };
  } });
  const first = f.movies.playGuest("old.roq", f.rect, 1);
  f.movies.stopGuest(0);
  const second = f.movies.playGuest("new.roq", f.rect, 1);
  const old = pending[0], next = pending[1]; if (old === undefined || next === undefined) throw new Error("Missing pending requests");
  expect(old.current()).toBe(false); expect(next.current()).toBe(true);
  next.gate.resolve(); expect(await second).toBe(0); old.gate.resolve(); await expect(first).rejects.toThrow("loaded after close");
  expect(stopped).toEqual([0]); expect(skipped).toEqual([]); expect(f.movies.runGuest(0)).toBe(1);
  f.movies.stopGuest(0); expect(skipped).toEqual([1]); expect(next.current()).toBe(false);
  const third = f.movies.playGuest("last.roq", f.rect, 1), last = pending[2];
  if (last === undefined) throw new Error("Missing final pending request");
  last.gate.resolve(); expect(await third).toBe(0); expect(next.current()).toBe(false); expect(last.current()).toBe(true);
  f.movies.stop(0); expect(last.current()).toBe(false); expect(stopped).toEqual([0, 2]); f.movies.close();
});


test("CIN constructor audio waits for activation and a retired caption load cannot publish it", async () => {
  const writer = new BinaryWriter(70000);
  for (const value of [2, 1, 14000, 1, 1]) writer.i32(value);
  const counts = new Uint8Array(65536);
  for (let context = 0; context < 256; context++) { counts[context * 256] = 1; counts[context * 256 + 1] = 1; }
  writer.bytes(counts); writer.i32(1); writer.bytes(new Uint8Array(768)); writer.i32(5); writer.i32(2); writer.u8(2);
  writer.bytes(new Uint8Array(1000).fill(128)); writer.i32(2);
  const resource = opened(writer.finish()), f = fixture(), captions = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
  const request = { name: "test.cin", loop: false, hold: false, silent: false };
  let current = true, takeovers = 0;
  const engine = { ...f.engine, stopAll: () => { takeovers++; }, pump: () => 0 }, renderer = { window: { drawableSize: { width: 8, height: 8 } }, execute: () => undefined };
  const pending = CampaignCinematic.prepare(request, { mounts: { open: async () => resource } }, { images: f.assets.assets.images }, { engine }, renderer, f.seat, () => current,
    { prepare: async () => { entered.resolve(); await captions.promise; }, commands: () => [] });
  await entered.promise; expect(f.pcm).toHaveLength(0); current = false; captions.resolve();
  await expect(pending).rejects.toThrow("retired request"); expect(f.resets).toHaveLength(0); expect(takeovers).toBe(0);
  current = true;
  const movie = await CampaignCinematic.prepare(request, { mounts: { open: async () => resource } }, { images: f.assets.assets.images }, { engine }, renderer, f.seat, () => current);
  expect(f.pcm).toHaveLength(0); movie.activate(); expect(f.pcm).toHaveLength(1); expect(takeovers).toBe(1); movie.close(1); f.movies.close();
});
