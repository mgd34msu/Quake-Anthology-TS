// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { openArchive } from "../../../../src/content/archive/index.ts";
import {
  createContentDigest,
  createContentId,
  createMountId,
  createMountIdentity,
  createMountPlanId,
  createResourceId,
} from "../../../../src/contracts/content.ts";
import type { ResolvedResourceReference } from "../../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { SceneCamera } from "../../../../src/contracts/render.ts";
import type { SceneEntity } from "../../../../src/contracts/scene.ts";
import { decodeQ3World } from "../../../../src/formats/q3-map/index.ts";
import { parseMd3 } from "../../../../src/formats/q3-model/md3.ts";
import { toSceneMd3 } from "../../../../src/formats/q3-model/scene.ts";
import { SceneMaterialRegistrations } from "../../../../src/render/scene/material-registrations.ts";
import { SceneModelRenderer } from "../../../../src/render/scene/models/index.ts";
import { SceneImageRegistry, SceneShaderRegistry, SceneTextureLoader, WorldScene, perspectiveProjection } from "../../../../src/render/scene/index.ts";
import { finishSceneOperations } from "../../../../src/render/scene/submissions.ts";
import { corpusFile } from "../../../support/corpus.ts";

const axis = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
] satisfies SceneCamera["axis"];
const RF_SHADOW_PLANE = 256,
  RF_NOSHADOW = 64;

async function member(path: string): Promise<{ bytes: Uint8Array; resource: ResolvedResourceReference }> {
  const archive = await openArchive(corpusFile("q3a/baseq3/pak0.pk3"));
  try {
    const entry = archive.findEntries(path)[0];
    if (entry === undefined) throw new Error(`Missing ${path}`);
    const bytes = await archive.readEntry(entry);
    const mount = {
      kind: "loose",
      identity: createMountIdentity(
        createMountId("scene", "q3"),
        createContentId({ family: "q3", edition: "classic", package: "base", revision: "retail" }),
        0,
      ),
      rootPath: "/",
    } as const;
    const resource: Omit<ResolvedResourceReference, "id"> = {
      requestedPath: path,
      provenance: { kind: "loose", mount, memberPath: path },
      digest: createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")),
      byteLength: bytes.length,
      resolution: { kind: "default-order", plan: createMountPlanId("scene", "test"), rank: 0 },
    };
    return { bytes, resource: { ...resource, id: createResourceId(resource) } };
  } finally {
    archive.close();
  }
}

test("cg_shadows 2 and 3 submit stencil volumes with one finish, and projection surfaces only for RF_SHADOW_PLANE", async () => {
  const archive = await openArchive(corpusFile("q3a/baseq3/pak0.pk3"));
  const identity = createIdentityOwner("model-shadows"),
    registrations = new SceneMaterialRegistrations();
  const images = new SceneImageRegistry({ identity: Symbol("model-shadows"), session: identity.session, generation: 0 });
  const textures = new SceneTextureLoader(images, {
    read: async name => {
      const entry = archive.findEntries(name)[0];
      return entry === undefined ? null : { bytes: await archive.readEntry(entry), source: { kind: "generated", name } };
    },
  });
  const shaders = new SceneShaderRegistry(textures, registrations.provider("q3:classic:retail:shadows"));
  let world: WorldScene | null = null;
  try {
    await shaders.initializeSourceMaterials(async () => {
      shaders.addScript(
        "projectionShadow { polygonOffset deformVertexes projectionShadow { map $whiteimage blendFunc GL_ONE GL_ZERO rgbGen const ( 0 0 0 ) } }",
      );
    });
    const map = await member("maps/q3dm1.bsp");
    world = await WorldScene.load(decodeQ3World(map.bytes), shaders);
    const body = await member("models/players/sarge/lower.md3");
    const origin = { x: 212, y: 2360, z: 82.125 };
    const base: SceneEntity = {
      actor: null,
      resource: body.resource,
      model: toSceneMd3(parseMd3(body.bytes)),
      transform: { origin, axis, scale: { x: 1, y: 1, z: 1 } },
      previousOrigin: origin,
      pose: { kind: "frame", frame: 1, previousFrame: 1, backLerp: 0 },
      skin: 0,
      color: { x: 1, y: 1, z: 1, w: 1 },
      shaderTime: { kind: "seconds", value: 0 },
      flags: { kind: "q3", bits: 0 },
      lightingOrigin: origin,
      shadowPlane: origin.z - 24,
      attachments: [],
    };
    const camera: SceneCamera = {
      origin: { ...origin, x: origin.x - 100 },
      axis,
      projection: perspectiveProjection(90, 74, 4096),
      viewport: { x: 0, y: 0, width: 640, height: 480 },
      clip: { kind: "none" },
    };
    const input = { camera, time: { kind: "seconds", value: 0 }, target: { kind: "seat", seat: identity.seat(0) } } as const;
    const renderer = new SceneModelRenderer({ family: "q3", textures, shaders, palette: null }, world);
    const options = () => ({ customSkin: [{ name: "l_legs", shader: "models/players/sarge/legs" }] });
    await renderer.preload([base], options);
    const volumes = (entity: SceneEntity, mode: 2 | 3 | undefined) =>
      finishSceneOperations(renderer.prepare([entity], mode === undefined ? input : { ...input, modelShadows: mode }, options));
    expect(volumes(base, undefined).some(operation => operation.kind === "shadow-volume")).toBe(false);
    const stencil = volumes(base, 2).filter(operation => operation.kind === "shadow-volume");
    expect(stencil.length).toBeGreaterThan(0);
    for (const operation of stencil) {
      if (operation.kind !== "shadow-volume") continue;
      expect(operation.indices.length % 3).toBe(0);
      expect(operation.positions.length % 2).toBe(0);
      expect(operation.mirror).toBe(false);
    }
    expect(volumes({ ...base, flags: { kind: "q3", bits: RF_NOSHADOW } }, 2).some(operation => operation.kind === "shadow-volume")).toBe(false);
    const mirrored = finishSceneOperations(
      renderer.prepare(
        [base],
        { ...input, camera: { ...camera, clip: { kind: "portal", mirror: true, plane: { normal: { x: 1, y: 0, z: 0 }, distance: -1000 } } }, modelShadows: 2 },
        options,
      ),
    );
    expect(mirrored.some(operation => operation.kind === "shadow-volume" && operation.mirror)).toBe(true);
    const prepared = world.prepareView({
      ...input,
      modelShadows: 2,
      noWorldModel: true,
      clear: { color: null, depth: 1, stencil: false },
      operations: renderer.prepare([base], { ...input, modelShadows: 2 }, options),
    });
    expect(prepared.view.clear?.stencil).toBe(true);
    expect(prepared.view.operations.filter(operation => operation.kind === "shadow-finish")).toHaveLength(1);
    expect(prepared.view.operations.at(-1)?.kind).toBe("shadow-finish");
    // Projection shadows draw colour batches only for RF_SHADOW_PLANE entities.
    const plain = volumes(base, 3),
      planar = volumes({ ...base, flags: { kind: "q3", bits: RF_SHADOW_PLANE } }, 3);
    expect(plain.every(operation => operation.kind !== "shadow-volume")).toBe(true);
    expect(planar.filter(operation => operation.kind === "draw").length).toBeGreaterThan(plain.filter(operation => operation.kind === "draw").length);
  } finally {
    world?.close();
    textures.close();
    archive.close();
  }
}, 60000);
