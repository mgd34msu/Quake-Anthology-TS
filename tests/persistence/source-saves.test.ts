import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { decodeQ1Save, encodeQ1Save } from "../../src/persistence/q1.ts";
import { decodeQ2RereleaseLevelMetadata, decodeQ2RereleaseServer, encodeQ2RereleaseLevelMetadata, encodeQ2RereleaseServer } from "../../src/persistence/q2-containers.ts";
import { decodeQ2RereleaseGame, decodeQ2RereleaseLevel, encodeQ2RereleaseGame, encodeQ2RereleaseLevel, readQ2AmmoCapacity, readQ2BrushAnimation, readQ2Fog, readQ2HeightFog, readQ2Poi, writeQ2AmmoCapacity, writeQ2BrushAnimation, writeQ2Fog, writeQ2HeightFog, writeQ2Poi } from "../../src/persistence/q2-rerelease.ts";
import { SaveNumber, sourceObject } from "../../src/persistence/source-json.ts";
import { captureQ1QuakeCSave, restoreQ1QuakeCSave } from "../../src/persistence/q1-quakec.ts";
import { openArchive } from "../../src/content/archive/index.ts";
import { QcMachine, QcEntityMemory, classicQcEntityLayout, createQcBuiltins, loadQcProgram } from "../../src/compat/qc/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../src/core/numeric.ts";

const artifacts = join(import.meta.dir, "../../.artifacts");
const q1Save = join(artifacts, "q1-retail/2026-09-11T05-43-37-305Z/game/id1/retail-before.sav");
const q2Root = join(artifacts, "q2-native/2026-09-11T05-40-13-908Z/rerelease/singleplayer-save/client/baseq2/save/native-reference");

test.skipIf(!existsSync(q1Save))("reads and rewrites the actual WinQuake reference save without losing edict fields", async () => {
  const save = decodeQ1Save(new Uint8Array(await Bun.file(q1Save).arrayBuffer()));
  expect(save.map).toBe("start");
  expect(save.entities.length).toBeGreaterThan(1);
  expect(decodeQ1Save(encodeQ1Save(save))).toEqual(save);
  const kex = { ...save, format: { version: 6, gameDirectories: "id1;mg1" } } satisfies Parameters<typeof encodeQ1Save>[0];
  expect(decodeQ1Save(encodeQ1Save(kex))).toEqual(kex);
  const archive = await openArchive(join(import.meta.dir, "../../../qfiles/q1/id1/PAK0.PAK"));
  try {
    const entry = archive.findEntries("progs.dat").at(-1); if (entry === undefined) throw new Error("no source progs.dat");
    const program = loadQcProgram(await archive.readEntry(entry));
    const machine = new QcMachine({ program, entities: new QcEntityMemory(classicQcEntityLayout(program), save.entities.length), numeric: createNumericOperations(Q1_DONOR_PROFILE), builtins: createQcBuiltins({ kind: "netquake" }), serverActive: () => true });
    const free = new Set<number>();
    let restoredTime = 0;
    const unknown = restoreQ1QuakeCSave(machine, save, { begin: () => {}, entity: (slot, empty) => { if (empty) free.add(slot); }, finish: header => { restoredTime = header.time; } });
    expect(unknown).toEqual({ globals: [], entities: [] });
    expect(restoredTime).toBe(save.time);
    expect(machine.entities.at(1).vector(machine.fieldOffset("origin"))).toEqual({ x: 544, y: 288, z: 28.03125 });
    const captured = captureQ1QuakeCSave(machine, save, slot => free.has(slot));
    expect(captured.entities[1]).toEqual(save.entities[1]);
    expect(captured.globals).toEqual(save.globals);
  } finally { archive.close(); }
});

test.skipIf(!existsSync(q2Root))("roundtrips actual q2repro rerelease engine and game saves", async () => {
  const serverBytes = new Uint8Array(await Bun.file(join(q2Root, "server.ssv")).arrayBuffer());
  const server = decodeQ2RereleaseServer(serverBytes);
  expect(server.mapCommand).toContain("base1");
  expect(encodeQ2RereleaseServer(server)).toEqual(serverBytes);
  const levelBytes = new Uint8Array(await Bun.file(join(q2Root, "base1.sv2")).arrayBuffer());
  const levelMetadata = decodeQ2RereleaseLevelMetadata(levelBytes, 12448);
  expect(encodeQ2RereleaseLevelMetadata(levelMetadata, 12448)).toEqual(levelBytes);
  const game = decodeQ2RereleaseGame(await Bun.file(join(q2Root, "game.ssv")).text());
  expect(decodeQ2RereleaseGame(encodeQ2RereleaseGame(game))).toEqual(game);
  const level = decodeQ2RereleaseLevel(await Bun.file(join(q2Root, "base1.sav")).text());
  expect(decodeQ2RereleaseLevel(encodeQ2RereleaseLevel(level))).toEqual(level);
  const world = level.entities.get(0); if (world === undefined) throw new Error("reference has no worldspawn");
  expect(readQ2Fog(world).density).toBeGreaterThan(0);
  expect(readQ2HeightFog(world).density).toBeGreaterThan(0);
});

test("rerelease field codecs retain fog, brush animation, POIs, ammo capacities and unknown 64-bit fields", () => {
  const save = decodeQ2RereleaseLevel('{"save_version":1,"level":{"valid_poi":true,"current_poi":[1,2,3],"current_poi_stage":4,"current_poi_image":5,"current_dynamic_poi":7},"entities":{"0":{"fog.color":[0.1,0.2,0.3],"fog.density":0.4,"heightfog.density":0.5,"bmodel_anim.start":3,"bmodel_anim.end":9,"bmodel_anim.enabled":true,"bmodel_anim.alternate":true,"bmodel_anim.currently_alternate":true,"bmodel_anim.next_tick":1500,"private_flags":18446744069414584320}}}');
  const entity = save.entities.get(0); if (entity === undefined) throw new Error("missing entity");
  const fog = readQ2Fog(entity), height = readQ2HeightFog(entity), animation = readQ2BrushAnimation(entity), poi = readQ2Poi(save.level);
  writeQ2Fog(entity, fog); writeQ2HeightFog(entity, height); writeQ2BrushAnimation(entity, animation); writeQ2Poi(save.level, poi);
  const roundtrip = decodeQ2RereleaseLevel(encodeQ2RereleaseLevel(save));
  const after = roundtrip.entities.get(0); if (after === undefined) throw new Error("missing restored entity");
  expect([readQ2Fog(after), readQ2HeightFog(after), readQ2BrushAnimation(after), readQ2Poi(roundtrip.level)]).toEqual([fog, height, animation, poi]);
  const flags = after["private_flags"]; expect(flags instanceof SaveNumber ? flags.bigint() : null).toBe(18446744069414584320n);
  const game = decodeQ2RereleaseGame('{"save_version":1,"game":{},"clients":[{"pers":{"max_ammo":[200,100,50,50,200,50,120]}}]}');
  const persistent = sourceObject(game.clients[0]?.["pers"], "pers"); const capacity = readQ2AmmoCapacity(persistent);
  writeQ2AmmoCapacity(persistent, capacity);
  expect(readQ2AmmoCapacity(sourceObject(decodeQ2RereleaseGame(encodeQ2RereleaseGame(game)).clients[0]?.["pers"], "pers"))).toEqual(capacity);
});
