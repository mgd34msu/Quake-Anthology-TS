import { expect, spyOn, test } from "bun:test";
import { ApplicationAssets } from "../../src/app/bootstrap/assets.ts";
import { ApplicationEffects } from "../../src/app/bootstrap/effects.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { WorldSnapshot } from "../../src/contracts/session.ts";
import type { PresentationOwner } from "../../src/contracts/presentation.ts";
import { createSceneQueries } from "../../src/world/collision/index.ts";
import { SceneModelRenderer } from "../../src/render/scene/models/index.ts";
import { ComponentDrawings } from "../../src/app/bootstrap/component-drawings.ts";
import { decodeUnifiedPresentationEvents, encodeUnifiedPresentationEvents } from "../../src/app/bootstrap/network/unified-event-codec.ts";
import type { SimulationPresentationEvent } from "../../src/app/bootstrap/simulation/types.ts";
import type { Palette, RenderCommand } from "../../src/contracts/render.ts";
import { Draw2D, TextCommandSink } from "../../src/text/draw2d.ts";

test("component retirement and restore invalidate pending real static media, preserving a new activation", async () => {
  const command = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "start", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Missing Q1 world");
  const content = await loadApplicationContent(command.options), ids = createIdentityOwner("component-static");
  const assets = new ApplicationAssets(content, { identity: Symbol("component-static"), session: ids.session, generation: 0 });
  const effects = new ApplicationEffects(assets, createSceneQueries(content.world), () => false);
  const owner: PresentationOwner = { provider: "mod:static", generation: 1 }, source = content.recipe.map.entities.content;
  const snapshot: WorldSnapshot = { session: ids.session, frame: { frame: 1, time: { kind: "seconds", value: 1 }, elapsed: { kind: "seconds", value: 0.1 }, phase: "frame-exit" },
    actors: [], bodies: [], inventories: [], configurations: [], scene: { session: ids.session, time: { kind: "seconds", value: 1 }, world: null, entities: [], lights: [], particles: [], lightStyles: [], areaBits: null } };
  const event = { kind: "q1", content: source, sequence: 0, seconds: 1, owner, event: { kind: "static-model", path: "progs/flame.mdl", frame: 0, colorMap: 0, skin: 0, origin: { x: 0, y: 0, z: 0 }, angles: { x: 0, y: 0, z: 0 } } } satisfies import("../../src/app/bootstrap/simulation/types.ts").SimulationPresentationEvent;
  const original = assets.model.bind(assets), preload = spyOn(SceneModelRenderer.prototype, "preload");
  try {
    await assets.loadWorld();
    for (const [index, kind] of (["refreshed", "retired"] satisfies readonly ("refreshed" | "retired")[]).entries()) {
      const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
      const load = spyOn(assets, "model").mockImplementation(async (...args) => { const result = await original(...args); entered.resolve(); await resume.promise; return result; });
      try {
        effects.receive([{ ...event, sequence: index * 2 }]);
        const pending = effects.prepare(snapshot, []); await entered.promise;
        effects.receive([{ kind: "presentation-owner", event: { kind, owner }, sequence: index * 2 + 1, content: source, seconds: 1 }]);
        resume.resolve(); await pending;
        expect(preload.mock.calls.flatMap(call => call[0])).toHaveLength(0);
      } finally { resume.resolve(); load.mockRestore(); }
    }
    effects.receive([{ ...event, sequence: 4, owner: { ...owner, generation: 2 } }]);
    await effects.prepare(snapshot, []); expect(preload.mock.calls.flatMap(call => call[0]).some(entity => entity.model.kind === "q1-mdl")).toBe(true);
    effects.receive([{ kind: "presentation-owner", event: { kind: "refreshed", owner: { ...owner, generation: 2 } }, sequence: 5, content: source, seconds: 1 }]);
    preload.mockClear(); await effects.prepare(snapshot, []); expect(preload.mock.calls.flatMap(call => call[0])).toHaveLength(1);
    effects.receive([{ kind: "presentation-owner", event: { kind: "retired", owner: { ...owner, generation: 2 } }, sequence: 6, content: source, seconds: 1 }]);
    preload.mockClear(); await effects.prepare(snapshot, []); expect(preload.mock.calls.flatMap(call => call[0])).toHaveLength(0);
  } finally { preload.mockRestore(); effects.close(); assets.close(); }
});

test("native graph samples retain source colors across transport and retire during pending palette loading", async () => {
  const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Missing Q2 content");
  const content = await loadApplicationContent(command.options), ids = createIdentityOwner("component-graph");
  const assets = new ApplicationAssets(content, { identity: Symbol("component-graph"), session: ids.session, generation: 0 });
  const drawings = new ComponentDrawings(), source = content.recipe.map.entities.content;
  const owner: PresentationOwner = { provider: "mod:graph", generation: 1 };
  const sample: SimulationPresentationEvent = { kind: "debug-graph", event: { kind: "sample", value: 7.5, color: 0x40 }, owner, content: source, sequence: 0, seconds: 1 };
  const settings = { debuggraph: 1, timegraph: 0, netgraph: 0, height: 32, scale: 1, shift: 0 };
  const view = { x: 0, y: 0, width: 64, height: 64 }, commands: RenderCommand[] = [];
  const draw = new Draw2D(new TextCommandSink(ids.seat(0), view, command => commands.push(command), () => { throw new Error("Unexpected graph material"); }), "pixels");
  const transfer = (events: readonly SimulationPresentationEvent[]) => decodeUnifiedPresentationEvents(encodeUnifiedPresentationEvents(events), { ...ids, resourceId: id => id });
  try {
    await assets.loadWorld();
    const palette = (await assets.provider(source)).palette;
    if (palette === null) throw new Error("Missing original Q2 palette");
    const white = { kind: "image", name: "white", image: assets.world.shaders.textures.white.image } satisfies import("../../src/text/draw2d.ts").PictureAsset;
    const wire = transfer([sample]); expect(wire).toEqual([sample]); drawings.receive(wire);
    const pending = Promise.withResolvers<Palette>();
    const preparing = drawings.prepareGraphs(async requested => { expect(requested).toBe(source); return pending.promise; });
    drawings.receive(transfer([{ kind: "presentation-owner", event: { kind: "retired", owner }, content: source, sequence: 1, seconds: 1 }]));
    pending.resolve(palette); await preparing;
    drawings.drawGraphs(draw, view, settings, white); expect(commands).toHaveLength(0);
    drawings.receive(transfer([{ ...sample, sequence: 2 }]));
    await drawings.prepareGraphs(async () => palette);
    drawings.drawGraphs(draw, view, settings, white); expect(commands).toHaveLength(0);
    const next = { ...owner, generation: 2 };
    drawings.receive(transfer([{ ...sample, owner: next, sequence: 3 }]));
    await drawings.prepareGraphs(async () => palette);
    drawings.drawGraphs(draw, view, settings, white);
    expect(commands.some(command => command.kind === "stretch-pic" && command.rect.height === 7 && command.rect.x === 63)).toBe(true);
    expect(commands.some(command => command.kind === "set-color" && command.color.x === (palette.colors[0x40 * 3] ?? -1) / 255
      && command.color.y === (palette.colors[0x40 * 3 + 1] ?? -1) / 255 && command.color.z === (palette.colors[0x40 * 3 + 2] ?? -1) / 255)).toBe(true);
    commands.length = 0;
    drawings.receive(transfer([{ kind: "presentation-owner", event: { kind: "refreshed", owner: next }, content: source, sequence: 4, seconds: 1 }]));
    drawings.receive(transfer([{ ...sample, owner: next, sequence: 3 }]));
    await drawings.prepareGraphs(async () => palette);
    drawings.drawGraphs(draw, view, settings, white); expect(commands).toHaveLength(0);
    drawings.receive(transfer([{ ...sample, owner: next, sequence: 5 }]));
    await drawings.prepareGraphs(async () => palette);
    drawings.drawGraphs(draw, view, { ...settings, debuggraph: 0 }, white); expect(commands).toHaveLength(0);
    drawings.drawGraphs(draw, view, settings, white); expect(commands.length).toBeGreaterThan(0);
  } finally { drawings.clear(); assets.close(); }
});
