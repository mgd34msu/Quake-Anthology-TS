import { expect, test } from "bun:test";
import { demoFamily, openDemoResource } from "../../src/app/bootstrap/demo-playback.ts";

test("recording suffix selects its family and mounted lookup retains its bytes", async () => {
  expect(demoFamily("test.qwd", "q3")).toBe("qw");
  expect(demoFamily("test.dem", "q2")).toBe("q1");
  expect(demoFamily("test.dm2", "q1")).toBe("q2");
  expect(demoFamily("test.mvd", "q3")).toBe("q2");
  expect(demoFamily("test.dm_68", "q1")).toBe("q3");
  expect(demoFamily("test", "qw")).toBe("qw");
  const bytes = new Uint8Array([1, 2, 3]);
  for (const [family, path] of [["q1", "demo1.dem"], ["qw", "demo1.qwd"], ["q2", "demos/demo1.dm2"]] satisfies readonly (readonly ["q1" | "qw" | "q2", string])[]) {
    const lookups: string[] = [];
    const result = await openDemoResource({ family, name: "demo1", timedemo: false }, async name => { lookups.push(name); return bytes; }, () => {});
    expect(lookups).toEqual([path]); expect(result.path).toBe(path); expect(result.kind).toBe(family); expect(result.bytes).toBe(bytes);
  }
});

test("Q3 searches the donor's compatible suffix order and retains the recorded protocol identity", async () => {
  const bytes = new Uint8Array([1]), paths: string[] = [];
  const request = { family: "q3", name: "demo1", timedemo: false } satisfies Parameters<typeof openDemoResource>[0];
  const result = await openDemoResource(request, async path => { paths.push(path); return path.endsWith("68") ? bytes : undefined; }, () => {});
  expect(paths).toEqual(["demos/demo1.dm_66", "demos/demo1.dm_67", "demos/demo1.dm_68"]);
  expect(result).toEqual({ kind: "q3", path: "demos/demo1.dm_68", bytes, protocol: 68 });
  expect(await openDemoResource(request, async () => bytes, () => {})).toMatchObject({ protocol: 66, path: 'demos/demo1.dm_66' });
  expect(await openDemoResource({ ...request, name: 'demo1.dm_67' }, async () => bytes, () => {})).toMatchObject({ protocol: 67, path: 'demos/demo1.dm_67' });
  const explicit: string[] = [];
  await openDemoResource({ ...request, name: "demos/demo1.dm_68" }, async path => { explicit.push(path); return bytes; }, () => {});
  expect(explicit).toEqual(["demos/demo1.dm_68"]);
});

test("missing files differ from failed reads and invalid paths never reach mounted lookup", async () => {
  const request = { family: "q1", name: "missing", timedemo: false } satisfies Parameters<typeof openDemoResource>[0];
  await expect(openDemoResource(request, async () => undefined, () => {})).rejects.toThrow("Couldn't open demo missing.dem");
  const corrupt = new Error("Corrupt archive");
  await expect(openDemoResource(request, async () => { throw corrupt; }, () => {})).rejects.toBe(corrupt);
  let reads = 0;
  for (const name of ["../escape", "/absolute", "C:\\absolute", "bad\0name"])
    await expect(openDemoResource({ ...request, name }, async () => { reads++; return undefined; }, () => {})).rejects.toThrow("Invalid relative resource path");
  expect(reads).toBe(0);
});


test("MVD explicit resource names retain their suffix and source packet family", async () => {
  const bytes = Uint8Array.of(77, 86, 68, 50), paths: string[] = [];
  const resource = await openDemoResource({ family: demoFamily('match.mvd', 'q3'), name: 'match.mvd', timedemo: false }, async path => { paths.push(path); return bytes; }, () => {});
  expect(paths).toEqual(['demos/match.mvd']); expect(resource).toEqual({ kind: 'q2', path: 'demos/match.mvd', bytes });
});
