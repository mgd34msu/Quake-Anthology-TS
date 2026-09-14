import { expect, test } from "bun:test";
import { botKnowledgePersistence } from "../../../src/app/bootstrap/simulation/bot-knowledge-checkpoint.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../../src/persistence/value.ts";

for (const source of ["q1", "q2", "q3"] satisfies readonly ("q1" | "q2" | "q3")[]) {
  test(`${source} arsenal checkpoints retain historical actor generations and weapon handle ownership`, () => {
    const before = createIdentityOwner("before"), after = createIdentityOwner("after");
    const first = before.actor(8, 1), replacement = before.actor(8, 2);
    const actors = new Map([[3, first], [7, replacement]]), codec = botKnowledgePersistence(source, actors);
    const saved = decodeCheckpointValue(encodeCheckpointValue(codec.checkpoint()));
    const restored = new Set<number>(), target = new Map<number, typeof first>();
    const restoredCodec = botKnowledgePersistence(source, target);
    restoredCodec.restoreCheckpoint(saved, value => after.actor(value.slot, value.generation), handle => {
      restored.add(handle); return handle;
    });
    expect(restoredCodec.checkpoint()).toEqual(codec.checkpoint());
    expect([...restored.keys()]).toEqual([3, 7]);
    expect(target.get(3)?.equals(after.actor(8, 1))).toBe(true);
    expect(target.get(7)?.equals(after.actor(8, 2))).toBe(true);
    expect(target.get(3)?.equals(first)).toBe(false);
    expect(() => restoredCodec.restoreCheckpoint(saved, value => after.actor(value.slot, value.generation), () => 3)).toThrow();
    expect(restoredCodec.checkpoint()).toEqual(codec.checkpoint());
    expect(() => restoredCodec.restoreCheckpoint(saved, value => after.actor(value.slot, value.generation), () => { throw new Error("unknown restored library handle"); })).toThrow();
    expect(restoredCodec.checkpoint()).toEqual(codec.checkpoint());
  });
}
