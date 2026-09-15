import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { CommandBuffer } from "../../../src/core/commands/index.ts";
import { SeatInput, registerInputCommands } from "../../../src/input/seat.ts";
import { InputCommandBuilder, type UserCommandFrame } from "../../../src/input/user-command.ts";
import { registerQ1ClientCommands } from "../../../src/app/bootstrap/q1-client-commands.ts";
import type { CommandContext } from "../../../src/contracts/common.ts";

test("native Q1 console god and impulse 9 affect actual damage and selected inventory", async () => {
  const corpus = resolve(import.meta.dir, "../../../../qfiles");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  for (const mixed of [false, true]) {
    const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q1-classic-id1", "--map", "e1m1", "--movement", mixed ? "q3" : "q1",
      "--character", mixed ? "q3" : "q1", "--dedicated", "--mode", "singleplayer"]);
    if (launch.kind !== "run") throw new Error("Expected Q1 launch");
    const preset = applicationPreset(catalog, launch.options);
    const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), ...(mixed ? {
      weapons: { kind: "selected", value: [{ provider: "q3:official", content: catalog.require("q3-baseq3").id }] },
    } : {}) } });
    const content = await loadApplicationContent(launch.options, recipe), identity = createIdentityOwner(`q1-console-${mixed}`), client = identity.client(0, 0), seat = identity.seat(0);
    const simulation = createSimulation({ identity, recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 });
    try {
      const actor = simulation.admitPlayer(client).actor, source = simulation.q1Source();
      if (source === null) throw new Error("Missing native Q1 source");
      const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client } };
      const commands = new CommandBuffer({ dialect: "q1-netquake", context, cvars: source.cvars });
      registerQ1ClientCommands(commands, "q1-netquake", (name, args) => simulation.playerCommand(actor, name, args));
      const dialect = mixed ? "q3" : "q1-netquake", input = new SeatInput({ seat, dialect, context, commands, uiEvent: () => false });
      registerInputCommands(commands, selected => selected.equals(seat) ? input : null);
      const builder = new InputCommandBuilder(dialect);
      builder.setViewAngles(simulation.playerView(actor).angles);
      commands.append("god\n"); commands.execute(); expect(simulation.combat.read(actor)?.invulnerable).toBe(true);
      expect(source.composition.clients.require(actor).godMode).toBe(true);
      const before = simulation.combat.read(actor)?.health;
      source.game.damage(actor, actor, actor, 20); expect(simulation.combat.read(actor)?.health).toBe(before);
      commands.append("god\n"); commands.execute(); expect(simulation.combat.read(actor)?.invulnerable).toBe(false);
      source.game.damage(actor, actor, actor, 20); expect(simulation.combat.read(actor)?.health).toBe((before ?? 0) - 20);
      commands.append("notarget\nnoclip\n"); commands.execute();
      expect(source.composition.noTarget(actor)).toBe(true);
      expect(source.game.monsterTarget(actor)?.notarget).toBe(true);
      const clipped = simulation.movementPlayer(actor)?.readState();
      expect(clipped?.kind === "q1-netquake" ? clipped.moveType : clipped?.kind === "q3" ? clipped.movementType : -1).toBe(mixed ? 1 : 8);
      commands.append("notarget\nnoclip\n"); commands.execute();
      expect(source.composition.noTarget(actor)).toBe(false);
      expect(source.game.monsterTarget(actor)?.notarget).toBe(false);
      commands.append("impulse 9\n"); commands.execute();
      const sample = input.sample(100, 100);
      const frame: UserCommandFrame = mixed ? { kind: "q3", serverTimeMilliseconds: 100, weapon: 2, sensitivity: 1 }
        : { kind: "q1-netquake", acknowledgedServerTimeSeconds: 0.1 };
      const provider = simulation.movementPlayer(actor)?.arsenal.provider; if (provider === undefined) throw new Error("Missing selected arsenal");
      simulation.step({ elapsedMilliseconds: 100, commands: [{ actor, source: { kind: "local-seat", seat, client }, sequence: 0,
        command: builder.build(sample, frame), ...(mixed ? { arsenal: { provider, weapon: null, impulse: sample.impulse, useHoldable: false } } : {}) }] });
      const weapon = mixed ? "q3:weapon/rocketlauncher" : "q1:weapon/rocketlauncher";
      expect(simulation.inventory.count(actor, weapon)).toBe(1);
      expect(simulation.inventory.count(actor, mixed ? "q3:ammo/rocketlauncher" : "q1:ammo/rockets")).toBeGreaterThan(0);
    } finally { simulation.close(); await content.close(); }
  }
}, 30000);
