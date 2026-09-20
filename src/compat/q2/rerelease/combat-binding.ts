import type { ArmorState, ItemId } from "../../../contracts/gameplay.ts";
import type { RawEntityView } from "../../../contracts/execution.ts";
import type { CombatStateBinding } from "../../../world/gameplay/authority.ts";
import type { RereleaseQ2GuestHost } from "./host.ts";
import { RereleaseSourceClient, RereleaseSourceEdict } from "./source-state.ts";
import { RereleasePublicEdict } from "./public-state.ts";
import { retailRereleaseClientProfile } from "./client-profile.ts";
import { rereleaseInventoryItems } from "./semantics.ts";
import { retailRereleaseTime } from "./native-entries.ts";

/** The original retail DLL owns armor rules, damage callbacks and health stores. */
export class RereleaseCombatBindings {
  private items: ReturnType<typeof rereleaseInventoryItems> | null = null;
  constructor(private readonly host: RereleaseQ2GuestHost) {}
  notarget(view: RawEntityView): boolean | null {
    const { module } = this.host, profile = retailRereleaseClientProfile;
    if (profile.authority.kind !== "artifact" || module.memory.module.digest !== profile.authority.digest) return null;
    return (module.memory.readUint64(new RereleaseSourceEdict(view, module).at("flags")) & 32n) !== 0n;
  }
  bind(view: RawEntityView): CombatStateBinding | null {
    const host = this.host, module = host.module, profile = retailRereleaseClientProfile, damage = host.foreignActors;
    if (profile.authority.kind !== "artifact" || module.memory.module.digest !== profile.authority.digest || damage === null) return null;
    const source = new RereleaseSourceEdict(view, module), publicState = new RereleasePublicEdict(module.memory, view), memory = module.memory;
    const client = (): RereleaseSourceClient | null => source.client === null ? null : new RereleaseSourceClient(source.client, module, profile);
    const itemAddress = (value: RereleaseSourceClient, item: ItemId) => {
      this.items ??= rereleaseInventoryItems(module, text => host.core.string(text));
      const entry = this.items.find(entry => entry.item === item);
      if (entry === undefined) throw new Error(`Native armor item is absent: ${item}`);
      return memory.offset(value.at("pers.inventory"), BigInt(entry.sourceIndex * 4));
    };
    const count = (value: RereleaseSourceClient, item: ItemId): number => memory.readInt32(itemAddress(value, item));
    const armorItems: readonly { readonly item: ItemId; readonly normal: number; readonly energy: number }[] = [
      { item: "q2:item_armor_jacket", normal: 0.3, energy: 0 },
      { item: "q2:item_armor_combat", normal: 0.6, energy: 0.3 },
      { item: "q2:item_armor_body", normal: 0.8, energy: 0.6 },
    ];
    const armor = (): ArmorState => {
      const value = client(); if (value === null) return { kind: "none" };
      const regular = armorItems.find(item => count(value, item.item) > 0);
      const powered = (memory.readUint64(source.at("flags")) & 4096n) !== 0n;
      const power = !powered ? null : count(value, "q2:item_power_shield") > 0 ? "shield" : count(value, "q2:item_power_screen") > 0 ? "screen" : null;
      if (regular === undefined && power === null) return { kind: "none" };
      return { kind: "q2", points: regular === undefined ? 0 : count(value, regular.item), item: regular?.item ?? "q2:none",
        normalProtection: regular?.normal ?? 0, energyProtection: regular?.energy ?? 0,
        powerArmor: power === null ? { kind: "none" } : { kind: power, cells: count(value, "q2:ammo_cells") } };
    };
    const writeArmor = (state: ArmorState): undefined => {
      const value = client();
      if (value === null) { if (state.kind !== "none") throw new Error("Native non-client armor requires its own source declaration"); return undefined; }
      if (state.kind !== "none" && state.kind !== "q2") throw new Error("Native Q2 armor cannot store another game's armor record");
      if (state.kind === "q2" && state.points !== 0 && !armorItems.some(item => item.item === state.item)) throw new Error("Unknown native armor item");
      for (const item of armorItems) memory.writeInt32(itemAddress(value, item.item), state.kind === "q2" && state.item === item.item ? state.points : 0);
      if (state.kind === "q2" && state.powerArmor.kind !== "none") memory.writeInt32(itemAddress(value, "q2:ammo_cells"), state.powerArmor.cells);
      return undefined;
    };
    return { ...source.combat({ armor, writeArmor, traits: () => {
      const value = client(), flags = memory.readUint64(source.at("flags"));
      const team = value === null ? 0 : publicState.playerState().teamId;
      const invincibleUntil = value !== null ? value.invincibleUntilMilliseconds()
        : (publicState.uint("svflags") & 4) !== 0 ? memory.readInt64(memory.offset(view.address, 0xb88n)) : 0n;
      return { invulnerable: (flags & 16n) !== 0n || invincibleUntil > retailRereleaseTime(module, damage.entries),
        team: team > 0 ? `q2:${team}` : null, noKnockback: (flags & 2048n) !== 0n };
    } }), sourceDamage: request => damage.damageNative(request) };
  }
}
