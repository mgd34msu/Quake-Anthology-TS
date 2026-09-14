import { expect, test } from "bun:test";
import { BotMemory } from "../../../src/bots/behavior/library/memory.ts";
import { BotScriptSources } from "../../../src/bots/behavior/library/script-sources.ts";
import { ScriptGlobalDefines } from "../../../src/ui/common/legacy/script/preprocessor.ts";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../../src/persistence/value.ts";

const disk = (value: unknown): unknown => decodeCheckpointValue(encodeCheckpointValue(value));

test("open parser handles continue macros, include stack, conditionals and source token storage", () => {
  const files = new Map([ ["root", "#define TWICE(x) x x\n#if GLOBAL\n#include \"child\"\nroot_tail\n#endif\n"], ["child", "#define CHILD 41\nTWICE(CHILD) child_tail\n"] ]);
  let reads = 0;
  const assets = { read: (path: string) => { reads++; const text = files.get(path); return text === undefined ? null : new TextEncoder().encode(text); } };
  const memory = new BotMemory(), globals = new ScriptGlobalDefines(undefined, memory);
  globals.add("GLOBAL 1");
  const sources = new BotScriptSources(assets, globals, () => undefined, () => undefined, memory);
  const handle = sources.loadSourceHandle("root"); expect(handle).toBe(1);
  expect(sources.readTokenHandle(handle)?.token.text).toBe("41");
  const memoryImage = memory.checkpoint(), image = disk(sources.captureSaveState(memoryImage));
  const suffix = () => { const result: string[] = []; for (;;) { const token = sources.readTokenHandle(handle); if (token === undefined) return result; result.push(token.token.text); } };
  const expected = suffix(); expect(expected).toEqual(["41", "child_tail", "root_tail"]);
  sources.disposeResources(); globals.clear(); memory.dispose();
  const restoredMemory = new BotMemory(), allocation = restoredMemory.restore(memoryImage.image);
  const restoredGlobals = new ScriptGlobalDefines(undefined, restoredMemory);
  const restored = new BotScriptSources(assets, restoredGlobals, () => undefined, () => undefined, restoredMemory);
  const before = reads; restored.restoreSaveState(image, allocation); expect(reads).toBe(before);
  expect(restoredMemory.liveAllocations).toBe(memoryImage.image.allocations.length);
  const actual: string[] = []; for (;;) { const token = restored.readTokenHandle(handle); if (token === undefined) break; actual.push(token.token.text); }
  expect(actual).toEqual(expected); expect(reads).toBe(before);
  expect(restored.freeSourceHandle(handle)).toBe(true);
  expect(restored.loadSourceHandle("root")).toBe(1);
  expect(restored.readTokenHandle(handle)?.token.text).toBe("41");
  restored.disposeResources(); restoredGlobals.clear(); expect(restoredMemory.liveAllocations).toBe(0); restoredMemory.dispose();
});

test("parser rejects token image disagreement with its saved allocation", () => {
  const memory = new BotMemory(), globals = new ScriptGlobalDefines(undefined, memory);
  const assets = { read: () => new TextEncoder().encode("one two") };
  const sources = new BotScriptSources(assets, globals, () => undefined, () => undefined, memory);
  const handle = sources.loadSourceHandle("root"); sources.readTokenHandle(handle);
  const allocationImage = memory.checkpoint(), image = sources.captureSaveState(allocationImage), source = image.sourceFiles[handle];
  if (source === undefined || source === null) throw new Error("missing source image");
  source.source.token.token.bytes[0] = 99;
  const candidateMemory = new BotMemory(), restoredAllocations = candidateMemory.restore(allocationImage.image);
  const candidate = new BotScriptSources(assets, new ScriptGlobalDefines(undefined, candidateMemory), () => undefined, () => undefined, candidateMemory);
  expect(() => candidate.restoreSaveState(disk(image), restoredAllocations)).toThrow("disagree");
  expect(sources.readTokenHandle(handle)?.token.text).toBe("two");
  sources.disposeResources(); globals.clear(); memory.dispose(); candidateMemory.dispose();
});
