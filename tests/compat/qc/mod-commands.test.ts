import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { CommandContext } from "../../../src/contracts/common.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ModCallbackDeclaration } from "../../../src/contracts/mod-callbacks.ts";
import { prepareQuakeCMod } from "../../../src/app/bootstrap/simulation/quakec-mod.ts";
import { readModCallbacks } from "../../../src/content/mods/callbacks.ts";
import { CommandBuffer } from "../../../src/core/commands/index.ts";
import { CvarRegistry } from "../../../src/core/cvars/index.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../src/world/gameplay/index.ts";
import { ModCommands } from "../../../src/world/session/mod-commands.ts";
import { SessionMods } from "../../../src/world/session/mods.ts";

const artifact = "/home/buzzkill/.local/share/quake-typescript/content/q1/rerelease/copper/progs.dat";
test.skipIf(!await Bun.file(artifact).exists())("original Copper console functions and localcmd retain component cvars and source ownership", async () => {
  const program = await Bun.file(artifact).bytes(), digest = createContentDigest(new Bun.CryptoHasher("sha256").update(program).digest("hex"));
  const actors = new SessionActorRegistry(createIdentityOwner("copper-console")), callbacks = new ActorCallbackTable(actors);
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors), bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const context: CommandContext = { session: actors.session, origin: { kind: "server-console" } };
  const primary = new CvarRegistry({ dialect: "q3", context }); primary.register("skill", "9");
  const values: string[] = [], maps: { readonly map: string; readonly dialect: string; readonly owner: string | undefined }[] = [];
  const commands: CommandBuffer = new CommandBuffer({ dialect: "q3", context, cvars: primary,
    cvarRouting: { owner: (_name, source) => sourceCommands.cvars(source) ?? primary, visible: source => [sourceCommands.cvars(source) ?? primary] },
    sourceCommand: command => sourceCommands.handles(command.argv[0] ?? "", command.source) && sourceCommands.invoke(command) });
  const sourceCommands = new ModCommands({ context, commands: () => commands });
  commands.register("recordskill", command => { values.push((sourceCommands.cvars(command.source) ?? primary).variableString("skill")); });
  commands.register("changelevel", command => { maps.push({ map: command.argsText, dialect: command.dialect, owner: command.source.producer?.module.id }); });
  const declaration: ModCallbackDeclaration = { version: 1, runtime: "quakec", program: { path: "progs.dat", digest }, actorFields: [], callbacks: [], commands: [
    { name: "source_skill", function: "skill_set", arguments: [{ kind: "argument", index: 1, type: "string" }], globals: [] },
    { name: "source_restart", function: "restart", arguments: [], globals: [{ name: "mapname", value: { kind: "argument", index: 1, type: "string" } }] },
  ] };
  const encoded = new TextEncoder().encode(JSON.stringify(declaration));
  const prepared = ["first", "second"].map(id => prepareQuakeCMod({ program, declaration: readModCallbacks(encoded), declarationDigest: digest,
    description: { selection: { product: "copper", id }, source: { provider: "q1:copper", content: "q1:rerelease:copper:installed" }, title: id,
      sourceTitle: "Copper", purpose: "addition", requires: [], conflicts: [], availability: { kind: "available" } } }));
  const mods = await SessionMods.open({ prepared, enabled: prepared.map(mod => mod.description.selection),
    operations: { actors: callbacks.operations, damage: combat.damageOperation, inventory: inventory.operations },
    services: { commands: sourceCommands, actors, bodies, combat, inventory, seed: 1, time: () => ({ kind: "seconds", value: 0 }) }, nextFrame: async () => {} });
  const first = { product: "copper", id: "first" }, second = { product: "copper", id: "second" };
  try {
    sourceCommands.execute(first, 'source_skill "3"', context);
    sourceCommands.execute(first, "recordskill", context); sourceCommands.execute(second, "recordskill", context);
    expect(values).toEqual(["3", "1"]); expect(primary.variableString("skill")).toBe("9");
    sourceCommands.execute(first, "source_restart e1m2", context);
    expect(maps).toHaveLength(0);
    commands.execute();
    expect(maps).toEqual([{ map: "e1m2", dialect: "q1-netquake", owner: prepared[0]?.identity.modules[0]?.id }]);
    sourceCommands.execute(first, "source_restart discarded", context);
    sourceCommands.execute(second, "source_restart retained", context);
    await mods.setEnabled(first, false); commands.execute();
    expect(maps.map(entry => entry.map)).toEqual(["e1m2", "retained"]);
    expect(() => sourceCommands.execute(first, "recordskill", context)).toThrow("unavailable");
  } finally { mods.close(); actors.close(); }
});
