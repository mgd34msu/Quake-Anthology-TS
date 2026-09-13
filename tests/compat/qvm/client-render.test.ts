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

async function fixture() {
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
    shader: async () => picture, world: async () => ({ map: { models: [] } }), remapShader: async () => {} });
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

test("guest record marshalling preserves complete values and rejects truncated records", () => {
  const entity = new DataView(new ArrayBuffer(140)); entity.setInt32(0, 0, true); entity.setInt32(8, 12, true); entity.setUint8(119, 255);
  expect(readQvmRefEntity(entity).model).toBe(12); expect(readQvmRefEntity(entity).shaderRGBA.w).toBe(255);
  expect(() => readQvmRefEntity(new DataView(new ArrayBuffer(139)))).toThrow();
  const refdef = new DataView(new ArrayBuffer(368)); refdef.setUint8(80, 123); refdef.setUint8(112, 65);
  const saved = readQvmRefdef(refdef); refdef.setUint8(80, 0);
  expect(saved.areaMask[0]).toBe(123); expect(saved.text[0].startsWith("A\0")).toBe(true);
  expect(() => readQvmRefdef(new DataView(new ArrayBuffer(367)))).toThrow();
});
