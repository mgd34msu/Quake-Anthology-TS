import { q2MissionWeaponIcons } from "../q2/missionpacks/items.ts";
import { xatrixWeaponDefinitions, rogueWeaponDefinitions } from "../q2/missionpacks/weapons/definitions.ts";
import { Q2_BASE_WEAPONS } from "../q2/foundation/weapons/definitions.ts";
import type { ProviderReference, ResourceRequest } from "../../contracts/content.ts";
import type { ItemId } from "../../contracts/gameplay.ts";
import type { WeaponHudIcon } from "../../contracts/ui.ts";
import { q2BaseItemIcons } from "../q2/foundation/items.ts";
import { Q3_WEAPON_ITEMS } from "../q3/foundation/arsenal.ts";
import { ItemType } from "../q3/base/shared/definitions.ts";
import { itemList } from "../q3/base/shared/items.ts";
import type { ProductExpectation } from "./products.ts";

export interface WeaponHudIcons {
  readonly weapon: WeaponHudIcon | null;
  readonly selectedWeapon: WeaponHudIcon | null;
  readonly ammo: WeaponHudIcon | null;
}

// id1 sbar pictures and rerelease id1/wwheel.txt slots, including the axe slot.
const q1Pictures: readonly { readonly item: ItemId; readonly classic: string | null; readonly wheel: string; readonly ammo: string | null }[] = [
  { item: "q1:weapon/axe", classic: null, wheel: "axe", ammo: null },
  { item: "q1:weapon/shotgun", classic: "shotgun", wheel: "shotgun1", ammo: "sb_shells" },
  { item: "q1:weapon/supershotgun", classic: "sshotgun", wheel: "shotgun2", ammo: "sb_shells" },
  { item: "q1:weapon/nailgun", classic: "nailgun", wheel: "nail1", ammo: "sb_nails" },
  { item: "q1:weapon/supernailgun", classic: "snailgun", wheel: "nail2", ammo: "sb_nails" },
  { item: "q1:weapon/grenadelauncher", classic: "rlaunch", wheel: "rocket1", ammo: "sb_rocket" },
  { item: "q1:weapon/rocketlauncher", classic: "srlaunch", wheel: "rocket2", ammo: "sb_rocket" },
  { item: "q1:weapon/lightning", classic: "lightng", wheel: "light", ammo: "sb_cells" },
];

// Hipnotic sbar.ts lumps and retail rerelease hipnotic/wwheel.txt slots 7–9.
const hipnoticPictures: typeof q1Pictures = [
  { item: "q1:weapon/hipnotic:laser", classic: "laser", wheel: "ui_h_weapon_laser", ammo: "sb_cells" },
  { item: "q1:weapon/hipnotic:mjolnir", classic: "mjolnir", wheel: "ui_h_weapon_mjolnir", ammo: "sb_cells" },
  { item: "q1:weapon/hipnotic:proximity", classic: "prox", wheel: "ui_h_weapon_gren", ammo: "sb_rocket" },
];

const roguePictures: typeof q1Pictures = [
  { item: "q1:weapon/rogue:lava-nailgun", classic: "r_lava", wheel: "ui_r_weapon_lava", ammo: "r_ammolava" },
  { item: "q1:weapon/rogue:lava-supernailgun", classic: "r_superlava", wheel: "ui_r_weapon_superlava", ammo: "r_ammolava" },
  { item: "q1:weapon/rogue:multi-grenade", classic: "r_gren", wheel: "ui_r_weapon_gren", ammo: "r_ammoplasma" },
  { item: "q1:weapon/rogue:multi-rocket", classic: "r_multirock", wheel: "ui_r_weapon_multirock", ammo: "r_ammoplasma" },
  { item: "q1:weapon/rogue:plasma", classic: "r_plasma", wheel: "ui_r_weapon_plasma", ammo: "r_ammomulti" },
];
const mg3Pictures: typeof q1Pictures = [
  { item: "q1:weapon/mg3:laser", classic: "laser", wheel: "ui_h_weapon_laser", ammo: "sb_cells" },
  { item: "q1:weapon/mg3:mjolnir", classic: null, wheel: "axe", ammo: "sb_cells" },
];
function q1WeaponPictures(program: string): typeof q1Pictures {
  return [...q1Pictures, ...(program === "hipnotic" ? hipnoticPictures : program === "rogue" ? roguePictures : program === "mg3" ? mg3Pictures : [])];
}
function q2WeaponDefinitions(product: ProductExpectation) {
  return [...Q2_BASE_WEAPONS, ...(product.edition === "rerelease" || product.campaign === "xatrix" ? xatrixWeaponDefinitions : []),
    ...(product.edition === "rerelease" || product.campaign === "rogue" ? rogueWeaponDefinitions : [])];
}

function image(source: ProviderReference, path: string): WeaponHudIcon {
  return { kind: "image", resource: { content: source.content, path } };
}
function wad(source: ProviderReference, lump: string): WeaponHudIcon {
  return { kind: "wad-picture", resource: { content: source.content, path: "gfx.wad" }, lump };
}

export function weaponHudIcons(source: ProviderReference, product: ProductExpectation, item: ItemId): WeaponHudIcons | null {
  if (product.family === "q1" && ["id1", "hipnotic", "rogue", "dopa", "mg1", "mg3"].includes(product.campaign) && (product.edition === "classic" || product.edition === "rerelease")) {
    const pictures = q1WeaponPictures(product.campaign).find(entry => entry.item === item);
    if (pictures === undefined) return null;
    return { weapon: product.edition === "rerelease" ? image(source, `gfx/weapons/${pictures.wheel.startsWith("ui_") ? pictures.wheel : `ww_${pictures.wheel}`}_1.lmp`) : pictures.classic === null ? null : wad(source, pictures.classic.startsWith("r_") ? pictures.classic : `inv_${pictures.classic}`),
      selectedWeapon: product.edition === "rerelease" ? image(source, `gfx/weapons/${pictures.wheel.startsWith("ui_") ? pictures.wheel : `ww_${pictures.wheel}`}_2.lmp`) : pictures.classic === null ? null : wad(source, pictures.classic.startsWith("r_") ? pictures.classic : `inv2_${pictures.classic}`),
      ammo: pictures.ammo === null ? null : wad(source, pictures.ammo) };
  }
  if (product.family === "q2" && ["baseq2", "xatrix", "rogue", "mg2"].includes(product.campaign) && (product.edition === "classic" || product.edition === "rerelease")) {
    const pictures = [...q2BaseItemIcons(), ...q2MissionWeaponIcons()], picture = pictures.find(entry => entry.item === item);
    const weapon = q2WeaponDefinitions(product).find(entry => entry.item === item);
    if (picture === undefined || weapon === undefined) return null;
    const ammo = pictures.find(entry => entry.item === weapon.ammo);
    return { weapon: image(source, `pics/${picture.icon}.pcx`), selectedWeapon: image(source, `pics/${picture.icon}.pcx`),
      ammo: ammo === undefined ? null : image(source, `pics/${ammo.icon}.pcx`) };
  }
  if (product.family === "q3" && (product.campaign === "baseq3" || product.campaign === "missionpack")) {
    const definition = Q3_WEAPON_ITEMS.find(entry => entry.item === item);
    if (definition === undefined) return null;
    const items = itemList(product.campaign), weapon = items.find(entry => entry.type === ItemType.IT_WEAPON && entry.tag === definition.weapon);
    if (weapon === undefined) return null;
    const ammo = items.find(entry => entry.type === ItemType.IT_AMMO && entry.tag === definition.weapon);
    const icon = (name: string | null): WeaponHudIcon | null => name === null ? null : { kind: "shader", content: source.content, name };
    return { weapon: icon(weapon.icon), selectedWeapon: icon(weapon.icon), ammo: icon(ammo?.icon ?? null) };
  }
  return null;
}


// Retail missionpack scripts/gfx.shader maps these shader names to these images.
const teamArenaImages: Readonly<Record<string, string>> = {
  "icons/iconw_nailgun": "icons/nailgun128.tga", "icons/iconw_chaingun": "icons/chaingun128.tga",
  "icons/iconw_proxlauncher": "icons/proxmine.tga", "icons/icona_nailgun": "icons/ammo_nailgun.tga",
  "icons/icona_chaingun": "icons/ammo_chaingun.tga", "icons/icona_proxlauncher": "icons/ammo_proxmine.tga",
};

export function weaponHudResources(source: ProviderReference, product: ProductExpectation): readonly ResourceRequest[] {
  const items = product.family === "q1" ? q1WeaponPictures(product.campaign).map(entry => entry.item) : product.family === "q2" ? q2WeaponDefinitions(product).map(entry => entry.item) : Q3_WEAPON_ITEMS.map(entry => entry.item);
  const paths = new Set<string>();
  for (const item of items) {
    const icons = weaponHudIcons(source, product, item);
    if (icons === null) continue;
    for (const icon of [icons.weapon, icons.selectedWeapon, icons.ammo]) {
      if (icon === null) continue;
      if (icon.kind === "shader") paths.add(teamArenaImages[icon.name] ?? `${icon.name}.tga`);
      else paths.add(icon.resource.path);
    }
  }
  if (paths.size > 0 && product.family === "q1") {
    paths.add("gfx/palette.lmp");
    if (product.edition === "rerelease") paths.add("wwheel.txt");
  }
  if (paths.size > 0 && product.family === "q2") paths.add("pics/colormap.pcx");
  if (paths.size > 0 && product.family === "q3" && product.campaign === "missionpack") paths.add("scripts/gfx.shader");
  return [...paths].map(path => ({ content: source.content, path }));
}
