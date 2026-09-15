import { expect, test } from "bun:test";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { ApplicationAssets } from "../../src/app/bootstrap/assets.ts";
import { ApplicationWorldScene } from "../../src/app/bootstrap/presentation-scene.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { anglesToAxis } from "../../src/core/math.ts";
import { perspectiveProjection } from "../../src/render/scene/view.ts";
import type { SceneCamera } from "../../src/contracts/render.ts";

test("Q1 authored button frame selects alternate texture through shared scene commands", async () => {
  const command = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "e1m1", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Expected Q1 launch");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("q1-button-texture");
  const assets = new ApplicationAssets(content, { identity: Symbol("q1-button-texture"), session: identity.session, generation: 0 });
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 });
  try {
    await assets.loadWorld();
    const source = simulation.q1Source();
    if (source === null) throw new Error("Missing Q1 source");
    const player = simulation.admitPlayer(identity.client(0, 0));
    const snapshot = simulation.step({ elapsedMilliseconds: 16, commands: [] }).snapshot;
    const button = [...source.game.entities.values()].find(entity => entity.classname === "func_button" && entity.target === "t9");
    if (button === undefined) throw new Error("Missing authored button");
    const body = source.game.body(button);
    const camera: SceneCamera = { origin: { x: body.origin.x + body.bounds.min.x - 100,
      y: body.origin.y + body.bounds.min.y - 100, z: body.origin.z + body.bounds.max.z + 100 },
      axis: anglesToAxis({ x: 30, y: 45, z: 0 }), projection: perspectiveProjection(90, 90, 8192, 1),
      viewport: { x: 0, y: 0, width: 64, height: 64 }, clip: { kind: "none" } };
    const scene = new ApplicationWorldScene(assets, null);
    const textures = async () => {
      const model = simulation.presentations().find(value => value.actor.equals(button.actor.id));
      if (model === undefined) throw new Error("Missing button presentation");
      await scene.prepare(player.actor, snapshot, [model], []);
      const prepared = scene.view({ camera, target: { kind: "seat", seat: identity.seat(0) },
        time: { kind: "seconds", value: 0 }, noCull: true }, [], [], false);
      return prepared.view.operations.flatMap(operation => operation.kind === "draw" ? operation.batches.flatMap(batch =>
        batch.texture.kind === "bind-image" && batch.texture.image.source.kind === "generated" && batch.texture.image.source.name.startsWith("+")
          ? [batch.texture.image.source.name] : []) : []);
    };
    const normal = await textures();
    source.game.named.action(button, "button_wait")();
    expect(button.frame).toBe(1);
    const active = await textures();
    expect(active).not.toEqual(normal);
    const changed = active.find(name => !normal.includes(name));
    expect(changed).toBeDefined();
    expect(active.filter(name => name === changed)).toHaveLength(2);
    source.game.named.action(button, "button_return")();
    expect(await textures()).toEqual(normal);
  } finally { simulation.close(); assets.close(); await content.close(); }
}, 30000);
