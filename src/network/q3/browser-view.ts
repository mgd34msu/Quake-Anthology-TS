/* Q3 LAN_* list and request semantics from id Software cl_ui.c/cl_main.c.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import { CommonError } from "../../core/common-error.ts";
import { sourceCommandText } from "../../core/commands/text.ts";
import { setInfoValue } from "../../core/cvars/info.ts";
import { nativeAtoi } from "../../core/numeric.ts";
import { addressKey } from "../common/endpoint.ts";
import type { NetworkAddress } from "../common/endpoint.ts";
import type { DiscoveryRequestHandle, ServerBrowser, ServerStatus } from "../services/discovery.ts";

export type Q3BrowserSource = 0 | 1 | 2 | 3;
export interface Q3BrowserCacheRow {
  readonly address: NetworkAddress;
  readonly name: string;
  readonly visible: number;
  readonly ping: number;
}
export interface Q3BrowserCacheList { readonly source: 1 | 2 | 3; readonly rows: readonly Q3BrowserCacheRow[]; }
export interface Q3BrowserCacheView { readonly lists: readonly Q3BrowserCacheList[]; }
export interface Q3BrowserHost {
  readonly q3Core: ServerBrowser;
  q3List(source: Q3BrowserSource): { readonly addresses: readonly NetworkAddress[]; readonly pending: boolean; readonly generation: number; readonly resetGeneration: number };
  resolveQ3(text: string): Promise<NetworkAddress | null>;
  addQ3(source: Q3BrowserSource, address: NetworkAddress): void;
  removeQ3(source: Q3BrowserSource, address: NetworkAddress): void;
  scanQ3(): void;
  requestQ3Master(source: 1 | 2, remote: string, protocol: number, keywords: readonly string[], assertCurrent?: () => void): Promise<void>;
  loadQ3Cache(assertCurrent?: () => void): Promise<Q3BrowserCacheView | null>;
  saveQ3Cache(view: Q3BrowserCacheView): Promise<void>;
  assertOpen(): void;
}
export interface Q3BrowserViewOptions {
  readonly browser: Q3BrowserHost;
  now(): number;
  maxPing(): number;
  statusResendTime(): number;
  print(text: string): void;
}
interface Row { address: NetworkAddress | null; name: string; visible: number; ping: number; }
interface List { readonly rows: Row[]; readonly seen: Set<string>; overflow: NetworkAddress[]; count: number; generation: number; resetGeneration: number; pending: boolean; }
interface PingSlot { address: NetworkAddress | null; handle: DiscoveryRequestHandle | null; start: number; info: string; published: boolean; }
interface StatusSlot { address: NetworkAddress | null; handle: DiscoveryRequestHandle | null; start: number; retrieved: boolean; print: boolean; }
const sources: readonly Q3BrowserSource[] = [0, 1, 2, 3];
const cachedSources: readonly (1 | 2 | 3)[] = [1, 2, 3];
function emptyRow(): Row { return { address: null, name: "", visible: 0, ping: 0 }; }
function capacity(source: number): number { return source === 2 ? 4096 : source === 0 || source === 1 || source === 3 ? 128 : 0; }
function same(left: NetworkAddress | null, right: NetworkAddress | null): boolean {
  return left !== null && right !== null && addressKey(left) === addressKey(right);
}
function copyString(text: string, size: number): string {
  if (size < 1) throw new CommonError("fatal", "Q_strncpyz: destsize < 1");
  return text.slice(0, size - 1);
}
function slotAt<T>(slots: readonly T[], index: number): T {
  const slot = slots[index];
  if (!Number.isInteger(index) || slot === undefined) throw new RangeError(`Server browser source index ${index} outside ${slots.length}`);
  return slot;
}
function compareText(left: string, right: string): number {
  for (let index = 0; ; index++) {
    let a = left.charCodeAt(index) || 0, b = right.charCodeAt(index) || 0;
    a = (a << 24) >> 24; b = (b << 24) >> 24;
    if (a !== b) {
      if (a >= 97 && a <= 122) a -= 32;
      if (b >= 97 && b <= 122) b -= 32;
      if (a !== b) return a < b ? -1 : 1;
    }
    if (a === 0) return 0;
  }
}

/** ABI indices and request slots borrow canonical entries from the shared browser. */
export class Q3BrowserView {
  private readonly lists = new Map<Q3BrowserSource, List>(sources.map(source => [source,
    { rows: Array.from({ length: capacity(source) }, emptyRow), seen: new Set<string>(), overflow: [], count: 0, generation: -1, resetGeneration: -1, pending: false }]));
  private readonly pings: PingSlot[] = Array.from({ length: 32 }, () => ({ address: null, handle: null, start: 0, info: "", published: false }));
  private readonly statuses: StatusSlot[] = Array.from({ length: 16 }, () => ({ address: null, handle: null, start: 0, retrieved: true, print: false }));
  private closed = false;
  private generation = 0;
  constructor(readonly options: Q3BrowserViewOptions) {}
  private entry(generation = this.generation): void {
    if (this.closed || generation !== this.generation) throw new Error("Q3 browser view operation completed after close");
    this.options.browser.assertOpen();
  }
  private list(source: number): List | null {
    this.entry();
    if (source !== 0 && source !== 1 && source !== 2 && source !== 3) return null;
    const list = this.lists.get(source);
    if (list === undefined) throw new Error("Missing Q3 browser list");
    const state = this.options.browser.q3List(source);
    list.pending = state.pending;
    if (list.generation !== state.generation) {
      const resetting = state.resetGeneration !== list.resetGeneration;
      const previous = resetting ? [] : list.rows.slice(0, list.count);
      if (resetting) {
        list.seen.clear(); list.overflow = [];
        for (const row of list.rows) { row.address = null; row.name = ""; row.ping = 0; }
      }
      let count = 0;
      if (source === 2) {
        const addresses = state.addresses.slice(0, 8192), keys = new Set(addresses.map(address => addressKey(address)));
        for (const key of list.seen) if (!keys.has(key)) list.seen.delete(key);
        for (const row of previous) if (row.address !== null && keys.has(addressKey(row.address))) list.rows[count++] = { ...row };
        const active = new Set(list.rows.slice(0, count).flatMap(row => row.address === null ? [] : [addressKey(row.address)]));
        list.overflow = list.overflow.filter(address => keys.has(addressKey(address)) && !active.has(addressKey(address)));
        for (const address of addresses) {
          const key = addressKey(address); if (list.seen.has(key)) continue; list.seen.add(key);
          if (count < list.rows.length) { const row = slotAt(list.rows, count); list.rows[count++] = { address, name: "", visible: row.visible, ping: -1 }; }
          else if (list.overflow.length < 4096) list.overflow.push(address);
        }
      } else for (const address of state.addresses.slice(0, list.rows.length)) {
        const old = previous.find(row => same(row.address, address)), row = slotAt(list.rows, count++);
        list.rows[count - 1] = old === undefined ? { address, name: "", visible: row.visible, ping: -1 } : { ...old };
      }
      list.count = count; list.generation = state.generation; list.resetGeneration = state.resetGeneration;
    }
    return list;
  }
  private row(source: number, index: number): Row | null {
    const list = this.list(source);
    return list === null || !Number.isInteger(index) ? null : list.rows[index] ?? null;
  }
  private status(row: Row): ServerStatus | null { return row.address === null ? null : this.options.browser.q3Core.entry(row.address)?.status ?? null; }
  private name(row: Row): string { return sourceCommandText(this.status(row)?.name || row.name || (row.address === null ? "" : addressKey(row.address))).slice(0, 31); }
  private info(pairs: readonly (readonly [string, string])[]): string {
    let result = "";
    for (const [key, value] of pairs) result = setInfoValue(result, key, value, { dialect: "q3", maximumLength: 1024,
      target: "client-userinfo", serverHighCharacters: false, print: text => { this.options.print(text); this.entry(); } });
    return result;
  }
  getServerCount(source: number): number { const list = this.list(source); return list === null ? 0 : list.pending ? -1 : list.count; }
  getServerAddressString(source: number, index: number, size: number, write?: (text: string) => void): string {
    const row = this.row(source, index); if (row === null) return "";
    const text = row.address === null ? "bot" : addressKey(row.address); write?.(text); return copyString(text, size);
  }
  getServerInfo(source: number, index: number, size: number, write?: (text: string) => void): string {
    const row = this.row(source, index); if (row === null) return "";
    const status = this.status(row), rules = status?.rules;
    const text = this.info([["hostname", this.name(row)], ["mapname", sourceCommandText(status?.map ?? "").slice(0, 31)],
      ["clients", String(status?.players ?? 0)], ["sv_maxclients", String(status?.maxPlayers ?? 0)], ["ping", String(row.ping)],
      ["minping", String(nativeAtoi(rules?.get("minping") ?? ""))], ["maxping", String(nativeAtoi(rules?.get("maxping") ?? ""))],
      ["game", sourceCommandText(rules?.get("game") ?? "").slice(0, 31)], ["gametype", String(nativeAtoi(rules?.get("gametype") ?? ""))],
      ["nettype", row.address === null ? "0" : "1"], ["addr", row.address === null ? "bot" : addressKey(row.address)],
      ["punkbuster", String(nativeAtoi(rules?.get("punkbuster") ?? ""))]]);
    write?.(text); return copyString(text, size);
  }
  getServerPing(source: number, index: number): number { return this.row(source, index)?.ping ?? -1; }
  markServerVisibleValue(source: number, index: number, visible: number): void {
    const list = this.list(source); if (list === null) return;
    if (index === -1) for (const row of list.rows) row.visible = visible;
    else { const row = list.rows[index]; if (row !== undefined) row.visible = visible; }
  }
  serverVisibilityValue(source: number, index: number): number { return this.row(source, index)?.visible ?? 0; }
  resetPings(source: number): void { const list = this.list(source); if (list !== null) for (const row of list.rows) row.ping = -1; }
  compareServers(source: number, key: number, direction: number, first: number, second: number): number {
    const a = this.row(source, first), b = this.row(source, second); if (a === null || b === null) return 0;
    let compared = 0;
    if (key === 0) compared = compareText(this.name(a), this.name(b));
    else if (key === 1) compared = compareText((this.status(a)?.map ?? "").slice(0, 31), (this.status(b)?.map ?? "").slice(0, 31));
    else {
      const left = key === 2 ? this.status(a)?.players ?? 0 : key === 3 ? nativeAtoi(this.status(a)?.rules.get("gametype") ?? "") : key === 4 ? a.ping : 0;
      const right = key === 2 ? this.status(b)?.players ?? 0 : key === 3 ? nativeAtoi(this.status(b)?.rules.get("gametype") ?? "") : key === 4 ? b.ping : 0;
      compared = left < right ? -1 : left > right ? 1 : 0;
    }
    return direction === 0 || compared === 0 ? compared : -compared;
  }
  async addServer(source: number, name: () => string, address: () => string): Promise<-1 | 0 | 1> {
    const list = this.list(source); if (list === null || list.count >= list.rows.length) return -1;
    const generation = this.generation, resolved = await this.options.browser.resolveQ3(address()); this.entry(generation);
    if (resolved === null) throw new Error("LAN_AddServer: address resolution failed");
    if (list.rows.slice(0, list.count).some(row => same(row.address, resolved))) return 0;
    const row = slotAt(list.rows, list.count); row.address = resolved;
    row.name = sourceCommandText(name()).slice(0, 31); row.visible = 1;
    if (source !== 0 && source !== 1 && source !== 2 && source !== 3) return -1;
    this.options.browser.addQ3(source, resolved); list.count++; list.seen.add(addressKey(resolved));
    list.generation = this.options.browser.q3List(source).generation;
    return 1;
  }
  async removeServer(source: number, address: () => string): Promise<void> {
    const list = this.list(source); if (list === null) return;
    const generation = this.generation, resolved = await this.options.browser.resolveQ3(address()); this.entry(generation);
    if (resolved === null) throw new Error("LAN_RemoveServer: address resolution failed");
    const index = list.rows.slice(0, list.count).findIndex(row => same(row.address, resolved)); if (index < 0) return;
    if (source !== 0 && source !== 1 && source !== 2 && source !== 3) return;
    this.options.browser.removeQ3(source, resolved);
    for (let next = index; next < list.count - 1; next++) list.rows[next] = { ...slotAt(list.rows, next + 1) };
    list.count--; list.seen.delete(addressKey(resolved)); list.generation = this.options.browser.q3List(source).generation;
  }
  private release(handle: DiscoveryRequestHandle | null): void { if (handle !== null) this.options.browser.q3Core.releaseRequest(handle); }
  private publishPing(address: NetworkAddress, ping: number): void {
    for (const source of sources) { const list = this.list(source); if (list !== null) for (const row of list.rows) if (same(row.address, address)) row.ping = ping; }
  }
  getPingQueueCount(): number { this.entry(); return this.pings.filter(slot => slot.address !== null).length; }
  clearPing(index: number): void {
    this.entry(); const slot = this.pings[index]; if (slot === undefined) return;
    this.release(slot.handle); slot.address = null; slot.handle = null;
  }
  private pingTime(slot: PingSlot): number {
    const result = slot.handle === null ? null : this.options.browser.q3Core.requestResult(slot.handle);
    if (result?.kind === "completed") {
      let text = ""; for (const [key, value] of result.status.rules) text += `\\${key}\\${value}`;
      slot.info = setInfoValue(text, "nettype", "1", { dialect: "q3", maximumLength: 1024, target: "client-userinfo",
        serverHighCharacters: false, print: value => { this.options.print(value); this.entry(); } });
      return Math.trunc(result.pingMilliseconds) + 1;
    }
    return 0;
  }
  getPing(index: number, size: number, write?: (address: string | null) => void): { readonly address: string; readonly time: number } {
    this.entry(); const slot = slotAt(this.pings, index);
    if (slot.address === null) { write?.(null); return { address: "", time: 0 }; }
    const text = addressKey(slot.address); write?.(text); const address = copyString(text, size);
    const measured = this.pingTime(slot), elapsed = Math.trunc(this.options.now() - slot.start);
    const time = measured !== 0 ? measured : elapsed < Math.max(100, this.options.maxPing()) ? 0 : elapsed;
    this.publishPing(slot.address, measured); return { address, time };
  }
  sourcePingInfo(index: number, size: number, write?: (text: string) => void): string | null {
    this.entry(); const slot = slotAt(this.pings, index); if (slot.address === null) return null;
    this.pingTime(slot); write?.(slot.info); return copyString(slot.info, size);
  }
  private startPing(slot: PingSlot, address: NetworkAddress): void {
    this.release(slot.handle); slot.address = address; slot.start = this.options.now(); slot.published = false;
    slot.handle = this.options.browser.q3Core.request(address, slot.start, "info", null);
    if (slot.handle === null) { slot.address = null; throw new Error("Could not send Q3 ping"); }
  }
  updateVisiblePings(source: number): boolean {
    const list = this.list(source); if (list === null) return false;
    let count = this.getPingQueueCount(), active = false;
    for (const row of list.rows.slice(0, list.count)) {
      if (count >= 32) break;
      if (row.visible === 0) continue;
      if (source === 2 && row.ping === 0) {
        const address = list.overflow.pop();
        if (address !== undefined) { row.address = address; row.name = ""; row.ping = -1; }
        continue;
      }
      if (row.ping !== -1 || row.address === null || this.pings.some(slot => same(slot.address, row.address))) continue;
      const slot = this.pings.find(slot => slot.address === null); if (slot === undefined) break;
      this.startPing(slot, row.address); count++; active = true;
    }
    if (count !== 0) active = true;
    for (let index = 0; index < this.pings.length; index++) if (slotAt(this.pings, index).address !== null && this.getPing(index, 1024).time !== 0) this.clearPing(index);
    return active;
  }
  localServers(): void { this.entry(); this.options.browser.scanQ3(); this.list(0); }
  async globalServers(source: 1 | 2, remote: string, protocol: number, keywords: readonly string[]): Promise<void> {
    this.entry(); const generation = this.generation;
    await this.options.browser.requestQ3Master(source, remote, protocol, keywords, () => { this.entry(generation); }); this.entry(generation); this.list(source);
  }
  async ping(address: string): Promise<void> {
    this.entry(); const generation = this.generation, resolved = await this.options.browser.resolveQ3(address); this.entry(generation);
    if (resolved === null) return;
    const now = this.options.now();
    let slot = this.pings.find(slot => slot.address === null || (this.pingTime(slot) === 0 ? now - slot.start >= 500 : this.pingTime(slot) >= 500));
    if (slot === undefined) slot = this.pings.reduce((oldest, next) => next.start < oldest.start ? next : oldest);
    this.startPing(slot, resolved); this.publishPing(resolved, 0);
  }
  private statusSlot(address: NetworkAddress): StatusSlot {
    return this.statuses.find(slot => same(slot.address, address)) ?? this.statuses.find(slot => slot.retrieved)
      ?? this.statuses.reduce((oldest, next) => next.start < oldest.start ? next : oldest);
  }
  private statusText(status: ServerStatus): string {
    let text = ""; for (const [key, value] of status.rules) text += `\\${key}\\${value}`;
    text = text.slice(0, 8191) + "\\";
    for (const player of status.playerDetails) text = (text + `\\${player.score} ${player.ping} "${player.name}"`).slice(0, 8191);
    return (text + "\\").slice(0, 8191);
  }
  private startStatus(slot: StatusSlot, address: NetworkAddress): void {
    this.release(slot.handle); slot.address = address; slot.start = this.options.now(); slot.retrieved = false;
    slot.handle = this.options.browser.q3Core.request(address, slot.start, "status", null);
    if (slot.handle === null) { slot.retrieved = true; throw new Error("Could not send Q3 server status request"); }
  }
  async serverStatus(address: string | null, size: number | null, write?: (text: string) => void): Promise<string | null> {
    this.entry();
    if (address === null) { for (const slot of this.statuses) { this.release(slot.handle); slot.handle = null; slot.address = null; slot.retrieved = true; slot.print = false; } return null; }
    const generation = this.generation, resolved = await this.options.browser.resolveQ3(address); this.entry(generation);
    if (resolved === null) return null;
    if (size === null) {
      const slot = this.statuses.find(slot => same(slot.address, resolved));
      if (slot !== undefined) { this.release(slot.handle); slot.handle = null; slot.address = null; slot.retrieved = true; slot.print = false; }
      return null;
    }
    const slot = this.statusSlot(resolved);
    if (!same(slot.address, resolved) && !slot.retrieved) return null;
    const result = slot.handle === null ? null : this.options.browser.q3Core.requestResult(slot.handle);
    if (same(slot.address, resolved) && result?.kind === "completed") {
      const text = this.statusText(result.status); write?.(text); const value = copyString(text, size);
      slot.retrieved = true; slot.start = 0; return value;
    }
    if (!same(slot.address, resolved) || slot.handle === null || slot.start < this.options.now() - this.options.statusResendTime()) {
      slot.print = false; this.startStatus(slot, resolved);
    }
    return null;
  }
  async serverStatusCommand(address: string): Promise<void> {
    this.entry(); const generation = this.generation, resolved = await this.options.browser.resolveQ3(address); this.entry(generation);
    if (resolved === null) return;
    const slot = this.statusSlot(resolved); this.startStatus(slot, resolved); slot.print = true;
  }
  poll(): void {
    this.entry();
    for (const slot of this.pings) {
      if (slot.address === null || slot.published) continue;
      const time = this.pingTime(slot);
      if (time !== 0) { this.publishPing(slot.address, time); slot.published = true; }
    }
    for (const slot of this.statuses) {
      if (!slot.print || slot.handle === null) continue;
      const result = this.options.browser.q3Core.requestResult(slot.handle); if (result?.kind !== "completed") continue;
      this.options.print("Server settings:\n");
      for (const [key, value] of result.status.rules) this.options.print(`${key.padEnd(24, " ")}${value}\n`);
      this.options.print("\nPlayers:\nnum: score: ping: name:\n");
      result.status.playerDetails.forEach((player, index) => this.options.print(`${String(index).padEnd(2, " ")}   ${String(player.score).padEnd(3, " ")}    ${String(player.ping).padEnd(3, " ")}   "${player.name}"\n`));
      slot.print = false; slot.retrieved = true; this.entry();
    }
  }
  async loadCachedServers(): Promise<void> {
    this.entry(); const generation = this.generation, cache = await this.options.browser.loadQ3Cache(() => { this.entry(generation); }); this.entry(generation);
    for (const source of cachedSources) {
      const list = this.list(source); if (list === null) continue;
      const saved = cache?.lists.find(value => value.source === source);
      if (saved === undefined) continue;
      if (source === 2) {
        const canonical = this.options.browser.q3List(source).addresses, keys = new Set(canonical.map(address => addressKey(address)));
        const selected = saved.rows.filter(row => keys.has(addressKey(row.address)));
        list.count = Math.min(selected.length, list.rows.length);
        for (let index = 0; index < list.rows.length; index++) {
          const row = selected[index]; list.rows[index] = row === undefined ? emptyRow() : { ...row };
        }
        list.seen.clear(); for (const address of canonical) list.seen.add(addressKey(address)); list.overflow = [];
      } else for (let index = 0; index < list.rows.length; index++) {
        const current = slotAt(list.rows, index);
        const row = index < list.count ? saved.rows.find(row => same(row.address, current.address)) : undefined;
        list.rows[index] = row !== undefined ? { ...row } : index < list.count ? current : emptyRow();
      }
    }
  }
  async saveServersToCache(): Promise<void> {
    this.entry(); const generation = this.generation, lists: Q3BrowserCacheList[] = [];
    for (const source of cachedSources) {
      const list = this.list(source); if (list === null) continue;
      const rows: Q3BrowserCacheRow[] = [];
      for (const row of list.rows.slice(0, list.count)) if (row.address !== null) rows.push({ ...row, address: row.address });
      lists.push({ source, rows });
    }
    await this.options.browser.saveQ3Cache({ lists }); this.entry(generation);
  }
  close(): void {
    if (this.closed) return; this.closed = true; this.generation++;
    for (const slot of [...this.pings, ...this.statuses]) { this.release(slot.handle); slot.handle = null; slot.address = null; }
  }
}
