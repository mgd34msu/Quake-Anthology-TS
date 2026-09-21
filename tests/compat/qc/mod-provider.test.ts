import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ModCallbackDeclaration } from "../../../src/contracts/mod-callbacks.ts";
import { readModCallbacks } from "../../../src/content/mods/callbacks.ts";
import { prepareQuakeCMod } from "../../../src/app/bootstrap/simulation/quakec-mod.ts";
import { SessionMods } from "../../../src/world/session/mods.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../src/world/gameplay/index.ts";

const path = "/home/buzzkill/.local/share/quake-typescript/content/q1/rerelease/copper/progs.dat";
test.skipIf(!await Bun.file(path).exists())("original Copper healing executes through declared actor callbacks in isolated mod instances", async () => {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer()), digest = createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
  const actors = new SessionActorRegistry(createIdentityOwner("copper-mods")), callbacks = new ActorCallbackTable(actors);
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors), bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const target = actors.allocate("q2:game", "q2:monster_soldier");
  combat.create(target, { health: 20, mass: 200, canTakeDamage: true, invulnerable: false, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, team: null });
  let uses = 0;
  callbacks.bind(target, { think: null, touch: null, pain: null, die: null, use: () => { uses++; return undefined; } });
  const declaration = (amount: number): ModCallbackDeclaration => ({ version: 1, runtime: "quakec", program: { path: "progs.dat", digest },
    actorFields: [{ field: "health", binding: "health" }, { field: "classname", binding: "constant", value: { kind: "string", value: "monster_soldier" } },
      { field: "max_health", binding: "constant", value: { kind: "float", value: 100 } }],
    callbacks: [{ id: "copper:heal", operation: "actor.use", stage: "observe", function: "T_Heal", globals: [], arguments: [
      { kind: "input", name: "self" }, { kind: "float", value: amount }, { kind: "float", value: 0 },
    ] }] });
  const prepared = [15.5, 7.2].map((amount, index) => {
    const encoded = new TextEncoder().encode(JSON.stringify(declaration(amount))), selected = { product: "q1-copper", id: `healing-${index}` };
    return prepareQuakeCMod({ description: { selection: selected, source: { provider: "q1:copper", content: "q1:rerelease:copper:installed" }, title: selected.id,
      sourceTitle: "Copper 1.30", purpose: "addition", requires: [], conflicts: [], availability: { kind: "available" } },
      declaration: readModCallbacks(encoded), declarationDigest: createContentDigest(new Bun.CryptoHasher("sha256").update(encoded).digest("hex")), program: bytes });
  });
  const options = { prepared, enabled: prepared.map(mod => mod.description.selection), operations: { actors: callbacks.operations, damage: combat.damageOperation, inventory: inventory.operations },
    services: { actors, bodies, combat, inventory, seed: 1, time: () => ({ kind: "seconds", value: 3 } satisfies ReturnType<import("../../../src/world/session/mods.ts").ModHostServices["time"]>) }, nextFrame: async () => {} };
  let mods = await SessionMods.open(options);
  try {
    expect(callbacks.use(target, null, null)).toBe(true); expect(uses).toBe(1);
    expect(combat.read(target.id)?.health).toBe(44);
    const saved = await mods.checkpoint();
    expect(saved.mods).toHaveLength(2);
    expect(saved.mods[0]?.identity.modules[0]?.id).not.toBe(saved.mods[1]?.identity.modules[0]?.id);
    callbacks.use(target, null, null); expect(combat.read(target.id)?.health).toBe(68);
    mods.close(); expect(callbacks.operations.use.active).toBe(false);
    combat.setHealth(target, 44);
    mods = await SessionMods.open(options, saved);
    callbacks.use(target, null, null); expect(combat.read(target.id)?.health).toBe(68);
    await mods.setEnabled(options.enabled[0] ?? { product: "invalid", id: "invalid" }, false);
    callbacks.use(target, null, null); expect(combat.read(target.id)?.health).toBe(76);
    actors.release(target); expect(callbacks.use(target, null, null)).toBe(false);
  } finally { mods.close(); actors.close(); }
});

test.skipIf(!await Bun.file(path).exists())("original Copper helper spawn and scheduled removal retain shared actor ownership across save", async () => {
  const { QcModProvider } = await import("../../../src/compat/qc/mod-provider.ts");
  const { loadQcProgram } = await import("../../../src/compat/qc/program.ts");
  const { SourceRandom } = await import("../../../src/app/bootstrap/simulation/random.ts");
  const program = loadQcProgram(await Bun.file(path).bytes());
  const declaration: ModCallbackDeclaration = { version: 1, runtime: "quakec", program: { path: "progs.dat", digest: program.digest }, callbacks: [],
    actorFields: [{ field: "version", binding: "private" }, { field: "spawnflags", binding: "private" },
      { field: "impulse", binding: "constant", value: { kind: "float", value: 20 } },
      { field: "classname", binding: "constant", value: { kind: "string", value: "player" } },
      { field: "owner", binding: "private" }, { field: "model", binding: "private" }, { field: "solid", binding: "private" },
      { field: "touch", binding: "private" }, { field: "use", binding: "private" },
      { field: "think", binding: "think" }, { field: "nextthink", binding: "nextthink" }] };
  const create = (actors: SessionActorRegistry, restored: boolean) => {
    const callbacks = new ActorCallbackTable(actors), bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
    const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
    const random = new SourceRandom(17);
    return new QcModProvider(program, { id: "mod:copper-helper", artifactPath: "progs.dat", digest: program.digest, revision: "test" }, declaration,
      { actors, callbacks, bodies, combat, inventory: new SharedInventoryTable(actors), seed: 17, time: () => ({ kind: "seconds", value: 5 }),
        referenceSaved: actor => actors.referenceSaved(actor, restored ? "checkpoint" : "current") },
      { nextInteger: () => random.nextInteger(), nextUnit: () => random.nextUnit(), checkpoint: () => random.checkpoint(), restore: state => {
        if (state.kind !== "glibc-random") throw new Error("Wrong test RNG"); return random.restore(state);
      } });
  };
  const original = new SessionActorRegistry(createIdentityOwner("copper-helper-original")), player = original.allocate("q2:game", "q2:player");
  const source = create(original, false);
  const call = (name: string) => ({ function: name, arguments: [], globals: [
    { name: "self", value: { kind: "input", name: "self" } }, { name: "time", value: { kind: "input", name: "time" } },
  ] } satisfies import("../../../src/contracts/mod-callbacks.ts").ModSourceCall);
  const inputs = (actor: import("../../../src/contracts/identity.ts").ActorId) => new Map<import("../../../src/contracts/mod-callbacks.ts").ModCallbackInput, import("../../../src/contracts/mod-callbacks.ts").ModRuntimeValue>([
    ["self", { kind: "actor", value: actor }], ["time", { kind: "float", value: 5 }],
  ]);
  let restored: SessionActorRegistry | null = null, resumed: InstanceType<typeof QcModProvider> | null = null;
  try {
    expect(source.invoke(call("SUB_ShouldSpawn"), inputs(player.id))).toBe(1);
    const helper = original.ownedBy("mod:copper-helper")[0];
    if (helper === undefined) throw new Error("Copper did not spawn its impulse helper");
    expect(original.sourceOf(helper.id)?.provider).toBe("mod:copper-helper");
    source.invoke(call("SUB_RemoveSoon"), inputs(helper.id));
    const guest = source.checkpoint(), actors = original.checkpoint(), slots = original.sourceCheckpoint();
    source.advance({ frame: 1, time: { kind: "seconds", value: 5.05 }, elapsed: { kind: "seconds", value: 0.1 }, phase: "frame-exit" });
    expect(original.isLive(helper.id)).toBe(false);
    expect(original.isLive(player.id)).toBe(true);
    restored = SessionActorRegistry.restore(createIdentityOwner("copper-helper-restored"), actors, slots);
    resumed = create(restored, true); resumed.restore(guest);
    const revived = restored.ownedBy("mod:copper-helper")[0];
    if (revived === undefined) throw new Error("Saved helper disappeared");
    resumed.advance({ frame: 1, time: { kind: "milliseconds", value: 5050 }, elapsed: { kind: "milliseconds", value: 100 }, phase: "frame-exit" });
    expect(restored.isLive(revived.id)).toBe(false);
    expect(restored.ownedBy("q2:game")).toHaveLength(1);
  } finally { resumed?.close(); restored?.close(); source.close(); original.close(); }
});
