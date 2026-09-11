import type { EquipmentSelection, ProviderReference, ProviderTiming, ResourceRequest } from "../../contracts/content.ts";
import { Q1_DONOR_PROFILE, Q2_DONOR_PROFILE } from "../../core/numeric.ts";
import type { InstalledCatalog } from "./index.ts";

/** Provider identities correspond to the reusable source equipment implementations. */
export const EQUIPMENT_PROVIDERS = {
  threewave: "q1:equipment/threewave-grapple",
  ctf: "q2:equipment/ctf-grapple",
  lmctf: "q2:equipment/lmctf-grapple",
  handGrenades: "q2:equipment/hand-grenades",
} satisfies Readonly<Record<string, ProviderReference["provider"]>>;

export function disabledEquipment(): EquipmentSelection { return { grapple: { kind: "disabled" }, handGrenades: { kind: "disabled" } }; }

export function nativeEquipment(catalog: InstalledCatalog, map: ProviderReference, match: ProviderReference): EquipmentSelection {
  const product = catalog.require(map.content), rules = catalog.require(match.content);
  if (product.expectation.family === "q1" && product.expectation.campaign === "ctf" && product.expectation.edition === "rerelease") {
    return { grapple: { kind: "enabled", mechanic: "q1-threewave", edition: "rerelease", binding: "slot",
      source: { provider: EQUIPMENT_PROVIDERS.threewave, content: product.id } }, handGrenades: { kind: "disabled" } };
  }
  const source = match.provider === "q2:ctf" || match.provider === "q2:lmctf" ? rules : product;
  if (source.expectation.family === "q2" && source.expectation.campaign === "lmctf" && source.expectation.edition === "classic") {
    return { grapple: { kind: "enabled", mechanic: "q2-lmctf", edition: "classic", binding: "offhand",
      source: { provider: EQUIPMENT_PROVIDERS.lmctf, content: source.id } }, handGrenades: { kind: "disabled" } };
  }
  if (source.expectation.family === "q2" && source.expectation.campaign === "ctf" && (source.expectation.edition === "classic" || source.expectation.edition === "rerelease")) {
    return { grapple: { kind: "enabled", mechanic: "q2-ctf", edition: source.expectation.edition, binding: "slot",
      source: { provider: EQUIPMENT_PROVIDERS.ctf, content: source.id } }, handGrenades: { kind: "disabled" } };
  }
  return disabledEquipment();
}

export function equipmentProviders(equipment: EquipmentSelection): readonly ProviderReference[] {
  return [...equipment.grapple.kind === "enabled" ? [equipment.grapple.source] : [],
    ...equipment.handGrenades.kind === "enabled" ? [equipment.handGrenades.source] : []];
}

export function validateEquipment(equipment: EquipmentSelection, catalog: InstalledCatalog): undefined {
  const check = (source: ProviderReference, provider: ProviderReference["provider"], family: string, campaign: string, edition: string): void => {
    const product = catalog.require(source.content).expectation;
    if (source.provider !== provider || product.family !== family || product.campaign !== campaign || product.edition !== edition) {
      throw new RangeError(`Equipment source ${source.provider}/${source.content} does not supply ${provider} ${edition}`);
    }
  };
  const grapple = equipment.grapple;
  if (grapple.kind === "enabled") {
    switch (grapple.mechanic) {
      case "q1-threewave": check(grapple.source, EQUIPMENT_PROVIDERS.threewave, "q1", "ctf", grapple.edition); break;
      case "q2-ctf": check(grapple.source, EQUIPMENT_PROVIDERS.ctf, "q2", "ctf", grapple.edition); break;
      case "q2-lmctf": check(grapple.source, EQUIPMENT_PROVIDERS.lmctf, "q2", "lmctf", grapple.edition); break;
    }
  }
  const grenades = equipment.handGrenades;
  if (grenades.kind === "enabled") {
    check(grenades.source, EQUIPMENT_PROVIDERS.handGrenades, "q2", "baseq2", grenades.edition);
    if (!Number.isSafeInteger(grenades.initialAmmo) || !Number.isSafeInteger(grenades.capacity) || grenades.initialAmmo < 0 || grenades.capacity < grenades.initialAmmo) {
      throw new RangeError("Equipment hand grenade allowance must be whole ammunition within capacity");
    }
  }
  return undefined;
}

export function equipmentTiming(equipment: EquipmentSelection): readonly ProviderTiming[] {
  const result: ProviderTiming[] = [], grapple = equipment.grapple, grenades = equipment.handGrenades;
  const add = (source: ProviderReference, edition: "classic" | "rerelease", q1: boolean): void => {
    result.push({ provider: source.provider, numeric: q1 ? Q1_DONOR_PROFILE : Q2_DONOR_PROFILE,
      clock: q1 ? { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: null }
        : edition === "classic" ? { kind: "q2-classic", frameMilliseconds: 100 } : { kind: "q2-rerelease", frameMilliseconds: 25, preparation: "before-frame" } });
  };
  if (grapple.kind === "enabled") add(grapple.source, grapple.edition, grapple.mechanic === "q1-threewave");
  if (grenades.kind === "enabled") add(grenades.source, grenades.edition, false);
  return result;
}

export function equipmentResources(equipment: EquipmentSelection): readonly ResourceRequest[] {
  const result: ResourceRequest[] = [], grapple = equipment.grapple, grenades = equipment.handGrenades;
  const add = (source: ProviderReference, paths: readonly string[]): void => { for (const path of paths) result.push({ content: source.content, path }); };
  if (grapple.kind === "enabled") {
    switch (grapple.mechanic) {
      case "q1-threewave":
        add(grapple.source, ["progs/star.mdl", "sound/weapons/chain1.wav", "sound/blob/land1.wav", "sound/player/axhit2.wav"]);
        if (grapple.binding === "slot") add(grapple.source, ["progs/v_star.mdl"]);
        break;
      case "q2-ctf":
        add(grapple.source, ["models/weapons/grapple/hook/tris.md2", "models/weapons/grapple/hook/skin.pcx", ...["grfire", "grpull", "grhit", "grhang", "grreset"].map(name => `sound/weapons/grapple/${name}.wav`)]);
        if (grapple.binding === "slot") add(grapple.source, ["models/weapons/grapple/tris.md2", "models/weapons/grapple/skin.pcx"]);
        break;
      case "q2-lmctf":
        add(grapple.source, ["models/objects/ghook/tris.md2", "models/objects/ghook/skin.pcx", ...["grfire", "gflyair", "gpulling", "gkilling", "ghit", "ghitwall"].map(name => `sound/weapons/grapple/${name}.wav`)]);
        if (grapple.binding === "slot") add(grapple.source, ["models/weapons/v_hook/tris.md2", "models/weapons/v_hook/skin.pcx"]);
        break;
    }
  }
  if (grenades.kind === "enabled") add(grenades.source, [`models/objects/${grenades.edition === "classic" ? "grenade2" : "grenade3"}/tris.md2`,
    `models/objects/${grenades.edition === "classic" ? "grenade2" : "grenade3"}/skin.pcx`,
    ...["hgrena1b", "hgrenc1b", "hgrent1a", "hgrenb1a", "hgrenb2a"].map(name => `sound/weapons/${name}.wav`)]);
  return result;
}
