import type { BotSourceFiles } from "../../../bots/behavior/assets.ts";
import { WeaponEntry } from "../../../bots/behavior/rerelease/data/botdata.ts";
import type { BotWeaponT } from "../../../bots/behavior/rerelease/data/knowledge.ts";
import { BotScriptSources } from "../../../bots/behavior/library/script-sources.ts";
import { ScriptGlobalDefines } from "../../../ui/common/legacy/script/preprocessor.ts";
import { BotMemory } from "../../../bots/behavior/library/memory.ts";
import { WeightConfigStore } from "../../../bots/behavior/library/weights.ts";
import { WeaponAi, WeaponLoadResult } from "../../../bots/behavior/library/weapons.ts";
import { Q3_WEAPON_ITEMS } from "../../../content/q3/foundation/arsenal.ts";
/** Parse the selected Q3 source weapon metadata once; retain values, not botlib allocations. */
export function nativeQ3WeaponKnowledge(files: BotSourceFiles): readonly BotWeaponT[] {
  const memory = new BotMemory(), sources = new BotScriptSources(files, new ScriptGlobalDefines(), (_severity, text) => { throw new Error(text); }, () => undefined, memory);
  const weights = new WeightConfigStore(sources, { memory }), reader = new WeaponAi({ resolver: sources, weights }, { memory });
  try {
    if (reader.setup() !== WeaponLoadResult.NoError || reader.config === undefined) throw new Error("Selected Q3 bot weapon metadata is unavailable");
    const result: BotWeaponT[] = [];
    for (const binding of Q3_WEAPON_ITEMS) {
      const info = reader.config.weapons[binding.weapon];
      if (info === undefined || !info.valid || info.projectileInfo.damage <= 0) continue;
      const entry = new WeaponEntry();
      entry.name = binding.item; entry.number = 1 << binding.weapon; entry.identity = { kind: "q1-bit", bit: entry.number };
      entry.damage = info.projectileInfo.damage * info.projectileCount; entry.speed = info.speed;
      entry.minRange = info.projectileInfo.radius; entry.maxRange = binding.weapon === 1 ? 60 : binding.weapon === 6 ? 768 : 4096;
      entry.priority = entry.damage / Math.max(0.05, info.reload);
      entry.ammoName = binding.ammo ?? ""; entry.ammo = entry.ammoName; entry.minAmmo = info.ammoAmount; entry.maxAmmo = 200;
      entry.flags = [binding.weapon === 1 ? "melee" : info.speed === 0 ? "hitscan" : "projectile",
        ...(info.projectileInfo.radius > 0 ? ["explosive"] : []), ...(info.projectileInfo.gravity > 0 ? ["parabolic"] : [])];
      entry.aimPoint = info.projectileInfo.radius > 0 ? "feet" : "center";
      result.push(Object.assign(entry, { isMelee: binding.weapon === 1, isElectric: false, needsAmmo: binding.ammo !== null }));
    }
    return result;
  } finally { reader.shutdown(); sources.disposeResources(); memory.dispose(); }
}
