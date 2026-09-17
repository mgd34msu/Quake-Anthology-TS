import { expect, test } from "bun:test";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { BotAssetFiles } from "../../../../src/bots/behavior/assets.ts";
import { nativeQ3WeaponKnowledge } from "../../../../src/app/bootstrap/simulation/bot-selected-knowledge.ts";

test("native source behavior reads actual selected Q3 projectile and inventory metadata", async () => {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q3a/baseq3/pak0.pk3"), files = new BotAssetFiles();
  try { for (const entry of archive.entries) if (entry.path.startsWith("botfiles/") && !entry.isDirectory) files.add(entry.path, await archive.readEntry(entry)); }
  finally { archive.close(); }
  const weapons = nativeQ3WeaponKnowledge(files), rocket = weapons.find(value => value.name === "q3:weapon/rocketlauncher");
  expect(rocket?.damage).toBe(100); expect(rocket?.speed).toBe(900);
  expect(rocket?.number).toBe(1 << 5); expect(rocket?.ammoName).toBe("q3:ammo/rocketlauncher");
  expect(rocket?.flags).toContain("explosive");
  expect(weapons.find(value => value.name === "q3:weapon/gauntlet")?.needsAmmo).toBe(false);
  expect(weapons.some(value => value.name === "q3:weapon/grapple")).toBe(false);
});
