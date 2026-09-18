import { expect, test } from "bun:test";
import type { BspFace, DecoupledLightmap, Q1WorldGeometry, Q2WorldGeometry } from "../../src/contracts/scene.ts";
import { prepareBrushFace } from "../../src/render/scene/geometry.ts";
import { buildQ1Lightmap, buildQ2Lightmap, q2LightStyle } from "../../src/materials/lighting.ts";

const face: BspFace = { plane: 0, back: false, edges: { first: 0, count: 3 }, textureInfo: 0, styles: [0, 255], lightingOffset: 1 };
const projection = { s: { x: 1, y: 0, z: 0, w: 0 }, t: { x: 0, y: 1, z: 0, w: 0 } };
const base: Q1WorldGeometry = {
  kind: "q1-bsp", format: "bsp29", entities: "",
  planes: [{ normal: { x: 0, y: 0, z: 1 }, distance: 0, type: 2, signbits: 0 }],
  vertices: [{ x: 0, y: 0, z: 0 }, { x: 16, y: 0, z: 0 }, { x: 0, y: 16, z: 0 }],
  edges: [{ vertices: [0, 1] }, { vertices: [1, 2] }, { vertices: [2, 0] }], surfaceEdges: [0, 1, 2],
  textureInfo: [{ projection, texture: 0, flags: 0 }], faces: [face],
  textures: [], nodes: [], leaves: [], leafFaces: [], models: [], clipnodes: [], visibility: new Uint8Array(),
  lighting: { kind: "luminance8", samples: new Uint8Array([200, 16, 16, 16, 16]) },
  decoupledLightmaps: null, brushList: null, extensions: [],
};
const mapping: DecoupledLightmap = { width: 2, height: 2, lightingOffset: 1,
  axes: [{ x: 1 / 16, y: 0, z: 0 }, { x: 0, y: 1 / 16, z: 0 }], offset: { x: 0, y: 0 } };
const rgb = [16, 32, 48, 16, 32, 48, 16, 32, 48, 16, 32, 48];
const rgba = (r: number, g: number, b: number, a = 255): Uint8Array => new Uint8Array([r, g, b, a, r, g, b, a, r, g, b, a, r, g, b, a]);

test("Q1 colored lightmaps address complete RGB samples for classic and decoupled faces", () => {
  for (const source of ["lit", "bspx", "bsp"] satisfies readonly ("lit" | "bspx" | "bsp")[]) {
    for (const decoupled of [false, true]) {
      const world: Q1WorldGeometry = { ...base, format: source === "bsp" ? "quake64" : "bsp29",
        lighting: { kind: "rgb8", source, samples: new Uint8Array([200, 201, 202, ...rgb]) },
        decoupledLightmaps: decoupled ? [mapping] : null };
      const prepared = prepareBrushFace(world, face, 0, { x: 64, y: 64 }, false);
      expect(buildQ1Lightmap(prepared.lightmap, [256]).image.pixels).toEqual(rgba(32, 64, 96));
    }
  }
});

test("Q1 monochrome and native Q2 byte offsets retain their lighting", () => {
  const mono = prepareBrushFace(base, face, 0, { x: 64, y: 64 }, false);
  expect(buildQ1Lightmap(mono.lightmap, [256], { encoding: "rgb" }).image.pixels).toEqual(rgba(32, 32, 32));
  const q2: Q2WorldGeometry = { ...base, kind: "q2-bsp", format: "ibsp38", leaves: [], models: [], visibility: null,
    textureInfo: [{ projection, name: "stone", flags: 0, value: 0, material: "", next: null }],
    lighting: { kind: "rgb8", source: "bsp", samples: new Uint8Array([200, ...rgb]) },
    leafBrushes: [], brushes: [], brushSides: [], areas: [], areaPortals: [], lightgrid: null };
  for (const decoupled of [false, true]) {
    const prepared = prepareBrushFace({ ...q2, decoupledLightmaps: decoupled ? [mapping] : null }, face, 0, { x: 64, y: 64 }, false);
    expect(buildQ2Lightmap(prepared.lightmap, [q2LightStyle("m", 0)]).image.pixels).toEqual(rgba(16, 32, 48, 48));
  }
  expect(prepareBrushFace(base, { ...face, lightingOffset: null }, 0, { x: 64, y: 64 }, false).lightmap.lighting).toBeNull();
});
