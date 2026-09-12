import type { ProviderReference, ProviderTiming, ResourceRequest } from "../../contracts/content.ts";
import { precacheQ1World } from "../q1/foundation/precache-world.ts";
import type { InstalledCatalog } from "./index.ts";
import { nativeProviderTiming } from "./timing.ts";

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

export function selectedWeaponResources(map: ProviderReference, weapons: readonly ProviderReference[], catalog: InstalledCatalog): readonly ResourceRequest[] {
  return weapons.flatMap(weapon => {
    if (weapon.content === map.content) return [];
    const product = catalog.require(weapon.content).expectation;
    if (!weapon.provider.startsWith("q1:") || product.family !== "q1" || product.campaign !== "id1" ||
      product.edition !== "classic" && product.edition !== "rerelease") return [];
    return q1BaseWeaponPaths.map(path => ({ content: weapon.content, path }));
  });
}

export function selectedWeaponTiming(map: ProviderReference, weapons: readonly ProviderReference[], catalog: InstalledCatalog): readonly ProviderTiming[] {
  const mapFamily = catalog.require(map.content).expectation.family;
  const providers = new Map<ProviderReference["provider"], ProviderReference["content"]>();
  return weapons.flatMap(weapon => {
    if (weapon.content === map.content) return [];
    const product = catalog.require(weapon.content).expectation;
    const supported = weapon.provider.startsWith("q1:") && product.family === "q1" && product.campaign === "id1" &&
      (product.edition === "classic" || product.edition === "rerelease") ||
      weapon.provider.startsWith("q3:") && product.family === "q3" && product.campaign === "baseq3";
    if (!supported) return [];
    const prior = providers.get(weapon.provider);
    if (weapon.provider === map.provider || prior !== undefined && prior !== weapon.content)
      throw new Error(`Selected weapon provider ${weapon.provider} has conflicting content`);
    if (mapFamily === product.family || prior !== undefined) return [];
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
    : wanted.kind === "q3" && clock.kind === "q3" && clock.serverFrameMilliseconds === wanted.serverFrameMilliseconds &&
      clock.fixedMovementMilliseconds === wanted.fixedMovementMilliseconds && clock.maximumCommandMilliseconds === wanted.maximumCommandMilliseconds;
  if (!numericMatches || !clockMatches) throw new Error(`Selected weapon provider ${weapon.provider} has conflicting timing`);
}
