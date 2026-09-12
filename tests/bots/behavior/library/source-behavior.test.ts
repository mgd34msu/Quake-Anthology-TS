import { expect, test } from "bun:test";
import { BotAssetFiles } from "../../../../src/bots/behavior/assets.ts";
import { BotActionBuffer, BotActionFlag } from "../../../../src/bots/behavior/library/actions.ts";
import { AasBspEntities } from "../../../../src/bots/behavior/library/bsp-entities.ts";
import type { CallSteps } from "../../../../src/bots/behavior/library/call-steps.ts";
import { BotChatLibrary, ChatDestination } from "../../../../src/bots/behavior/library/chat.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { BotGoalLibrary, GoalError, isSourceGoalNumber } from "../../../../src/bots/behavior/library/goals.ts";
import type { GoalEntityInfo, GoalNavigation, GoalWorldHost, SourcePickupGoals } from "../../../../src/bots/behavior/library/goals.ts";
import { BotMemory } from "../../../../src/bots/behavior/library/memory.ts";
import { BotScriptSources } from "../../../../src/bots/behavior/library/script-sources.ts";
import { WeightConfigStore } from "../../../../src/bots/behavior/library/weights.ts";
import { ScriptGlobalDefines } from "../../../../src/ui/common/legacy/script/preprocessor.ts";

function sources(files: Readonly<Record<string, string>>, memory: BotMemory): BotScriptSources {
  const assets = new BotAssetFiles();
  for (const [path, text] of Object.entries(files)) assets.add(`botfiles/${path}`, new TextEncoder().encode(text));
  return new BotScriptSources(assets, new ScriptGlobalDefines(), (_severity, text) => { throw new Error(text); }, () => undefined, memory);
}

test("fuzzy weights retain source integer interpolation, recursive branches, and masked host random draws", () => {
  const memory = new BotMemory(), reader = sources({
    "rules.c": 'weight "linear" switch(0) { case 0: return 10; case 10: return 20; default: return 30; }\n'
      + 'weight "uncertain" switch(0) { case 0: return balance(4,2,6); case 10: { switch(1) { default: return 100; } } default: return 20; }\n'
      + 'weight "range" return balance(4,2,6);',
  }, memory), store = new WeightConfigStore(reader, { memory });
  try {
    const config = store.load("rules.c");
    expect(config.evaluate(0, [5, 0])).toBe(20);
    expect(config.evaluate(0, [10, 0])).toBe(30);
    expect(config.evaluate(0, [-1, 0])).toBe(10);
    let calls = 0;
    expect(config.evaluateUndecided(1, [5, 0], { nextInt: () => { calls++; return 1_804_289_383; } })).toBe(100);
    expect(calls).toBe(1);
    expect(config.evaluateUndecided(2, [0, 0], { nextInt: () => 0x17fff })).toBe(6);
    expect(config.evaluateUndecided(2, [0, 0], { nextInt: () => 0 })).toBe(2);
  } finally { store.shutdown(); reader.disposeResources(); memory.dispose(); }
});

test("chat uses caller time, shared cooldowns, context matches, and caller-owned command dispatch", () => {
  const memory = new BotMemory(), reader = sources({
    "syn.c": '1 { [("do not",1),("don\'t",1)] }',
    "rnd.c": 'greeting = { "first"; "last"; }',
    "match.c": '1 { 0, " says ", 1 = (7,9); }',
    "rchat.c": '["hello"] = 5 { "hello"; }',
    "test_t.c": 'chat "test" { type "hello" { "first"; "last"; } type "compose" { 0, ", ", greeting; } }',
  }, memory);
  let now = 10;
  const commands: { readonly client: number; readonly command: string }[] = [];
  const chats = new BotChatLibrary(reader, { random: { nextInt: () => 0 }, time: () => now,
    *clientCommand(client, command): CallSteps { commands.push({ client, command }); } }, {}, memory);
  try {
    chats.setup();
    const first = chats.allocate(), second = chats.allocate();
    expect(chats.loadChatFile(first, "test_t.c", "test")).toBe(true);
    expect(chats.loadChatFile(second, "test_t.c", "test")).toBe(true);
    chats.initialChat(first, "hello", 0);
    expect(chats.getChatMessage(first)).toBe("last");
    chats.initialChat(second, "hello", 0);
    expect(chats.getChatMessage(second)).toBe("first");
    now = 50;
    chats.initialChat(second, "hello", 0);
    expect(chats.getChatMessage(second)).toBe("last");
    const match = chats.findMatch("Sarge says hello", 1);
    if (match === null) throw new Error("Expected source context match");
    expect(match.type).toBe(7);
    expect(chats.matchVariable(match, 0)).toBe("Sarge");
    expect(chats.matchVariable(match, 1)).toBe("hello");
    expect(chats.findMatch("Sarge says hello", 2)).toBeNull();
    expect(chats.replaceSynonyms("don't", 1)).toBe("do not");
    expect(chats.replaceSynonyms("don't", 2)).toBe("don't");
    chats.setName(first, "Sarge", 4);
    chats.initialChat(first, "compose", 0, ["Ranger", null, null, null, null, null, null, null]);
    chats.enterChat(first, 0, ChatDestination.Team);
    expect(commands).toEqual([{ client: 4, command: "say_team Ranger, last" }]);
    chats.queueConsoleMessage(first, 2, "incoming");
    now = 51;
    const message = chats.nextConsoleMessage(first);
    expect(message).toMatchObject({ time: 50, type: 2, message: "incoming" });
    if (message === null) throw new Error("Expected queued source message");
    chats.removeConsoleMessage(first, message.handle);
    expect(chats.nextConsoleMessage(first)).toBeNull();
  } finally { chats.shutdown(); reader.disposeResources(); memory.dispose(); }
});

test("item goals combine source weights, borrowed route costs, and source respawn avoidance", () => {
  const memory = new BotMemory(), reader = sources({
    "items.c": 'iteminfo "item_health" { name "Health" modelindex 5 respawntime 35 mins {-15,-15,-15} maxs {15,15,15} }\n'
      + 'iteminfo "item_armor" { name "Armor" modelindex 6 respawntime 25 mins {-15,-15,-15} maxs {15,15,15} }\n'
      + 'iteminfo "weapon_shotgun" { name "Shotgun" modelindex 7 respawntime 30 mins {-15,-15,-15} maxs {15,15,15} }',
    "weights.c": 'weight "item_health" return 10; weight "item_armor" return 30; weight "weapon_shotgun" return balance(150,100,200);',
  }, memory), weightStore = new WeightConfigStore(reader, { memory });
  let now = 50, randomCalls = 0;
  const library = new BotGoalLibrary({ memory, resolver: reader, weightStore, log: { write() {} }, clock: () => now,
    gameType: () => 0, random: { nextInt: () => { randomCalls++; return 0; } } });
  const bspEntities = new AasBspEntities(() => {}, memory);
  const entities = new Map<number, GoalEntityInfo>();
  for (const [entity, x, modelIndex] of [[1, 100, 5], [2, 200, 6]]) {
    if (entity === undefined || x === undefined || modelIndex === undefined) throw new Error("Missing goal fixture field");
    const origin = { x, y: 0, z: 15 };
    entities.set(entity, { origin, lastVisibleOrigin: origin, lastUpdateTime: 50, type: 2, modelIndex });
  }
  const host: GoalWorldHost = { trace: () => ({ fraction: 1 }), pointContents: () => 0,
    nextEntity: after => after < 2 ? after + 1 : 0,
    entityInfo: entity => { const value = entities.get(entity); if (value === undefined) throw new Error("Missing item entity"); return value; } };
  const routes: number[] = [];
  const navigation: GoalNavigation = { area: () => ({ contents: 0, reachableAreaCount: 1 }),
    bestReachableFromJumpPadArea: () => 0, dropToFloor: origin => ({ origin, success: true }),
    bestReachableArea: origin => ({ area: origin.x === 100 ? 2 : 3, origin }), reachabilityArea: () => 1,
    route: query => { routes.push(query.goalArea); return { kind: "found", travelTime: query.goalArea === 2 ? 100 : 200 }; } };
  try {
    expect(library.setup()).toBe(GoalError.None);
    bspEntities.load('{ "classname" "worldspawn" } { "classname" "item_health" "origin" "100 0 15" } { "classname" "item_armor" "origin" "200 0 15" }');
    library.initLevelItems({ bspEntities, navigation, host, pointArea: () => 1 });
    library.updateEntityItems();
    const state = library.allocGoalState(0);
    expect(library.loadItemWeights(state, "weights.c")).toBe(GoalError.None);
    expect(library.chooseLTGItem(state, { x: 0, y: 0, z: 0 }, [0], 0)).toBe(true);
    expect(library.getTopGoal(state)?.entity).toBe(2);
    expect(library.avoidGoalTime(state, 2)).toBe(25);
    now = 51;
    expect(library.avoidGoalTime(state, 2)).toBe(24);
    expect(library.chooseLTGItem(state, { x: 0, y: 0, z: 0 }, [0], 0)).toBe(true);
    expect(library.getTopGoal(state)?.entity).toBe(1);
    expect(library.avoidGoalTime(state, 1)).toBe(35);
    expect(routes).toEqual([3, 2, 3, 2]);
    const identity = createIdentityOwner("source-pickup-goals");
    let generation = 0, useful = true;
    const sourcePickups: SourcePickupGoals = {
      candidates: () => [{ actor: identity.actor(50, generation), entity: 50, origin: { x: 200, y: 0, z: 15 },
        bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } }, name: "Shell supply", utility: 100 }],
      inspect: (_client, actor) => useful && actor.equals(identity.actor(50, generation)) ? {
        actor: identity.actor(50, generation), entity: 50, origin: { x: 200, y: 0, z: 15 },
        bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } }, name: "Shell supply", utility: 100,
      } : null,
    };
    const world = { bspEntities, navigation, host, pointArea: () => 1, sourcePickups };
    library.initLevelItems(world); library.updateEntityItems();
    expect(library.chooseLTGItem(state, { x: 0, y: 0, z: 0 }, [0], 0)).toBe(true);
    const source = library.getTopGoal(state);
    if (source === null) throw new Error("Source pickup was not pushed on the common stack");
    expect(source.number).toBe(0x7fffffff);
    expect(isSourceGoalNumber(source.number)).toBe(true);
    expect(library.goalName(source.number)).toBe("Shell supply");
    expect(library.getLevelItemGoal(-1, "Shell supply")?.number).toBe(source.number);
    expect(library.getLevelItemGoal(source.number, "Shell supply")).toBeNull();
    expect(library.avoidGoalTime(state, source.number)).toBe(0);
    expect(library.sourceGoalStatus(0, source)).toBe("available");
    expect(library.itemGoalInVisButNotVisible(0, source.origin, source.origin, source)).toBe(false);
    library.setAvoidGoalTime(state, source.number, 5);
    expect(library.chooseLTGItem(state, { x: 0, y: 0, z: 0 }, [0], 0)).toBe(false);
    library.removeFromAvoidGoals(state, source.number);
    expect(library.chooseNBGItem(state, { x: 0, y: 0, z: 0 }, [0], 0, null, 201)).toBe(true);
    expect(library.getTopGoal(state)?.number).toBe(source.number);
    useful = false;
    expect(library.sourceGoalStatus(0, source)).toBe("unavailable");
    expect(library.itemGoalInVisButNotVisible(0, source.origin, source.origin, source)).toBe(true);
    useful = true; generation++;
    expect(library.sourceGoalStatus(0, source)).toBe("unavailable");
    expect(library.chooseLTGItem(state, { x: 0, y: 0, z: 0 }, [0], 0)).toBe(true);
    const replacement = library.getTopGoal(state);
    if (replacement === null) throw new Error("Replacement pickup missing");
    expect(replacement.number).toBe(source.number - 1);
    library.initLevelItems(world); library.updateEntityItems();
    expect(library.sourceGoalStatus(0, replacement)).toBe("unavailable");
    expect(library.chooseLTGItem(state, { x: 0, y: 0, z: 0 }, [0], 0)).toBe(true);
    expect(library.getTopGoal(state)?.number).toBe(replacement.number - 1);
    let retireDuringReach = false;
    library.initLevelItems({ ...world, navigation: { ...navigation, bestReachableArea: (origin, bounds) => {
      if (retireDuringReach) { retireDuringReach = false; library.initLevelItems(world); }
      return navigation.bestReachableArea(origin, bounds);
    } } });
    library.updateEntityItems(); retireDuringReach = true;
    expect(library.chooseLTGItem(state, { x: 0, y: 0, z: 0 }, [0], 0)).toBe(false);
    expect(library.getLevelItemGoal(-1, "Shell supply")).toBeNull();
    expect(library.chooseLTGItem(state, { x: 0, y: 0, z: 0 }, [0], 0)).toBe(true);
    expect(library.getTopGoal(state)?.number).toBe(replacement.number - 2);
    library.emptyGoalStack(state);
    let projectingSource = false;
    library.initLevelItems({ ...world, sourcePickups: { ...sourcePickups, inspect: (client, actor) => {
      const pickup = sourcePickups.inspect(client, actor);
      return pickup === null ? null : { ...pickup, bounds: { min: { x: -8, y: -8, z: 0 }, max: { x: 8, y: 8, z: 56 } } };
    } }, navigation: { ...navigation, bestReachableArea: (origin, bounds) => {
      if (!projectingSource) return navigation.bestReachableArea(origin, bounds);
      expect(origin).toEqual({ x: 200, y: 0, z: 43 });
      expect(bounds).toEqual({ min: { x: -8, y: -8, z: -28 }, max: { x: 8, y: 8, z: 28 } });
      return { area: 3, origin: { ...origin, z: 39 } };
    } } });
    library.updateEntityItems(); projectingSource = true;
    expect(library.chooseLTGItem(state, { x: 0, y: 0, z: 0 }, [0], 0)).toBe(true);
    const anchored = library.getTopGoal(state);
    if (anchored === null) throw new Error("Bottom-anchored source pickup missing");
    expect(anchored.origin).toEqual({ x: 200, y: 0, z: 39 });
    expect(anchored.mins).toEqual({ x: -8, y: -8, z: -24 });
    expect(anchored.maxs).toEqual({ x: 8, y: 8, z: 32 });
    bspEntities.load('{ "classname" "worldspawn" } { "classname" "item_health" "origin" "100 0 15" } { "classname" "weapon_shotgun" "origin" "200 0 15" }');
    const weaponOrigin = { x: 200, y: 0, z: 15 };
    entities.set(2, { origin: weaponOrigin, lastVisibleOrigin: weaponOrigin, lastUpdateTime: now, type: 2, modelIndex: 7 });
    let supplyAvailable = false;
    const mappedPickups: SourcePickupGoals = {
      candidates: client => supplyAvailable ? sourcePickups.candidates(client).map(pickup => ({ ...pickup, entity: 2 })) : [],
      inspect: (client, actor) => {
        const pickup = supplyAvailable ? sourcePickups.inspect(client, actor) : null;
        return pickup === null ? null : { ...pickup, entity: 2 };
      },
    };
    const unownedWorld = { ...world, sourcePickups: mappedPickups };
    library.initLevelItems(unownedWorld); library.updateEntityItems(); library.resetGoalState(state); randomCalls = 0;
    expect(library.chooseLTGItem(state, { x: 0, y: 0, z: 0 }, [0], 0)).toBe(true);
    const nativeWeapon = library.getTopGoal(state);
    if (nativeWeapon === null) throw new Error("Linked native weapon goal missing");
    expect(nativeWeapon.entity).toBe(2); expect(isSourceGoalNumber(nativeWeapon.number)).toBe(false);
    expect(randomCalls).toBe(2);
    const ownershipCalls: (readonly [number, number])[] = [];
    const ownedWorld = { ...unownedWorld, sourcePickups: { ...mappedPickups, ownsItemGoal: (client: number, entity: number) => {
      ownershipCalls.push([client, entity]); return entity === 2;
    } } };
    library.initLevelItems(ownedWorld); library.updateEntityItems(); library.resetGoalState(state); randomCalls = 0;
    expect(library.chooseLTGItem(state, { x: 0, y: 0, z: 0 }, [0], 0)).toBe(true);
    expect(library.getTopGoal(state)?.entity).toBe(1);
    expect(randomCalls).toBe(1); expect(ownershipCalls).toEqual([[0, 2], [0, 1]]);
    expect(library.goalName(nativeWeapon.number)).toBe("Shotgun");
    expect(library.getLevelItemGoal(-1, "Shotgun")?.entity).toBe(2);
    supplyAvailable = true; library.resetGoalState(state); randomCalls = 0;
    expect(library.chooseNBGItem(state, { x: 0, y: 0, z: 0 }, [0], 0, null, 201)).toBe(true);
    const mapped = library.getTopGoal(state);
    if (mapped === null) throw new Error("Mapped weapon supply goal missing");
    expect(mapped.entity).toBe(2); expect(isSourceGoalNumber(mapped.number)).toBe(true);
    expect(randomCalls).toBe(1);
    library.initLevelItems({ ...unownedWorld, sourcePickups: { ...mappedPickups, ownsItemGoal: () => {
      library.initLevelItems(unownedWorld); return true;
    } } });
    library.updateEntityItems(); library.resetGoalState(state); randomCalls = 0;
    expect(library.chooseLTGItem(state, { x: 0, y: 0, z: 0 }, [0], 0)).toBe(false);
    expect(library.getTopGoal(state)).toBeNull(); expect(randomCalls).toBe(0);
  } finally { library.shutdown(); weightStore.shutdown(); reader.disposeResources(); memory.dispose(); }
});

test("elementary actions retain jump edge semantics, binary32 fields, and hunk ownership", () => {
  const memory = new BotMemory(), commands: string[] = [];
  const actions = new BotActionBuffer(1, { *clientCommand(_client, command): CallSteps { commands.push(command); } }, memory);
  actions.selectWeapon(0, 5); actions.move(0, { x: 1, y: 0, z: 0 }, 500); actions.jump(0);
  expect(actions.getInput(0, 0.1)).toMatchObject({ speed: 400, weapon: 5, thinkTime: Math.fround(0.1), actionFlags: BotActionFlag.JUMP });
  actions.resetInput(0); actions.jump(0);
  expect(actions.getInput(0, 0).actionFlags & BotActionFlag.JUMP).toBe(0);
  actions.resetInput(0); actions.delayedJump(0);
  expect(actions.getInput(0, 0).actionFlags).toBe(BotActionFlag.DELAYED_JUMP);
  actions.sayTeam(0, "defend");
  expect(commands).toEqual(["say_team defend"]);
  actions.shutdown();
  expect(memory.liveAllocations).toBe(1);
  memory.resetHunk();
  expect(memory.liveAllocations).toBe(0);
  memory.dispose();
});

test("bot memory borrows actual host capacity and releases heap and hunk at their respective boundaries", () => {
  let available = 100;
  const releases: string[] = [];
  const memory = new BotMemory({ host: {
    allocate: (size) => { available -= size; return { bytes: new Uint8Array(size) }; },
    release: (allocation, kind) => { available += allocation.bytes.length; releases.push(kind); }, availableMemory: () => available,
  } });
  const heap = memory.allocate(8, "heap", true), hunk = memory.allocate(16, "hunk", false);
  expect(memory.availableMemory()).toBe(68);
  memory.free(hunk);
  expect(hunk.bytes.length).toBe(16);
  memory.free(heap);
  expect(() => heap.bytes).toThrow("freed");
  expect(memory.availableMemory()).toBe(80);
  memory.resetHunk(); memory.dispose(); memory.dispose();
  expect(releases).toEqual(["heap", "hunk"]);
  expect(memory.availableMemory()).toBe(100);
});
