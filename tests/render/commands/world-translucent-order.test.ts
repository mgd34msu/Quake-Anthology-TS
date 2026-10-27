import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { Q2WorldGeometry } from "../../../src/contracts/scene.ts";
import type { DrawBatch, RendererImage, RendererResourceOwner, SceneCamera } from "../../../src/contracts/render.ts";
import { anglesToAxis } from "../../../src/core/math.ts";
import { SceneImageRegistry, SceneTextureLoader, SceneShaderRegistry, WorldScene, perspectiveProjection } from "../../../src/render/scene/index.ts";
import { SceneMaterialRegistrations } from "../../../src/render/scene/material-registrations.ts";
import { sequenceDrawGroup } from "../../../src/render/scene/submissions.ts";
import { CPU_OPAQUE_STATE } from "../../../src/render/cpu/index.ts";
import type { WorldViewInput } from "../../../src/render/scene/world.ts";

test("legacy translucent world surfaces draw after supplied opaque entity operations", async () => {
  const identity = createIdentityOwner("world-translucent-order");
  const owner: RendererResourceOwner = { identity: Symbol("world-translucent-order"), session: identity.session, generation: 0 };
  const images = new SceneImageRegistry(owner), textures = new SceneTextureLoader(images, { read: async () => null });
  const shaders = new SceneShaderRegistry(textures, new SceneMaterialRegistrations().provider("q3:classic:retail:test"));
  const bounds = { min: { x: 32, y: -8, z: -8 }, max: { x: 32, y: 8, z: 8 } };
  const projection = { s: { x: 0, y: 1, z: 0, w: 0 }, t: { x: 0, y: 0, z: -1, w: 0 } };
  // One Q2 leaf holding a single TRANS66 (surface flag 32) pane at x=32.
  const map: Q2WorldGeometry = {
    kind: "q2-bsp", format: "ibsp38", entities: "",
    planes: [{ normal: { x: -1, y: 0, z: 0 }, distance: -32, type: 0, signbits: 0 }],
    vertices: [{ x: 32, y: -8, z: -8 }, { x: 32, y: 8, z: -8 }, { x: 32, y: 0, z: 8 }],
    edges: [{ vertices: [0, 1] }, { vertices: [1, 2] }, { vertices: [2, 0] }], surfaceEdges: [0, 1, 2],
    nodes: [], leaves: [{ contents: 0, mergedContents: 0, cluster: -1, area: 0, bounds, faces: { first: 0, count: 1 }, brushes: { first: 0, count: 0 } }],
    leafFaces: [0], leafBrushes: [],
    textureInfo: [{ projection, name: "glass", flags: 32, value: 0, material: "", next: null }],
    faces: [{ plane: 0, back: false, edges: { first: 0, count: 3 }, textureInfo: 0, styles: [255, 255, 255, 255], lightingOffset: null }],
    brushes: [], brushSides: [], models: [{ bounds, origin: { x: 0, y: 0, z: 0 }, headnode: -1, faces: { first: 0, count: 1 } }],
    areas: [], areaPortals: [], visibility: null,
    lighting: { kind: "rgb8", source: "bsp", samples: new Uint8Array() }, lightgrid: null, decoupledLightmaps: null, extensions: [],
  };
  const scene = await WorldScene.load(map, shaders);
  try {
    const marker: RendererImage = { owner, ordinal: 999, source: { kind: "generated", name: "opaque-entity" }, width: 1, height: 1 };
    const opaque: DrawBatch = { lighting: { kind: "vertex" }, primitive: "triangles", texturing: "single",
      texture: { kind: "bind-image", image: marker }, indices: [0, 1, 2], state: CPU_OPAQUE_STATE,
      vertices: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 0, y: 1 }].map(position => ({
        position: { ...position, z: 0, w: 1 }, texCoord: { x: 0.5, y: 0.5 }, color: { x: 1, y: 0, z: 0, w: 1 } })) };
    const camera: SceneCamera = { origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }),
      viewport: { x: 0, y: 0, width: 32, height: 32 }, projection: perspectiveProjection(90, 90, 4096), clip: { kind: "none" } };
    const input: WorldViewInput = { camera, target: { kind: "seat", seat: identity.seat(0) }, time: { kind: "seconds", value: 0 },
      operations: [sequenceDrawGroup("opaque", [opaque])] };
    const batches = scene.prepareView(input).view.operations.flatMap(operation => operation.kind === "draw" ? operation.batches : []);
    const opaqueIndex = batches.indexOf(opaque);
    const translucentIndex = batches.findIndex(batch => batch.state.blend.source === "src-alpha" && batch.state.depthWrite === false);
    expect(opaqueIndex).toBeGreaterThanOrEqual(0);
    expect(translucentIndex).toBeGreaterThanOrEqual(0);
    expect(opaqueIndex).toBeLessThan(translucentIndex);
  } finally { scene.close(); }
});
