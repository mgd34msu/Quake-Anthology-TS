import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { SceneCamera } from "../../src/contracts/render.ts";
import type { SceneEntity } from "../../src/contracts/scene.ts";
import { anglesToAxis, identityMat4 } from "../../src/core/math.ts";
import { ApplicationAssets } from "../../src/app/bootstrap/assets.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createStartupSelection } from "../../src/app/bootstrap/startup-selection.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import { prepareSceneEntity } from "../../src/render/scene/models/prepare.ts";

test("menu-selected Q2 monsters advance rendered poses when the source has no explicit old frame", async () => {
  const root = await mkdtemp("/tmp/quake-monster-animation-");
  try {
    const parsed = parseApplicationCommand(["--menu", "--user-content-root", root]);
    if (parsed.kind !== "menu") throw new Error("Expected startup menu");
    const menu = await createStartupSelection(parsed.options);
    menu.select("product", "q2-classic-baseq2"); menu.select("map", "maps/base1.bsp");
    menu.select("movement", "q1-classic-id1"); menu.select("character", "q3-baseq3"); menu.select("model", "sarge");
    menu.select("weapons", "q2-classic-baseq2"); menu.select("enemies", "native");
    menu.select("grapple", "disabled"); menu.select("grenades", "disabled");
    const selected = await menu.resolve(), content = await loadApplicationContent(selected.options, selected.recipe);
    const identity = createIdentityOwner("monster-animation");
    const assets = new ApplicationAssets(content, { identity: Symbol("monster-animation"), session: identity.session, generation: 0 });
    const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
      skill: selected.options.skill, mode: selected.options.mode, seed: selected.options.seed, maxClients: 1,
      playerIdentity: client => ({ seat: client.slot, socialId: "" }) });
    try {
      simulation.admitPlayer(identity.client(0, 0));
      const camera: SceneCamera = { origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }),
        projection: identityMat4(), viewport: { x: 0, y: 0, width: 640, height: 480 }, clip: { kind: "none" } };
      const frames = new Set<number>(), shapes = new Set<string>();
      for (let tick = 0; tick < 12; tick++) {
        simulation.step({ elapsedMilliseconds: 100, commands: [] });
        const source = simulation.presentations().find(value => value.path === "models/monsters/infantry/tris.md2");
        if (source === undefined) throw new Error("base1 infantry is missing");
        const asset = await assets.model(source.content, source.path);
        const entity: SceneEntity = { actor: source.actor, model: asset.model, resource: asset.resource,
          transform: { origin: source.origin, axis: anglesToAxis(source.angles), scale: { x: source.scale, y: source.scale, z: source.scale } },
          previousOrigin: source.previousOrigin ?? source.origin,
          pose: { kind: "frame", frame: source.frame, previousFrame: source.oldFrame, backLerp: source.backLerp ?? 0 },
          skin: source.skin, color: { x: 1, y: 1, z: 1, w: 1 }, flags: { kind: source.family, bits: source.renderFlags },
          shaderTime: { kind: "seconds", value: 0 }, lightingOrigin: source.origin, shadowPlane: 0, attachments: [] };
        const prepared = prepareSceneEntity(entity, { camera, timeSeconds: tick / 10, noCull: true });
        expect(prepared.frameFallback).toBe(false);
        expect(prepared.frame).toBe(source.frame);
        expect(source.oldFrame).toBe(source.frame);
        frames.add(prepared.frame);
        shapes.add(JSON.stringify(prepared.surfaces.map(surface => surface.localGeometry.vertices.map(vertex => vertex.position))));
      }
      expect(frames.size).toBeGreaterThan(1);
      expect(shapes.size).toBeGreaterThan(1);
    } finally { simulation.close(); assets.close(); await content.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
