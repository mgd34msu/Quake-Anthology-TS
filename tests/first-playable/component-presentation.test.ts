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
