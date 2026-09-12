import { weaponHudResources } from "./weapon-hud.ts";
import { Q2_BASE_WEAPONS } from "../q2/foundation/weapons/definitions.ts";
import type { ProviderReference, ProviderTiming, ResourceRequest } from "../../contracts/content.ts";
import { precacheQ1World } from "../q1/foundation/precache-world.ts";
import type { InstalledCatalog } from "./index.ts";
import { nativeProviderTiming } from "./timing.ts";
import { EQUIPMENT_PROVIDERS } from "./equipment.ts";

export const Q1_WEAPON_PROVIDERS = {
  classic: "q1:weapons/classic/id1",
  rerelease: "q1:weapons/rerelease/id1",
} satisfies Readonly<Record<"classic" | "rerelease", ProviderReference["provider"]>>;

export const Q2_WEAPON_PROVIDERS = {
  classic: "q2:weapons/classic/baseq2",
  rerelease: "q2:weapons/rerelease/baseq2",
} satisfies Readonly<Record<"classic" | "rerelease", ProviderReference["provider"]>>;

export function canonicalWeaponSource(map: ProviderReference, weapon: ProviderReference, catalog: InstalledCatalog): ProviderReference {
  if (Object.values(EQUIPMENT_PROVIDERS).some(provider => provider === weapon.provider)) return weapon;
  const family = weapon.provider.startsWith("q1:") ? "q1" : weapon.provider.startsWith("q2:") ? "q2" : null;
  if (family === null) return weapon;
  const program = family === "q1" ? "id1" : "baseq2", providers = family === "q1" ? Q1_WEAPON_PROVIDERS : Q2_WEAPON_PROVIDERS;
  const role = weapon.provider.startsWith(`${family}:weapons/`);
  if (!role && weapon.provider !== `${family}:official`) throw new Error(`Unsupported ${family.toUpperCase()} weapon provider ${weapon.provider}`);
  const product = catalog.require(weapon.content).expectation;
  const mapProduct = catalog.require(map.content).expectation;
  if (weapon.content !== map.content && mapProduct.family === family && (mapProduct.campaign !== program || mapProduct.edition !== "classic" && mapProduct.edition !== "rerelease"))
    throw new Error(`Cross-edition ${family.toUpperCase()} arsenals require a classic or rerelease ${program} map program`);
  const base = product.family === family && product.campaign === program && (product.edition === "classic" || product.edition === "rerelease");
  if (!base) {
    if (role || weapon.content !== map.content || product.family !== family)
      throw new Error(`Selected ${family.toUpperCase()} arsenal roles require classic or rerelease ${program} content`);
    return weapon;
  }
  const provider = product.edition === "classic" ? providers.classic : providers.rerelease;
  if (role && weapon.provider !== provider) throw new Error(`Selected weapon role ${weapon.provider} does not match ${weapon.content}`);
  if (weapon.content === map.content && map.provider === `${family}:official`) return map;
  return { provider, content: weapon.content };
}

const q1BaseWeaponPaths: readonly string[] = (() => {
  const paths = ["gfx/palette.lmp"];
  precacheQ1World({
    precacheSound: path => {
      if (path.startsWith("weapons/") || path.startsWith("player/axhit")) paths.push(`sound/${path}`);
      return path;
    },
    precacheModel: path => {
      if (path.startsWith("progs/v_") || /^progs\/(missile|grenade|spike|s_spike|bolt2)\.mdl$/.test(path)) paths.push(path);
      return path;
    },
  });
  return paths;
})();

// Base g_items precaches plus the shared base weapon/projectile effect paths.
function q2BaseWeaponPaths(rerelease: boolean): readonly string[] {
  const models = [...Object.values(Q2_BASE_WEAPONS).flatMap(weapon => [weapon.viewModel, weapon.worldModel]).filter(path => path !== ""),
    ...["laser", "rocket", "debris2", "smoke", "explode", "r_explode", rerelease ? "grenade4" : "grenade", rerelease ? "grenade3" : "grenade2"].map(name => `models/objects/${name}/tris.md2`)];
  const sounds = ["blastf1a", "shotgf1b", "shotgr1b", "sshotf1b", "machgf1b", "machgf2b", "machgf3b", "machgf4b", "machgf5b",
    "chngnu1a", "chngnl1a", "chngnd1a", "hgrent1a", "hgrena1b", "hgrenc1b", "hgrenb1a", "hgrenb2a", "grenlf1a", "grenlr1b", "grenlb1b",
    "rockfly", "rocklf1a", "rocklr1b", "hyprbu1a", "hyprbl1a", "hyprbf1a", "hyprbd1a", "rg_hum", "railgf1a", "bfg__f1y", "bfg__l1a", "bfg__x1b", "bfg_hum", "noammo"];
  return [...models.flatMap(path => [path, ...(path === "models/objects/r_explode/tris.md2"
      ? Array.from({ length: 7 }, (_, index) => `models/objects/r_explode/skin${index + 1}.pcx`) : [path.replace("tris.md2", "skin.pcx")])]),
    ...(rerelease ? ["models/objects/explode/rskin.pcx", "models/objects/explode/skin2.pcx", "models/objects/laser/skinb.pcx", "models/objects/laser/sking.pcx"] : ["models/weapons/v_proxyl/skin.pcx"]),
    "pics/colormap.pcx", "sound/misc/lasfly.wav", ...sounds.map(name => `sound/weapons/${name}.wav`),
    ...[2, 4, 6].flatMap((count, index) => [`sprites/s_bfg${index + 1}.sp2`, ...Array.from({ length: count }, (_, frame) => `sprites/s_bfg${index + 1}_${frame}.pcx`)]),
    ...(rerelease ? ["sound/weapons/change.wav", "sound/weapons/lowammo.wav"] : [])];
}

export function selectedWeaponResources(map: ProviderReference, weapons: readonly ProviderReference[], catalog: InstalledCatalog): readonly ResourceRequest[] {
  return weapons.flatMap(reference => {
    const weapon = canonicalWeaponSource(map, reference, catalog);
    if (Object.values(EQUIPMENT_PROVIDERS).some(provider => provider === weapon.provider)) return [];
    if (weapon.content === map.content) return [];
    const product = catalog.require(weapon.content).expectation;
    if (weapon.provider.startsWith("q2:") && product.family === "q2" && product.campaign === "baseq2" &&
      (product.edition === "classic" || product.edition === "rerelease"))
      return [...q2BaseWeaponPaths(product.edition === "rerelease").map(path => ({ content: weapon.content, path })), ...weaponHudResources(weapon, product)];
    if (weapon.provider.startsWith("q3:") && product.family === "q3") return weaponHudResources(weapon, product);
    if (!weapon.provider.startsWith("q1:") || product.family !== "q1" || product.campaign !== "id1" ||
      product.edition !== "classic" && product.edition !== "rerelease") return [];
    return [...q1BaseWeaponPaths.map(path => ({ content: weapon.content, path })), ...weaponHudResources(weapon, product)];
  });
}

export function selectedWeaponTiming(map: ProviderReference, weapons: readonly ProviderReference[], catalog: InstalledCatalog): readonly ProviderTiming[] {
  const mapFamily = catalog.require(map.content).expectation.family;
  const providers = new Map<ProviderReference["provider"], ProviderReference["content"]>();
  return weapons.flatMap(reference => {
    const weapon = canonicalWeaponSource(map, reference, catalog);
    if (Object.values(EQUIPMENT_PROVIDERS).some(provider => provider === weapon.provider)) return [];
    if (weapon.content === map.content) return [];
    const product = catalog.require(weapon.content).expectation;
    const supported = weapon.provider.startsWith("q1:") && product.family === "q1" && product.campaign === "id1" &&
      (product.edition === "classic" || product.edition === "rerelease") ||
      weapon.provider.startsWith("q2:") && product.family === "q2" && product.campaign === "baseq2" &&
      (product.edition === "classic" || product.edition === "rerelease") ||
      weapon.provider.startsWith("q3:") && product.family === "q3" && product.campaign === "baseq3";
    if (!supported) return [];
    const prior = providers.get(weapon.provider);
    if (weapon.provider === map.provider || prior !== undefined && prior !== weapon.content)
      throw new Error(`Selected weapon provider ${weapon.provider} has conflicting content`);
    if (mapFamily === product.family && ![...Object.values(Q1_WEAPON_PROVIDERS), ...Object.values(Q2_WEAPON_PROVIDERS)].some(provider => provider === weapon.provider) || prior !== undefined) return [];
    providers.set(weapon.provider, weapon.content);
    return [nativeProviderTiming(weapon, product.family, product.edition === "rerelease")];
  });
}

export function admitWeaponTiming(timing: ProviderTiming[], weapon: ProviderTiming): void {
  const existing = timing.find(entry => entry.provider === weapon.provider);
  if (existing === undefined) { timing.push(weapon); return; }
  const actual = existing.numeric, expected = weapon.numeric;
  const numericMatches = actual.id === expected.id && actual.arithmetic.kind === "binary32" && expected.arithmetic.kind === "binary32" &&
    actual.arithmetic.round === expected.arithmetic.round && actual.scalarStorage === expected.scalarStorage &&
    actual.floatToInt === expected.floatToInt && actual.integerOverflow === expected.integerOverflow;
  const clock = existing.clock, wanted = weapon.clock;
  const clockMatches = wanted.kind === "q1-netquake" && clock.kind === "q1-netquake"
    ? clock.minimumFrameSeconds === wanted.minimumFrameSeconds && clock.maximumFrameSeconds === wanted.maximumFrameSeconds && clock.fixedFrameSeconds === wanted.fixedFrameSeconds
    : wanted.kind === "q2-classic" && clock.kind === "q2-classic" ? clock.frameMilliseconds === wanted.frameMilliseconds
    : wanted.kind === "q2-rerelease" && clock.kind === "q2-rerelease" ? clock.frameMilliseconds === wanted.frameMilliseconds && clock.preparation === wanted.preparation
    : wanted.kind === "q3" && clock.kind === "q3" && clock.serverFrameMilliseconds === wanted.serverFrameMilliseconds &&
      clock.fixedMovementMilliseconds === wanted.fixedMovementMilliseconds && clock.maximumCommandMilliseconds === wanted.maximumCommandMilliseconds;
  if (!numericMatches || !clockMatches) throw new Error(`Selected weapon provider ${weapon.provider} has conflicting timing`);
}
