import { ServerBrowser } from "../../network/services/discovery.ts";
import type { BrowserEntry } from "../../network/services/discovery.ts";
import { UdpTransport } from "../../network/common/transport.ts";
import { addressHost, addressKey, ipv4Address, resolveAddress } from "../../network/common/endpoint.ts";
import type { NetworkAddress } from "../../network/common/endpoint.ts";
import { netQuakeDiscoveryWire, readNetQuakeDiscovery } from "../../network/q1/discovery.ts";
import { q2DiscoveryWire, readQ2Status } from "../../network/q2/connectionless.ts";
import { readQ2OutOfBand } from "../../network/q2/handshake.ts";
import { q3DiscoveryWire, decodeQ3ServerStatus } from "../../network/q3/discovery.ts";
import { ConfigStore } from "../../settings/config.ts";
import { directServerText, maximumDirectServers, readDirectServers } from "./server-browser-addresses.ts";
import type { DirectServerAddress } from "./server-browser-addresses.ts";

export type BrowserProtocol = "q1" | "q2" | "q3";
export interface BrowserConnection { readonly protocol: BrowserProtocol; readonly remote: string; }
const protocols: readonly BrowserProtocol[] = ["q1", "q2", "q3"];
const ports = { q1: 26000, q2: 27910, q3: 27960 };
export function browserAddress(address: NetworkAddress): string {
  if (address.kind !== "ipv4" && address.kind !== "ipv6") throw new Error("Server requires an IP address");
  return `${address.kind === "ipv6" ? `[${addressHost(address)}]` : addressHost(address)}:${address.port}`;
}
export class StartupServerBrowser {
  private readonly browsers: ReadonlyMap<BrowserProtocol, ServerBrowser>;
  private readonly directServers = new Map<BrowserProtocol, readonly DirectServerAddress[]>();
  private readonly addresses = new Map<BrowserProtocol, string>();
  private writes: Promise<void> = Promise.resolve();
  protocol: BrowserProtocol = "q1";
  get address(): string { return this.addresses.get(this.protocol) ?? `localhost:${ports[this.protocol]}`; }
  set address(value: string) { this.addresses.set(this.protocol, value); }
  filter = "";
  favoritesOnly = false;
  selected: string | null = null;
  status = "";
  private constructor(private readonly transport: UdpTransport, private readonly config: ConfigStore) {
    const sender = { send: (to: NetworkAddress, bytes: Uint8Array): boolean =>
      to.kind === "ipv4" || to.kind === "ipv6" ? transport.send(to, bytes) : false };
    this.browsers = new Map<BrowserProtocol, ServerBrowser>(protocols.map(protocol => [protocol, new ServerBrowser(protocol === "q1" ? netQuakeDiscoveryWire()
      : protocol === "q2" ? (() => { const wire = q2DiscoveryWire({ kind: "q2-classic", version: 34 }, () => ({ serverInfo: "", players: [] })); return { ...wire, query: (_kind: "info" | "status", challenge: string) => wire.query("status", challenge) }; })() : q3DiscoveryWire(), sender)]));
  }
  static async open(config: ConfigStore): Promise<StartupServerBrowser> {
    const transport = await UdpTransport.bind({ host: "0.0.0.0", port: 0, broadcast: true });
    const result = new StartupServerBrowser(transport, config);
    try {
      for (const protocol of protocols) { const saved = await config.loadText(`servers-${protocol}`); if (saved !== null) { if (saved.length > 65536) throw new Error("Saved server list is too large"); result.browser(protocol).restoreFavorites(saved); for (const address of result.browser(protocol).favoriteAddresses()) browserAddress(address); } }
      for (const protocol of protocols) {
        const saved = await config.loadText(`servers-direct-${protocol}`);
        if (saved === null) continue;
        const servers = readDirectServers(saved);
        result.directServers.set(protocol, servers);
        for (const server of servers) result.browser(protocol).add(server.address, "direct");
        const last = servers[0];
        if (last !== undefined) result.addresses.set(protocol, last.remote);
      }
      return result;
    } catch (error) { transport.close(); throw error; }
  }
  private browser(protocol = this.protocol): ServerBrowser {
    const value = this.browsers.get(protocol); if (value === undefined) throw new Error("Unsupported browser protocol"); return value;
  }
  choose(protocol: string): void {
    if (protocol !== "q1" && protocol !== "q2" && protocol !== "q3") throw new Error("Unsupported server protocol");
    this.protocol = protocol; this.selected = null;
  }
  rows(): readonly BrowserEntry[] {
    const search = this.filter.toLowerCase();
    return this.browser().list().filter(entry => (!this.favoritesOnly || entry.sources.includes("favorite"))
      && `${entry.status?.name ?? ""} ${entry.status?.map ?? ""} ${browserAddress(entry.address)}`.toLowerCase().includes(search))
      .sort((a, b) => (a.pingMilliseconds ?? Infinity) - (b.pingMilliseconds ?? Infinity) || browserAddress(a.address).localeCompare(browserAddress(b.address)));
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
      const address = await resolveAddress(remote, ports[protocol], 4);
      await this.rememberDirect(protocol, { remote, address });
      if (!this.browser(protocol).query(address, performance.now(), "status")) throw new Error("Could not send server query");
      this.status = "Query sent";
    });
  }
  scan(): void {
    this.browser().broadcast([ipv4Address([255, 255, 255, 255], ports[this.protocol])], performance.now()); this.status = "Searching local network...";
  }
  async favorite(): Promise<void> {
    const protocol = this.protocol, remote = directServerText(this.address.trim());
    await this.persist(async () => {
      const address = await resolveAddress(remote, ports[protocol], 4), browser = this.browser(protocol);
      const before = browser.saveFavorites(), existing = browser.list().find(entry => addressKey(entry.address) === addressKey(address));
      const removing = existing?.sources.includes("favorite") === true;
      if (removing) browser.removeFavorite(address); else browser.add(address, "favorite");
      try { await this.config.dump(`servers-${protocol}`, browser.saveFavorites()); }
      catch (error) { browser.restoreFavorites(before); throw error; }
      this.status = removing ? "Favorite removed" : "Favorite added";
    });
  }
  async connection(): Promise<BrowserConnection> {
    const protocol = this.protocol, remote = directServerText(this.address.trim());
    await this.persist(async () => {
      const address = await resolveAddress(remote, ports[protocol], 4);
      await this.rememberDirect(protocol, { remote, address });
    });
    return { protocol, remote };
  }
  private persist(write: () => Promise<void>): Promise<void> {
    const pending = this.writes.then(write);
    this.writes = pending.catch(() => undefined);
    return pending;
  }
  private async rememberDirect(protocol: BrowserProtocol, server: DirectServerAddress): Promise<void> {
    const servers = [server, ...this.directServers.get(protocol) ?? []].filter((entry, index, entries) =>
      entries.findIndex(candidate => addressKey(candidate.address) === addressKey(entry.address)) === index).slice(0, maximumDirectServers);
    await this.config.dump(`servers-direct-${protocol}`, `${JSON.stringify({ version: 1, servers })}\n`);
    this.directServers.set(protocol, servers);
    this.browser(protocol).add(server.address, "direct");
  }
  poll(): void {
    for (let event = this.transport.poll(); event !== null; event = this.transport.poll()) {
      if (event.kind === "error") { this.status = event.error.message; continue; }
      if (event.kind !== "packet") continue;
      for (const protocol of protocols) try {
        const decoded = protocol === "q1" ? { status: readNetQuakeDiscovery(event.payload), challenge: null }
          : protocol === "q2" ? { status: (() => { const message = readQ2OutOfBand(event.payload); return message === null ? null : readQ2Status(message, { kind: "q2-classic", version: 34 }); })(), challenge: null }
          : decodeQ3ServerStatus(event.payload);
        if (decoded.status !== null) {
          const status = decoded.status;
          if (!Number.isSafeInteger(status.players) || !Number.isSafeInteger(status.maxPlayers) || status.players < 0 || status.maxPlayers < 0
            || status.players > 1024 || status.maxPlayers > 1024 || status.name.length > 1024 || status.map.length > 1024) continue;
          const clean = (text: string): string => text.replace(/[\x00-\x1f\x7f]/g, " ");
          if (this.browser(protocol).receive(event.from, { ...status, name: clean(status.name), map: clean(status.map) }, decoded.challenge, performance.now())) this.status = "Server updated";
        }
      } catch { /* Other source packets and malformed datagrams are not browser entries. */ }
    }
    for (const [protocol, browser] of this.browsers) if (browser.expireQueries(performance.now(), 3000).length > 0 && protocol === this.protocol) this.status = "No response from server";
  }
  async close(): Promise<void> { this.transport.close(); await this.writes; }
}
