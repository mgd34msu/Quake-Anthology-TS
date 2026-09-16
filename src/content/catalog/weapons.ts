import { missionWeapons } from "../q1/missionpacks/types.ts";
import { weaponHudResources } from "./weapon-hud.ts";
import { Q2_BASE_WEAPONS } from "../q2/foundation/weapons/definitions.ts";
import type { ProviderReference, ProviderTiming, ResourceRequest } from "../../contracts/content.ts";
import { precacheQ1World } from "../q1/foundation/precache-world.ts";
import type { InstalledCatalog } from "./index.ts";
import { nativeProviderTiming } from "./timing.ts";
import { EQUIPMENT_PROVIDERS } from "./equipment.ts";
import type { Q2Weapons } from "../q2/foundation/weapons/player.ts";

export const Q1_WEAPON_PROVIDERS = {
  classic: "q1:weapons/classic/id1",
  rerelease: "q1:weapons/rerelease/id1",
} satisfies Readonly<Record<"classic" | "rerelease", ProviderReference["provider"]>>;

export const Q1_HIPNOTIC_WEAPON_PROVIDERS = {
  classic: "q1:weapons/classic/hipnotic",
  rerelease: "q1:weapons/rerelease/hipnotic",
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
  if (family === "q1" && product.family === "q1" && product.campaign === "hipnotic" && (product.edition === "classic" || product.edition === "rerelease")) {
    const provider = Q1_HIPNOTIC_WEAPON_PROVIDERS[product.edition];
    if (role && weapon.provider !== provider) throw new Error(`Selected weapon role ${weapon.provider} does not match ${weapon.content}`);
    return weapon.content === map.content && map.provider === "q1:official" ? map : { provider, content: weapon.content };
  }
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

// Hipnotic weapon definitions and hipnotic-weapons.ts projectile/sound callers.
const q1HipnoticWeaponPaths: readonly string[] = [
  ...missionWeapons.filter(weapon => weapon.id.startsWith("hipnotic:")).flatMap(weapon => [weapon.model, weapon.worldModel]),
  "progs/lasrspik.mdl", "progs/proxbomb.mdl",
  ...["hipweap/laserg.wav", "hipweap/laserric.wav", "enforcer/enfstop.wav", "hipweap/proxbomb.wav", "hipweap/proxwarn.wav",
    "hipweap/mjoltink.wav", "knight/sword1.wav", "hipweap/mjolslap.wav", "hipweap/mjolhit.wav"].map(path => `sound/${path}`),
];

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

/** Expansion g_items precaches plus projectile dependencies used by their source callbacks. */
const q2ExpansionWeaponPaths: Readonly<Record<string, readonly string[]>> = {
  trap: ["models/weapons/z_trap/tris.md2", "models/objects/trapfx/tris.md2", "models/objects/gibs/chest/tris.md2", "models/objects/gibs/sm_meat/tris.md2",
    "sound/misc/fhit3.wav", "sound/weapons/trapcock.wav", "sound/weapons/traploop.wav", "sound/weapons/trapsuck.wav", "sound/weapons/trapdown.wav", "sound/items/s_health.wav"],
  ionripper: ["models/objects/boomrang/tris.md2", "sound/weapons/rg_hum.wav", "sound/weapons/rippfire.wav", "sound/misc/lasfly.wav"],
  phalanx: ["sprites/s_photon.sp2", "sound/weapons/plasshot.wav", "sound/weapons/rockfly.wav"],
  tesla: ["models/weapons/g_tesla/tris.md2", "sound/weapons/teslaopen.wav", "sound/weapons/hgrenb1a.wav", "sound/weapons/hgrenb2a.wav"],
  proxlauncher: ["models/weapons/g_prox/tris.md2", "sound/weapons/grenlf1a.wav", "sound/weapons/grenlr1b.wav", "sound/weapons/grenlb1b.wav", "sound/weapons/proxwarn.wav", "sound/weapons/proxopen.wav"],
  chainfist: ["sound/weapons/sawidle.wav", "sound/weapons/sawhit.wav", "sound/weapons/sawslice.wav"],
  disintegrator: ["models/proj/disintegrator/tris.md2", "sound/weapons/disrupt.wav", "sound/weapons/disint2.wav", "sound/weapons/disrupthit.wav"],
  etf_rifle: ["models/proj/flechette/tris.md2", "sound/weapons/nail1.wav"],
  heatbeam: ["sound/weapons/bfg__l1a.wav"],
};

export function q2RegisteredWeaponResources(weapons: Pick<Q2Weapons, "registeredDefinitions">, rerelease: boolean): readonly string[] {
  return [...q2BaseWeaponPaths(rerelease), ...weapons.registeredDefinitions().flatMap(weapon => [weapon.viewModel, weapon.worldModel,
    ...q2ExpansionWeaponPaths[weapon.name] ?? [], ...weapon.name === "tesla" && !rerelease ? ["models/weapons/v_tesla2/tris.md2"] : [],
    ...weapon.name === "heatbeam" && !rerelease ? ["models/weapons/v_beamer2/tris.md2"] : []]),
    ...rerelease ? ["sound/weapons/railgr1b.wav"] : []];
}

export function selectedWeaponResources(map: ProviderReference, weapons: readonly ProviderReference[], catalog: InstalledCatalog): readonly ResourceRequest[] {
  return weaponResources(map, weapons, catalog).filter(resource => resource.content !== map.content);
}

export function weaponResources(map: ProviderReference, weapons: readonly ProviderReference[], catalog: InstalledCatalog): readonly ResourceRequest[] {
  return weapons.flatMap(reference => {
    const weapon = canonicalWeaponSource(map, reference, catalog);
    if (Object.values(EQUIPMENT_PROVIDERS).some(provider => provider === weapon.provider)) return [];
    const product = catalog.require(weapon.content).expectation;
    if (weapon.provider.startsWith("q2:") && product.family === "q2" && product.campaign === "baseq2" &&
      (product.edition === "classic" || product.edition === "rerelease"))
      return [...q2BaseWeaponPaths(product.edition === "rerelease").map(path => ({ content: weapon.content, path })), ...weaponHudResources(weapon, product)];
    if (weapon.provider.startsWith("q3:") && product.family === "q3") return weaponHudResources(weapon, product);
    if (!weapon.provider.startsWith("q1:") || product.family !== "q1" || (product.campaign !== "id1" && product.campaign !== "hipnotic") ||
      product.edition !== "classic" && product.edition !== "rerelease") return [];
    return [...[...q1BaseWeaponPaths, ...(product.campaign === "hipnotic" ? q1HipnoticWeaponPaths : [])].map(path => ({ content: weapon.content, path })), ...weaponHudResources(weapon, product)];
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
    const supported = weapon.provider.startsWith("q1:") && product.family === "q1" && (product.campaign === "id1" || product.campaign === "hipnotic") &&
      (product.edition === "classic" || product.edition === "rerelease") ||
      weapon.provider.startsWith("q2:") && product.family === "q2" && product.campaign === "baseq2" &&
      (product.edition === "classic" || product.edition === "rerelease") ||
      weapon.provider.startsWith("q3:") && product.family === "q3" && product.campaign === "baseq3";
    if (!supported) return [];
    const prior = providers.get(weapon.provider);
    if (weapon.provider === map.provider || prior !== undefined && prior !== weapon.content)
      throw new Error(`Selected weapon provider ${weapon.provider} has conflicting content`);
    if (mapFamily === product.family && ![...Object.values(Q1_WEAPON_PROVIDERS), ...Object.values(Q1_HIPNOTIC_WEAPON_PROVIDERS), ...Object.values(Q2_WEAPON_PROVIDERS)].some(provider => provider === weapon.provider) || prior !== undefined) return [];
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
