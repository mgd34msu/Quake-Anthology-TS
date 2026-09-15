import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import { createStartupSource, resolveStartupRules } from "../../src/app/bootstrap/startup-source.ts";

test.skipIf(process.env["QUAKE_STARTUP_RETAIL_TEST"] !== "1")("prepared skill controls first retail Q2 entity spawn", async () => {
  const command = parseApplicationCommand(["--game", "q2-rerelease-baseq2", "--map", "base1"]);
  if (command.kind !== "run") throw new Error("Expected launch");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("startup-first-spawn");
  try {
    const source = createStartupSource(command.options, { source: content.recipe.map.entities, match: content.recipe.match }, "q2-rerelease", { session: identity.session, origin: { kind: "server-console" } }, 1, () => {});
    expect(source.find("timescale")?.value).toBe("1");
    expect(source.find("fixedtime")?.value).toBe("0");
    expect(source.find("sv_airaccelerate")?.value).toBe("0");
    source.set("skill", "3");
    const effective = resolveStartupRules(command.options, source, 1, []);
    const world = { ...content.world, entities: (content.world.entities.split("\0")[0] ?? "")
      + '\n{ "classname" "trigger_relay" "targetname" "startup_easy_only" "spawnflags" "1024" }\n'
      + '{ "classname" "trigger_relay" "targetname" "startup_hard_only" "spawnflags" "256" }\n' };
    const simulation = createSimulation({ identity, recipe: content.recipe, world, mounts: content.mounts,
      skill: effective.options.skill, mode: effective.options.mode, seed: effective.options.seed, maxClients: effective.maxClients, sourceRegistry: source });
    try {
      const game = simulation.q2Source()?.game;
      expect(game?.options.skill).toBe(3);
      expect(simulation.q2ServerCvars()).toBe(source);
      expect(game?.targets("startup_easy_only").length).toBe(0);
      expect(game?.targets("startup_hard_only").length).toBe(1);
    } finally { simulation.close(); }
  } finally { await content.close(); }
});
