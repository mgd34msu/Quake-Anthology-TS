import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { SceneCamera } from "../../src/contracts/render.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { ApplicationAssets } from "../../src/app/bootstrap/assets.ts";
import { ApplicationEffects } from "../../src/app/bootstrap/effects.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import { createSceneQueries } from "../../src/world/collision/index.ts";
import { anglesToAxis } from "../../src/core/math.ts";
import { perspectiveProjection } from "../../src/render/scene/view.ts";

test.skipIf(!existsSync("/home/buzzkill/Projects/qfiles/q2/rerelease/Q2Game.kpf"))("retail Q2 shadow lights preserve source toggle, cone, fade and atlas metadata", async () => {
  const command = parseApplicationCommand(["--game", "q2-rerelease-baseq2", "--map", "base1", "--renderer", "cpu"]);
  if (command.kind !== "run") throw new Error("Expected application launch");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("shadow-light-source");
  const assets = new ApplicationAssets(content, { identity: Symbol("shadow-light"), session: identity.session, generation: 0 });
  const world = { ...content.world, entities: (content.world.entities.split("\0")[0] ?? "") + '\n{ "classname" "dynamic_light" "targetname" "proof_light" "target" "proof_aim" "spawnflags" "1" "origin" "0 0 64" "rgba" "1 0.5 0 1" "shadowlightradius" "192" "shadowlightintensity" "2" "shadowlightresolution" "128" "shadowlightconeangle" "45" "shadowlightstartfadedistance" "100" "shadowlightendfadedistance" "200" }\n{ "classname" "info_notnull" "targetname" "proof_aim" "origin" "0 0 0" }\n{ "classname" "trigger_always" "target" "proof_light" "delay" "0.2" }\n{ "classname" "trigger_always" "target" "proof_light" "delay" "0.4" }\n' };
  const simulation = createSimulation({ identity, recipe: content.recipe, world, mounts: content.mounts, skill: 1, mode: "singleplayer", seed: 1, maxClients: 1, playerIdentity: client => ({ seat: client.slot, socialId: "" }) });
  const effects = new ApplicationEffects(assets, createSceneQueries(world), actor => simulation.players().some(player => player.equals(actor)));
  const camera: SceneCamera = { origin: { x: 0, y: 0, z: 64 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }), viewport: { x: 0, y: 0, width: 160, height: 120 }, projection: perspectiveProjection(90, 74, 4096), clip: { kind: "none" } };
  try {
    simulation.admitPlayer(identity.client(0, 0));
    const advance = async () => {
      const output = simulation.step({ elapsedMilliseconds: 25, commands: [] });
      const events = simulation.drainPresentationEvents().filter(source => source.kind === "q2" && source.event.kind === "dynamic-light" && source.event.radius === 192);
      effects.receive(events); await effects.prepare(output.snapshot, []); return events;
    };
    await advance(); expect(effects.shadowSceneLights(camera, () => 1)).toEqual([]);
    for (let i = 0; i < 9; i++) await advance();
    const lights = effects.shadowSceneLights(camera, () => 1), light = lights[0];
    expect(lights).toHaveLength(1);
    if (light?.profile.kind !== "q2") throw new Error("Missing source shadow light");
    expect(light.profile.scale).toBe(2); expect(light.profile.shadow).toEqual({ kind: "cast", resolution: 128 });
    expect(light.profile.cone?.direction).toEqual({ x: 0, y: 0, z: -1 });
    expect(light.color).toEqual({ x: 1, y: 127 / 255, z: 0 });
    expect(effects.shadowSceneLights({ ...camera, origin: { x: 150, y: 0, z: 64 } }, () => 1)[0]?.profile).toMatchObject({ scale: 1 });
    expect(effects.shadowSceneLights({ ...camera, origin: { x: 200, y: 0, z: 64 } }, () => 1)).toEqual([]);
    const source = simulation.q2Source();
    if (source === null) throw new Error("Missing Q2 source");
    const target = [...source.game.entities.values()].find(entity => entity.targetname === "proof_aim");
    if (target === undefined) throw new Error("Missing light target");
    source.game.move(target, { origin: { x: 64, y: 0, z: 64 } });
    const moved = await advance();
    expect(moved).toHaveLength(1);
    expect(effects.shadowSceneLights(camera, () => 1)[0]?.profile).toMatchObject({ cone: { direction: { x: 1, y: 0, z: 0 } } });
    for (let i = 0; i < 10; i++) await advance();
    expect(effects.shadowSceneLights(camera, () => 1)).toEqual([]);
  } finally { effects.close(); simulation.close(); assets.close(); }
});

test("flashlight uses seat eye/hand, follows foreign actor pose and retires on toggle/reset/generation", async () => {
  const { SessionActorRegistry } = await import("../../src/world/actors/registry.ts");
  const { q3SpawnAnimation } = await import("../../src/content/q3/foundation/arsenal.ts");
  const command = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "start", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Expected Q1 world");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("flashlight-seats");
  const actors = new SessionActorRegistry(identity), actor = actors.allocate("q3:character", "q3:character/sarge");
  const assets = new ApplicationAssets(content, { identity: Symbol("flashlight-seats"), session: identity.session, generation: 0 });
  const effects = new ApplicationEffects(assets, createSceneQueries(content.world), () => true);
  let sequence = 0;
  const camera: SceneCamera = { origin: { x: 40, y: 50, z: 60 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }),
    viewport: { x: 0, y: 0, width: 64, height: 64 }, projection: perspectiveProjection(90, 90, 4096), clip: { kind: "none" } };
  const snapshot = (): import("../../src/contracts/session.ts").WorldSnapshot => ({ session: identity.session,
    frame: { frame: sequence, time: { kind: "seconds", value: sequence }, elapsed: { kind: "seconds", value: 1 }, phase: "frame-exit" },
    actors: actors.observations(), bodies: [], inventories: [], configurations: [],
    scene: { session: identity.session, time: { kind: "seconds", value: sequence }, world: null, entities: [], lights: [], particles: [], lightStyles: [], areaBits: null } });
  const pose = { actor: actor.id, origin: { x: 10, y: 20, z: 30 }, angles: { x: 0, y: 90, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    movementDirection: 0, animation: q3SpawnAnimation(), sourceFlags: 0, powerups: 0, team: null, color: { x: 1, y: 1, z: 1, w: 1 } };
  const emit = async (enabled: boolean, hand: "right" | "left" | "center") => {
    sequence++;
    effects.receive([{ kind: "q2-rerelease", content: content.recipe.map.entities.content, sequence, seconds: sequence,
      event: { kind: "flashlight", actor: actor.id, enabled, hand } }]);
    await effects.prepare(snapshot(), [], [pose]);
  };
  try {
    await emit(true, "right");
    const local = effects.shadowSceneLights(camera, () => 1, actor.id)[0];
    expect(local?.origin).toEqual({ x: 40, y: 43, z: 60 });
    expect(local).toMatchObject({ radius: 512, color: { x: 1, y: 1, z: 1 }, profile: { kind: "q2", scale: 2,
      cone: { direction: camera.axis[0], cosHalfAngle: Math.cos(22 * Math.PI / 180) }, shadow: { kind: "cast", resolution: 512 } } });
    expect(effects.shadowSceneLights(camera, () => 1)[0]?.origin).toEqual(pose.origin);
    pose.origin = { x: 12, y: 22, z: 32 }; await effects.prepare(snapshot(), [], [pose]);
    expect(effects.shadowSceneLights(camera, () => 1)[0]?.origin).toEqual(pose.origin);
    await emit(true, "left"); expect(effects.shadowSceneLights(camera, () => 1, actor.id)[0]?.origin.y).toBe(57);
    await emit(true, "center"); expect(effects.shadowSceneLights(camera, () => 1, actor.id)[0]?.origin).toEqual(camera.origin);
    await emit(false, "right"); expect(effects.shadowSceneLights(camera, () => 1)).toEqual([]);
    await emit(true, "right"); effects.resetRound(); expect(effects.shadowSceneLights(camera, () => 1)).toEqual([]);
    await emit(true, "right"); actors.release(actor);
    const next = actors.allocate("q3:character", "q3:character/sarge");
    await effects.prepare(snapshot(), [], [{ ...pose, actor: next.id }]);
    expect(effects.shadowSceneLights(camera, () => 1)).toEqual([]);
    expect(effects.drainSounds()).toEqual([]);
  } finally { effects.close(); assets.close(); await content.close(); }
});

for (const game of ["q1-classic-id1", "q2-rerelease-baseq2", "q3-baseq3"]) for (const backend of ["cpu", "gl"] satisfies readonly ("cpu" | "gl")[])
  test.skipIf(process.env["QUAKE_FLASHLIGHT_RENDER"] !== "1")(`shared spotlight illuminates and restores actual ${game} surfaces through ${backend}`, async () => {
    const { NativeRenderer } = await import("../../src/app/bootstrap/renderer.ts");
    const { SceneFrameBuilder } = await import("../../src/render/commands/frame.ts");
    const { vectorToAngles } = await import("../../src/core/math.ts");
    const command = parseApplicationCommand(["--game", game, "--map", game.startsWith("q1") ? "start" : game.startsWith("q2") ? "base1" : "q3dm1", "--dedicated"]);
    if (command.kind !== "run") throw new Error("Expected render fixture");
    const content = await loadApplicationContent(command.options), identity = createIdentityOwner(`flashlight-${game}-${backend}`);
    const owner = { identity: Symbol("flashlight-render"), session: identity.session, generation: 0 };
    const assets = new ApplicationAssets(content, owner), renderer = NativeRenderer.open({ renderer: backend, width: 96, height: 96, hidden: true, gamma: 1 }, owner);
    try {
      const world = await assets.loadWorld();
      const surface = world.surfaces.find(surface => surface.geometry.vertices.length >= 3 && surface.geometry.vertices.every(vertex => Math.abs(vertex.normal.z) < 0.5)
        && (surface.kind === "legacy" ? surface.lightmap !== null : surface.shader.finished.hasLightmapStage));
      if (surface === undefined) throw new Error("Missing authored lightmapped wall");
      const normal = surface.geometry.vertices[0]?.normal;
      if (normal === undefined) throw new Error("Missing wall normal");
      const center = surface.geometry.vertices.reduce((sum, vertex) => ({ x: sum.x + vertex.position.x / surface.geometry.vertices.length,
        y: sum.y + vertex.position.y / surface.geometry.vertices.length, z: sum.z + vertex.position.z / surface.geometry.vertices.length }), { x: 0, y: 0, z: 0 });
      const camera: SceneCamera = { origin: { x: center.x + normal.x * 96, y: center.y + normal.y * 96, z: center.z + normal.z * 96 },
        axis: anglesToAxis(vectorToAngles({ x: -normal.x, y: -normal.y, z: -normal.z })), viewport: { x: 0, y: 0, width: 96, height: 96 }, projection: perspectiveProjection(60, 60, 4096), clip: { kind: "none" } };
      const light: import("../../src/contracts/scene.ts").SceneLight = { origin: camera.origin, radius: 512, color: { x: 1, y: 1, z: 1 }, additive: true,
        profile: { kind: "q2", scale: 2, cone: { direction: camera.axis[0], cosHalfAngle: Math.cos(22 * Math.PI / 180) }, shadow: { kind: "cast", resolution: 512 } } };
      const frames = new SceneFrameBuilder(assets.images), captures: Uint8Array[] = [];
      for (const mode of ["off", "unshadowed", "shadowed", "off"]) {
        const enabled = mode !== "off";
        const input = { camera, target: { kind: "preview", id: "flashlight" }, time: { kind: "seconds", value: 0 },
          q1Styles: Array.from({ length: 256 }, () => 32), q2Styles: Array.from({ length: 256 }, () => ({ rgb: { x: 0.125, y: 0.125, z: 0.125 }, white: 0.375 })),
          clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false } } satisfies import("../../src/render/scene/world.ts").WorldViewInput;
        const shadows = world.prepareShadows(enabled ? [light] : [], input, [], { enabled: mode === "shadowed" });
        if (mode === "shadowed") expect(shadows.lighting.atlas).not.toBeNull();
        if (mode === "unshadowed") expect(shadows.lighting.lights[0]?.cone).not.toBeNull();
        frames.begin();
        frames.world(world.prepareView(enabled ? { ...input, q2FragmentLighting: shadows.lighting, beforeView: shadows.operations } : input));
        const capture = renderer.captureNextFrame(); renderer.execute(frames.finish(true)); const pixels = await capture; captures.push(pixels);
        const output = process.env["QUALIFICATION_OUTPUT"];
        if (output !== undefined) {
          const { encodePng } = await import("../../src/formats/images/png.ts");
          await Bun.write(`${output}/${game}-${backend}-${captures.length}-${mode}.png`, encodePng(96, 96, pixels));
        }
      }
      const [off, unshadowed, shadowed, restored] = captures;
      if (off === undefined || unshadowed === undefined || shadowed === undefined || restored === undefined) throw new Error("Missing spotlight captures");
      expect(restored).toEqual(off);
      for (const on of [unshadowed, shadowed]) {
        let brighter = 0;
        for (let index = 0; index < off.length; index += 4) if ((on[index] ?? 0) + (on[index + 1] ?? 0) + (on[index + 2] ?? 0)
          > (off[index] ?? 0) + (off[index + 1] ?? 0) + (off[index + 2] ?? 0) + 3) brighter++;
        expect(brighter).toBeGreaterThan(16);
      }
    } finally { renderer.close(); assets.close(); await content.close(); }
  }, 60000);
