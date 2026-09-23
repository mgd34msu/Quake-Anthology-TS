import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { SessionActorRegistry } from "../../../../src/world/actors/index.ts";
import { SharedInventoryTable } from "../../../../src/world/gameplay/inventory.ts";
import { Q3MappedAmmoRegeneration } from "../../../../src/app/bootstrap/simulation/arsenal/q3-ammo-regen.ts";
import { Q3_Q2_SUPPLY_PROFILE } from "../../../../src/content/composition/q3-q2-supply.ts";
import { Q3_Q1_SUPPLY_PROFILE } from "../../../../src/content/composition/q3-q1-supply.ts";
import { expansionSupply } from "../../../../src/content/composition/expansion-supply.ts";
import { GameClient } from "../../../../src/content/q3/base/game/state.ts";
import { SaveReader } from "../../../../src/persistence/value.ts";
import { stepQ3AmmoRegeneration } from "../../../../src/content/q3/team-arena/client-effects.ts";

test("all expansion pools keep independent original counters, source resets, and exact saved identities", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("mapped-ammo")), inventory = new SharedInventoryTable(actors);
  const actor = actors.allocate("q3:official", "q3:player");
  const profile = expansionSupply(Q3_Q2_SUPPLY_PROFILE, ["q2-xatrix", "q2-rogue"]);
  const owners = profile.ammoOwners; if (owners === undefined) throw new Error("Missing mapped rules");
  inventory.create(actor, owners.map(owner => ({ item: owner.item, count: 0, capacity: 200 })));
  const mapped = new Q3MappedAmmoRegeneration(profile, actors, inventory, Q3_Q2_SUPPLY_PROFILE.ammoOwners ?? []);
  try {
    const timers = mapped.timers(actor); expect(timers).toHaveLength(12);
    const source = new GameClient("missionpack", null, (weapon, value) => mapped.stored(actor.id, weapon, value));
    for (const [index, timer] of timers.entries()) timer.elapsedMilliseconds = index * 30;
    const saved = mapped.capture([actor]);
    source.ammoTimes.set(12, 0); source.ammoTimes.set(12, 0);
    expect(timers.filter(timer => timer.rule.weapon === 12).map(timer => timer.elapsedMilliseconds)).toEqual([0, 0, 0]);
    mapped.restore(new SaveReader(saved), [actor], () => 0);
    expect(mapped.capture([actor])).toEqual(saved);
    expect(() => mapped.restore(new SaveReader({ ...saved, profile: "other:profile" }), [actor], () => 0)).toThrow("profile");
    const first = saved.actors[0]; if (first === undefined) throw new Error("Missing captured actor");
    expect(() => mapped.restore(new SaveReader({ ...saved, actors: [first, first] }), [actor], () => 0)).toThrow("duplicated");
    expect(() => mapped.restore(new SaveReader({ ...saved, actors: [{ ...first, timers: first.timers.map(timer => ({ ...timer, elapsedMilliseconds: Infinity })) }] }), [actor], () => 0)).toThrow("integer");
    mapped.restore(new SaveReader(undefined), [actor], () => 123);
    expect(mapped.capture([actor]).actors[0]?.timers.map(timer => timer.elapsedMilliseconds)).toEqual([123, 123, 123, 123, 123, 123, 0, 0, 0, 0, 0, 0]);
    const repeated = timers.filter(timer => timer.rule.weapon === 12), trap = repeated[0], prox = repeated[1];
    if (trap === undefined || prox === undefined) throw new Error("Missing independent repeated rule");
    trap.count = trap.rule.max; trap.elapsedMilliseconds = 1900; prox.count = 0; prox.elapsedMilliseconds = 1900;
    expect(stepQ3AmmoRegeneration(trap.rule, trap.count, trap.elapsedMilliseconds, 100)).toEqual({ milliseconds: 0, count: null });
    expect(stepQ3AmmoRegeneration(prox.rule, prox.count, prox.elapsedMilliseconds, 100)).toEqual({ milliseconds: 0, count: 1 });
    actors.release(actor); expect(timers.every(timer => !timer.current())).toBe(true);
  } finally { mapped.close(); actors.close(); }
  expect(expansionSupply(Q3_Q1_SUPPLY_PROFILE, ["q1-rogue"]).ammoOwners).toHaveLength(7);
});
