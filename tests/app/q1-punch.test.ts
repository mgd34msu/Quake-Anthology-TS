import { expect, test } from "bun:test";
import { Q1PlayerPunch, type Q1PunchOwner } from "../../src/app/bootstrap/simulation/q1-punch.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { SessionActorRegistry } from "../../src/world/actors/index.ts";
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from "../../src/persistence/value.ts";
import { createNumericOperations, Q1_DONOR_PROFILE } from "../../src/core/numeric.ts";

test("Q1 fallback punch restores by actor generation and transfers once into a source-owned field", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("punch-save")), actor = actors.allocate("q2:game", "q2:player");
  const state = new Q1PlayerPunch(actors, () => null), value = { x: 3, y: 4, z: 2 };
  state.write(actor.id, value);
  const saved = decodeCheckpointValue(encodeCheckpointValue(state.capture()));
  const restored = SessionActorRegistry.restore(createIdentityOwner("punch-restored"), actors.checkpoint(), actors.sourceCheckpoint());
  let source: Q1PunchOwner | null = null;
  const resumed = new Q1PlayerPunch(restored, () => source), target = restored.referenceSaved(actor.id, "current");
  resumed.restore(new SaveReader(saved)); expect(resumed.read(target)).toEqual(value);
  expect(resumed.advance(target, 0.1, createNumericOperations(Q1_DONOR_PROFILE))).toEqual(state.advance(actor.id, 0.1, createNumericOperations(Q1_DONOR_PROFILE)));
  let words = { x: 0, y: 0, z: 0 }, writes = 0;
  source = { read: () => words, write: angles => { words = { ...angles }; writes++; } };
  const expected = resumed.read(target); expect(words).toEqual(expected); expect(writes).toBe(1);
  expect(resumed.capture()).toEqual([]); expect(resumed.read(target)).toEqual(expected); expect(writes).toBe(1);
  const owner = restored.resolveOwned(target); if (owner === null) throw new Error("Missing owner");
  restored.release(owner); source = null;
  const replacement = restored.allocate("q2:game", "q2:player");
  expect(replacement.id.slot).toBe(target.slot); expect(resumed.read(replacement.id)).toEqual({ x: 0, y: 0, z: 0 });
  expect(() => resumed.write(target, value)).toThrow("retired");
  actors.close(); restored.close();
});
