import { expect, test } from "bun:test";
import { QvmCgameImport } from "../../../src/compat/qvm/abi.ts";
import { qvmClientRenderSyscall } from "../../../src/compat/qvm/client-render-syscalls.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";
import { readQvmRefEntity, readQvmRefdef } from "../../../src/compat/qvm/render-record.ts";
import { Q3RendererResources } from "../../../src/content/q3/presentation/resources.ts";
import { Q3SceneRecorder } from "../../../src/content/q3/presentation/scene.ts";
import type { Q3PresentedScene } from "../../../src/content/q3/presentation/scene.ts";
import { DEFAULT_MODEL } from "../../../src/content/q3/presentation/ref-entity.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { Draw2D, TextCommandSink } from "../../../src/text/draw2d.ts";
import type { MaterialPicture, MaterialTextDraw } from "../../../src/text/draw2d.ts";
import { DEFAULT_RAIL_SETTINGS } from "../../../src/render/scene/particles/primitives.ts";
import { compileShaderScript } from "../../../src/materials/compile.ts";
import type { RegisteredImage } from "../../../src/materials/material.ts";
import type { Q3ResourceWorld } from "../../../src/content/q3/presentation/resources.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { decodeQ3World } from "../../../src/formats/q3-map/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { CommonParseCursor, CommonParseState } from "../../../src/core/common-parse.ts";
import { resolve } from "node:path";

async function fixture(world?: Q3ResourceWorld, load: () => Promise<void> = async () => {}) {
  const identity = createIdentityOwner("qvm-render"), seat = identity.seat(1), scenes: Q3PresentedScene[] = [], pictures: MaterialTextDraw[] = [];
  const target = { x: 0, y: 0, width: 640, height: 480 };
  const scene = new Q3SceneRecorder({ seat, viewport: target, nearClip: 4, farClip: 4096, rail: DEFAULT_RAIL_SETTINGS,
    actor: () => null, publish: value => { scenes.push(value); } });
  const registered: RegisteredImage = { frame: { image: { owner: { identity: Symbol("qvm"), session: identity.session, generation: 0 },
    ordinal: 0, source: { kind: "generated", name: "white" }, width: 1, height: 1 } }, tmu: 0 };
  const compiled = (await compileShaderScript("vm/picture { { map $whiteimage } }", { whiteImage: registered, defaultImage: registered, lightmapImage: registered,
    findImage: async () => registered, playShaderCinematic: async () => null, applySun() {}, initializeSkyTexCoords() {}, printWarning() {} }))[0];
  if (compiled === undefined) throw new Error("Missing compiled material");
  const picture: MaterialPicture = { kind: "material", name: "vm/picture", material: { order: 17, compiled } };
  const skin = { path: "vm/skin", surfaces: [{ name: "body", shader: "vm/picture" }] };
  const resources = new Q3RendererResources({ scene, zeroPicture: picture, model: async () => DEFAULT_MODEL, skin: async () => skin,
    shader: async () => picture, world: async () => { await load(); return { map: { models: [] } }; }, remapShader: async () => {} }, world);
  const draw = new Draw2D(new TextCommandSink(seat, target, () => {}, value => { pictures.push(value); }), "pixels");
  const guest = new QvmMemory(new Uint8Array(4096));
  const call = (code: QvmCgameImport, args: readonly number[] = []): QvmHostCall => {
    const words = new DataView(new ArrayBuffer((args.length + 1) * 4));
    words.setInt32(0, code, true); args.forEach((value, index) => words.setInt32((index + 1) * 4, value, true));
    return { words, memory: guest.bytes, guest, code, role: "cgame", kind: "engine", commandArguments: null,
      invoke: () => { throw new Error("Unexpected reentry"); }, invokeAsync: async () => { throw new Error("Unexpected reentry"); } };
  };
  return { resources, draw, guest, call, scenes, pictures, picture, skin };
}

test("guest handles register the same resource objects and submit through the shared scene and draw sink", async () => {
  const f = await fixture();
  f.guest.writeString(512, "vm/picture", 32);
  expect(await qvmClientRenderSyscall(f.call(QvmCgameImport.CG_R_REGISTERSHADER, [512]), f.resources, f.draw)).toBe(17);
  expect(f.resources.shaderForHandle(17)).toBe(f.picture);
  expect(f.resources.shaderHandle(await f.resources.registerShader("vm/picture"))).toBe(17);
  expect(await qvmClientRenderSyscall(f.call(QvmCgameImport.CG_R_REGISTERSKIN, [512]), f.resources, f.draw)).toBe(1);
  expect(f.resources.skinForHandle(1)).toBe(f.skin);
  expect(f.resources.skinHandle(await f.resources.registerSkin("vm/picture"))).toBe(1);
  const entity = f.guest.view(1024, 140); entity.setInt32(0, 2, true); entity.setFloat32(68, 12, true); entity.setInt32(112, 17, true); entity.setFloat32(132, 8, true);
  expect(qvmClientRenderSyscall(f.call(QvmCgameImport.CG_R_ADDREFENTITYTOSCENE, [1024]), f.resources, f.draw)).toBe(0);
  entity.setFloat32(68, 900, true);
  const refdef = f.guest.view(1536, 368); refdef.setInt32(8, 640, true); refdef.setInt32(12, 480, true); refdef.setFloat32(16, 90, true); refdef.setFloat32(20, 75, true);
  for (const offset of [36, 52, 68]) refdef.setFloat32(offset, 1, true);
  qvmClientRenderSyscall(f.call(QvmCgameImport.CG_R_RENDERSCENE, [1536]), f.resources, f.draw);
  expect(f.scenes[0]?.effects[0]?.shader).toBe(f.picture);
  expect(f.scenes[0]?.effects[0]?.geometry.vertices[0]?.position.x).toBe(12);
  const pictureCall = f.call(QvmCgameImport.CG_R_DRAWSTRETCHPIC, Array.from({ length: 9 }, () => 0));
  pictureCall.words.setFloat32(12, 32, true); pictureCall.words.setFloat32(16, 16, true); pictureCall.words.setInt32(36, 17, true);
  qvmClientRenderSyscall(pictureCall, f.resources, f.draw);
  expect(f.pictures[0]?.picture).toBe(f.picture);
  expect(() => f.resources.skinForHandle(9)).toThrow("Invalid cgame skin handle");
});

test("QVM world traps iterate retail entity bytes and query the loaded collision PVS", async () => {
  const archive = await openArchive(resolve(import.meta.dir, "../../../../qfiles/q3a/baseq3/pak0.pk3"));
  try {
    const entry = archive.findEntries("maps/q3dm1.bsp")[0];
    if (entry === undefined) throw new Error("Missing retail map");
    const map = decodeQ3World(await archive.readEntry(entry)), queries = createSceneQueries(map), clip = queries.nativeQ3ClipModels();
    if (clip === null) throw new Error("Missing loaded Q3 collision owner");
    const f = await fixture({ map, clusterPVS: cluster => clip.world.clusterPVS(cluster) });
    const token = () => qvmClientRenderSyscall(f.call(QvmCgameImport.CG_GET_ENTITY_TOKEN, [512, 1024]), f.resources, f.draw);
    expect(token()).toBe(0);
    expect(() => qvmClientRenderSyscall(f.call(QvmCgameImport.CG_R_INPVS, [4094, 4094]), f.resources, f.draw)).toThrow("bad model");
    await f.resources.loadWorld("maps/q3dm1.bsp");
    const cursor = new CommonParseCursor(map.entities), parser = new CommonParseState();
    let count = 0;
    for (;;) {
      const expected = parser.parse(cursor), result = token();
      expect(f.guest.readString(512)).toBe(expected);
      if (cursor.offset === null || expected.length === 0) { expect(result).toBe(0); break; }
      expect(result).toBe(1); count++;
    }
    expect(count).toBeGreaterThan(100);
    expect(token()).toBe(1); expect(f.guest.readString(512)).toBe("{");
    const points = map.leaves.filter(leaf => leaf.cluster >= 0).slice(0, 200).map(leaf => ({
      x: (leaf.bounds.min.x + leaf.bounds.max.x) / 2, y: (leaf.bounds.min.y + leaf.bounds.max.y) / 2, z: (leaf.bounds.min.z + leaf.bounds.max.z) / 2,
    }));
    let positive = false, negative = false;
    let visiblePoint: (typeof points)[number] | undefined;
    for (const first of points) {
      for (const second of points) {
        const from = clip.world.leafCluster(clip.world.pointLeafnum(first)), to = clip.world.leafCluster(clip.world.pointLeafnum(second));
        if (from < 0 || to < 0) continue;
        const expected = (clip.world.clusterPVS(from).byteAt(to >> 3) & (1 << (to & 7))) !== 0;
        if (expected ? positive : negative) continue;
        for (const [pointer, point] of [[2048, first], [2060, second]] satisfies readonly (readonly [number, typeof first])[]) {
          const record = f.guest.view(pointer, 12);
          record.setFloat32(0, point.x, true); record.setFloat32(4, point.y, true); record.setFloat32(8, point.z, true);
        }
        expect(qvmClientRenderSyscall(f.call(QvmCgameImport.CG_R_INPVS, [2048, 2060]), f.resources, f.draw)).toBe(Number(expected));
        if (expected) { positive = true; visiblePoint = first; } else negative = true;
        if (positive && negative) break;
      }
      if (positive && negative) break;
    }
    expect(positive).toBe(true); expect(negative).toBe(true);
    const noVisQueries = createSceneQueries({ ...map, visibility: null }), noVisClip = noVisQueries.nativeQ3ClipModels();
    if (noVisClip === null) throw new Error("Missing no-vis collision owner");
    const noVis = await fixture({ map, clusterPVS: cluster => noVisClip.world.clusterPVS(cluster) });
    await noVis.resources.loadWorld("maps/q3dm1.bsp");
    const point = visiblePoint; if (point === undefined) throw new Error("Missing visible retail leaf point");
    expect(noVis.resources.inPVS(() => point, () => point)).toBe(true);
    expect(() => qvmClientRenderSyscall(f.call(QvmCgameImport.CG_R_INPVS, [4094, 512]), f.resources, f.draw)).toThrow();
  } finally { archive.close(); }
});

test("world token and PVS traps retain source exhaustion, plane-side and lazy pointer semantics", async () => {
  const leaf = { cluster: 0, area: 0, bounds: { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }, surfaces: { first: 0, count: 0 }, brushes: { first: 0, count: 0 } };
  const map: Q3ResourceWorld["map"] = { entities: '{ "quoted key" "quoted value" }',
    planes: [{ normal: { x: 1, y: 0, z: 0 }, distance: 0, type: 0, signbits: 0 }],
    nodes: [{ plane: 0, bounds: leaf.bounds, children: [{ kind: "leaf", index: 1 }, { kind: "leaf", index: 0 }] }],
    leaves: [leaf, { ...leaf, cluster: 1 }] };
  const visited: number[] = [];
  let failLoad = false;
  const f = await fixture({ map, clusterPVS: cluster => { visited.push(cluster); return { byteAt: () => 1 << cluster }; } }, async () => {
    if (failLoad) throw new Error("world load failed");
  });
  await f.resources.loadWorld("test");
  const token = (capacity = 32, pointer = 512) => qvmClientRenderSyscall(f.call(QvmCgameImport.CG_GET_ENTITY_TOKEN, [pointer, capacity]), f.resources, f.draw);
  expect(token()).toBe(1); expect(f.guest.readString(512)).toBe("{");
  failLoad = true;
  await expect(f.resources.loadWorld("failed")).rejects.toThrow("world load failed");
  expect(token(7)).toBe(1); expect(f.guest.readString(512)).toBe("quoted");
  expect(() => token(32, 4090)).toThrow();
  expect(token()).toBe(1); expect(f.guest.readString(512)).toBe("}");
  expect(token()).toBe(0); expect(token()).toBe(1);
  const origin = { x: 0, y: 0, z: 0 }, front = { x: 1, y: 0, z: 0 };
  expect(f.resources.inPVS(() => origin, () => front)).toBe(false); expect(visited).toEqual([0]);
  const flat = await fixture({ map: { ...map, nodes: [] }, clusterPVS: () => ({ byteAt: () => 255 }) });
  await flat.resources.loadWorld("empty-nodes");
  expect(qvmClientRenderSyscall(flat.call(QvmCgameImport.CG_R_INPVS, [4094, 4094]), flat.resources, flat.draw)).toBe(1);
});

test("guest record marshalling preserves complete values and rejects truncated records", () => {
  const entity = new DataView(new ArrayBuffer(140)); entity.setInt32(0, 0, true); entity.setInt32(8, 12, true); entity.setUint8(119, 255);
  expect(readQvmRefEntity(entity).model).toBe(12); expect(readQvmRefEntity(entity).shaderRGBA.w).toBe(255);
  expect(() => readQvmRefEntity(new DataView(new ArrayBuffer(139)))).toThrow();
  const refdef = new DataView(new ArrayBuffer(368)); refdef.setUint8(80, 123); refdef.setUint8(112, 65);
  const saved = readQvmRefdef(refdef); refdef.setUint8(80, 0);
  expect(saved.areaMask[0]).toBe(123); expect(saved.text[0].startsWith("A\0")).toBe(true);
  expect(() => readQvmRefdef(new DataView(new ArrayBuffer(367)))).toThrow();
});

test("guest scene admission keeps refentity slots, polygon membership, and earlier snapshots", async () => {
  const f = await fixture();
  f.guest.writeString(512, "vm/picture", 32);
  await qvmClientRenderSyscall(f.call(QvmCgameImport.CG_R_REGISTERSHADER, [512]), f.resources, f.draw);
  const entity = f.guest.view(1024, 140);
  for (const type of [0, 1, 7, 3, 2, 2]) {
    entity.setInt32(0, type, true); entity.setInt32(8, type === 1 ? 9041 : 0, true);
    entity.setInt32(108, type === 1 ? 9042 : 0, true); entity.setInt32(112, type === 1 ? 9043 : 17, true); entity.setFloat32(132, 8, true);
    entity.setFloat32(68, 12, true);
    qvmClientRenderSyscall(f.call(QvmCgameImport.CG_R_ADDREFENTITYTOSCENE, [1024]), f.resources, f.draw);
  }
  const vertices = f.guest.view(2048, 72);
  for (let index = 0; index < 3; index++) {
    vertices.setFloat32(index * 24, 20, true); vertices.setFloat32(index * 24 + 4, index, true);
    vertices.setFloat32(index * 24 + 8, index % 2, true);
  }
  qvmClientRenderSyscall(f.call(QvmCgameImport.CG_R_ADDPOLYTOSCENE, [17, 3, 2048]), f.resources, f.draw);
  entity.setFloat32(68, 900, true); vertices.setFloat32(0, 900, true);
  const refdef = f.guest.view(1536, 368);
  refdef.setInt32(8, 640, true); refdef.setInt32(12, 480, true); refdef.setFloat32(16, 90, true); refdef.setFloat32(20, 75, true);
  for (const offset of [36, 52, 68]) refdef.setFloat32(offset, 1, true);
  qvmClientRenderSyscall(f.call(QvmCgameImport.CG_R_RENDERSCENE, [1536]), f.resources, f.draw);
  qvmClientRenderSyscall(f.call(QvmCgameImport.CG_R_RENDERSCENE, [1536]), f.resources, f.draw);
  qvmClientRenderSyscall(f.call(QvmCgameImport.CG_R_CLEARSCENE), f.resources, f.draw);
  qvmClientRenderSyscall(f.call(QvmCgameImport.CG_R_RENDERSCENE, [1536]), f.resources, f.draw);
  const first = f.scenes[0], repeated = f.scenes[1], cleared = f.scenes[2];
  if (first === undefined || repeated === undefined || cleared === undefined) throw new Error("Missing guest scene snapshots");
  expect(first.admission.entities.map(entity => entity.kind)).toEqual(["model", "poly", "portal-surface", "beam", "sprite", "sprite"]);
  expect(first.admission.entities.map(entity => entity.origin.x)).toEqual([12, 12, 12, 12, 12, 12]);
  expect(first.admission.entities[4]).not.toBe(first.admission.entities[5]);
  const unsupported = first.admission.entities[1];
  if (unsupported?.kind !== "poly") throw new Error("Missing admitted RT_POLY source record");
  expect(unsupported.model).toBe(9041); expect(unsupported.customSkin).toBe(9042); expect(unsupported.customShader).toBe(9043);
  expect(first.specialEntities.map(entity => entity.entityIndex)).toEqual([0, 3]);
  expect(first.portals.map(portal => portal.entityIndex)).toEqual([2]);
  expect(first.effects.map(effect => effect.admission)).toEqual([{ kind: "refentity", index: 4 }, { kind: "refentity", index: 5 }, { kind: "polygon", index: 0 }]);
  expect(first.admission.polygons[0]?.vertices[0]?.position.x).toBe(20);
  expect(first.admission.id.equals(repeated.admission.id)).toBe(false);
  expect(first.effects).toEqual(repeated.effects); expect(first.specialEntities).toEqual(repeated.specialEntities);
  expect(cleared.admission.entities).toHaveLength(0); expect(cleared.admission.polygons).toHaveLength(0);
  expect(first.admission.entities).toHaveLength(6); expect(first.admission.polygons).toHaveLength(1);
});
