// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { RendererImage, RendererResourceOwner, RenderOperation } from "../../src/contracts/render.ts";
import { CPU_OPAQUE_STATE, SoftwareRenderer } from "../../src/render/cpu/index.ts";
import { stencilShadowVolume } from "../../src/render/scene/models/stencil-shadow.ts";
import { shadowFinishQuad } from "../../src/render/scene/shadow-geometry.ts";
import { perspectiveProjection } from "../../src/render/scene/view.ts";

const up = { x: 0, y: 0, z: 1 };

test("a lone upward triangle lit from above casts a three-edge silhouette extruded 512 units", () => {
  const volume = stencilShadowVolume([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }], [0, 1, 2], up);
  if (volume === null) throw new Error("Expected a shadow volume");
  expect(volume.positions).toHaveLength(6);
  expect(volume.positions[3]).toEqual({ x: 0, y: 0, z: -512 });
  expect(volume.indices).toHaveLength(3 * 6);
  expect(volume.indices.slice(0, 6)).toEqual([0, 3, 1, 1, 3, 4]);
});

test("an edge shared by two lit triangles is interior and a light behind the surface casts nothing", () => {
  const quad = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }];
  expect(stencilShadowVolume(quad, [0, 1, 2, 0, 2, 3], up)?.indices).toHaveLength(4 * 6);
  expect(stencilShadowVolume(quad, [0, 1, 2, 0, 2, 3], { x: 0, y: 0, z: -1 })?.indices).toHaveLength(0);
  expect(stencilShadowVolume(Array.from({ length: 500 }, () => ({ x: 0, y: 0, z: 0 })), [], up)).toBeNull();
});

test("the finish quad covers the view and the CPU renderer darkens exactly the stencilled pixels", () => {
  const camera = { origin: { x: 0, y: 0, z: 0 }, axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }] as const,
    projection: perspectiveProjection(90, 90, 1000, 4), viewport: { x: 0, y: 0, width: 8, height: 8 }, clip: { kind: "none" } } as const;
  const corners = shadowFinishQuad(camera);
  expect(corners.every(corner => corner.w === 10 && Math.abs(corner.x) > corner.w && Math.abs(corner.y) > corner.w)).toBe(true);
  const owner: RendererResourceOwner = { identity: Symbol("stencil"), session: createIdentityOwner("stencil shadow").session, generation: 0 };
  const renderer = new SoftwareRenderer(8, 8, owner, 8, 8, 8);
  const white: RendererImage = { owner, ordinal: 0, source: { kind: "generated", name: "white" }, width: 1, height: 1 };
  renderer.applyImageResource({ kind: "create-image", image: white, content: { kind: "rgba8", borderColor: { x: 0, y: 0, z: 0, w: 0 },
    levels: [{ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) }] }, sampling: { filter: "nearest", wrap: "repeat" } });
  try {
    renderer.beginView({ viewport: camera.viewport, clipPlane: null, clear: { color: { x: 1, y: 1, z: 1, w: 1 }, depth: 1, stencil: true } });
    const vertex = (x: number, y: number, z: number) => ({ position: { x, y, z, w: 1 }, texCoord: { x: 0, y: 0 }, color: { x: 1, y: 1, z: 1, w: 1 } });
    // An opaque floor at mid depth; the volume's near face is in front of it and its far face behind it.
    renderer.draw({ lighting: { kind: "vertex" }, primitive: "triangles", texturing: "single", texture: { kind: "bind-image", image: white },
      indices: [0, 1, 2, 0, 2, 3], state: CPU_OPAQUE_STATE,
      vertices: [vertex(-1, -1, 0), vertex(1, -1, 0), vertex(1, 1, 0), vertex(-1, 1, 0)] });
    const positions = [-0.5, 0.5].flatMap(z => [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }].map(p => ({ ...p, z, w: 1 })));
    const volume: RenderOperation = { kind: "shadow-volume", whiteImage: white, mirror: false, positions,
      indices: [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6] };
    renderer.drawImmediate(volume);
    renderer.drawImmediate({ kind: "shadow-finish", whiteImage: white, positions: [{ x: -1, y: 1, z: 0, w: 1 }, { x: 1, y: 1, z: 0, w: 1 }, { x: 1, y: -1, z: 0, w: 1 }, { x: -1, y: -1, z: 0, w: 1 }] });
    const at = (x: number, y: number): number => renderer.pixels[(y * 8 + x) * 4] ?? -1;
    expect(at(4, 4)).toBe(153);
    expect(at(0, 0)).toBe(255);
    expect(at(7, 7)).toBe(255);
  } finally { renderer.close(); }
});

test("stencil shadow operations are skipped on a target without stencil bits", () => {
  const owner: RendererResourceOwner = { identity: Symbol("nostencil"), session: createIdentityOwner("no stencil").session, generation: 0 };
  const renderer = new SoftwareRenderer(8, 8, owner, 8, 0, 8);
  const white: RendererImage = { owner, ordinal: 0, source: { kind: "generated", name: "white" }, width: 1, height: 1 };
  try {
    renderer.beginView({ viewport: { x: 0, y: 0, width: 8, height: 8 }, clipPlane: null, clear: { color: { x: 1, y: 1, z: 1, w: 1 }, depth: 1, stencil: false } });
    renderer.drawImmediate({ kind: "shadow-finish", whiteImage: white, positions: [{ x: -1, y: 1, z: 0, w: 1 }, { x: 1, y: 1, z: 0, w: 1 }, { x: 1, y: -1, z: 0, w: 1 }, { x: -1, y: -1, z: 0, w: 1 }] });
    expect(renderer.pixels[0]).toBe(255);
  } finally { renderer.close(); }
});
