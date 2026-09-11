import { expect, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";

test("Q1 force_retouch links players without a source entity and runs the actual map pickup", async () => {
  const command = parseApplicationCommand(["--preset", "q1-q2", "--map", "e1m1"]);
  if (command.kind !== "run") throw new Error("Expected application launch");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("actor-execution-retouch");
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: 0, mode: "singleplayer", seed: 17, maxClients: 1 });
  try {
    const actor = simulation.admitPlayer(identity.client(0, 0)).actor, source = simulation.q1Source();
    const player = simulation.movementPlayer(actor);
    if (source === null || player === null) throw new Error("Missing admitted source player");
    expect(source.game.entity(actor)).toBeNull();
    for (let frame = 0; frame < 4; frame++) simulation.step({ elapsedMilliseconds: 100, commands: [] });
    const pickup = [...source.game.entities.values()].find(entity => entity.classname === "item_shells");
    if (pickup === undefined) throw new Error("Retail map shell pickup missing");
    const pickupBody = simulation.bodies.read(pickup.actor.id), playerBody = simulation.bodies.read(actor);
    if (pickupBody === null || playerBody === null) throw new Error("Missing shared body");
    const before = simulation.inventory.count(actor, "q1:ammo/shells");
    simulation.bodies.write(player.actor, { ...playerBody, origin: pickupBody.origin, velocity: { x: 0, y: 0, z: 0 } });
    simulation.step({ elapsedMilliseconds: 100, commands: [] });
    expect(simulation.inventory.count(actor, "q1:ammo/shells")).toBe(before);
    source.game.forceRetouch = 1;
    simulation.step({ elapsedMilliseconds: 100, commands: [] });
    expect(simulation.inventory.count(actor, "q1:ammo/shells")).toBeGreaterThan(before);
    expect(source.game.forceRetouch).toBe(0);
  } finally { simulation.close(); await content.close(); }
});
