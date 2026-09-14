import { BotCvar } from "../../../src/bots/behavior/q3/ai-context.ts";
import { CvarRegistry } from "../../../src/core/cvars/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { expect, test } from "bun:test";
import { BotStateStore, BotWaypoint } from "../../../src/bots/behavior/q3/ai-state.ts";
import { GameMemory } from "../../../src/content/q3/base/game/memory.ts";
import { CommonParseCursor, CommonParseState } from "../../../src/core/common-parse.ts";
import { encodeCheckpointValue, decodeCheckpointValue } from "../../../src/persistence/value.ts";

const disk = (value: unknown): unknown => decodeCheckpointValue(encodeCheckpointValue(value));

test("AI retained heap restores byte cells, activation cycles, waypoint aliases and generation orders", () => {
  const memory = new GameMemory(() => 0, () => {}), states = new BotStateStore("baseq3");
  memory.allocate(23).writeString("retained");
  const state = states.acquire(3, memory), point = new BotWaypoint();
  state.inuse = true; state.client = 3; state.aiNode = "battle-chase"; state.botThinkResidual = 29;
  state.inventory[17] = 86; state.curPs.origin = { ...state.curPs.origin, x: -0 }; state.settings.characterfile = "bots/sarge_c.c";
  state.patrolPoints = point; state.currentPatrolPoint = point; state.checkpoints = point;
  const activation = state.activateGoalHeap[2]; if (activation === undefined) throw new Error("missing activation");
  activation.next = activation; activation.time = 13.25; state.activateStack = activation;
  state.scriptedOrder = { progress: "success", order: { kind: "follow", entity: { number: 4, generation: 7 } } };
  state.setup = { kind: "failed", stage: "chat-file", errorCode: 27 };
  const image = disk(states.captureSaveState(memory, value => value === null ? null : 0));
  const pool = disk(memory.captureSaveState());
  const restoredMemory = new GameMemory(() => 0, () => {}); restoredMemory.restoreSaveState(pool);
  const restored = new BotStateStore("baseq3"), restoredPoint = new BotWaypoint();
  restored.restoreSaveState(image, restoredMemory, id => id === null ? null : restoredPoint, (number, generation) => ({ number, generation: generation + 100 }));
  const result = restored.get(3); if (result === null) throw new Error("missing restored state");
  const restoredActivation = result.activateGoalHeap[2]; if (restoredActivation === undefined) throw new Error("missing restored activation");
  expect(result.activateStack).toBe(restoredActivation); expect(result.activateStack?.next).toBe(result.activateStack);
  expect(result.currentPatrolPoint).toBe(restoredPoint); expect(result.checkpoints).toBe(result.patrolPoints);
  expect(result.botThinkResidual).toBe(29); expect(result.inventory[17]).toBe(86); expect(Object.is(result.curPs.origin.x, -0)).toBe(true);
  expect(result.scriptedOrder).toEqual({ progress: "success", order: { kind: "follow", entity: { number: 4, generation: 107 } } });
  expect(result.setup).toEqual(state.setup); expect(result.aiNode).toBe("battle-chase");
  expect(restoredMemory.allocatedBytes).toBe(memory.allocatedBytes);
  result.inventory[17] = 99; expect(state.inventory[17]).toBe(86);
  expect(result.sourceAllocation).not.toBeNull();
  expect(() => restored.restoreSaveState([], restoredMemory, () => null, (number, generation) => ({ number, generation }))).toThrow();
});

test("parser checkpoint retains diagnostic session and current token", () => {
  const parser = new CommonParseState(); parser.beginSession("bots/sample.bot", () => undefined);
  parser.parse(new CommonParseCursor("\n\nname"));
  const restored = new CommonParseState(); restored.restoreSaveState(disk(parser.captureSaveState()));
  expect(restored.captureSaveState()).toEqual(parser.captureSaveState());
});

test("game allocations restore retained tails after allocator rewind", () => {
  const memory = new GameMemory(() => 0, () => {}), allocation = memory.allocate(12); allocation.writeString("retained");
  const pointer = disk(memory.captureAllocation(allocation)); memory.initialize();
  const restored = new GameMemory(() => 0, () => {}); restored.restoreSaveState(disk(memory.captureSaveState()));
  expect(restored.restoreAllocation(pointer).readString()).toBe("retained"); expect(restored.allocatedBytes).toBe(0);
  expect(() => restored.restoreAllocation({ offset: 262144, length: 1 })).toThrow();
});

test("cached bot cvar restores stale value until its next source update", () => {
  const registry = new CvarRegistry({ dialect: "q3", context: { session: createIdentityOwner("bot-cvar-save").session, origin: { kind: "server-console" } } });
  const cell = new BotCvar(registry); cell.register("bot_thinktime", "100"); cell.writeInteger(17);
  registry.set("bot_thinktime", "200", true);
  const restored = new BotCvar(registry); restored.restoreSaveState(disk(cell.captureSaveState()));
  expect(restored.value).toBe("100"); expect(restored.integerValue).toBe(17);
  restored.update(); expect(restored.value).toBe("200"); expect(restored.integerValue).toBe(200);
});

test("AI pool disagreement is rejected before replacing saved state bytes", () => {
  const memory = new GameMemory(() => 0, () => {}), states = new BotStateStore("baseq3");
  const state = states.acquire(0, memory); state.inuse = true;
  const image = states.captureSaveState(memory, () => null), first = image[0];
  if (first === null || first === undefined) throw new Error("missing saved state");
  first.state.bytes[0] = 0;
  const restored = new BotStateStore("baseq3");
  expect(() => restored.restoreSaveState(disk(image), memory, () => null, (number, generation) => ({ number, generation }))).toThrow("disagree");
  expect(state.inuse).toBe(true);
});
