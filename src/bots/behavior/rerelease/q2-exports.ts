// quake2-rerelease-dll/rerelease/bots/bot_exports.cpp; GPL-2.0-or-later.
// Source operations act through the selected game's existing inventory/callback owner.
import { bvecSub, vectorToAngles, type BotVec3 } from "./math.ts";

export interface Q2BotClientView {
  readonly inuse: boolean; readonly bot: boolean;
  readonly client: null | {
    readonly currentWeapon: number; readonly pendingWeapon: number; readonly selectedItem: number;
    readonly origin: BotVec3; readonly viewOffset: BotVec3; readonly commandAngles: BotVec3;
  };
}
export interface Q2BotItemView {
  readonly id: number; readonly classname: string | null;
  readonly weapon: boolean; readonly useCallback: string | null;
}
export interface Q2BotEntityView {
  readonly inuse: boolean; readonly useCallback: string | null; readonly touchCallback: string | null;
}
export interface Q2BotExportsHost {
  readonly itemCount: number;
  bot(entity: number): Q2BotClientView | null;
  entity(entity: number): Q2BotEntityView | null;
  item(item: number): Q2BotItemView | null;
  inventory(entity: number, item: number): number;
  setSelectedItem(entity: number, item: number): void;
  validateSelectedItem(entity: number): void;
  disableWeaponChains(entity: number): void;
  useItem(callback: string, entity: number, item: number): void;
  /** The arsenal owns ChangeWeapon and the scoped g_instant_weapon_switch override. */
  changeWeaponInstantly(entity: number): void;
  triggerUse(callback: string, target: number, other: number, activator: number): void;
  triggerTouch(callback: string, target: number, other: number, otherTouchingSelf: boolean): void;
  forceLook(entity: number, deltaAngles: BotVec3): void;
  pickedUpBy(itemEntity: number, sourceClient: number): boolean;
}

export function Bot_SetWeapon(host: Q2BotExportsHost, entity: number, weapon: number, instantSwitch: boolean): void {
  if (weapon <= 0 || weapon > host.itemCount) return;
  const bot = host.bot(entity);
  if (bot === null || !bot.bot || bot.client === null || host.inventory(entity, weapon) === 0) return;
  if (bot.client.currentWeapon === weapon || bot.client.pendingWeapon === weapon) return;
  const item = host.item(weapon);
  if (item === null || !item.weapon || item.useCallback === null) return;
  host.disableWeaponChains(entity);
  host.useItem(item.useCallback, entity, item.id);
  if (instantSwitch) host.changeWeaponInstantly(entity);
}

export function Bot_TriggerEdict(host: Q2BotExportsHost, entity: number, target: number): void {
  const bot = host.bot(entity), initial = host.entity(target);
  if (bot === null || !bot.inuse || !bot.bot || initial === null || !initial.inuse) return;
  if (initial.useCallback !== null) host.triggerUse(initial.useCallback, target, entity, entity);
  const reached = host.entity(target);
  if (reached !== null && reached.touchCallback !== null) host.triggerTouch(reached.touchCallback, target, entity, true);
}

export function Bot_UseItem(host: Q2BotExportsHost, entity: number, itemId: number): void {
  const bot = host.bot(entity);
  if (bot === null || !bot.inuse || !bot.bot || bot.client === null) return;
  host.setSelectedItem(entity, itemId);
  host.validateSelectedItem(entity);
  const selected = host.bot(entity)?.client?.selectedItem;
  if (selected === undefined || selected === 0 || selected !== itemId) return;
  const item = host.item(selected);
  host.setSelectedItem(entity, 0);
  if (item?.useCallback === undefined || item.useCallback === null) return;
  host.disableWeaponChains(entity);
  host.useItem(item.useCallback, entity, item.id);
}

export function Bot_GetItemID(host: Pick<Q2BotExportsHost, "item" | "itemCount">, classname: string | null): number {
  if (classname === null || classname.length === 0 || classname.charAt(0) === "\0") return -1;
  const name = classname.split("\0", 1)[0]?.toLowerCase();
  if (name === "none") return 0;
  for (let index = 0; index < host.itemCount; index++) {
    const item = host.item(index);
    if (item?.classname !== undefined && item.classname !== null && item.classname.length !== 0 && item.classname.toLowerCase() === name) return item.id;
  }
  return -1;
}

export function Edict_ForceLookAtPoint(host: Q2BotExportsHost, entity: number, point: BotVec3): void {
  const client = host.bot(entity)?.client;
  if (client === undefined || client === null) return;
  const eye = { x: client.origin.x + client.viewOffset.x, y: client.origin.y + client.viewOffset.y, z: client.origin.z + client.viewOffset.z };
  const angles = vectorToAngles(bvecSub(point, eye));
  host.forceLook(entity, { x: angles.pitch - client.commandAngles.x, y: angles.yaw - client.commandAngles.y, z: -client.commandAngles.z });
}

export function Bot_PickedUpItem(host: Q2BotExportsHost, entity: number, itemEntity: number): boolean {
  return host.pickedUpBy(itemEntity, entity - 1);
}
