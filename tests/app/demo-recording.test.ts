import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DemoRecording, recordingPath } from "../../src/app/bootstrap/demo-recording.ts";
import type { DemoRecordingSeed } from "../../src/app/bootstrap/demo-recording.ts";
import { NetQuakeDemoReader, QuakeWorldDemoReader } from "../../src/network/q1/demos.ts";
import { readQ2Demo } from "../../src/network/q2/demo.ts";
import { DemoReader } from "../../src/network/q3/demo.ts";
import { DemoLibrary } from "../../src/app/bootstrap/demo-library.ts";

const seeds: readonly DemoRecordingSeed[] = [
  { identity: { kind: "q1", protocol: 999, track: -1 }, packets: [{ kind: "q1", message: new Uint8Array([1]), viewAngles: { x: 1, y: 2, z: 3 } }] },
  { identity: { kind: "qw", protocol: 28 }, packets: [{ kind: "qw", record: { kind: "sequences", seconds: 1, outgoing: 5, incoming: 7 } }] },
  { identity: { kind: "q2", protocol: { kind: "q2-rerelease", version: 1038 } }, packets: [{ kind: "q2", message: new Uint8Array([1, 2]) }] },
  { identity: { kind: "q3", protocol: 68 }, packets: [{ kind: "q3", sequence: 17, message: new Uint8Array([1, 2, 3]) }] },
];

for (const seed of seeds) test(`streamed ${seed.identity.kind} recording closes once and replays exact ordered records`, async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-recording-"));
  try {
    const recording = await DemoRecording.open(root, "session", seed), packet = seed.packets[0];
    if (packet === undefined) throw new Error("Missing seed");
    const write = recording.append(packet), stop = recording.stop();
    expect(recording.stop()).toBe(stop);
    await write; await stop;
    await expect(recording.append(packet)).rejects.toThrow("stopped");
    await expect(DemoRecording.open(root, "session", seed)).rejects.toThrow();
    const bytes = await readFile(recording.path);
    if (seed.identity.kind === "q1") {
      const reader = new NetQuakeDemoReader(bytes);
      expect(reader.forcedTrack).toBe(-1);
      expect(reader.next()).toEqual(reader.next());
      expect(reader.next()?.message).toEqual(new Uint8Array([2]));
      expect(reader.next()).toBeNull();
    } else if (seed.identity.kind === "qw") {
      const reader = new QuakeWorldDemoReader(bytes);
      expect(reader.next()).toEqual(reader.next());
      expect(reader.next()).toMatchObject({ kind: "packet", seconds: 1 });
      expect(reader.next()).toBeNull();
    } else if (seed.identity.kind === "q2") {
      expect([...readQ2Demo(bytes)].map(record => record.bytes)).toEqual([new Uint8Array([1, 2]), new Uint8Array([1, 2])]);
    } else {
      const reader = new DemoReader(bytes);
      expect(reader.next(() => undefined)).toEqual(reader.next(() => undefined));
      expect(reader.next(() => undefined)).toMatchObject({ kind: "end", reason: "terminator" });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recording names cannot escape the source user directory", () => {
  for (const name of ["../outside", "/tmp/outside", "a/../../outside"]) expect(() => recordingPath("/game", name, { kind: "q1", protocol: 15, track: -1 })).toThrow();
});

test("demo library discovers actual recordings and reads them through the playback lookup", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-library-"));
  try {
    const seed = seeds[3]; if (seed === undefined) throw new Error("Missing Q3 seed");
    const recording = await DemoRecording.open(root, "session", seed); await recording.stop();
    const mounted = new Uint8Array([7]);
    const library = new DemoLibrary(root, { listFiles: async (directory, extension) => directory === "" && extension === ".dem" ? ["demo1.dem"] : [],
      read: async path => path === "demo1.dem" ? mounted : undefined });
    expect(await library.list()).toEqual([{ id: "demo1.dem", label: "demo1.dem", family: "q1" }, { id: "demos/session.dm_68", label: "demos/session.dm_68", family: "q3" }]);
    expect(await library.read("demo1.dem")).toBe(mounted);
    expect(await library.read("demos/session.dm_68")).toEqual(await readFile(recording.path));
  } finally { await rm(root, { recursive: true, force: true }); }
});
