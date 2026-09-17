import type { ContentId, ResourceId } from "../../contracts/content.ts";
import type { ItemId } from "../../contracts/gameplay.ts";
import { parseQ1WeaponWheel, q1WheelItems, type Q1WheelSlot } from "../../ui/hud/q1-wheel.ts";
import type { WheelItem } from "../../ui/hud/wheel.ts";
import type { ApplicationAssets } from "./assets.ts";
import type { PlayerUi } from "./simulation/types.ts";
import type { ApplicationWeaponHudAssets } from "./weapon-hud.ts";

const baseItems: readonly ItemId[] = ["q1:weapon/axe", "q1:weapon/shotgun", "q1:weapon/supershotgun", "q1:weapon/nailgun", "q1:weapon/supernailgun", "q1:weapon/grenadelauncher", "q1:weapon/rocketlauncher", "q1:weapon/lightning"];
export function q1WheelSlotItem(slot: Q1WheelSlot, campaign: string): ItemId | null {
  const impulse = slot.impulse;
  if (impulse === null) return null;
  if (impulse >= 1 && impulse <= 8) return baseItems[impulse - 1] ?? null;
  if (campaign === "hipnotic") return impulse === 225 ? "q1:weapon/hipnotic:laser" : impulse === 226 ? "q1:weapon/hipnotic:mjolnir" : impulse === 227 ? "q1:weapon/hipnotic:proximity" : impulse === 228 ? "q1:weapon/grenadelauncher" : null;
  if (campaign === "mg3") return impulse === 225 ? "q1:weapon/mg3:laser" : null;
  if (campaign === "ctf") return impulse === 22 ? "q1:weapon/ctf:grapple" : null;
  if (campaign === "rogue") {
    if (impulse === 22) return "q1:weapon/rogue:grapple";
    const powered: readonly ItemId[] = ["q1:weapon/rogue:lava-nailgun", "q1:weapon/rogue:lava-supernailgun", "q1:weapon/rogue:multi-grenade", "q1:weapon/rogue:multi-rocket", "q1:weapon/rogue:plasma"];
    if (impulse >= 60 && impulse <= 64) return powered[impulse - 60] ?? null;
    if (impulse >= 65 && impulse <= 68) return baseItems[impulse - 62] ?? null;
  }
  return null;
}

export class ApplicationQ1Wheel {
  private content: ContentId | null = null;
  private campaign = "";
  private slots: readonly Q1WheelSlot[] = [];
  private readonly images = new Map<string, ResourceId>();
  async prepare(assets: ApplicationAssets, icons: ApplicationWeaponHudAssets, player: PlayerUi): Promise<void> {
    const source = player.weaponStatus?.source;
    if (source === undefined) { this.slots = []; this.content = null; return; }
    if (source.content === this.content) return;
    this.content = source.content; this.slots = []; this.images.clear();
    const product = assets.content.catalog.product(source.content).expectation;
    if (product.family !== "q1" || product.edition !== "rerelease") return;
    this.campaign = product.campaign;
    const provider = await assets.provider(source.content), file = await provider.mounts.open("wwheel.txt");
    if (file === null) return;
    const parsed = parseQ1WeaponWheel(new TextDecoder().decode(file.bytes));
    if (parsed.errors.length !== 0) throw new Error(`Invalid authored weapon wheel: ${parsed.errors.join("; ")}`);
    this.slots = parsed.slots;
    for (const slot of this.slots) for (const path of [slot.icon, slot.selectedIcon]) {
      if (path !== null && !this.images.has(path)) this.images.set(path, await icons.load({ kind: "image", resource: { content: source.content, path } }));
    }
  }
  switchWeapon(player: PlayerUi, first: number, second: number): ItemId | null {
    const resolve = (ordinal: number) => {
      if (!Number.isInteger(ordinal) || ordinal < 0) return undefined;
      const slot = this.slots.find(slot => slot.slot === ordinal);
      const id = slot === undefined ? baseItems[ordinal === 7 ? 0 : ordinal + 1] : this.slotItem(slot, player);
      return player.items.find(item => item.id === id && item.owned);
    };
    const a = resolve(first), b = resolve(second);
    return (a?.id === player.activeWeapon ? b ?? a : a ?? b)?.id ?? null;
  }
  private slotItem(slot: Q1WheelSlot, player: PlayerUi): ItemId | null {
    if (this.campaign === "mg3" && slot.impulse === 1 && player.items.some(item => item.id === "q1:weapon/mg3:mjolnir" && item.owned)) return "q1:weapon/mg3:mjolnir";
    return q1WheelSlotItem(slot, this.campaign);
  }
  items(player: PlayerUi): readonly WheelItem[] | null {
    if (this.slots.length === 0) return null;
    const item = (slot: Q1WheelSlot) => player.items.find(item => item.id === this.slotItem(slot, player));
    const bits = this.slots.reduce((value, slot) => value | (item(slot)?.owned ? slot.weaponBits ?? 0 : 0), 0);
    const values = q1WheelItems(this.slots, { items: bits,
      entityFloat: offset => { const slot = this.slots.find(slot => slot.entityVariableByteOffset === offset); return slot === undefined ? 0 : item(slot)?.count ?? 0; },
      label: slot => item(slot)?.label ?? `Slot ${slot.slot + 1}`, image: path => this.images.get(path) ?? null });
    return values.map(value => {
      const slot = this.slots.find(slot => slot.slot === value.sourceOrdinal), selected = slot === undefined ? undefined : item(slot);
      return { ...value, id: selected?.id ?? value.id, owned: selected?.owned ?? false, hasAmmo: selected?.hasAmmo ?? false };
    });
  }
}
