import { normalizeLegacyPowerOnlyArmor } from "../../../world/gameplay/authority.ts";
import type { ArmorState, ItemId } from "../../../contracts/gameplay.ts";
import type { RawEntityView } from "../../../contracts/execution.ts";
import type { CombatStateBinding } from "../../../world/gameplay/authority.ts";
import type { RereleaseQ2GuestHost } from "./host.ts";
import { RereleaseSourceClient, RereleaseSourceEdict } from "./source-state.ts";
import { RereleasePublicEdict } from "./public-state.ts";
import { rereleaseInventoryItems } from "./semantics.ts";

/** The declared original DLL owns armor rules, damage callbacks and health stores. */
export class RereleaseCombatBindings {
  private items: ReturnType<typeof rereleaseInventoryItems> | null = null;
  constructor(private readonly host: RereleaseQ2GuestHost) {}
  notarget(view: RawEntityView): boolean | null {
    const { module } = this.host, world = module.worldProfile;
    if (world === null) return null;
    return (module.memory.readUint64(new RereleaseSourceEdict(view, module).at("flags")) & BigInt(world.flags.notarget)) !== 0n;
  }
  bind(view: RawEntityView): CombatStateBinding | null {
    const host = this.host, module = host.module, world = module.worldProfile, damage = host.foreignActors;
    if (world === null || damage === null) return null;
    const profile = world.client;
    const source = new RereleaseSourceEdict(view, module), publicState = new RereleasePublicEdict(module.memory, view), memory = module.memory;
    const client = (): RereleaseSourceClient | null => source.client === null ? null : new RereleaseSourceClient(source.client, module, profile);
    const itemAddress = (value: RereleaseSourceClient, item: ItemId) => {
      this.items ??= rereleaseInventoryItems(module, text => host.core.string(text));
      const entry = this.items.find(entry => entry.item === item);
      if (entry === undefined) throw new Error(`Native armor item is absent: ${item}`);
      return memory.offset(value.at("pers.inventory"), BigInt(entry.sourceIndex * 4));
    };
    const count = (value: RereleaseSourceClient, item: ItemId): number => memory.readInt32(itemAddress(value, item));
    const armorItems = world.armor.regular;
    const protection = (item: ItemId, offset: number): number => {
      this.items ??= rereleaseInventoryItems(module, text => host.core.string(text));
      const index = this.items.find(entry => entry.item === item)?.sourceIndex;
      if (index === undefined) throw new Error("Native armor item is absent");
      const info = memory.readPointer(memory.offset(damage.entries.armorInfoTable, BigInt(index * world.armor.stride)));
      return info === null ? 0 : memory.readFloat32(memory.offset(info, BigInt(offset)));
    };
    const armor = (): ArmorState => {
      const value = client(); if (value === null) return { regular: { kind: "none" }, powered: { kind: "none" } };
      const regular = armorItems.find(item => count(value, item) > 0);
      const powered = (memory.readUint64(source.at("flags")) & BigInt(world.flags.powerArmor)) !== 0n;
      const power = !powered ? null : count(value, world.armor.shield) > 0 ? "shield" : count(value, world.armor.screen) > 0 ? "screen" : null;
      if (regular === undefined && power === null) return { regular: { kind: "none" }, powered: { kind: "none" } };
      return { regular: regular === undefined ? { kind: "none" } : { kind: "q2", points: count(value, regular), item: regular,
        normalProtection: protection(regular, world.armor.normal), energyProtection: protection(regular, world.armor.energy) },
        powered: power === null ? { kind: "none" } : { kind: power, cells: count(value, world.armor.cells) } };
    };
    const validateArmor = (state: ArmorState): undefined => {
      if (state.regular.kind !== "none" && state.regular.kind !== "q2") throw new Error("Native Q2 armor cannot store another game's armor record");
      if (state.powered.kind !== armor().powered.kind) throw new Error("Native power activation requires its original source equipment operation");
      return undefined;
    };
    const writeArmor = (state: ArmorState): undefined => {
      validateArmor(state);
      const value = client(), regular = state.regular;
      if (value === null) { if (regular.kind !== "none" || state.powered.kind !== "none") throw new Error("Native non-client armor requires its own source declaration"); return undefined; }
      if (regular.kind !== "none" && regular.kind !== "q2") throw new Error("Native Q2 armor cannot store another game's armor record");
      if (regular.kind === "q2" && regular.points !== 0 && !armorItems.includes(regular.item)) throw new Error("Unknown native armor item");
      const current = armor().regular;
      for (const item of armorItems) {
        if (regular.kind === "q2" && current.kind === "q2" && regular.item === current.item && item !== current.item) continue;
        const address = itemAddress(value, item), points = regular.kind === "q2" && regular.item === item ? regular.points : 0;
        if (memory.readInt32(address) !== points) memory.writeInt32(address, points);
      }
      if (state.powered.kind !== "none") memory.writeInt32(itemAddress(value, world.armor.cells), state.powered.cells);
      return undefined;
    };
    return { validateArmor, emptyRegularArmor: points => ({ kind: "q2", item: world.armor.empty, points,
      normalProtection: protection(world.armor.empty, world.armor.normal), energyProtection: protection(world.armor.empty, world.armor.energy) }), protection: {
      regular: { owner: memory.module.id, stage: damage.armorStage(view, armor, "regular") },
      powered: { owner: memory.module.id, stage: damage.armorStage(view, armor, "powered") },
    },
      normalizeLegacyArmor: legacy => normalizeLegacyPowerOnlyArmor(legacy, armor(), "q2:none"), ...source.combat({ armor, writeArmor, traits: () => {
      const value = client(), flags = memory.readUint64(source.at("flags"));
      const team = value === null ? 0 : publicState.playerState().teamId;
      const invincibleUntil = value !== null ? value.invincibleUntilMilliseconds()
        : (publicState.uint("svflags") & 4) !== 0 ? memory.readInt64(memory.offset(view.address, BigInt(world.monster.invincibleTime))) : 0n;
      return { invulnerable: (flags & BigInt(world.flags.godmode)) !== 0n || invincibleUntil > memory.readInt64(damage.entries.time),
        team: team > 0 ? `q2:${team}` : null, noKnockback: (flags & BigInt(world.flags.noKnockback)) !== 0n };
    } }), sourceDamage: request => damage.damageNative(request) };
  }
}
