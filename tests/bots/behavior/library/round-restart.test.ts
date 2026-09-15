import { expect, test } from "bun:test";
import { BotAssetFiles } from "../../../../src/bots/behavior/assets.ts";
import { AasBspEntities } from "../../../../src/bots/behavior/library/bsp-entities.ts";
import { BotGoalLibrary, GoalError } from "../../../../src/bots/behavior/library/goals.ts";
import type { GoalNavigation, GoalWorld } from "../../../../src/bots/behavior/library/goals.ts";
import { BotMemory } from "../../../../src/bots/behavior/library/memory.ts";
import { BotScriptSources } from "../../../../src/bots/behavior/library/script-sources.ts";
import { WeightConfigStore } from "../../../../src/bots/behavior/library/weights.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { ScriptGlobalDefines } from "../../../../src/ui/common/legacy/script/preprocessor.ts";

test("round rebinding retains map allocations and replaces pickup and observation owners", () => {
  const memory = new BotMemory(), files = new BotAssetFiles();
  files.add("botfiles/items.c", new TextEncoder().encode('iteminfo "item_health" { name "Health" modelindex 5 respawntime 35 mins {-15,-15,-15} maxs {15,15,15} }'));
  files.add("botfiles/weights.c", new TextEncoder().encode('weight "item_health" return 10;'));
  const reader = new BotScriptSources(files, new ScriptGlobalDefines(), (_severity, message) => { throw new Error(message); }, () => {}, memory);
  const weights = new WeightConfigStore(reader, { memory });
  const goals = new BotGoalLibrary({ memory, resolver: reader, weightStore: weights, log: { write() {} },
    clock: () => 50, gameType: () => 0, random: { nextInt: () => 0 } });
  const bsp = new AasBspEntities(() => {}, memory), identity = createIdentityOwner("bot-round-goals");
  const navigation: GoalNavigation = { area: () => ({ contents: 0, reachableAreaCount: 1 }),
    bestReachableFromJumpPadArea: () => 0, dropToFloor: origin => ({ origin, success: true }),
    bestReachableArea: origin => ({ area: 1, origin }), reachabilityArea: () => 1,
    route: () => ({ kind: "found", travelTime: 100 }) };
  let oldReads = 0, newReads = 0;
  const worldFor = (generation: number, read: () => void): GoalWorld => {
    const origin = { x: 100, y: 0, z: 15 }, pickup = { actor: identity.actor(50, generation), entity: 50,
      origin, bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } }, name: `Supply ${generation}`, utility: 100 };
    return { bspEntities: bsp, navigation, pointArea: () => 1, host: {
      trace: () => ({ fraction: 1 }), pointContents: () => 0, nextEntity: () => { read(); return 0; },
      entityInfo: () => { throw new Error("No visible item entities in restart fixture"); },
    }, sourcePickups: { candidates: () => { read(); return [pickup]; },
      inspect: (_client, actor) => { read(); return actor.equals(pickup.actor) ? pickup : null; } } };
  };
  try {
    expect(goals.setup()).toBe(GoalError.None);
    bsp.load('{ "classname" "worldspawn" } { "classname" "item_health" "origin" "100 0 15" }');
    const oldWorld = worldFor(0, () => { oldReads++; }), newWorld = worldFor(1, () => { newReads++; });
    goals.initLevelItems(oldWorld);
    const oldState = goals.allocGoalState(0);
    expect(goals.loadItemWeights(oldState, "weights.c")).toBe(GoalError.None);
    expect(goals.chooseLTGItem(oldState, { x: 0, y: 0, z: 0 }, [0], 0)).toBe(true);
    const oldGoal = goals.getTopGoal(oldState);
    if (oldGoal === null) throw new Error("Missing original pickup goal");
    expect(goals.sourceGoalStatus(0, oldGoal)).toBe("available");
    expect(() => goals.rebindWorld(newWorld)).toThrow("retired bot states");
    goals.freeGoalState(oldState);
    const before = memory.checkpoint().image, nativeGoal = goals.getLevelItemGoal(-1, "Health");
    const readsBefore = oldReads;
    goals.rebindWorld(newWorld);
    expect(memory.checkpoint().image).toEqual(before);
    expect(goals.getLevelItemGoal(-1, "Health")).toEqual(nativeGoal);
    expect(goals.sourceGoalStatus(0, oldGoal)).toBe("unavailable");
    goals.updateEntityItems();
    const state = goals.allocGoalState(0);
    expect(goals.loadItemWeights(state, "weights.c")).toBe(GoalError.None);
    expect(goals.chooseLTGItem(state, { x: 0, y: 0, z: 0 }, [0], 0)).toBe(true);
    const newGoal = goals.getTopGoal(state);
    if (newGoal === null) throw new Error("Missing restarted pickup goal");
    expect(newGoal.number).toBeLessThan(oldGoal.number);
    expect(goals.goalName(newGoal.number)).toBe("Supply 1");
    expect(goals.sourceGoalStatus(0, newGoal)).toBe("available");
    expect(goals.sourceGoalStatus(0, oldGoal)).toBe("unavailable");
    expect(oldReads).toBe(readsBefore);
    expect(newReads).toBeGreaterThan(0);
  } finally { goals.shutdown(); weights.shutdown(); reader.disposeResources(); memory.dispose(); }
});
