import { expect, test } from "bun:test";
import { QvmModPickups, validateQvmModPickups } from "../../../src/compat/qvm/mod-pickups.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ModCallbackInput, ModRuntimeValue } from "../../../src/contracts/mod-callbacks.ts";
import type { OriginalPickupOffer } from "../../../src/contracts/original-pickups.ts";
import type { QvmModCallbackDeclaration, QvmModPickup, QvmModSourceCall } from "../../../src/contracts/qvm-mod-callbacks.ts";
import { ActorCallbackTable, SessionActorRegistry } from "../../../src/world/actors/index.ts";
import { SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/body.ts";
import { GameplayAuthority } from "../../../src/world/gameplay/authority.ts";
import { SharedInventoryTable } from "../../../src/world/gameplay/inventory.ts";
import { SharedOriginalPickupAdmission } from "../../../src/world/gameplay/original-pickups.ts";
import type { ModHostServices } from "../../../src/world/session/mods.ts";

function fixture(operation: QvmModPickup["operation"]) {
  const identity = createIdentityOwner("qvm-pickup-rules"), actors = new SessionActorRegistry(identity);
  const recipient = actors.allocate("test:player", "test:player"), pickup = actors.allocate("test:map", "test:map"), client = identity.client(0, 0);
  const callbacks = new ActorCallbackTable(actors), combat = new GameplayAuthority(actors, callbacks, {
    impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined,
  }), inventory = new SharedInventoryTable(actors);
  combat.create(recipient, { health: 100, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  inventory.create(recipient, [{ item: "test:ammo", count: 0, capacity: 100 }]);
  const services: ModHostServices = { actors, callbacks, combat, inventory, seed: 1, time: () => ({ kind: "seconds", value: 99 }),
    bodies: new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined }), clients: { maximum: 1,
      clients: () => [{ actor: recipient.id, client }], forActor: actor => actor.equals(recipient.id) ? client : null,
      actor: value => value.equals(client) ? recipient.id : null, userinfo: () => "", setUserinfo: () => {}, command: () => null, drop: () => {},
      subscribe: () => () => undefined, subscribeApplication: () => () => undefined } };
  const definition: QvmModPickup = { id: "source:ammo", offered: ["map:ammo"], resource: { kind: "inventory", item: "test:ammo" }, operation, context: [] };
  const calls: { call: QvmModSourceCall; inputs: ReadonlyMap<ModCallbackInput, ModRuntimeValue> }[] = [];
  let grant = 0, gate = 1, duringGate = () => {};
  const provider = new QvmModPickups([definition], services, "mod:source", {
    current: () => {}, eligible: actor => actors.isLive(actor) && actor.equals(recipient.id), context: (_definition, _offer, _inputs, execute) => execute(),
    observe: (_actor, _observer, execute) => execute(), invoke: (call, inputs) => {
      calls.push({ call, inputs });
      if (call.entry === 1) { duringGate(); return gate; }
      return grant;
    },
  });
  provider.activate(); const admission = new SharedOriginalPickupAdmission(actors, combat, inventory);
  const offer: OriginalPickupOffer = { recipient: recipient.id, pickup: pickup.id, source: "test:map", item: "map:ammo",
    defaultResource: { kind: "inventory", item: "test:ammo" }, count: { kind: "default" }, dropped: false, time: { kind: "milliseconds", value: 1234 } };
  let completed = 0;
  return { provider, actors, pickup, calls, definition, offer, setGate: (value: number) => { gate = value; }, setGrant: (value: number) => { grant = value; },
    duringGate: (run: () => void) => { duringGate = run; }, completed: () => completed,
    touch: (value = offer) => admission.touch(value, { original: () => { throw new Error("Original fallback must not run"); }, complete: () => { completed++; } }),
    close: () => { provider.close(); actors.close(); } };
}
const gate: QvmModSourceCall = { entry: 1, arguments: [], globals: [], returns: "int32" };
const grant: QvmModSourceCall = { entry: 2, arguments: [], globals: [], returns: "int32" };

test("QVM pickup preserves exact offer inputs and explicit grant acceptance", () => {
  const f = fixture({ kind: "gate-then-grant", gate, grant, grantAccepts: "always" });
  try {
    expect(f.touch()).toBe("accepted"); expect(f.calls.map(entry => entry.call.entry)).toEqual([1, 2]);
    const values = f.calls[1]?.inputs;
    expect(values?.get("self")).toEqual({ kind: "actor", value: f.offer.recipient });
    expect(values?.get("other")).toEqual({ kind: "actor", value: f.pickup.id });
    expect(values?.get("item")).toEqual({ kind: "string", value: "map:ammo" });
    expect(values?.get("time")).toEqual({ kind: "float", value: 1.234 });
    expect(values?.get("pickup-count")).toEqual({ kind: "float", value: 0 });
    expect(values?.get("pickup-has-count")).toEqual({ kind: "float", value: 0 });
    expect(f.touch({ ...f.offer, count: { kind: "override", amount: 0 }, dropped: true })).toBe("accepted");
    expect(f.calls.at(-1)?.inputs.get("pickup-has-count")).toEqual({ kind: "float", value: 1 });
    expect(f.calls.at(-1)?.inputs.get("pickup-dropped")).toEqual({ kind: "float", value: 1 });
    f.setGate(0); expect(f.touch()).toBe("refused"); expect(f.calls.at(-1)?.call.entry).toBe(1);
  } finally { f.close(); }
  const boolean = fixture({ kind: "boolean-grant", grant });
  try { expect(boolean.touch()).toBe("refused"); boolean.setGrant(40); expect(boolean.touch()).toBe("accepted"); }
  finally { boolean.close(); }
  const nonzero = fixture({ kind: "gate-then-grant", gate, grant, grantAccepts: "nonzero" });
  try { expect(nonzero.touch()).toBe("refused"); } finally { nonzero.close(); }
});

test("QVM gate retirement or removal cannot grant, complete, or checkpoint its pickup scope", () => {
  for (const retire of [true, false]) {
    const f = fixture({ kind: "gate-then-grant", gate, grant, grantAccepts: "always" });
    try {
      f.duringGate(() => { expect(() => f.provider.assertIdle()).toThrow("pickup execution"); if (retire) f.actors.release(f.pickup); else f.provider.close(); });
      expect(f.touch()).toBe("stale"); expect(f.calls.map(entry => entry.call.entry)).toEqual([1]); expect(f.completed()).toBe(0);
      expect(() => f.provider.assertIdle()).not.toThrow();
    } finally { f.close(); }
  }
});

test("QVM pickup admission rejects context aliases and missing resource storage", () => {
  const definition: QvmModPickup = { id: "source:ammo", resource: { kind: "inventory", item: "test:ammo" }, offered: ["map:ammo"], operation: { kind: "boolean-grant", grant },
    context: [{ record: "entity", offset: 0, value: { kind: "address", value: 64 } }] };
  const declaration: QvmModCallbackDeclaration = { version: 1, runtime: "qvm", program: { path: "vm/qagame.qvm", digest: `sha256:${"0".repeat(64)}` }, abiProfile: "q3-modern",
    clients: { maximum: 1, records: ["client"], playerStateRecord: "client", admit: [], userinfo: [], disconnect: [] }, entityRecord: "entity",
    actorRecords: [{ id: "entity", address: 64, stride: 64, capacity: 2, fields: [{ binding: "record", record: "client", offset: 0 }] },
      { id: "client", address: 1024, stride: 512, capacity: 1, fields: [{ binding: "inventory", item: "test:ammo", offset: 0, encoding: "int32" }] }],
    pickups: [definition], callbacks: [], initialize: [] };
  expect(() => validateQvmModPickups(declaration)).toThrow("overlaps shared");
  expect(() => validateQvmModPickups({ ...declaration, pickups: [{ ...definition, context: [], resource: { kind: "inventory", item: "test:missing" } }] })).toThrow("inventory storage");
  expect(() => validateQvmModPickups({ ...declaration, pickups: [{ ...definition, context: [{ record: "client", offset: 4, value: { kind: "address", value: 64 } }] }] })).toThrow("source context");
});
