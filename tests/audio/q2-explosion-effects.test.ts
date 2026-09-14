import { expect, test } from "bun:test";
import { ApplicationAssets } from "../../src/app/bootstrap/assets.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { ApplicationEffects } from "../../src/app/bootstrap/effects.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { WorldSnapshot } from "../../src/contracts/session.ts";
import { createSceneQueries } from "../../src/world/collision/index.ts";

test("Q2 explosion events emit one authored fixed-position sound and preserve BFG silence", async () => {
  const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Expected Q2 fixture");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("q2-explosion-audio");
  const assets = new ApplicationAssets(content, { identity: Symbol("q2-explosion-audio"), session: identity.session, generation: 0 });
  const effects = new ApplicationEffects(assets, createSceneQueries(content.world), () => false);
  try {
    await assets.loadWorld();
    const cases = [
      ["rocket-explosion", "rocklx1a.wav"], ["rocket-explosion-water", "xpld_wat.wav"],
      ["grenade-explosion", "grenlx1a.wav"], ["grenade-explosion-water", "xpld_wat.wav"],
      ["explosion1", "rocklx1a.wav"], ["explosion2", "grenlx1a.wav"],
      ["plain-explosion", "rocklx1a.wav"], ["bfg-explosion", null],
    ] satisfies readonly (readonly [string, string | null])[];
    for (const [index, [name, sound]] of cases.entries()) {
      const seconds = index + 1, origin = { x: 8192 + index, y: -4096, z: 384 };
      const event = { kind: "q2", content: content.recipe.map.entities.content, seconds, sequence: index,
        event: { kind: "effect", effect: `q2:${name}`, origin, direction: { x: 0, y: 0, z: 1 }, count: 0, color: 0 } } satisfies Parameters<ApplicationEffects["receive"]>[0][number];
      const snapshot: WorldSnapshot = { session: identity.session,
        frame: { frame: seconds, time: { kind: "seconds", value: seconds }, elapsed: { kind: "seconds", value: 1 }, phase: "frame-exit" },
        actors: [], bodies: [], inventories: [], configurations: [],
        scene: { session: identity.session, time: { kind: "seconds", value: seconds }, world: null, entities: [], lights: [], particles: [], lightStyles: [], areaBits: null } };
      effects.receive([event]);
      await effects.prepare(snapshot, []);
      expect(effects.drainUnhandled()).toEqual([]);
      expect(effects.drainSounds()).toEqual(sound === null ? [] : [{ content: content.recipe.map.entities.content,
        path: `weapons/${sound}`, origin, channel: 0, volume: 1, seconds, playback: { kind: "once" } }]);
      effects.receive([event]);
      await effects.prepare(snapshot, []);
      expect(effects.drainSounds()).toEqual([]);
    }
  } finally { effects.close(); assets.close(); await content.close(); }
}, 30000);
