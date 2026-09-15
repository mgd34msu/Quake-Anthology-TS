import { expect, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { encodeCheckpointValue } from "../../../src/persistence/value.ts";

for (const edition of ["classic", "rerelease"]) test(`Q2 ${edition} authored gravity and live cvar share physics`, async () => {
  const command = parseApplicationCommand(["--game", `q2-${edition}-baseq2`, "--map", "base1", "--movement", "q2", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Missing launch");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner(`q2-gravity-${edition}`);
  const options: Parameters<typeof createSimulation>[0] = { identity, recipe: content.recipe,
    world: { ...content.world, entities: content.world.entities.replace(/"classname"\s+"worldspawn"/, '"classname" "worldspawn"\n"gravity" "321"') },
    mounts: content.mounts, skill: 0, mode: "singleplayer", seed: 17, maxClients: 1, playerIdentity: client => ({ seat: client.slot, socialId: "" }) };
  const simulation = createSimulation(options);
  try {
    const cvars = simulation.q2ServerCvars();
    if (cvars === null) throw new Error("Missing source cvars");
    expect(cvars.find("sv_gravity")?.flags).toBe(0);
    expect(cvars.variableValue("sv_gravity")).toBe(321);
    expect(simulation.physics.gravity).toBe(321);
    const actor = simulation.admitPlayer(identity.client(0, 0)).actor;
    cvars.set("sv_gravity", "456");
    simulation.step({ elapsedMilliseconds: 100, commands: [] });
    expect(simulation.physics.gravity).toBe(456);
    expect(simulation.movementPlayer(actor)?.worldGravity).toBe(456);
    simulation.setWorldGravity(654);
    expect(cvars.variableValue("sv_gravity")).toBe(654);
    expect(simulation.movementPlayer(actor)?.worldGravity).toBe(654);
    simulation.step({ elapsedMilliseconds: 100, commands: [] });
    expect(simulation.physics.gravity).toBe(654);
    cvars.set("sv_gravity", "777");
    const image = simulation.checkpoint(), registry = cvars.captureSaveState();
    expect(image.providers.some(provider => provider.schema === "world:source-cvars")).toBe(true);
    expect(image.providers.some(provider => provider.schema === "world:bots")).toBe(false);
    const pending = createSimulation({ ...options, restore: image, restoredClients: [identity.client(0, 0)] });
    try {
      expect(pending.physics.gravity).toBe(654);
      expect(pending.q2ServerCvars()?.variableValue("sv_gravity")).toBe(777);
      pending.step({ elapsedMilliseconds: 100, commands: [] });
      expect(pending.physics.gravity).toBe(777);
    } finally { pending.close(); }
    const legacy: typeof image = { ...image, providers: [...image.providers.filter(provider => provider.schema !== "world:source-cvars"), {
      provider: image.recipe.map.entities.provider, schema: "world:source-cvars", version: 1,
      bytes: encodeCheckpointValue({ ...registry,
        variables: registry.variables.map(variable => variable?.name === "sv_gravity" ? null : variable),
        order: registry.order.filter(name => name !== "sv_gravity"),
      }),
    }] };
    for (const oldImage of [legacy, { ...image, providers: image.providers.filter(provider => provider.schema !== "world:source-cvars") }]) {
    const restored = createSimulation({ ...options, restore: oldImage, restoredClients: [identity.client(0, 0)] });
    try {
      expect(restored.q2ServerCvars()?.variableValue("sv_gravity")).toBe(654);
      restored.step({ elapsedMilliseconds: 100, commands: [] });
      expect(restored.physics.gravity).toBe(654);
      expect(restored.q2ServerCvars()?.variableValue("sv_gravity")).toBe(654);
    } finally { restored.close(); }
    }
  } finally { simulation.close(); await content.close(); }
}, 30000);
