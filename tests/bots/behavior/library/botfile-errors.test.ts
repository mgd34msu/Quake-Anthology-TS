// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { BotAssetFiles } from "../../../../src/bots/behavior/assets.ts";
import { BotChatLibrary } from "../../../../src/bots/behavior/library/chat.ts";
import type { CallSteps } from "../../../../src/bots/behavior/library/call-steps.ts";
import { BotMemory } from "../../../../src/bots/behavior/library/memory.ts";
import { BotScriptSources } from "../../../../src/bots/behavior/library/script-sources.ts";
import { WeightConfigError, WeightConfigStore } from "../../../../src/bots/behavior/library/weights.ts";
import { ScriptGlobalDefines } from "../../../../src/content/legacy-script/preprocessor.ts";
import { literal } from "../../../support/literal.ts";

function sources(files: Readonly<Record<string, string>>, memory: BotMemory): BotScriptSources {
  const assets = new BotAssetFiles();
  for (const [path, text] of Object.entries(files)) assets.add(`botfiles/${path}`, new TextEncoder().encode(text));
  return new BotScriptSources(
    assets,
    new ScriptGlobalDefines(),
    () => undefined,
    () => undefined,
    memory,
  );
}
function chatLibrary(files: Readonly<Record<string, string>>, memory: BotMemory) {
  const reader = sources(files, memory);
  const chats = new BotChatLibrary(
    reader,
    {
      random: { nextInt: () => 0 },
      time: () => 0,
      *clientCommand(): CallSteps {
        return;
      },
    },
    {},
    memory,
  );
  return { reader, chats };
}

test("a non-integer case label fails the weight file load as a script error", () => {
  const memory = new BotMemory(),
    reader = sources({ "rules.c": 'weight "w" switch(0) { case 1.5: return 1; default: return 2; }' }, memory);
  const store = new WeightConfigStore(reader, { memory });
  try {
    expect(() => store.load("rules.c")).toThrow(WeightConfigError);
  } finally {
    store.shutdown();
    reader.disposeResources();
    memory.dispose();
  }
});

test("a synonym file with an unclosed context loads as no synonyms instead of ending setup", () => {
  const memory = new BotMemory(),
    { reader, chats } = chatLibrary({ "syn.c": '1 { [("do not",1),("don\'t",1)]' }, memory);
  try {
    expect(() => chats.setup()).not.toThrow();
    expect(chats.replaceSynonyms("don't", 1)).toBe("don't");
  } finally {
    chats.shutdown();
    reader.disposeResources();
    memory.dispose();
  }
});

test("a console print of 256 bytes or more matches against the truncated message", () => {
  const memory = new BotMemory(),
    { reader, chats } = chatLibrary({ "match.c": '1 { 0, " says ", 1 = (7,9); }' }, memory);
  try {
    chats.setup();
    for (const length of [255, 256, 400, 5000]) expect(() => chats.findMatch("x".repeat(length), 1)).not.toThrow();
    expect(chats.findMatch(`Sarge says ${"y".repeat(400)}`, 1)?.type).toBe(7);
  } finally {
    chats.shutdown();
    reader.disposeResources();
    memory.dispose();
  }
});

for (const [label, text] of literal([
  ["a decimal escape beyond the int range", '1 { [("\\99999999999",1)] }'],
  ["a string stringized beyond 1024 bytes", `1 { [("${"x".repeat(1100)}",1)] }`],
])) {
  test(`UI-004 ${label} fails that file's load instead of ending setup`, () => {
    const memory = new BotMemory(),
      { reader, chats } = chatLibrary({ "syn.c": text }, memory);
    try {
      expect(() => chats.setup()).not.toThrow();
    } finally {
      chats.shutdown();
      reader.disposeResources();
      memory.dispose();
    }
  });
}

for (const [label, text] of literal([
  ["a self-including file", '#include "syn.c"\n1 { [("a",1)] }'],
  [
    "a define chain that doubles forty times",
    `#define D0 x x\n#define D1 D0 D0\n#define D2 D1 D1\n#define D3 D2 D2\n#define D4 D3 D3\n#define D5 D4 D4\n#define D6 D5 D5\n#define D7 D6 D6\n#define D8 D7 D7\n#define D9 D8 D8\n#define D10 D9 D9\n#define D11 D10 D10\n#define D12 D11 D11\n#define D13 D12 D12\n#define D14 D13 D13\n#define D15 D14 D14\n#define D16 D15 D15\n#define D17 D16 D16\n#define D18 D17 D17\n#define D19 D18 D18\n#define D20 D19 D19\n#define D21 D20 D20\n#define D22 D21 D21\n#define D23 D22 D22\n#define D24 D23 D23\n#define D25 D24 D24\n#define D26 D25 D25\n#define D27 D26 D26\n#define D28 D27 D27\n#define D29 D28 D28\n#define D30 D29 D29\n#define D31 D30 D30\n#define D32 D31 D31\n#define D33 D32 D32\n#define D34 D33 D33\n#define D35 D34 D34\n#define D36 D35 D35\n#define D37 D36 D36\n#define D38 D37 D37\n#define D39 D38 D38\n1 { [("a",1)] D39 }`.replaceAll(
      "\\n",
      "\n",
    ),
  ],
])) {
  test(`UI-013 ${label} loads within the preprocessor limits instead of hanging`, () => {
    const memory = new BotMemory(),
      { reader, chats } = chatLibrary({ "syn.c": text }, memory);
    try {
      expect(() => chats.setup()).not.toThrow();
    } finally {
      chats.shutdown();
      reader.disposeResources();
      memory.dispose();
    }
  }, 20000);
}
