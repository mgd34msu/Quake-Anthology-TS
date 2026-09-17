import { expect, test } from "bun:test";
import { BotKnowledge } from "../../../../src/bots/behavior/rerelease/data/knowledge.ts";
import { RereleaseBotBehavior } from "../../../../src/bots/behavior/rerelease/profile.ts";
import { readRereleaseBehavior } from "../../../../src/bots/behavior/rerelease/checkpoint.ts";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../../../src/persistence/value.ts";

test("rerelease brain save boundary reconstructs every memory field without live references", () => {
  const knowledge = new BotKnowledge({ characters: "", weapons: "", items: "", monsters: "", interactables: "", gameRules: "", teams: "", chats: "", settings: 'skill easy\n{\n}\n' });
  const behavior = new RereleaseBotBehavior({ definition: "fixture", source: "q1-rerelease", knowledge, skill: "easy", seed: 7,
    gameMode: { gameType: "coop", weaponStay: false, hasTeams: true }, maxHealth: 100, runSpeed: 320, walkSpeed: 160,
    movement: { gravity: 800, jumpVelocity: 270, jumpAirSeconds: 0.675, maximumLandingRise: 18, startAbove: 56, bodyMins: { x: -16, y: -16, z: -24 }, bodyMaxs: { x: 16, y: 16, z: 32 } },
    callbacks: { time: () => 0, preThink: () => {}, postThink: () => {}, chat: () => {}, selectWeapon: () => {}, weaponImpulse: () => 0, humanTeammateNear: () => false } });
  behavior.requestMoveToPoint({ x: 32, y: 64, z: 16 });
  const before = behavior.checkpoint(), decoded = readRereleaseBehavior(decodeCheckpointValue(encodeCheckpointValue(before)));
  expect(decoded).toEqual(before); behavior.restore(decoded); expect(behavior.checkpoint()).toEqual(before);
  expect(() => readRereleaseBehavior({ ...before, rng: "wrong" })).toThrow();
});
