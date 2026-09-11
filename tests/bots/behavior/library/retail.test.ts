import { beforeAll, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { BotAssetFiles } from "../../../../src/bots/behavior/assets.ts";
import { BotCharacterLibrary, Characteristic } from "../../../../src/bots/behavior/library/character.ts";
import { BotChatLibrary } from "../../../../src/bots/behavior/library/chat.ts";
import type { CallSteps } from "../../../../src/bots/behavior/library/call-steps.ts";
import { BotMemory } from "../../../../src/bots/behavior/library/memory.ts";
import { BotScriptSources } from "../../../../src/bots/behavior/library/script-sources.ts";
import { WeaponAi, WeaponLoadResult } from "../../../../src/bots/behavior/library/weapons.ts";
import { WeightConfigStore } from "../../../../src/bots/behavior/library/weights.ts";
import { loadItemConfig } from "../../../../src/bots/behavior/library/goals.ts";
import { ScriptGlobalDefines } from "../../../../src/ui/common/legacy/script/preprocessor.ts";

const root = process.env["Q3_DATA"] ?? "/home/buzzkill/Projects/qfiles/q3a";
const available = existsSync(join(root, "baseq3/pak0.pk3")) && existsSync(join(root, "missionpack/pak0.pk3"));
const products = new Map<string, BotAssetFiles>();

beforeAll(async () => {
  if (!available) return;
  for (const product of ["baseq3", "missionpack"]) {
    const files = new BotAssetFiles();
    for (const directory of product === "missionpack" ? ["baseq3", "missionpack"] : ["baseq3"]) {
      for (const archiveName of readdirSync(join(root, directory)).filter(name => name.endsWith(".pk3")).sort()) {
        const archive = await openArchive(join(root, directory, archiveName));
        try {
          for (const entry of archive.entries) {
            if (!entry.isDirectory && entry.path.startsWith("botfiles/")) files.add(entry.path, await archive.readEntry(entry));
          }
        } finally { archive.close(); }
      }
    }
    products.set(product, files);
  }
});

function sources(files: BotAssetFiles, memory: BotMemory): BotScriptSources {
  return new BotScriptSources(files, new ScriptGlobalDefines(), (_severity, text) => { throw new Error(text); }, () => undefined, memory);
}

test.skipIf(!available)("retail Sarge skill interpolation preserves floats, strings, and lower-skill integers", () => {
  for (const files of products.values()) {
    const memory = new BotMemory(), reader = sources(files, memory), characters = new BotCharacterLibrary(reader, { memory });
    try {
      const easy = characters.load("bots/sarge_c.c", 1), medium = characters.load("bots/sarge_c.c", 2.5), hard = characters.load("bots/sarge_c.c", 4);
      expect([easy, medium, hard].every(handle => handle > 0)).toBe(true);
      expect(characters.string(medium, Characteristic.Name)).toBe("Sarge");
      expect(characters.float(easy, Characteristic.AttackSkill)).toBe(0.5);
      expect(characters.float(hard, Characteristic.AttackSkill)).toBe(0.75);
      expect(characters.float(medium, Characteristic.AttackSkill)).toBe(0.625);
      expect(characters.float(medium, Characteristic.ReactionTime)).toBe(1.5);
      expect(characters.integer(medium, Characteristic.ViewMaxChange)).toBe(180);
      expect(characters.string(medium, Characteristic.ItemWeights)).toBe("bots/sarge_i.c");
    } finally { characters.shutdown(); reader.disposeResources(); memory.dispose(); }
    expect(memory.liveAllocations).toBe(0);
  }
});

test.skipIf(!available)("retail weapon and item structures drive the original inventory weight choices", () => {
  for (const [product, files] of products) {
    const memory = new BotMemory(), reader = sources(files, memory), weights = new WeightConfigStore(reader, { memory });
    const weapons = new WeaponAi({ resolver: reader, weights }, { memory });
    try {
      expect(weapons.setup()).toBe(WeaponLoadResult.NoError);
      expect(weapons.config?.definedWeaponCount).toBe(12);
      expect(weapons.config?.projectiles).toHaveLength(12);
      expect(weapons.config?.weapons[1]?.projectileInfo.damage).toBe(50);
      expect(weapons.config?.weapons[5]).toMatchObject({ name: "Rocket Launcher", speed: 900, projectileInfo: { damage: 100, radius: 120, damageType: 3 } });
      if (product === "missionpack") expect(weapons.config?.weapons[13]?.name).toBe("Chaingun");
      const state = weapons.allocateState();
      expect(weapons.loadWeights(state, "bots/anarki_w.c")).toBe(WeaponLoadResult.NoError);
      const inventory = new Array<number>(256).fill(1);
      expect(weapons.chooseBestFightWeapon(state, inventory)).toBe(5);
      inventory[8] = 0;
      expect(weapons.chooseBestFightWeapon(state, inventory)).toBe(7);
      const items = loadItemConfig(reader, "items.c", { memory });
      const health = items.items.find(item => item.classname === "item_health");
      expect(health?.name).toBe("25 Health");
      expect(health?.respawnTime).toBe(30);
      const itemWeights = weights.load("bots/sarge_i.c");
      expect(itemWeights.find("item_health")).toBeGreaterThanOrEqual(0);
      expect(itemWeights.weightCount).toBeGreaterThan(20);
      items.free();
    } finally { weapons.shutdown(); weights.shutdown(); reader.disposeResources(); memory.dispose(); }
    expect(memory.liveAllocations).toBe(0);
  }
});

test.skipIf(!available)("retail chat loads shared context tables and expands Sarge's include and variable syntax", () => {
  for (const files of products.values()) {
    const memory = new BotMemory(), reader = sources(files, memory);
    const chats = new BotChatLibrary(reader, { random: { nextInt: () => 0 }, time: () => 100,
      *clientCommand(): CallSteps {} }, {}, memory);
    try {
      chats.setup();
      expect(chats.configurationCounts).toEqual({ synonyms: 191, randomLists: 249, matches: 182, replies: 457 });
      const state = chats.allocate();
      expect(chats.loadChatFile(state, "bots/sarge_t.c", "sarge")).toBe(true);
      const initial = chats.dumpInitialChat(state);
      expect(initial?.types).toHaveLength(99);
      expect(initial?.types.reduce((sum, type) => sum + type.messages.length, 0)).toBe(395);
      chats.initialChat(state, "hit_talking", 0, ["Ranger", null, null, null, null, null, null, null]);
      expect(chats.getChatMessage(state)).toBe("Shootin' a man while he's talkin' just rubs me raw, Ranger.");
    } finally { chats.shutdown(); reader.disposeResources(); memory.dispose(); }
    expect(memory.liveAllocations).toBe(0);
  }
});
