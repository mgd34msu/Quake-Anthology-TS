import { fetchServerMasterList } from "./server-master-list.ts";
import { ServerBrowser } from "../../network/services/discovery.ts";
import type { BrowserEntry, DiscoverySource } from "../../network/services/discovery.ts";
import { UdpTransport } from "../../network/common/transport.ts";
import { addressHost, addressKey, ipv4Address, resolveAddress } from "../../network/common/endpoint.ts";
import type { NetworkAddress } from "../../network/common/endpoint.ts";
import { netQuakeDiscoveryWire, readNetQuakeDiscovery, quakeWorldDiscoveryWire, readQuakeWorldDiscovery } from "../../network/q1/discovery.ts";
import { q2DiscoveryWire, readQ2Status, readQ2MasterReply } from "../../network/q2/connectionless.ts";
import { readQ2OutOfBand } from "../../network/q2/handshake.ts";
import { q3DiscoveryWire, decodeQ3ServerStatus, decodeQ3MasterPacket } from "../../network/q3/discovery.ts";
import type { Q3BrowserCacheView, Q3BrowserSource } from "../../network/q3/browser-view.ts";
import { readQ3BrowserCache, writeQ3BrowserCache } from "./server-browser-cache.ts";
import { ConfigStore } from "../../settings/config.ts";
import { directServerText, maximumDirectServers, readDirectServers } from "./server-browser-addresses.ts";
import type { DirectServerAddress } from "./server-browser-addresses.ts";

export type BrowserProtocol = "q1" | "qw" | "q2" | "q3";
export interface BrowserConnection { readonly protocol: BrowserProtocol; readonly remote: string; }
export type BrowserSortOrder = "ping-low" | "ping-high" | "name-az" | "name-za" | "map-az" | "map-za" | "players-most" | "players-fewest";
export const browserSortOrders: readonly { readonly id: BrowserSortOrder; readonly label: string }[] = [
  { id: "ping-low", label: "Ping: lowest first" }, { id: "ping-high", label: "Ping: highest first" },
  { id: "name-az", label: "Name: A to Z" }, { id: "name-za", label: "Name: Z to A" },
  { id: "map-az", label: "Map: A to Z" }, { id: "map-za", label: "Map: Z to A" },
  { id: "players-most", label: "Players: most first" }, { id: "players-fewest", label: "Players: fewest first" },
];
const protocols: readonly BrowserProtocol[] = ["q1", "qw", "q2", "q3"];
const ports = { q1: 26000, qw: 27500, q2: 27910, q3: 27960 };
const q3Sources: Readonly<Record<Q3BrowserSource, DiscoverySource>> = { 0: "lan", 1: "secondary-master", 2: "master", 3: "favorite" };
export function browserAddress(address: NetworkAddress): string {
  if (address.kind !== "ipv4" && address.kind !== "ipv6") throw new Error("Server requires an IP address");
  return `${address.kind === "ipv6" ? `[${addressHost(address)}]` : addressHost(address)}:${address.port}`;
}
export class StartupServerBrowser {
  private readonly browsers: ReadonlyMap<BrowserProtocol, ServerBrowser>;
  private readonly directServers = new Map<BrowserProtocol, readonly DirectServerAddress[]>();
  private readonly addresses = new Map<BrowserProtocol, string>();
  private writes: Promise<void> = Promise.resolve();
  private closing = false;
  private closed = false;
  private closeResult: Promise<void> | null = null;
  private generation = 0;
  private readonly listGenerations = new Map<Q3BrowserSource, number>();
  private readonly listSnapshots = new Map<Q3BrowserSource, { readonly generation: number; readonly addresses: readonly NetworkAddress[] }>();
  private readonly listResets = new Map<Q3BrowserSource, number>();
  private masterEpoch = 0;
  private master: { readonly source: 1 | 2; readonly address: NetworkAddress | null; readonly startedAt: number; readonly received: boolean } | null = null;
  private cachedView: Q3BrowserCacheView | null = null;
  private masterFetch: AbortController | null = null;
  private q2Master: { readonly address: NetworkAddress; readonly startedAt: number } | null = null;
  private readonly pendingStatus = new Map<string, { readonly protocol: BrowserProtocol; readonly address: NetworkAddress }>();
  private readonly masterAddresses = new Map<BrowserProtocol, string>();
  get masterAddress(): string { return this.masterAddresses.get(this.protocol) ?? ""; }
  set masterAddress(value: string) { this.masterAddresses.set(this.protocol, value); }
  protocol: BrowserProtocol = "q1";
  get address(): string { return this.addresses.get(this.protocol) ?? `localhost:${ports[this.protocol]}`; }
  set address(value: string) { this.addresses.set(this.protocol, value); }
  filter = "";
  favoritesOnly = false;
  sortOrder: BrowserSortOrder = "ping-low";
  hideEmpty = false;
  hideFull = false;
  selected: string | null = null;
  status = "";
  private constructor(private readonly transport: UdpTransport, private readonly config: ConfigStore) {
    const sender = { send: (to: NetworkAddress, bytes: Uint8Array): boolean =>
      to.kind === "ipv4" || to.kind === "ipv6" ? transport.send(to, bytes) : false };
    this.browsers = new Map<BrowserProtocol, ServerBrowser>(protocols.map(protocol => [protocol, new ServerBrowser(protocol === "q1" ? netQuakeDiscoveryWire()
      : protocol === "qw" ? quakeWorldDiscoveryWire() : protocol === "q2" ? (() => { const wire = q2DiscoveryWire({ kind: "q2-classic", version: 34 }, () => ({ serverInfo: "", players: [] })); return { ...wire, query: (_kind: "info" | "status", challenge: string) => wire.query("status", challenge) }; })() : q3DiscoveryWire(), sender)]));
  }
  static async open(config: ConfigStore): Promise<StartupServerBrowser> {
    const transport = await UdpTransport.bind({ host: "0.0.0.0", port: 0, broadcast: true });
    const result = new StartupServerBrowser(transport, config);
    try {
      for (const protocol of protocols) { const saved = await config.loadText(`servers-${protocol}`); if (saved !== null) { if (saved.length > 65536) throw new Error("Saved server list is too large"); result.browser(protocol).restoreFavorites(saved); for (const address of result.browser(protocol).favoriteAddresses()) browserAddress(address); } }
      for (const protocol of protocols) {
        const master = await config.loadText(`servers-master-${protocol}`);
        if (master !== null && master.trim().length <= 2048) result.masterAddresses.set(protocol, master.trim());
        const saved = await config.loadText(`servers-direct-${protocol}`);
        if (saved === null) continue;
        const servers = readDirectServers(saved);
        result.directServers.set(protocol, servers);
        for (const server of servers) result.browser(protocol).add(server.address, "direct");
        const last = servers[0];
        if (last !== undefined) result.addresses.set(protocol, last.remote);
      }
      await result.loadQ3Cache();
      return result;
    } catch (error) { transport.close(); throw error; }
  }
  private browser(protocol = this.protocol): ServerBrowser {
    const value = this.browsers.get(protocol); if (value === undefined) throw new Error("Unsupported browser protocol"); return value;
  }
  assertOpen(): void { if (this.closing || this.closed) throw new Error("Server browser is closed"); }
  private assertGeneration(generation: number, draining = false): void {
    if (this.closed || !draining && this.closing || generation !== this.generation) throw new Error("Server browser operation was retired");
  }
  get q3Core(): ServerBrowser { this.assertOpen(); return this.browser("q3"); }
  q3List(source: Q3BrowserSource): { readonly addresses: readonly NetworkAddress[]; readonly pending: boolean; readonly generation: number; readonly resetGeneration: number } {
    this.assertOpen();
    const generation = this.listGenerations.get(source) ?? 0;
    let snapshot = this.listSnapshots.get(source);
    if (snapshot === undefined || snapshot.generation !== generation) {
      snapshot = { generation, addresses: this.browser("q3").list().filter(entry => entry.sources.includes(q3Sources[source])).map(entry => entry.address) };
      this.listSnapshots.set(source, snapshot);
    }
    return { addresses: snapshot.addresses,
      pending: this.master?.source === source && !this.master.received,
      generation, resetGeneration: this.listResets.get(source) ?? 0 };
  }
  private clearQ3(source: Q3BrowserSource): void {
    const core = this.browser("q3");
    for (const entry of core.list()) core.removeSource(entry.address, q3Sources[source]);
    this.listGenerations.set(source, (this.listGenerations.get(source) ?? 0) + 1);
    this.listResets.set(source, (this.listResets.get(source) ?? 0) + 1);
  }
  async resolveQ3(text: string): Promise<NetworkAddress | null> {
    this.assertOpen(); const generation = this.generation;
    let address: NetworkAddress;
    try { address = await resolveAddress(directServerText(text), 27960, 4); }
    catch { this.assertGeneration(generation); return null; }
    this.assertGeneration(generation);
    return address.kind === "ipv4" && address.port !== 0 && !address.host.every(octet => octet === 255) ? address : null;
  }
  addQ3(source: Q3BrowserSource, address: NetworkAddress): void {
    this.assertOpen();
    if (address.kind !== "ipv4" || address.port === 0) throw new Error("Q3 browser requires an IPv4 endpoint");
    const core = this.browser("q3"), entries = core.list().filter(entry => entry.sources.includes(q3Sources[source]));
    if (entries.some(entry => addressKey(entry.address) === addressKey(address))) return;
    if (entries.length >= (source === 2 ? 8192 : 128)) throw new Error("Q3 browser list is full");
    core.add(address, q3Sources[source]);
    this.listGenerations.set(source, (this.listGenerations.get(source) ?? 0) + 1);
  }
  removeQ3(source: Q3BrowserSource, address: NetworkAddress): void {
    this.assertOpen(); this.browser("q3").removeSource(address, q3Sources[source]);
    this.listGenerations.set(source, (this.listGenerations.get(source) ?? 0) + 1);
  }
  scanQ3(): void {
    this.assertOpen(); this.clearQ3(0);
    this.browser("q3").broadcast(Array.from({ length: 4 }, (_, index) => ipv4Address([255, 255, 255, 255], 27960 + index)), performance.now());
  }
  async requestQ3Master(source: 1 | 2, remote: string, protocol: number, keywords: readonly string[], assertCurrent: () => void = () => {}): Promise<void> {
    this.assertOpen(); assertCurrent(); const bytes = q3DiscoveryWire(keywords, protocol).masterQuery(), generation = this.generation, epoch = ++this.masterEpoch;
    this.clearQ3(source); this.master = { source, address: null, startedAt: performance.now(), received: false };
    try {
      const address = await resolveAddress(directServerText(remote), 27950, 4);
      this.assertGeneration(generation); assertCurrent();
      if (epoch !== this.masterEpoch) return;
      this.master = { source, address, startedAt: performance.now(), received: false };
      if (!this.transport.send(address, bytes)) throw new Error("Could not send Q3 master query");
    } catch (error) { if (epoch === this.masterEpoch) this.master = null; throw error; }
  }
  loadQ3Cache(assertCurrent: () => void = () => {}): Promise<Q3BrowserCacheView | null> {
    assertCurrent();
    let view: Q3BrowserCacheView | null = null;
    return this.persist(async () => {
      const generation = this.generation, saved = await this.config.loadText("servers-cache-q3");
      this.assertGeneration(generation, true); assertCurrent();
      if (saved === null) return;
      const cache = readQ3BrowserCache(saved);
      const live = new Map(this.browser("q3").list().filter(entry => entry.status !== null).map(entry => [addressKey(entry.address), entry]));
      for (const source of [1, 2, 3] satisfies readonly Q3BrowserSource[]) this.clearQ3(source);
      this.masterEpoch++; this.master = null;
      for (const entry of cache.entries) {
        const current = live.get(addressKey(entry.address));
        this.browser("q3").restoreEntry(current === undefined ? entry : { ...entry, status: current.status, pingMilliseconds: current.pingMilliseconds, updatedAt: current.updatedAt });
      }
      view = cache.view;
      this.cachedView = cache.view;
    }).then(() => view);
  }
  saveQ3Cache(view: Q3BrowserCacheView): Promise<void> {
    return this.persist(async () => {
      const generation = this.generation;
      await this.config.dump("servers-cache-q3", writeQ3BrowserCache(this.browser("q3").list(), view));
      this.assertGeneration(generation, true);
      this.cachedView = view;
    });
  }
  private currentCacheView(): Q3BrowserCacheView | null {
    const cached = this.cachedView;
    if (cached === null) return null;
    return { lists: cached.lists.map(list => {
      const entries = this.browser("q3").list().filter(entry => entry.sources.includes(q3Sources[list.source])), keys = new Set(entries.map(entry => addressKey(entry.address)));
      const rows = list.rows.filter(row => keys.has(addressKey(row.address))), retained = new Set(rows.map(row => addressKey(row.address))), capacity = list.source === 2 ? 4096 : 128;
      for (const entry of entries) {
        if (rows.length >= capacity) break;
        if (!retained.has(addressKey(entry.address))) rows.push({ address: entry.address, name: entry.status?.name.slice(0, 31) ?? "", visible: 1, ping: -1 });
      }
      return { source: list.source, rows };
    }) };
  }
  choose(protocol: string): void {
    if (protocol !== "q1" && protocol !== "qw" && protocol !== "q2" && protocol !== "q3") throw new Error("Unsupported server protocol");
    this.protocol = protocol; this.selected = null;
  }
  chooseSort(order: string): void {
    const selected = browserSortOrders.find(choice => choice.id === order);
    if (selected === undefined) throw new Error("Unsupported server sort order");
    this.sortOrder = selected.id;
  }
  get selectedEntry(): BrowserEntry | null { return this.browser().list().find(entry => addressKey(entry.address) === this.selected) ?? null; }
  details(): readonly string[] {
    const entry = this.selectedEntry;
    if (entry === null) return ["Select a server first."];
    const status = entry.status;
    if (status === null) return [browserAddress(entry.address), "No status response yet."];
    const clean = (value: string): string => value.replace(/[\x00-\x1f\x7f]/g, " ");
    return [clean(status.name), browserAddress(entry.address), `Map: ${clean(status.map)}  Players: ${status.players}/${status.maxPlayers}`,
      ...status.playerDetails.map(player => `${clean(player.name)}  score ${player.score}  ping ${player.ping}`),
      ...[...status.rules].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${clean(key)}: ${clean(value)}`)];
  }
  private queueStatus(protocol: BrowserProtocol, address: NetworkAddress): void {
    this.pendingStatus.set(`${protocol}:${addressKey(address)}`, { protocol, address });
  }
  async discover(): Promise<void> {
    this.assertOpen();
    const protocol = this.protocol, remote = this.masterAddress.trim(), generation = this.generation;
    if (remote === "") throw new Error("Enter a master address or HTTP list URL");
    this.masterFetch?.abort(); const controller = new AbortController(); this.masterFetch = controller;
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      if (/^https?:\/\//i.test(remote)) {
        const names = await fetchServerMasterList(remote, controller.signal), addresses: NetworkAddress[] = [];
        for (let offset = 0; offset < names.length; offset += 16) {
          const batch = await Promise.all(names.slice(offset, offset + 16).map(name => resolveAddress(name, ports[protocol], 4)));
          this.assertGeneration(generation); controller.signal.throwIfAborted(); addresses.push(...batch);
        }
        const core = this.browser(protocol);
        for (const address of addresses) {
          if (core.size >= 4096 && core.entry(address) === null) break;
          if (protocol === "q3") this.addQ3(2, address); else core.add(address, "master");
          this.queueStatus(protocol, address);
        }
        this.status = `Found ${addresses.length} servers; querying status`;
      } else if (protocol === "q2") {
        const address = await resolveAddress(directServerText(remote.replace(/^udp:\/\//, "")), 27900, 4);
        this.assertGeneration(generation); controller.signal.throwIfAborted();
        this.q2Master = { address, startedAt: performance.now() };
        if (!this.browser(protocol).queryMaster(address)) throw new Error("Could not send master query");
        this.status = "Querying master...";
      } else if (protocol === "q3") { await this.requestQ3Master(2, remote.replace(/^udp:\/\//, ""), 68, ["empty", "full"]); this.status = "Querying master..."; }
      else throw new Error("Use an HTTP master list for Quake or QuakeWorld");
      await this.persist(async () => { this.assertGeneration(generation); await this.config.dump(`servers-master-${protocol}`, remote); });
      this.assertGeneration(generation);
    } finally { clearTimeout(timeout); if (this.masterFetch === controller) this.masterFetch = null; }
  }
  get emptyMessage(): string {
    return this.browser().list().length === 0 ? "No servers yet. Enter an address or find LAN." : "No servers match these filters.";
  }
  rows(): readonly BrowserEntry[] {
    const search = this.filter.trim().toLowerCase();
    return this.browser().list().filter(entry => (!this.favoritesOnly || entry.sources.includes("favorite"))
      && (entry.status === null || entry.status.maxPlayers <= 0 || (!this.hideEmpty || entry.status.players > 0) && (!this.hideFull || entry.status.players < entry.status.maxPlayers))
      && `${entry.status?.name ?? ""} ${entry.status?.map ?? ""} ${entry.status?.rules.get("gamedir") ?? entry.status?.rules.get("game") ?? ""} ${entry.status?.playerDetails.map(player => player.name.replace(/\^[0-9]/g, "")).join(" ") ?? ""} ${browserAddress(entry.address)}`.toLowerCase().includes(search))
      .sort((a, b) => {
        // Q2's source keeps unanswered rows last in either direction and treats 0/0 as unknown capacity.
        if ((a.status === null) !== (b.status === null)) return a.status === null ? 1 : -1;
        let compared = 0;
        switch (this.sortOrder) {
          case "ping-low": case "ping-high": {
            if ((a.pingMilliseconds === null) !== (b.pingMilliseconds === null)) return a.pingMilliseconds === null ? 1 : -1;
            compared = ((a.pingMilliseconds ?? 0) - (b.pingMilliseconds ?? 0)) * (this.sortOrder === "ping-low" ? 1 : -1); break;
          }
          case "name-az": case "name-za": compared = (a.status?.name ?? "").localeCompare(b.status?.name ?? "", undefined, { sensitivity: "base" }) * (this.sortOrder === "name-az" ? 1 : -1); break;
          case "map-az": case "map-za": compared = (a.status?.map ?? "").localeCompare(b.status?.map ?? "", undefined, { sensitivity: "base" }) * (this.sortOrder === "map-az" ? 1 : -1); break;
          case "players-most": case "players-fewest": compared = ((a.status?.players ?? 0) - (b.status?.players ?? 0)) * (this.sortOrder === "players-fewest" ? 1 : -1); break;
        }
        return compared || browserAddress(a.address).localeCompare(browserAddress(b.address));
      });
  }
  select(key: string): void {
    const entry = this.rows().find(entry => addressKey(entry.address) === key);
    if (entry === undefined) return;
    const direct = entry.sources.includes("direct") ? this.directServers.get(this.protocol)?.find(server => addressKey(server.address) === key) : undefined;
    this.selected = key; this.address = direct?.remote ?? browserAddress(entry.address);
  }
  async query(): Promise<void> {
    const protocol = this.protocol, remote = directServerText(this.address.trim());
    await this.persist(async () => {
      const generation = this.generation;
      const address = await resolveAddress(remote, ports[protocol], 4);
      this.assertGeneration(generation, true);
      await this.rememberDirect(protocol, { remote, address });
      this.assertGeneration(generation, true);
      if (!this.browser(protocol).query(address, performance.now(), "status")) throw new Error("Could not send server query");
      this.status = "Query sent";
    });
  }
  scan(): void {
    this.assertOpen();
    if (this.protocol === "q3") { this.scanQ3(); this.status = "Searching local network..."; return; }
    this.browser().broadcast([ipv4Address([255, 255, 255, 255], ports[this.protocol])], performance.now()); this.status = "Searching local network...";
  }
  async favorite(): Promise<void> {
    const protocol = this.protocol, remote = directServerText(this.address.trim());
    await this.persist(async () => {
      const generation = this.generation;
      const address = await resolveAddress(remote, ports[protocol], 4), browser = this.browser(protocol);
      this.assertGeneration(generation, true);
      const before = browser.saveFavorites(), existing = browser.list().find(entry => addressKey(entry.address) === addressKey(address));
      const removing = existing?.sources.includes("favorite") === true;
      if (removing) browser.removeFavorite(address); else browser.add(address, "favorite");
      if (protocol === "q3") this.listGenerations.set(3, (this.listGenerations.get(3) ?? 0) + 1);
      const view = protocol === "q3" ? this.currentCacheView() : null;
      try { await this.config.dump(protocol === "q3" ? "servers-cache-q3" : `servers-${protocol}`,
        protocol === "q3" ? writeQ3BrowserCache(browser.list(), view) : browser.saveFavorites()); this.assertGeneration(generation, true); }
      catch (error) {
        browser.restoreFavorites(before);
        if (protocol === "q3") this.listGenerations.set(3, (this.listGenerations.get(3) ?? 0) + 1);
        throw error;
      }
      if (protocol === "q3") this.cachedView = view;
      this.status = removing ? "Favorite removed" : "Favorite added";
    });
  }
  async connection(): Promise<BrowserConnection> {
    const protocol = this.protocol, remote = directServerText(this.address.trim());
    await this.persist(async () => {
      const generation = this.generation;
      const address = await resolveAddress(remote, ports[protocol], 4);
      this.assertGeneration(generation, true);
      await this.rememberDirect(protocol, { remote, address });
      this.assertGeneration(generation, true);
    });
    return { protocol, remote };
  }
  private persist(write: () => Promise<void>): Promise<void> {
    this.assertOpen();
    const pending = this.writes.then(write);
    this.writes = pending.catch(() => undefined);
    return pending;
  }
  private async rememberDirect(protocol: BrowserProtocol, server: DirectServerAddress): Promise<void> {
    const generation = this.generation;
    const servers = [server, ...this.directServers.get(protocol) ?? []].filter((entry, index, entries) =>
      entries.findIndex(candidate => addressKey(candidate.address) === addressKey(entry.address)) === index).slice(0, maximumDirectServers);
    await this.config.dump(`servers-direct-${protocol}`, `${JSON.stringify({ version: 1, servers })}\n`);
    this.assertGeneration(generation, true);
    this.directServers.set(protocol, servers);
    this.browser(protocol).add(server.address, "direct");
  }
  poll(): void {
    this.assertOpen();
    for (let event = this.transport.poll(); event !== null; event = this.transport.poll()) {
      if (event.kind === "error") { this.status = event.error.message; continue; }
      if (event.kind !== "packet") continue;
      if (this.q2Master !== null && addressKey(this.q2Master.address) === addressKey(event.from)) {
        try {
          const addresses = readQ2MasterReply(event.payload);
          if (addresses !== null) {
            const core = this.browser("q2");
            for (const address of addresses) { if (core.size >= 4096 && core.entry(address) === null) break; core.add(address, "master"); this.queueStatus("q2", address); }
            this.status = `Found ${addresses.length} servers; querying status`; continue;
          }
        } catch { this.status = "Malformed master reply"; continue; }
      }
      const master = this.master;
      if (master !== null && master.address !== null && addressKey(master.address) === addressKey(event.from)) {
        try {
          const packet = decodeQ3MasterPacket(event.payload);
          for (const address of packet.addresses) {
            if (this.q3List(master.source).addresses.length >= (master.source === 2 ? 8192 : 128)) break;
            this.addQ3(master.source, address);
            this.queueStatus("q3", address);
          }
          this.master = packet.complete ? null : { ...master, received: true };
          continue;
        } catch { /* A queried master may also answer a direct server query. */ }
      }
      for (const protocol of protocols) try {
        const decoded = protocol === "q1" ? { status: readNetQuakeDiscovery(event.payload), challenge: null }
          : protocol === "qw" ? { status: readQuakeWorldDiscovery(event.payload), challenge: null } : protocol === "q2" ? { status: (() => { const message = readQ2OutOfBand(event.payload); return message === null ? null : readQ2Status(message, { kind: "q2-classic", version: 34 }); })(), challenge: null }
          : decodeQ3ServerStatus(event.payload);
        if (decoded.status !== null) {
          const status = decoded.status;
          if (!Number.isSafeInteger(status.players) || !Number.isSafeInteger(status.maxPlayers) || status.players < 0 || status.maxPlayers < 0
            || status.players > 1024 || status.maxPlayers > 1024 || status.name.length > 1024 || status.map.length > 1024) continue;
          const clean = (text: string): string => text.replace(/[\x00-\x1f\x7f]/g, " ");
          const core = this.browser(protocol), wasLan = core.entry(event.from)?.sources.includes("lan") === true;
          if (core.receive(event.from, { ...status, name: clean(status.name), map: clean(status.map) }, decoded.challenge, performance.now())) {
            this.status = "Server updated";
            if (protocol === "q3" && !wasLan && core.entry(event.from)?.sources.includes("lan")) this.listGenerations.set(0, (this.listGenerations.get(0) ?? 0) + 1);
          }
        }
      } catch { /* Other source packets and malformed datagrams are not browser entries. */ }
    }
    for (const [protocol, browser] of this.browsers) if (browser.expireQueries(performance.now(), 3000).length > 0 && protocol === this.protocol) this.status = "No response from server";
    let sent = 0;
    for (const [key, query] of this.pendingStatus) {
      const core = this.browser(query.protocol);
      if (core.pendingRequests >= 16) continue;
      this.pendingStatus.delete(key); core.query(query.address, performance.now(), "status");
      if (++sent === 4) break;
    }
    if (this.q2Master !== null && performance.now() - this.q2Master.startedAt >= 3000) this.q2Master = null;
    if (this.master !== null && performance.now() - this.master.startedAt >= 3000) { this.master = null; this.masterEpoch++; }
  }
  close(): Promise<void> {
    if (this.closeResult !== null) return this.closeResult;
    this.closing = true; this.masterFetch?.abort(); this.masterFetch = null; this.q2Master = null; this.pendingStatus.clear(); this.masterEpoch++; this.master = null;
    this.closeResult = this.writes.finally(() => { this.closed = true; this.generation++; this.transport.close(); });
    return this.closeResult;
  }
}
