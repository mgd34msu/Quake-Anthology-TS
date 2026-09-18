import { expect, test } from "bun:test";
import { BotKnowledge } from "../../../../src/bots/behavior/rerelease/data/knowledge.ts";
import { RereleaseBotBehavior } from "../../../../src/bots/behavior/rerelease/profile.ts";
import { readRereleaseBehavior } from "../../../../src/bots/behavior/rerelease/checkpoint.ts";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../../../src/persistence/value.ts";

test("rerelease brain save boundary reconstructs every memory field without live references", () => {
  const behavior = fixture();
  behavior.requestMoveToPoint({ x: 32, y: 64, z: 16 });
  const before = behavior.checkpoint(), decoded = readRereleaseBehavior(decodeCheckpointValue(encodeCheckpointValue(before)));
  expect(decoded).toEqual(before); behavior.restore(decoded); expect(behavior.checkpoint()).toEqual(before);
  expect(() => readRereleaseBehavior({ ...before, rng: "wrong" })).toThrow();
});

function fixture() {
  const knowledge = new BotKnowledge({ characters: "", weapons: "", items: "", monsters: "", interactables: "", gameRules: "", teams: "", chats: "", settings: 'skill easy\n{\n}\n' });
  return new RereleaseBotBehavior({ definition: "fixture", source: "q1-rerelease", knowledge, skill: "easy", seed: 7,
    gameMode: { gameType: "coop", weaponStay: false, hasTeams: true }, maxHealth: 100, runSpeed: 320, walkSpeed: 160,
    movement: { gravity: 800, jumpVelocity: 270, jumpAirSeconds: 0.675, maximumLandingRise: 18, startAbove: 56, bodyMins: { x: -16, y: -16, z: -24 }, bodyMaxs: { x: 16, y: 16, z: 32 } },
    callbacks: { time: () => 0, preThink: () => {}, postThink: () => {}, chat: () => {}, selectWeapon: () => {}, weaponImpulse: () => 0, humanTeammateNear: () => false } });
}

test("automatic objectives yield to source orders and revoke only their own saved route", () => {
  const behavior = fixture(), objective = { x: 100, y: 0, z: 0 }, external = { x: 200, y: 0, z: 0 };
  behavior.setObjectiveGoal(objective);
  expect(behavior.checkpoint().brain.memory.explicitGoal?.owner).toBe("objective");
  const original = behavior.checkpoint(), saved = readRereleaseBehavior(decodeCheckpointValue(encodeCheckpointValue(original)));
  behavior.restore(saved); expect(behavior.checkpoint()).toEqual(original);
  const memory = saved.brain.memory;
  behavior.restore({ ...saved, brain: { ...saved.brain, memory: { ...memory, goalPoint: objective,
    pathState: { ...memory.pathState, path: { nodes: [1], points: [objective], links: [null], cost: 1, generation: 0, mapDigest: "fixture" }, index: 0 } } } });
  behavior.setObjectiveGoal(null);
  expect(behavior.checkpoint().brain.memory.explicitGoal).toBeNull();
  expect(behavior.checkpoint().brain.memory.goalPoint).toBeNull();
  expect(behavior.checkpoint().brain.memory.pathState.path).toBeNull();
  behavior.setObjectiveGoal(objective); behavior.requestMoveToPoint(external);
  const ordered = behavior.checkpoint();
  behavior.setObjectiveGoal({ x: 300, y: 0, z: 0 }); behavior.setObjectiveGoal(null);
  expect(behavior.checkpoint()).toEqual(ordered);
  behavior.restore(readRereleaseBehavior(decodeCheckpointValue(encodeCheckpointValue(ordered))));
  behavior.setObjectiveGoal(objective); expect(behavior.checkpoint()).toEqual(ordered);
  behavior.requestFollowEntity(17, external); const followed = behavior.checkpoint();
  behavior.setObjectiveGoal(null); behavior.setObjectiveGoal(objective); expect(behavior.checkpoint()).toEqual(followed);
  behavior.restore(readRereleaseBehavior(decodeCheckpointValue(encodeCheckpointValue(followed))));
  behavior.setObjectiveGoal(null); expect(behavior.checkpoint()).toEqual(followed);
  behavior.clearExplicitGoal(); behavior.setObjectiveGoal(objective);
  expect(behavior.checkpoint().brain.memory.explicitGoal?.owner).toBe("objective");
});
test("legacy saved explicit orders remain externally owned and malformed owners are rejected", () => {
  const behavior = fixture(); behavior.requestMoveToPoint({ x: 200, y: 0, z: 0 });
  const saved = behavior.checkpoint(), goal = saved.brain.memory.explicitGoal;
  if (goal === null) throw new Error("Missing saved goal");
  const { owner, ...legacyGoal } = goal;
  expect(owner).toBe("external");
  const legacy = { ...saved, brain: { ...saved.brain, memory: { ...saved.brain.memory, explicitGoal: legacyGoal } } };
  behavior.restore(readRereleaseBehavior(legacy)); behavior.setObjectiveGoal(null);
  expect(behavior.checkpoint().brain.memory.explicitGoal?.owner).toBe("external");
  expect(() => readRereleaseBehavior({ ...saved, brain: { ...saved.brain, memory: { ...saved.brain.memory, explicitGoal: { ...goal, owner: "unknown" } } } })).toThrow();
});
