import type { Q1Weapon } from "../content/q1/foundation/types.ts";
import { WEAPONS, weaponItem } from "../content/q1/foundation/types.ts";
import { q1WeaponDisplayName } from "../content/q1/foundation/weapon-names.ts";
import { missionWeapons } from "../content/q1/missionpacks/types.ts";
import { Q2_BASE_WEAPONS } from "../content/q2/foundation/weapons/definitions.ts";
import { q2BaseWeaponDisplayName } from "../content/q2/foundation/items.ts";
import { Q3_WEAPON_ITEMS } from "../content/q3/foundation/arsenal.ts";
import { itemList } from "../content/q3/base/shared/items.ts";
import { ItemType } from "../content/q3/base/shared/definitions.ts";
import { rogueWeaponDefinitions, xatrixWeaponDefinitions } from "../content/q2/missionpacks/weapons/definitions.ts";
import { q2MissionWeaponDisplayName } from "../content/q2/missionpacks/items.ts";

export interface WeaponBindingItem { readonly id: string; readonly label: string; readonly kind: "weapon" | "powerup"; }

/** Official boot catalog. A running game's registered items supersede this list. */
export function baseWeaponBindingItems(family: "q1" | "q2" | "q3", campaign = "", edition = "classic"): readonly WeaponBindingItem[] {
  switch (family) {
    case "q1": return [...WEAPONS, ...(campaign === "mg3" ? ["mg3:laser", "mg3:mjolnir"] satisfies readonly Q1Weapon[] : []), ...missionWeapons.filter(weapon => (campaign === "hipnotic" || campaign === "rogue") && weapon.id.startsWith(`${campaign}:`)).map(weapon => weapon.id)]
      .map(weapon => ({ id: weaponItem(weapon), label: q1WeaponDisplayName(weapon), kind: "weapon" }));
    case "q2": return [...Q2_BASE_WEAPONS, ...(edition === "rerelease" && ["baseq2", "xatrix", "rogue", "mg2"].includes(campaign) ? [...xatrixWeaponDefinitions, ...rogueWeaponDefinitions] : campaign === "xatrix" ? xatrixWeaponDefinitions : campaign === "rogue" ? rogueWeaponDefinitions : [])]
      .map(weapon => ({ id: weapon.item, label: q2BaseWeaponDisplayName(weapon.item) ?? q2MissionWeaponDisplayName(weapon.name) ?? weapon.name, kind: "weapon" }));
    case "q3": {
      const product = campaign === "missionpack" ? "missionpack" : "baseq3";
      return Q3_WEAPON_ITEMS.filter(weapon => product === "missionpack" || weapon.weapon <= 10).map(weapon => ({ id: weapon.item,
        label: itemList(product).find(item => item.type === ItemType.IT_WEAPON && item.tag === weapon.weapon)?.pickupName ?? "Grappling Hook", kind: "weapon" }));
    }
  }
}

export function defaultWeaponBindings(items: readonly WeaponBindingItem[]): readonly (readonly [string, string])[] {
  const result: (readonly [string, string])[] = [];
  const append = (id: string, key: string): void => {
    if (!result.some(([assigned]) => assigned === key) && items.some(item => item.kind === "weapon" && item.id === id)) result.push([key, `use ${id}`]);
  };
  for (const [index, weapon] of WEAPONS.entries()) append(`q1:weapon/${weapon}`, String(index + 1));
  append(weaponItem("hipnotic:laser"), "9");
  append(weaponItem("hipnotic:mjolnir"), "0");
  append(weaponItem("mg3:laser"), "9");
  // Q2's hand grenades have their own key and do not consume a number slot.
  let slot = 1;
  for (const weapon of Q2_BASE_WEAPONS) {
    if (weapon.name === "grenades") append(weapon.item, "g");
    else { append(weapon.item, String(slot % 10)); slot++; }
  }
  for (const weapon of Q3_WEAPON_ITEMS) if (weapon.weapon <= 10) append(weapon.item, String(weapon.weapon % 10));
  return result;
}

const normalized = (value: string): string => value.toLowerCase().replaceAll(" ", "");

export interface ResolvedWeaponSelection { readonly kind: WeaponBindingItem["kind"]; readonly item: string; }

/** Used by command dispatch and binding display against the same selected item catalog. */
export function resolveWeaponSelection(command: string, args: readonly string[], items: readonly WeaponBindingItem[]): ResolvedWeaponSelection | null {
  const name = command.toLowerCase();
  if (name !== "use" && name !== "weapon" && name !== "impulse") return null;
  if (args.length === 0 || args.some(argument => /[;\r\n\\"]/u.test(argument) || argument.includes("//") || argument.includes("/*"))) return null;
  if (name === "use") {
    const requested = normalized(args.join(""));
    const canonical = items.find(item => item.id === requested);
    if (canonical !== undefined) return { kind: canonical.kind, item: canonical.id };
    const matching = items.filter(item => {
      if (normalized(item.label) === requested) return true;
      const q1 = [...WEAPONS, ...missionWeapons.map(weapon => weapon.id)].find(weapon => weaponItem(weapon) === item.id);
      if (q1 !== undefined && (normalized(q1) === requested || normalized(q1WeaponDisplayName(q1)) === requested)) return true;
      const q3 = Q3_WEAPON_ITEMS.find(weapon => weapon.item === item.id);
      if (q3 !== undefined && normalized(q3.item.slice("q3:weapon/".length)) === requested) return true;
      const q2 = [...Q2_BASE_WEAPONS, ...xatrixWeaponDefinitions, ...rogueWeaponDefinitions].find(weapon => weapon.item === item.id);
      const label = q2 === undefined ? null : q2BaseWeaponDisplayName(q2.item) ?? q2MissionWeaponDisplayName(q2.name);
      return q2 !== undefined && normalized(q2.name) === requested || label !== null && normalized(label) === requested;
    });
    const item = matching.length === 1 ? matching[0] : undefined;
    return item === undefined ? null : { kind: item.kind, item: item.id };
  }
  const argument = args[0];
  if (args.length !== 1 || argument === undefined || !/^[1-9][0-9]*$/u.test(argument)) return null;
  const number = Number(argument);
  // Expansion impulses can toggle paired weapons or fall back to another item.
  if (name === "impulse" && items.some(item => item.kind === "weapon" && !WEAPONS.some(weapon => item.id === `q1:weapon/${weapon}`))) return null;
  const id = name === "weapon" ? Q3_WEAPON_ITEMS.find(weapon => weapon.weapon === number)?.item
    : WEAPONS[number - 1] === undefined ? undefined : `q1:weapon/${WEAPONS[number - 1]}`;
  const item = items.find(item => item.kind === "weapon" && item.id === id);
  return item === undefined ? null : { kind: item.kind, item: item.id };
}

/** Resolve only one simple selection command; scripts and aliases remain opaque. */
export function weaponBindingItem(text: string, items: readonly WeaponBindingItem[]): string | null {
  if (/[;\r\n\\]/u.test(text) || text.includes("//") || text.includes("/*")) return null;
  const command = /^\s*(use|weapon|impulse)\s+(?:"([^"\r\n]+)"|([^"\r\n]+?))\s*$/iu.exec(text);
  if (command === null) return null;
  const name = command[1], argument = command[2] ?? command[3];
  return name === undefined || argument === undefined ? null : resolveWeaponSelection(name, [argument], items)?.item ?? null;
}
