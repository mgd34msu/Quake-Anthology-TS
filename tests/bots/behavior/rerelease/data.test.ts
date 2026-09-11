import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { BotAssetFiles } from "../../../../src/bots/behavior/assets.ts";
import { parseBlocks } from "../../../../src/bots/behavior/rerelease/data/blockparse.ts";
import { parseBotSettings, parseCharacters, parseGameRules, parseWeapons } from "../../../../src/bots/behavior/rerelease/data/botdata.ts";
import { chooseWeapon, itemValue, weaponForItem } from "../../../../src/bots/behavior/rerelease/data/knowledge.ts";
import type { BotWeaponContextT } from "../../../../src/bots/behavior/rerelease/data/knowledge.ts";
import { loadQuake1Knowledge } from "../../../../src/bots/behavior/rerelease/data/knowledge-q1.ts";
import { BOT_WEAPON_BINDINGS, Bot_LoadKnowledge } from "../../../../src/bots/behavior/rerelease/data/knowledge-q2.ts";
import { readBotSourceText } from "../../../../src/bots/behavior/rerelease/data/source-files.ts";

const q1Path = new URL("../../../../../qfiles/q1/rerelease/id1/pak0.pak", import.meta.url).pathname;
const q2Path = new URL("../../../../../qfiles/q2/rerelease/baseq2/pak0.pak", import.meta.url).pathname;

async function sourceFiles(path: string): Promise<BotAssetFiles> {
  const archive = await openArchive(path), files = new BotAssetFiles();
  try {
    for (const entry of archive.entries.filter(entry => /^bots\/[^/]+\.txt$/i.test(entry.path))) {
      const bytes = await archive.readEntry(entry);
      files.add(entry.path, bytes);
      expect(parseBlocks(new TextDecoder().decode(bytes)).errors).toEqual([]);
    }
  } finally { archive.close(); }
  return files;
}

test.skipIf(!existsSync(q2Path))("all shipped Q2 bot families preserve source fields and drive weapon, pickup and rule consumers", async () => {
  const files = await sourceFiles(q2Path);
  expect(files.list("bots", ".txt")).toHaveLength(12);
  const knowledge = Bot_LoadKnowledge(files);
  expect(knowledge.errors).toEqual([]);
  expect([knowledge.characters.length, knowledge.weapons.length, knowledge.items.length, knowledge.monsters.length,
    knowledge.interactables.length, knowledge.gameRules.length, knowledge.teams.length, knowledge.chats.length, knowledge.dangers.length])
    .toEqual([121, 21, 79, 45, 18, 7, 2, 23, 9]);
  expect(knowledge.character("major")).toMatchObject({ skin: "female/brianna", dogtag: "q4_strogg" });
  expect(knowledge.weapons.every(weapon => weapon.identity.kind === "q2-classname" && weapon.number > 0 && weapon.ammo === "")).toBe(true);
  expect(new Set(knowledge.weapons.map(weapon => weapon.number)).size).toBe(21);
  expect(knowledge.weapons.every(weapon => BOT_WEAPON_BINDINGS.some(binding => binding.classname === weapon.name && binding.bit === weapon.number))).toBe(true);
  expect(knowledge.weaponByName("weapon_blaster")).toMatchObject({ needsAmmo: false, speed: 1500, idealFov: 15 });
  expect(knowledge.weaponByName("ammo_grenades")).toMatchObject({ needsAmmo: true, triggerType: "hold_and_release", triggerHold: 3, triggerCooldown: 1 });
  expect(weaponForItem(knowledge.weapons, "weapon_boomer")?.name).toBe("weapon_boomer");
  expect(weaponForItem(knowledge.weapons, "ammo_grenades")?.name).toBe("ammo_grenades");
  expect(weaponForItem(knowledge.weapons, "weapon_boom")?.name).toBeUndefined();
  expect(knowledge.interactables.filter(entry => entry.bounds !== undefined).map(entry => entry.bounds))
    .toEqual(Array.from({ length: 3 }, () => ({ mins: [-16, -16, -8], maxs: [16, 16, 48] })));
  expect(knowledge.danger("target_laser")).toMatchObject({ sightDist: 384, flags: ["check_beam", "nav_hazard"] });
  expect(knowledge.item("item_armor_shard")).toMatchObject({ sightDist: 768, flags: ["armor", "ignore_limits"] });
  for (const platform of ["PC", "Consoles", "Nintendo"] satisfies readonly ("PC" | "Consoles" | "Nintendo")[]) {
    const platformData = Bot_LoadKnowledge(files, platform);
    expect(platformData.errors).toEqual([]);
    expect(platformData.skillNames()).toEqual(["practice", "easy", "medium", "hard", "expert", "nightmare"]);
    expect(platformData.skill("practice")).toMatchObject({ aiming: { leadTargets: false }, weapons: { fovScalar: 4 },
      behaviors: { combatMaxItemDist: 560, combatMinHealthPct: 95, combatMinAmmoPct: 75, combatMinArmorPct: 95, combatGrabWeapons: true } });
  }
  const shotgun = knowledge.weaponByName("weapon_shotgun"), superShotgun = knowledge.weaponByName("weapon_supershotgun"), blaster = knowledge.weaponByName("weapon_blaster");
  if (shotgun === undefined || superShotgun === undefined || blaster === undefined) throw new Error("Missing shipped weapon");
  const context: BotWeaponContextT = { items: shotgun.number | superShotgun.number | blaster.number, ammo: { ammo_shells: 0 },
    range: 128, heightDelta: 0, inWater: false, hasProtection: false, targetInWater: false, allowMelee: true };
  expect(chooseWeapon(knowledge.weapons, context)?.weapon.name).toBe("weapon_blaster");
  expect(chooseWeapon(knowledge.weapons, { ...context, ammo: { ammo_shells: 1 } })?.weapon.name).toBe("weapon_shotgun");
  expect(chooseWeapon(knowledge.weapons, { ...context, ammo: { ammo_shells: 2 } })?.weapon.name).toBe("weapon_supershotgun");
  const shells = knowledge.item("ammo_shells"); if (shells === undefined) throw new Error("Missing shipped shells");
  expect(itemValue(shells, { spawnflags: 0, health: 100, maxHealth: 100, armor: 0, items: shotgun.number, ammo: {}, weaponStay: false,
    allowPowerItems: true, weapons: knowledge.weapons, team: 0, itemTeam: 0, objectiveAtHome: true })).toBe(150);
  const cvars: Record<string, number> = { coop: 1, g_friendly_fire: 1, g_coop_instanced_items: 0, g_coop_squad_respawn: 0 };
  expect(knowledge.gameMode(name => cvars[name] ?? 0)).toEqual({ gameType: "coop", hasTeams: true, teamDamage: true, weaponStay: true });
  cvars["g_coop_squad_respawn"] = 1;
  expect(knowledge.gameMode(name => cvars[name] ?? 0).weaponStay).toBe(false);
  expect(knowledge.gameRules.at(-1)?.conditions).toEqual([{ cvar: "g_coop_instanced_items", value: 0 }, { cvar: "g_coop_squad_respawn", value: 0 }]);
  const dmCvars: Readonly<Record<string, number>> = { deathmatch: 1, g_dm_weapons_stay: 1, g_friendly_fire: 1 };
  expect(knowledge.gameMode(name => dmCvars[name] ?? 0))
    .toEqual({ gameType: "dm", hasTeams: false, teamDamage: true, weaponStay: true });
});

test.skipIf(!existsSync(q1Path))("Q1 retains its shipped inventory bits, spawnflags and absolute firing cone", async () => {
  const files = await sourceFiles(q1Path), knowledge = loadQuake1Knowledge(files);
  if (knowledge === null) throw new Error("Missing installed Q1 bot files");
  expect(files.list("bots", ".txt")).toHaveLength(11);
  expect(knowledge.errors).toEqual([]);
  expect([knowledge.characters.length, knowledge.weapons.length, knowledge.items.length, knowledge.monsters.length]).toEqual([173, 8, 20, 14]);
  expect(knowledge.weaponByNumber(32)).toMatchObject({ name: "rocket_launcher", identity: { kind: "q1-bit", bit: 32 }, ammo: "rockets" });
  expect(weaponForItem(knowledge.weapons, "weapon_supershotgun")?.name).toBe("super_shotgun");
  expect(knowledge.item("item_health")?.megaSpawnflag).toBe(2);
  expect(knowledge.gameMode(name => name === "deathmatch" || name === "teamplay" ? 1 : 0)).toEqual({ gameType: "tdm", weaponStay: false });
  for (const platform of ["PC", "Consoles", "Nintendo"]) {
    const text = readBotSourceText(files, `bots/settings_${platform}.txt`); if (text === null) throw new Error("Missing source settings");
    const parsed = parseBotSettings(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.skills).toHaveLength(6);
    expect(parsed.skills.every(skill => skill.weapons.fovAngle > 0 && skill.weapons.fovScalar === 0 && !skill.aiming.leadTargets)).toBe(true);
  }
});

test("unknown source fields and repeated conditions survive parsing; missing Q2 data has no synthetic fallback", () => {
  const characters = parseCharacters("{\nname sample\nskin male/grunt\nfuture a b\nfuture c\n}\n");
  expect(characters.errors).toHaveLength(2);
  expect(characters.entries[0]?.unknown.map(field => field.values)).toEqual([["a", "b"], ["c"]]);
  const weapons = parseWeapons("{\nname weapon_custom\nnumber 99\nfuture value\n}\n", "q2");
  expect(weapons.entries[0]?.identity).toEqual({ kind: "q2-classname", classname: "weapon_custom" });
  expect(weapons.entries[0]?.source.fields.map(field => field.key)).toEqual(["name", "number", "future"]);
  const rule = parseGameRules("{\ncvar first\nvalue 1\ncvar second\nvalue 2\nlogic_op and\nweapon_stay false\n}\n");
  expect(rule.errors).toEqual([]);
  expect(rule.entries[0]).toMatchObject({ weaponStay: false, weaponStaySpecified: true,
    conditions: [{ cvar: "first", value: 1 }, { cvar: "second", value: 2 }] });
  expect(parseBlocks("skill custom {\nweapons.fov_scalar 2\n}\n").errors).toEqual([]);
  expect(() => Bot_LoadKnowledge(new BotAssetFiles())).toThrow("source data unavailable");
});
