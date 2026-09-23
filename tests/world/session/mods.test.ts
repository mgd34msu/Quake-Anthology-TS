import { expect, test } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../../src/contracts/execution.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { modInstanceProvider, modSelectionKey } from "../../../src/contracts/mods.ts";
import type { ModDescription, ModPrivateCheckpoint, ModSelection } from "../../../src/contracts/mods.ts";
import { QvmModule, QvmOpcode, rejectQvmSyscall, resolveQvmArtifact } from "../../../src/compat/qvm/index.ts";
import { ActorCallbackTable } from "../../../src/world/actors/callbacks.ts";
import { SessionActorRegistry } from "../../../src/world/actors/registry.ts";
import { GameplayAuthority } from "../../../src/world/gameplay/authority.ts";
import { SharedInventoryTable } from "../../../src/world/gameplay/inventory.ts";
import { SessionMods } from "../../../src/world/session/mods.ts";
import type { ModOperations, PreparedMod } from "../../../src/world/session/mods.ts";
import type { SimulationPresentation } from "../../../src/app/bootstrap/simulation/types.ts";

function program(value: number, multiply: boolean): Uint8Array {
  const operations: readonly (readonly [QvmOpcode, number?])[] = [
    [QvmOpcode.OP_ENTER, 0], [QvmOpcode.OP_CONST, 256], [QvmOpcode.OP_CONST, 256], [QvmOpcode.OP_LOAD4],
    [QvmOpcode.OP_CONST, 1], [QvmOpcode.OP_ADD], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_LOCAL, 8], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_CONST, value],
    [multiply ? QvmOpcode.OP_MULI : QvmOpcode.OP_ADD], [QvmOpcode.OP_LEAVE, 0],
  ];
  const code = new BinaryWriter(operations.length * 5);
  for (const [opcode, operand] of operations) { code.u8(opcode); if (operand !== undefined) code.i32(operand); }
  const instructions = code.finish(), bytes = new BinaryWriter(32 + instructions.length);
  for (const word of [0x12721444, operations.length, 32, instructions.length, 32 + instructions.length, 0, 0, 4096]) bytes.i32(word);
  bytes.bytes(instructions);
  return bytes.finish();
}

function world() {
  const actors = new SessionActorRegistry(createIdentityOwner("mod-session")), callbacks = new ActorCallbackTable(actors);
  const inventory = new SharedInventoryTable(actors), combat = new GameplayAuthority(actors, callbacks, {
    impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined,
  });
  const player = actors.allocate("q2:game", "q2:player");
  inventory.create(player, [{ item: "q2:cells", count: 0, capacity: 1000 }]);
  let uses = 0;
  callbacks.bind(player, { think: null, touch: null, pain: null, die: null, use: () => { uses++; return undefined; } });
  const operations: ModOperations = { actors: callbacks.operations, damage: combat.damageOperation, inventory: inventory.operations };
  return { actors, callbacks, combat, inventory, player, operations, uses: () => uses };
}
type TestWorld = ReturnType<typeof world>;
interface Controls { failInitialize?: boolean; failRegister?: boolean; failRestore?: boolean; invalidState?: boolean; appearances?: readonly SimulationPresentation[]; }

function prepared(world: TestWorld, selection: ModSelection, events: string[], value: number, multiply = false,
  controls: Controls = {}, requires: readonly ModSelection[] = [], conflicts: readonly ModSelection[] = []): PreparedMod {
  const bytes = program(value, multiply), key = modSelectionKey(selection), instance = modInstanceProvider(selection);
  const moduleIdentity: ModuleIdentity = { id: "q3:official", artifactPath: "vm/qagame.qvm", revision: "test",
    digest: createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")) };
  const artifact = resolveQvmArtifact({ module: moduleIdentity, role: "qagame", bytes });
  if (artifact.kind !== "bytecode") throw new Error("Expected original bytecode");
  const description: ModDescription = { selection, source: { provider: "q3:official", content: "q3:classic:baseq3:test" },
    title: key, sourceTitle: "Quake III", purpose: "addition", requires, conflicts, availability: { kind: "available" } };
  const provider = { provider: instance, schema: "test:source-host", version: 1 } satisfies Omit<import("../../../src/contracts/session.ts").ProviderCheckpoint, "bytes">;
  return { description, identity: { selection, source: description.source, declarationDigest: moduleIdentity.digest, modules: [moduleIdentity], providers: [provider] },
    validateState(state) {
      const guest = state.guests[0], host = state.providers[0];
      if (controls.invalidState || guest?.kind !== "qvm" || guest.data.length !== artifact.image.allocatedDataLength
        || guest.hostState.format !== "test:qvm-host" || host?.bytes.length !== 1) throw new Error(`Invalid source state: ${key}`);
    },
    async initialize(context) {
      events.push(`open:${key}`);
      expect(context.instance).toBe(instance);
      const actor = world.actors.allocate(context.instance, "test:mod-service");
      context.resources.defer(() => { events.push(`release:${key}`); return world.actors.release(actor); });
      if (controls.failInitialize) throw new Error(`Initialize failed: ${key}`);
      let hostValue = 7;
      const module = new QvmModule({ artifact, host: rejectQvmSyscall, hostState: {
        checkpoint: () => ({ state: { module: moduleIdentity, format: "test:qvm-host", bytes: Uint8Array.of(hostValue) }, random: [], callbacks: [] }),
        restore: state => { hostValue = state.state.bytes[0] ?? 0; return undefined; },
      } });
      return {
        appearanceOverrides: () => controls.appearances ?? [],
        register(registrations) {
          registrations.register(registrations.operations.inventory.give, { id: "mod:amount", kind: "transform",
            transform: ([owner, item, count]) => [owner, item, module.call([count])] });
          registrations.register(registrations.operations.actors.use, { id: "mod:used", kind: "observe",
            observe: () => { module.call([0]); return undefined; } });
          if (controls.failRegister) throw new Error(`Registration failed: ${key}`);
          return undefined;
        },
        async checkpoint(): Promise<ModPrivateCheckpoint> { return { guests: [module.checkpoint()], providers: [{ ...provider, bytes: Uint8Array.of(hostValue) }] }; },
        async restore(state) {
          events.push(`restore:${key}`);
          const guest = state.guests[0], host = state.providers[0];
          if (guest === undefined || host === undefined) throw new Error("Missing validated state");
          module.restore(guest); hostValue = host.bytes[0] ?? 0;
          if (controls.failRestore) { controls.failRestore = false; throw new Error(`Restore failed: ${key}`); }
        },
        close() { events.push(`close:${key}`); module.retire(); return undefined; },
      };
    },
  };
}
const first: ModSelection = { product: "q3-one", id: "amount" }, second: ModSelection = { product: "q3-two", id: "amount" };

test("declared component HUD and camera conflicts reject before source admission", async () => {
  const w = world(), events: string[] = [];
  const a = prepared(w, first, events, 1), b = prepared(w, second, events, 2);
  try {
    await expect(SessionMods.open({ prepared: [
      { ...a, clientPresentation: { hud: "replace", view: false } }, { ...b, clientPresentation: { hud: "replace", view: false } },
    ], enabled: [first, second], operations: w.operations, nextFrame: async () => {} })).rejects.toThrow("HUD replacement conflict");
    expect(events).toEqual([]);
    await expect(SessionMods.open({ prepared: [
      { ...a, clientPresentation: { hud: "overlay", view: true } }, { ...b, clientPresentation: { hud: "none", view: true } },
    ], enabled: [first, second], operations: w.operations, nextFrame: async () => {} })).rejects.toThrow("camera control conflict");
    expect(events).toEqual([]);
    const owner = await SessionMods.open({ prepared: [
      { ...a, clientPresentation: { hud: "overlay", view: false } }, { ...b, clientPresentation: { hud: "overlay", view: false } },
    ], enabled: [first, second], operations: w.operations, nextFrame: async () => {} });
    try { expect(owner.enabled()).toEqual([first, second]); }
    finally { owner.close(); }
  } finally { w.actors.close(); }
});

test("powered component reservations precede source initialization and activate after restore", async () => {
  const w = world(), events: string[] = [];
  const regular = { kind: "q1", points: 50, absorption: 0.6, item: "q1:armor/yellow" } satisfies import("../../../src/contracts/gameplay.ts").RegularArmorState;
  w.combat.create(w.player, { health: 73, armor: { regular, powered: { kind: "none" } }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  w.inventory.give(w.player, "q2:cells", 20);
  const withPower = (selection: ModSelection): PreparedMod => {
    const source = prepared(w, selection, events, 0), key = modSelectionKey(selection);
    return { ...source, async initialize(context) {
      const claim = { owner: context.instance, rule: "source:power", admission: { kind: "claim" } } satisfies import("../../../src/world/gameplay/authority.ts").ProtectionClaim;
      const reservation = w.combat.reserveProtection(w.player, "powered", claim); context.resources.defer(() => reservation.close());
      const runtime = await source.initialize(context); let active = false;
      return { ...runtime, activate() {
        events.push(`activate:${key}`);
        if (!active) {
          reservation.bind({ ...claim, channel: "powered", inventoryItems: ["q2:cells"], read: () => ({ kind: "shield", cells: w.inventory.count(w.player.id, "q2:cells") }),
            validateWrite: () => undefined, write: () => undefined, absorb: () => ({ saved: 0 }) }); active = true;
        }
        return undefined;
      } };
    } };
  };
  const options = { prepared: [withPower(first), withPower(second)], enabled: [first], operations: w.operations, nextFrame: async () => {} };
  const original = await SessionMods.open(options), saved = await original.checkpoint(); original.close(); events.length = 0;
  const owner = await SessionMods.open(options, saved);
  try {
    expect(events).toEqual(["open:q3-one/amount", "restore:q3-one/amount", "activate:q3-one/amount"]);
    expect(w.combat.read(w.player.id)?.armor).toEqual({ regular, powered: { kind: "shield", cells: 20 } });
    events.length = 0;
    await expect(owner.setEnabled(second, true)).rejects.toThrow("component owner");
    expect(events).toEqual([]);
    expect(owner.enabled()).toEqual([first]);
    await owner.restore(saved);
    expect(events).toEqual(["restore:q3-one/amount", "activate:q3-one/amount"]);
    await owner.setEnabled(first, false);
    expect(w.combat.read(w.player.id)?.armor).toEqual({ regular, powered: { kind: "none" } });
    expect(w.inventory.count(w.player.id, "q2:cells")).toBe(20);
  } finally { owner.close(); w.actors.close(); }
});

test("mod appearance groups preserve attachments and restore the preceding enabled source", async () => {
  const w = world(), events: string[] = [], origin = { x: 0, y: 0, z: 0 };
  const model = (path: string): SimulationPresentation => ({ actor: w.player.id, content: "q2:classic:mod:fixture", family: "q2", path,
    frame: 0, oldFrame: 0, skin: 0, effects: 0, renderFlags: 0, origin, angles: origin, scale: 1, visible: true, viewWeapon: false });
  const original = [model("body.md2"), model("weapon.md2")], replacement = [model("other.md2")];
  const owner = await SessionMods.open({ prepared: [prepared(w, first, events, 1, false, { appearances: original }),
    prepared(w, second, events, 1, false, { appearances: replacement })], enabled: [first, second], operations: w.operations, nextFrame: async () => {} });
  try {
    expect(owner.appearanceOverrides().get(w.player.id)).toEqual(replacement);
    await owner.setEnabled(second, false);
    expect(owner.appearanceOverrides().get(w.player.id)).toEqual(original);
    await owner.setEnabled(first, false);
    expect(owner.appearanceOverrides().size).toBe(0);
    expect(w.actors.resolveOwned(w.player.id)?.owner).toBe("q2:game");
  } finally { owner.close(); w.actors.close(); }
});

test("two guest mods compose on real Q2 inventory and actor operations with independent lifetimes", async () => {
  const w = world(), events: string[] = [];
  const mods = [prepared(w, first, events, 2), prepared(w, second, events, 3, true)];
  const owner = await SessionMods.open({ prepared: mods, enabled: [first, second], operations: w.operations, nextFrame: async () => {} });
  expect(w.inventory.give(w.player, "q2:cells", 1)).toBe(9);
  expect(w.callbacks.use(w.player, null, null)).toBe(true);
  expect(w.uses()).toBe(1);
  const saved = await owner.checkpoint();
  for (const checkpoint of saved.mods) {
    const guest = checkpoint.state.guests[0];
    if (guest?.kind !== "qvm") throw new Error("Missing VM state");
    expect(new DataView(guest.data.buffer, guest.data.byteOffset, guest.data.byteLength).getInt32(256, true)).toBe(2);
  }
  expect(w.actors.ownedBy(modInstanceProvider(first))).toHaveLength(1);
  expect(w.actors.ownedBy(modInstanceProvider(second))).toHaveLength(1);
  await owner.setEnabled(first, false);
  expect(w.inventory.give(w.player, "q2:cells", 1)).toBe(3);
  expect(owner.enabled()).toEqual([second]);
  expect(w.actors.ownedBy(modInstanceProvider(first))).toHaveLength(0);
  expect(w.actors.ownedBy(modInstanceProvider(second))).toHaveLength(1);
  await owner.setEnabled(first, true);
  expect(owner.enabled()).toEqual([second, first]);
  expect(w.inventory.give(w.player, "q2:cells", 1)).toBe(5);
  owner.close(); owner.close();
  expect(w.inventory.give(w.player, "q2:cells", 1)).toBe(1);
  expect(w.callbacks.operations.use.active).toBe(false);
  w.actors.close();
});

test("dependencies initialize first and disabling a dependency closes dependents first", async () => {
  const w = world(), events: string[] = [];
  const mods = [prepared(w, second, events, 3, true, {}, [first]), prepared(w, first, events, 2)];
  const owner = await SessionMods.open({ prepared: mods, enabled: [second], operations: w.operations, nextFrame: async () => {} });
  expect(owner.enabled()).toEqual([first, second]);
  expect(events).toEqual(["open:q3-one/amount", "open:q3-two/amount"]);
  await owner.setEnabled(first, false);
  expect(events.slice(2)).toEqual(["close:q3-two/amount", "release:q3-two/amount", "close:q3-one/amount", "release:q3-one/amount"]);
  expect(owner.enabled()).toEqual([]);
  expect(w.inventory.operations.give.active).toBe(false);
  owner.close(); w.actors.close();
});

test("dependency conflicts reject before initialization and partial acquisition rolls back", async () => {
  const w = world(), events: string[] = [];
  const conflicting = [prepared(w, first, events, 2, false, {}, [], [second]), prepared(w, second, events, 3)];
  await expect(SessionMods.open({ prepared: conflicting, enabled: [first, second], operations: w.operations, nextFrame: async () => {} })).rejects.toThrow("conflicts");
  expect(events).toEqual([]);
  const failing = [prepared(w, first, events, 2), prepared(w, second, events, 3, false, { failInitialize: true })];
  await expect(SessionMods.open({ prepared: failing, enabled: [first, second], operations: w.operations, nextFrame: async () => {} })).rejects.toThrow("Initialize failed");
  expect(events).toEqual(["open:q3-one/amount", "open:q3-two/amount", "release:q3-two/amount", "close:q3-one/amount", "release:q3-one/amount"]);
  expect(w.inventory.operations.give.active).toBe(false);
  expect(w.actors.ownedBy(modInstanceProvider(first))).toHaveLength(0);
  expect(w.actors.ownedBy(modInstanceProvider(second))).toHaveLength(0);
  w.actors.close();
});

test("failed registration removes only newly enabled hooks and providers", async () => {
  const w = world(), events: string[] = [];
  const mods = [prepared(w, first, events, 2), prepared(w, second, events, 3, true, { failRegister: true })];
  const owner = await SessionMods.open({ prepared: mods, enabled: [first], operations: w.operations, nextFrame: async () => {} });
  await expect(owner.setEnabled(second, true)).rejects.toThrow("Registration failed");
  expect(owner.enabled()).toEqual([first]);
  expect(w.inventory.give(w.player, "q2:cells", 1)).toBe(3);
  expect(w.actors.ownedBy(modInstanceProvider(second))).toHaveLength(0);
  expect(w.actors.ownedBy(modInstanceProvider(first))).toHaveLength(1);
  owner.close(); w.actors.close();
});

test("save identity, order and all source state validate before any live restore", async () => {
  const w = world(), events: string[] = [], controls: Controls = {};
  const mods = [prepared(w, first, events, 2), prepared(w, second, events, 3, true, controls)];
  const options = { prepared: mods, enabled: [first, second], operations: w.operations, nextFrame: async () => {} };
  const owner = await SessionMods.open(options), saved = await owner.checkpoint();
  events.length = 0;
  await expect(owner.restore({ ...saved, mods: [...saved.mods].reverse() })).rejects.toThrow("order or identity");
  const altered = saved.mods.map(entry => ({ ...entry, identity: { ...entry.identity, declarationDigest: createContentDigest("f".repeat(64)) } }));
  await expect(owner.restore({ ...saved, mods: altered })).rejects.toThrow("order or identity");
  controls.invalidState = true;
  await expect(owner.restore(saved)).rejects.toThrow("Invalid source state");
  expect(events).toEqual([]);
  controls.invalidState = false;
  w.inventory.give(w.player, "q2:cells", 1);
  await owner.restore(saved);
  expect(await owner.checkpoint()).toEqual(saved);
  owner.close(); events.length = 0;
  await expect(SessionMods.open(options, { ...saved, mods: [...saved.mods].reverse() })).rejects.toThrow("order or identity");
  expect(events).toEqual([]);
  const restored = await SessionMods.open(options, saved);
  expect(await restored.checkpoint()).toEqual(saved);
  restored.close(); w.actors.close();
});

test("a later restore failure restores earlier and failing guest state without leaking registrations", async () => {
  const w = world(), events: string[] = [], controls: Controls = {};
  const owner = await SessionMods.open({ prepared: [prepared(w, first, events, 2), prepared(w, second, events, 3, true, controls)],
    enabled: [first, second], operations: w.operations, nextFrame: async () => {} });
  const initial = await owner.checkpoint();
  w.inventory.give(w.player, "q2:cells", 1);
  const previous = await owner.checkpoint(); events.length = 0; controls.failRestore = true;
  await expect(owner.restore(initial)).rejects.toThrow("Restore failed");
  expect(events).toEqual(["restore:q3-one/amount", "restore:q3-two/amount", "restore:q3-two/amount", "restore:q3-one/amount"]);
  expect(await owner.checkpoint()).toEqual(previous);
  expect(w.inventory.give(w.player, "q2:cells", 1)).toBe(9);
  owner.close(); w.actors.close();
});
