import { expect, test } from "bun:test";
import { QcModPickups } from "../../../src/compat/qc/mod-pickups.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ModCallbackDeclaration, ModCallbackInput, ModRuntimeValue } from "../../../src/contracts/mod-callbacks.ts";
import type { OriginalPickupOffer } from "../../../src/contracts/original-pickups.ts";
import { SessionActorRegistry, ActorCallbackTable, SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority } from "../../../src/world/gameplay/authority.ts";
import { SharedInventoryTable } from "../../../src/world/gameplay/inventory.ts";
import { SharedOriginalPickupAdmission } from "../../../src/world/gameplay/original-pickups.ts";
import type { ModHostServices } from "../../../src/world/session/mods.ts";

test("QC inventory delegates keep admitted storage and scope gate inputs, retirement and removal", () => {
  const ids = createIdentityOwner("qc-pickup-inputs"), actors = new SessionActorRegistry(ids), client = ids.client(0, 0);
  const actor = actors.allocate("q2:game", "q2:player"), pickup = actors.allocate("q3:map", "q3:ammo_shells");
  const inventory = new SharedInventoryTable(actors), combat = new GameplayAuthority(actors, new ActorCallbackTable(actors), {
    impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  combat.create(actor, { health: 100, mass: 200, canTakeDamage: true, invulnerable: false, team: null,
    armor: { regular: { kind: "none" }, powered: { kind: "none" } } });
  inventory.create(actor, []);
  const services: ModHostServices = { actors, inventory, combat, seed: 1, time: () => ({ kind: "seconds", value: 99 }),
    bodies: new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined }),
    clients: { maximum: 1, clients: () => [{ actor: actor.id, client }], forActor: value => value.equals(actor.id) ? client : null,
      actor: value => value.equals(client) ? actor.id : null, userinfo: () => "", setUserinfo: () => undefined, command: () => null,
      subscribe: () => () => undefined, subscribeApplication: () => () => undefined, drop: () => undefined } };
  const declaration: ModCallbackDeclaration = { version: 1, runtime: "quakec", program: { path: "test.dat", digest: "sha256:test" },
    actorFields: [], callbacks: [], pickups: [{ id: "test:grant", writes: [{ kind: "inventory", item: "q1:ammo/shells", fields: "count" }], offered: ["q3:ammo_shells"],
      operation: { kind: "gate-then-grant", gate: { function: "test_gate", arguments: [], globals: [] },
        grant: { function: "test_grant", arguments: [], globals: [] }, grantAccepts: "always" } }] };
  const calls: { readonly name: string; readonly inputs: ReadonlyMap<ModCallbackInput, ModRuntimeValue> }[] = [];
  let accepted = false, retire = false;
  const adapter = new QcModPickups(declaration, "mod:grant", services, { watch: (_actor, _stores, run) => run(), invoke: (call, inputs) => {
    calls.push({ name: call.function, inputs });
    if (retire) actors.release(pickup);
    if (call.function === "test_gate") return accepted ? 1 : 0;
    inventory.give(actor, "q1:ammo/shells", 5); return 0;
  } });
  const offer: OriginalPickupOffer = { recipient: actor.id, pickup: pickup.id, source: "q3:map", item: "q3:ammo_shells",
    defaultResource: { kind: "inventory", item: "q1:ammo/shells" }, count: { kind: "default" }, dropped: false, time: { kind: "milliseconds", value: 3250 } };
  const admission = new SharedOriginalPickupAdmission(actors, combat, inventory);
  let fallback = 0; const completed: boolean[] = [];
  const continuation = { original: () => { fallback++; return true; }, complete: (taken: boolean) => { completed.push(taken); } };
  try {
    expect(() => adapter.admit(actor.id)).toThrow("not admitted");
    inventory.configure(actor, { item: "q1:ammo/shells", count: 2, capacity: 100 });
    adapter.admit(actor.id);
    expect(admission.touch(offer, continuation)).toBe("refused");
    expect(calls.map(call => call.name)).toEqual(["test_gate"]);
    expect(calls[0]?.inputs.get("pickup-count")).toEqual({ kind: "float", value: 0 });
    expect(calls[0]?.inputs.get("pickup-has-count")).toEqual({ kind: "float", value: 0 });
    accepted = true;
    expect(admission.touch({ ...offer, count: { kind: "override", amount: 12 }, dropped: true }, continuation)).toBe("accepted");
    expect(calls.map(call => call.name)).toEqual(["test_gate", "test_gate", "test_grant"]);
    const inputs = calls.at(-1)?.inputs;
    expect(inputs?.get("self")).toEqual({ kind: "actor", value: actor.id }); expect(inputs?.get("other")).toEqual({ kind: "actor", value: pickup.id });
    expect(inputs?.get("item")).toEqual({ kind: "string", value: "q3:ammo_shells" }); expect(inputs?.get("time")).toEqual({ kind: "float", value: 3.25 });
    expect(inputs?.get("pickup-count")).toEqual({ kind: "float", value: 12 }); expect(inputs?.get("pickup-has-count")).toEqual({ kind: "float", value: 1 });
    expect(inputs?.get("pickup-dropped")).toEqual({ kind: "float", value: 1 });
    expect(inventory.count(actor.id, "q1:ammo/shells")).toBe(7); expect(fallback).toBe(0); expect(completed).toEqual([false, true]);
    expect(admission.touch({ ...offer, item: "q2:ammo_shells" }, continuation)).toBe("accepted"); expect(fallback).toBe(1);
    const binding = inventory.resolvePickup(actor, offer).matches[0]; expect(binding?.current()).toBe(true);
    adapter.release(actor.id); expect(binding?.current()).toBe(false); expect(inventory.count(actor.id, "q1:ammo/shells")).toBe(7);
    adapter.admit(actor.id); retire = true;
    expect(admission.touch(offer, continuation)).toBe("stale"); expect(calls.at(-1)?.name).toBe("test_gate");
    expect(calls.filter(call => call.name === "test_grant")).toHaveLength(1); expect(completed).toEqual([false, true, true]);
    adapter.close(); expect(inventory.resolvePickup(actor, offer).matches).toHaveLength(0);
  } finally { adapter.close(); actors.close(); }
});
