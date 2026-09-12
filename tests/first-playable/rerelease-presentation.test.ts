import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { RendererResourceOwner } from "../../src/contracts/render.ts";
import { ApplicationRereleasePresentation } from "../../src/app/bootstrap/rerelease-presentation.ts";
import { RereleaseFog } from "../../src/app/bootstrap/rerelease-presentation/fog.ts";
import { ApplicationAssets } from "../../src/app/bootstrap/assets.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import { createQ2Fog } from "../../src/content/q2/rerelease/types.ts";
import { SceneFrameBuilder } from "../../src/render/commands/frame.ts";
import { CpuRenderTarget, SoftwareRenderer } from "../../src/render/cpu/index.ts";
import { q2SkySides } from "../../src/render/scene/q2-sky.ts";
import { Draw2D, TextCommandSink } from "../../src/text/draw2d.ts";
import { ApplicationWorldScene } from "../../src/app/bootstrap/presentation-scene.ts";
import { anglesToAxis } from "../../src/core/math.ts";
import { perspectiveProjection } from "../../src/render/scene/view.ts";
import { SeatTextPresentation } from "../../src/text/layout.ts";

test("rerelease fog messages preserve wire colors, world heights and interrupted source fades", () => {
  const fog = new RereleaseFog(), zero = createQ2Fog();
  const target = { fog: { density: 1, color: { x: 0.5, y: 1, z: 0 }, skyFactor: 0.5 },
    heightFog: { startColor: { x: 1, y: 0, z: 0 }, startDistance: -95.75, endColor: { x: 0, y: 0, z: 1 }, endDistance: 128.75, falloff: 0.1, density: 0.25 } };
  fog.receive(target, 1000, 2);
  const midway = fog.current(2.5);
  expect(midway.density).toBe(0.5); expect(midway.color.x).toBe(Math.fround(Math.fround(127 / 255) * 0.5));
  expect(midway.height.start.distance).toBe(-47.5); expect(midway.height.end.distance).toBe(64);
  fog.receive(zero, 1000, 2.5);
  expect(fog.current(2.5).density).toBe(1); expect(fog.current(3).density).toBe(0.5); expect(fog.current(3.5).density).toBe(0);
});

test.skipIf(!existsSync("/home/buzzkill/Projects/qfiles/q2/rerelease/Q2Game.kpf"))("source story and sky callbacks use retail localization and draw centered pixels for the selected seat", async () => {
  const command = parseApplicationCommand(["--game", "q2-rerelease-baseq2", "--map", "base1", "--renderer", "cpu", "--mode", "coop"]);
  if (command.kind !== "run") throw new Error("Expected application launch");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("rerelease-presentation");
  const owner: RendererResourceOwner = { identity: Symbol("rerelease-presentation"), session: identity.session, generation: 0 };
  const assets = new ApplicationAssets(content, owner);
  const world = { ...content.world, entities: (content.world.entities.split("\0")[0] ?? "") + '\n{ "classname" "target_story" "targetname" "presentation_story" "message" "$m_single_player" }\n'
    + '{ "classname" "target_sky" "targetname" "presentation_sky" "sky" "unit1_" "skyrotate" "90" "skyautorotate" "0" "skyaxis" "0 0 1" }\n'
    + '{ "classname" "trigger_always" "target" "presentation_story" }\n{ "classname" "trigger_always" "target" "presentation_sky" }\n' };
  const simulation = createSimulation({ identity, recipe: content.recipe, world, mounts: content.mounts,
    skill: command.options.skill, mode: command.options.mode, seed: command.options.seed, maxClients: 2,
    playerIdentity: client => ({ seat: client.slot, socialId: "" }) });
  try {
    const first = simulation.admitPlayer(identity.client(0, 0)), second = simulation.admitPlayer(identity.client(1, 0));
    const scene = await assets.loadWorld(), font = await assets.loadConsoleFont();
    const presentation = new ApplicationRereleasePresentation(assets, [{ actor: first.actor, seat: identity.seat(0) },
      { actor: second.actor, seat: identity.seat(1), language: "russian" }]);
    for (let frame = 0; frame < 12; frame++) simulation.step({ elapsedMilliseconds: 25, commands: [] });
    const events = simulation.drainPresentationEvents();
    expect(events.some(source => source.kind === "q2-rerelease" && source.event.kind === "story" && source.event.text === "$m_single_player")).toBe(true);
    presentation.receive(events); await presentation.prepare(); presentation.drainPrints();
    expect(presentation.storyActive(first.actor)).toBe(true); expect(presentation.storyActive(second.actor)).toBe(true);
    const sky = presentation.view(first.actor, 0.3).q2Sky;
    if (sky === undefined) throw new Error("Source target_sky was not presented");
    expect(sky.rotation).toBe(90); expect(sky.autoRotate).toBe(false); expect(sky.images).toHaveLength(6);
    expect(sky.images.every(image => image.source.kind === "resource")).toBe(true);
    const surface = scene.surfaces.find(value => value.kind === "legacy" && value.material.kind === "q2" && (value.material.surfaceFlags & 4) !== 0);
    if (surface === undefined) throw new Error("Retail base1 has no sky surface");
    const origin = { x: 0, y: 0, z: 0 }, project = (point: typeof origin) => ({ ...point, w: 1 });
    const fixed = q2SkySides(surface.geometry, origin, sky, 2, project);
    expect(fixed).toHaveLength(6); expect(q2SkySides(surface.geometry, origin, sky, 3, project)).toEqual(fixed);
    expect(q2SkySides(surface.geometry, origin, { ...sky, autoRotate: true }, 2, project)).not.toEqual(fixed);
    expect(q2SkySides({ vertices: [], indices: [] }, origin, sky, 2, project)).toEqual([]);
    const contentId = content.recipe.map.entities.content;
    presentation.receive([{ kind: "q2-rerelease", content: contentId, seconds: 0.3, sequence: 10000,
      event: { kind: "localized-print", actor: first.actor, level: "chat", text: "$g_exited_level", args: ["##P0"] } }]);
    await presentation.prepare();
    const prints = presentation.drainPrints();
    expect(prints).toHaveLength(1);
    const print = prints[0];
    if (print?.kind !== "q2-player" || print.event.kind !== "print") throw new Error("Missing localized source print");
    expect(print.event.target).toBe(first.actor); expect(print.event.text).toBe("Player 1 exited the level.\n"); expect(print.event.level).toBe("chat");
    const renderer = new SoftwareRenderer(640, 120, owner), target = new CpuRenderTarget(renderer), frames = new SceneFrameBuilder(assets.images);
    const viewport = { x: 0, y: 0, width: 320, height: 120 };
    frames.begin(); frames.view({ target: { kind: "seat", seat: identity.seat(0) }, time: { kind: "seconds", value: 0.3 }, viewport,
      clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false }, clipPlane: null, beforeView: [], operations: [] });
    const draw = new Draw2D(new TextCommandSink(identity.seat(0), viewport, value => {
      if (value.kind === "swap-buffers") throw new Error("Text cannot present a frame"); frames.command(value);
    }, () => { throw new Error("Source bitmap font must use image commands"); }), "pixels");
    presentation.drawStory(first.actor, draw, new SeatTextPresentation(identity.seat(0), font), 1);
    target.execute(frames.finish(false));
    let colored = 0, minX = 640, maxX = 0, otherSeat = 0;
    for (let y = 0; y < 120; y++) for (let x = 0; x < 640; x++) {
      const offset = (y * 640 + x) * 4;
      if ((renderer.pixels[offset] ?? 0) + (renderer.pixels[offset + 1] ?? 0) + (renderer.pixels[offset + 2] ?? 0) === 0) continue;
      colored++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); if (x >= 320) otherSeat++;
    }
    expect(colored).toBeGreaterThan(100); expect(Math.abs((minX + maxX) / 2 - 160)).toBeLessThan(8); expect(otherSeat).toBe(0);
    presentation.receive([{ kind: "q2-rerelease", content: contentId, seconds: 1, sequence: 10001, event: { kind: "story", text: "" } }]);
    await presentation.prepare(); expect(presentation.storyActive(first.actor)).toBe(false); expect(presentation.storyActive(second.actor)).toBe(false);
    target.close();
  } finally { simulation.close(); assets.close(); await content.close(); }
}, 60000);


test("Q2 geometry edition selects world lighting independently of external brush content", async () => {
  for (const game of ["q2-classic-baseq2", "q2-rerelease-baseq2"]) {
    const command = parseApplicationCommand(["--game", game, "--map", "base1", "--dedicated"]);
    if (command.kind !== "run") throw new Error("Missing Q2 launch");
    const content = await loadApplicationContent(command.options), identity = createIdentityOwner("q2-modulation");
    const assets = new ApplicationAssets(content, { identity: Symbol("q2-modulation"), session: identity.session, generation: 0 });
    try {
      const world = await assets.loadWorld();
      expect(world.options.q2LightModulate).toBe(game === "q2-rerelease-baseq2" ? 2 : 1);
      const other = content.catalog.require(game === "q2-rerelease-baseq2" ? "q2-classic-baseq2" : "q2-rerelease-baseq2");
      const brush = await assets.model(other.id, "maps/base1.bsp");
      const resolved = content.catalog.product(brush.resource.provenance.mount.identity.content).expectation;
      expect(brush.brushScene?.options.q2LightModulate).toBe(resolved.family === "q2" && resolved.edition === "rerelease" ? 2 : 1);
    } finally { assets.close(); await content.close(); }
  }
}, 60_000);

test.skipIf(!existsSync("/home/buzzkill/Projects/qfiles/q1/id1/PAK0.PAK"))("Q1 actor presentation preserves raw alpha and scale for real MDL, SPR and brush assets", async () => {
  const command = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "e1m1", "--dedicated", "--mode", "singleplayer"]);
  if (command.kind !== "run") throw new Error("Expected Q1 presentation launch");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("q1-actor-opacity");
  const assets = new ApplicationAssets(content, { identity: Symbol("q1-actor-opacity"), session: identity.session, generation: 0 });
  try {
    const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
      skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 });
    const source = simulation.q1Source();
    if (source === null) throw new Error("Missing native Q1 source");
    await assets.loadWorld();
    const player = simulation.admitPlayer(identity.client(0, 1)), scene = new ApplicationWorldScene(assets, null);
    const snapshot = simulation.step({ elapsedMilliseconds: 16, commands: [] }).snapshot;
    const camera = { origin: { x: -100, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }),
      projection: perspectiveProjection(90, 90, 4096, 1), viewport: { x: 0, y: 0, width: 64, height: 64 }, clip: { kind: "none" } } satisfies import("../../src/contracts/render.ts").SceneCamera;
    for (const path of ["progs/soldier.mdl", "progs/s_explod.spr", "*1"]) {
      const actor = source.game.create("info_notnull"); actor.model = path;
      const resource = await assets.model(content.recipe.map.entities.content, path);
      expect(resource.model.kind).toBe(path.startsWith("*") ? "brush-model" : path.endsWith(".mdl") ? "q1-mdl" : "q1-spr");
      const projected = () => {
        const value = simulation.presentations().find(value => value.actor.equals(actor.actor.id));
        if (value === undefined) throw new Error("Missing shared actor presentation");
        return value;
      };
      expect(projected().alpha).toBe(1); expect(projected().scale).toBe(1);
      actor.fields.set("alpha", "0.371337"); actor.fields.set("scale", "1.31337");
      expect(projected().alpha).toBe(Math.fround(0.371337)); expect(projected().scale).toBe(Math.fround(1.31337));
      await scene.prepare(player.actor, snapshot, [projected()], []);
      const prepared = scene.view({ camera, target: { kind: "seat", seat: identity.seat(0) }, time: { kind: "seconds", value: 0 } }, [], [], false);
      const batches = prepared.view.operations.flatMap(operation => operation.kind === "draw" ? operation.batches : []);
      const translucent = batches.find(batch => batch.vertices.some(vertex => Math.abs(vertex.color.w - Math.fround(0.371337)) < 0.000001));
      expect(translucent).toBeDefined();
      expect(translucent?.state.depthWrite).toBe(false);
      actor.fields.set("alpha", "-1"); expect(projected().alpha).toBe(0);
      actor.fields.set("alpha", "2"); expect(projected().alpha).toBe(1);
      actor.fields.set("alpha", "0"); actor.fields.set("scale", "0");
      expect(projected().alpha).toBe(1); expect(projected().scale).toBe(1);
    }
  } finally { assets.close(); await content.close(); }
}, 30000);
