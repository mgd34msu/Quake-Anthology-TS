import { expect, test } from "bun:test";
import { BotMemory } from "../../../../src/bots/behavior/library/memory.ts";
import { BotLibVars } from "../../../../src/bots/behavior/library/libvars.ts";
import { BotActionBuffer } from "../../../../src/bots/behavior/library/actions.ts";
import { BotMoveStateStore } from "../../../../src/bots/behavior/q3/movement-state.ts";
import { BotAssetFiles } from "../../../../src/bots/behavior/assets.ts";
import { BotScriptSources } from "../../../../src/bots/behavior/library/script-sources.ts";
import { WeightConfigStore } from "../../../../src/bots/behavior/library/weights.ts";
import { ScriptGlobalDefines } from "../../../../src/ui/common/legacy/script/preprocessor.ts";
import { BotChatLibrary } from "../../../../src/bots/behavior/library/chat.ts";

test("chat checkpoint preserves shared cooldowns, console lists and matching graph without replay", () => {
  const files = new BotAssetFiles();
  for (const [name, text] of Object.entries({ "syn.c": '1 { [("do not",1),("don\'t",1)] }',
    "rnd.c": 'greeting = { "first"; "last"; }', "match.c": '1 { 0, " says ", 1 = (7,9); }',
    "rchat.c": '["hello"] = 5 { "hello"; }',
    "test_t.c": 'chat "test" { type "hello" { "first"; "last"; } }' })) files.add(`botfiles/${name}`, new TextEncoder().encode(text));
  let randomCalls = 0;
  const host = { random: { nextInt: () => { randomCalls++; return 0; } }, time: () => 10, *clientCommand() { return undefined; } };
  const memory = new BotMemory(), reader = new BotScriptSources(files, new ScriptGlobalDefines(), () => undefined, () => undefined, memory);
  const chats = new BotChatLibrary(reader, host, {}, memory); chats.setup();
  const first = chats.allocate(), second = chats.allocate();
  chats.loadChatFile(first, "test_t.c", "test"); chats.loadChatFile(second, "test_t.c", "test");
  chats.initialChat(first, "hello", 0);
  const capture = memory.checkpoint(), image = chats.checkpoint(capture), before = randomCalls;
  memory.dispose();
  const restoredMemory = new BotMemory(), allocations = restoredMemory.restore(capture.image);
  const restoredReader = new BotScriptSources(files, new ScriptGlobalDefines(), () => undefined, () => undefined, restoredMemory);
  const restored = new BotChatLibrary(restoredReader, host, {}, restoredMemory); restored.restore(image, allocations);
  expect(randomCalls).toBe(before);
  expect(restored.getChatMessage(first)).toBe("last");
  restored.initialChat(second, "hello", 0);
  expect(restored.getChatMessage(second)).toBe("first");
  expect(restored.findMatch("Sarge says hello", 1)?.type).toBe(7);
  restoredMemory.dispose();
});

test("fuzzy checkpoint preserves evolved branches and cached configuration identity", () => {
  const files = new BotAssetFiles();
  files.add("botfiles/rules.c", new TextEncoder().encode('weight "test" switch(0) { case 1: return balance(4,2,6); default: return 12; }'));
  const memory = new BotMemory(), reader = new BotScriptSources(files, new ScriptGlobalDefines(), () => undefined, () => undefined, memory);
  const weights = new WeightConfigStore(reader, { memory }), config = weights.load("rules.c");
  config.scaleWeight("test", 0.3); config.evolve({ nextInt: () => 12345 });
  const reference = weights.reference(config), before = config.evaluate(0, [0]), capture = memory.checkpoint(), image = weights.checkpoint(capture);
  memory.dispose();
  const restoredMemory = new BotMemory(), allocations = restoredMemory.restore(capture.image);
  const restoredReader = new BotScriptSources(files, new ScriptGlobalDefines(), () => undefined, () => undefined, restoredMemory);
  const restored = new WeightConfigStore(restoredReader, { memory: restoredMemory }); restored.restore(image, allocations);
  expect(restored.resolve(reference).evaluate(0, [0])).toBe(before);
  expect(restored.load("rules.c")).toBe(restored.resolve(reference));
  expect(restored.checkpoint(restoredMemory.checkpoint())).toEqual(image);
  restoredMemory.dispose();
});

test("bot allocation references restore variable aliases, action bytes and movement handles after disposal", () => {
  const memory = new BotMemory(), variables = new BotLibVars(memory);
  const actions = new BotActionBuffer(4, { *clientCommand() { return undefined; } }, memory);
  const movement = new BotMoveStateStore({ time: () => 0, print: () => undefined,
    libVar: (name, value) => variables.getOrCreate(name, value) }, memory);
  movement.setup();
  variables.set("sv_gravity", "743.25"); variables.setNotModified("sv_gravity");
  const handle = movement.allocate(), state = movement.fromHandle(handle);
  if (state === null) throw new Error("Missing allocated move state");
  state.client = 2; state.origin = { x: 12.25, y: -0, z: 77 };
  state.avoidReach[0] = 91; state.avoidReachTimes[0] = 4.25;
  actions.move(2, { x: 1, y: 0, z: 0 }, 213);
  const input = actions.getInput(2, 0.25), capture = memory.checkpoint();
  const savedVariables = variables.checkpoint(capture), savedActions = actions.checkpoint(capture), savedMovement = movement.checkpoint(capture, variables);
  memory.dispose();
  expect(() => state.origin.x).toThrow();
  const restoredMemory = new BotMemory(), allocations = restoredMemory.restore(capture.image);
  const restoredVariables = new BotLibVars(restoredMemory);
  restoredVariables.restore(savedVariables, allocations);
  const restoredActions = new BotActionBuffer(null, { *clientCommand() { return undefined; } }, restoredMemory);
  restoredActions.restore(savedActions, allocations);
  const restoredMovement = new BotMoveStateStore({ time: () => 0, print: () => undefined,
    libVar: (name, value) => restoredVariables.getOrCreate(name, value) }, restoredMemory);
  restoredMovement.restore(savedMovement, allocations, restoredVariables, () => null);
  expect(restoredActions.getInput(2, 0.25)).toEqual(input);
  const restoredState = restoredMovement.fromHandle(handle);
  if (restoredState === null) throw new Error("Restored move handle missing");
  expect(restoredState.origin.x).toBe(12.25); expect(Object.is(restoredState.origin.y, -0)).toBe(true);
  expect(restoredState.avoidReach[0]).toBe(91); expect(restoredState.avoidReachTimes[0]).toBe(4.25);
  expect(restoredMovement.svGravity).toBe(restoredVariables.get("sv_gravity"));
  expect(restoredVariables.changed("sv_gravity")).toBe(false);
  restoredVariables.set("sv_gravity", "812");
  expect(restoredMovement.svGravity?.value).toBe(812);
  expect(restoredMovement.allocate()).toBe(handle + 1);
  restoredMemory.dispose();
});
