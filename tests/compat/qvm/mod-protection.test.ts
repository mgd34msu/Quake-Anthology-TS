import { expect, test } from "bun:test";
import { QvmModule, QvmOpcode, rejectQvmSyscall, resolveQvmArtifact } from "../../../src/compat/qvm/index.ts";
import { QvmModProtection } from "../../../src/compat/qvm/mod-protection.ts";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { digestBytes } from "../../../src/content/mounts/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { DamageOutcome, DamageRequest } from "../../../src/contracts/gameplay.ts";
import type { QvmModProtection as ProtectionDefinition } from "../../../src/contracts/qvm-mod-callbacks.ts";
import { ActorCallbackTable, SessionActorRegistry } from "../../../src/world/actors/index.ts";
import { SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/body.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../src/world/gameplay/index.ts";
import { createQ1CombatPolicy, nativeVictimArmor } from "../../../src/world/gameplay/policies.ts";
import type { ModHostServices } from "../../../src/world/session/mods.ts";

test("QVM component reports one atomic sibling-channel store and rebases suspended absorption", () => {
  const operations: readonly (readonly [QvmOpcode, number?])[] = [
    [QvmOpcode.OP_ENTER, 0], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 0],
    [QvmOpcode.OP_ENTER, 0],
    [QvmOpcode.OP_CONST, 80], [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_CONST, 5], [QvmOpcode.OP_SUB], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_CONST, 84], [QvmOpcode.OP_CONST, 68], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_CONST, 2], [QvmOpcode.OP_SUB], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_CONST, 80], [QvmOpcode.OP_BLOCK_COPY, 8], [QvmOpcode.OP_CONST, 5], [QvmOpcode.OP_LEAVE, 0],
  ];
  const code = new BinaryWriter(operations.length * 5);
  for (const [opcode, operand] of operations) { code.u8(opcode); if (operand !== undefined) code.i32(operand); }
  const instructions = code.finish(), output = new BinaryWriter(32 + instructions.length);
  for (const word of [0x12721444, operations.length, 32, instructions.length, 32 + instructions.length, 0, 0, 4096]) output.i32(word);
  output.bytes(instructions); const bytes = output.finish();
  const artifact = resolveQvmArtifact({ role: "qagame", bytes, module: { id: "mod:two-lanes", artifactPath: "vm/qagame.qvm", revision: "test", digest: digestBytes(bytes) } });
  if (artifact.kind !== "bytecode") throw new Error("Missing test bytecode");
  const module = new QvmModule({ artifact, host: rejectQvmSyscall }), identity = createIdentityOwner("qvm-sibling-stores");
  const actors = new SessionActorRegistry(identity), target = actors.allocate("q1:player", "q1:player"), client = identity.client(0, 0);
  const outcomes: DamageOutcome[] = [], callbacks = new ActorCallbackTable(actors);
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: outcome => { outcomes.push(outcome); return undefined; } });
  combat.create(target, { health: 100, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  const policy = createQ1CombatPolicy({ id: "q1:combat", armor: nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary32" })),
    context: () => ({ arithmetic: "binary32", quad: false, teamplay: 0, walk: false, momentumDirection: null }) });
  combat.register(policy);
  const services: ModHostServices = { actors, callbacks, combat, inventory: new SharedInventoryTable(actors), seed: 1, time: () => ({ kind: "seconds", value: 1 }),
    bodies: new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined }),
    clients: { maximum: 1, clients: () => [{ actor: target.id, client }], forActor: actor => actor.equals(target.id) ? client : null,
      actor: current => current.equals(client) ? target.id : null, userinfo: () => "", setUserinfo: () => {}, command: () => null, drop: () => {},
      subscribe: () => () => undefined, subscribeApplication: () => () => undefined } };
  const common = { flags: { noArmor: 0, noPowerArmor: 0, noRegularArmor: 0, energy: 0, radius: 0 }, admission: { kind: "replace-current-primary" } } satisfies Pick<ProtectionDefinition, "flags" | "admission">;
  const definitions: readonly ProtectionDefinition[] = [
    { ...common, channel: "regular", id: "regular", storage: { points: { record: "state", offset: 0, encoding: "int32" }, item: null },
      absorb: { entry: 3, arguments: [], globals: [], returns: "int32" } },
    { ...common, channel: "powered", id: "powered", storage: { cells: { record: "state", offset: 4, encoding: "int32" },
      selection: { field: { record: "state", offset: 8, encoding: "int32" }, mask: null, values: [{ value: 2, selected: "shield" }] } },
      absorb: { entry: 0, arguments: [], globals: [], returns: "int32" } },
  ];
  const channels = QvmModProtection.create(definitions, module, services, artifact.module.id, {
    current: () => {}, eligible: () => true, pointer: () => 64, invoke: call => module.call([], call.entry),
  });
  module.memory.dataView(64, 12).setInt32(0, 100, true); module.memory.dataView(68, 4).setInt32(0, 20, true); module.memory.dataView(72, 4).setInt32(0, 2, true);
  for (const channel of channels) channel.activate();
  const zero = { x: 0, y: 0, z: 0 }; let sequence = 0;
  const hit = () => combat.apply({ target: target.id, amount: 10, knockback: 0, direction: zero, point: zero, normal: zero, delivery: "direct",
    attack: { sequence: sequence++, time: services.time(), attacker: null, inflictor: null, weapon: null, weaponProvider: "q1:weapons", inventoryProvider: "q1:inventory",
      movementProvider: "q1:movement", combatProvider: policy.id, cause: { kind: "q1", deathType: "" } } } satisfies DamageRequest);
  let nested = false;
  const remove = module.bindInvocation({ kind: "qvm", module: artifact.module, instructionIndex: 3 }, call => {
    if (!nested) { nested = true; hit(); } return call.proceed();
  });
  try {
    hit(); expect(combat.read(target.id)?.armor).toEqual({ regular: { kind: "source", points: 90, item: null }, powered: { kind: "shield", cells: 16 } });
    expect(combat.read(target.id)?.health).toBe(90); expect(outcomes).toHaveLength(2);
    const changes = outcomes.map(outcome => outcome.kind === "committed" ? outcome.decision.mutations.filter(change => change.kind === "armor") : []);
    expect(changes.map(change => change.length)).toEqual([1, 1]);
    expect(changes[1]?.[0]).toMatchObject({ before: { regular: { points: 95 }, powered: { cells: 18 } }, after: { regular: { points: 90 }, powered: { cells: 16 } } });
  } finally { remove(); for (const channel of channels) channel.close(); module.retire(); actors.close(); }
});
