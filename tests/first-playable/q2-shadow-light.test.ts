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
