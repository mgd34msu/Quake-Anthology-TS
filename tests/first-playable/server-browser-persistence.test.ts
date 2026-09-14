import { decodePng } from "../../src/formats/images/png.ts";
import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { StartupServerBrowser } from "../../src/app/bootstrap/server-browser.ts";
import type { BrowserConnection } from "../../src/app/bootstrap/server-browser.ts";
import { readDirectServers } from "../../src/app/bootstrap/server-browser-addresses.ts";
import { StartupMenu } from "../../src/app/bootstrap/startup-menu.ts";
import { StartupSelectionModel } from "../../src/app/bootstrap/startup-selection.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { discoverInstalledContent } from "../../src/content/catalog/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { KeyCode } from "../../src/input/key-codes.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { classicCharset } from "../../src/text/atlas.ts";
import type { TextFontSelection } from "../../src/text/atlas.ts";
import { loadNativeUiArt } from "../../src/ui/common/index.ts";
import { UdpTransport } from "../../src/network/common/transport.ts";
import { ipv4Address, addressKey } from "../../src/network/common/endpoint.ts";
import type { Ipv4Address } from "../../src/network/common/endpoint.ts";
import { decodeConnectionless } from "../../src/network/q3/connectionless.ts";
import { decodeQ3MasterPacket, encodeQ3Status } from "../../src/network/q3/discovery.ts";
import { writeQ3BrowserCache, readQ3BrowserCache } from "../../src/app/bootstrap/server-browser-cache.ts";
import type { Q3BrowserCacheView } from "../../src/network/q3/browser-view.ts";

function masterPacket(addresses: readonly Ipv4Address[], complete: boolean): Uint8Array {
  return Uint8Array.from([255, 255, 255, 255, ...new TextEncoder().encode("getserversResponse"),
    ...addresses.flatMap(address => [92, ...address.host, address.port >>> 8, address.port & 255]), 92, ...complete ? [69, 79, 84] : []]);
}

test("Q3 browser facade retains final EOT at the 256-record packet boundary", () => {
  const addresses = Array.from({ length: 256 }, (_, index) => ipv4Address([127, 0, 0, 1], 20000 + index));
  expect(decodeQ3MasterPacket(masterPacket(addresses, true))).toEqual({ addresses, complete: true });
  expect(decodeQ3MasterPacket(masterPacket(addresses, false))).toEqual({ addresses, complete: false });
});

test("Q3 browser facade cache retains global overflow addresses beyond the 4096-row UI capacity", () => {
  const entries = Array.from({ length: 8192 }, (_, index) => ({ address: ipv4Address([127, 0, 0, 1], 20000 + index),
    sources: ["master"] satisfies readonly import("../../src/network/services/discovery.ts").DiscoverySource[], status: null, pingMilliseconds: null, updatedAt: 0 }));
  expect(readQ3BrowserCache(writeQ3BrowserCache(entries, null)).entries).toHaveLength(8192);
  expect(() => writeQ3BrowserCache([...entries, { address: ipv4Address([127, 0, 0, 2], 27960), sources: ["master"], status: null, pingMilliseconds: null, updatedAt: 0 }], null)).toThrow("master entries");
});

test("Q3 browser facade correlates master packets, exposes partial lists and persists canonical status with UI metadata", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "quake-browser-facade-")), config = new ConfigStore(root);
  const peer = await UdpTransport.bind({ host: "127.0.0.1", port: 0 }), stranger = await UdpTransport.bind({ host: "127.0.0.1", port: 0 });
  let browser = await StartupServerBrowser.open(config);
  try {
    const first = ipv4Address([127, 0, 0, 1], 20001), second = ipv4Address([127, 0, 0, 1], 20002);
    const receive = async () => {
      for (let attempt = 0; attempt < 100; attempt++) { const event = peer.poll(); if (event?.kind === "packet") return event; await Bun.sleep(1); }
      throw new Error("No browser master request");
    };
    const poll = async () => { await Bun.sleep(3); browser.poll(); };
    const initial = browser.q3List(2).generation;
    await browser.requestQ3Master(2, `127.0.0.1:${peer.address.port}`, 71, ["empty", "full"]);
    const request = await receive(); expect(decodeConnectionless(request.payload, "server").line).toBe("getservers 71 empty full");
    expect(browser.q3List(2).pending).toBe(true);
    stranger.send(request.from, masterPacket([first], true)); await poll(); expect(browser.q3List(2).addresses).toHaveLength(0);
    peer.send(request.from, masterPacket([first], false)); await poll();
    expect(browser.q3List(2).addresses).toEqual([first]); expect(browser.q3List(2).pending).toBe(false);
    peer.send(request.from, masterPacket([second], true)); await poll();
    expect(browser.q3List(2).addresses).toEqual([first, second]); expect(browser.q3List(2).generation).toBeGreaterThan(initial);
    await browser.requestQ3Master(1, `127.0.0.1:${peer.address.port}`, 68, []);
    const secondary = await receive();
    if (peer.address.kind !== "ipv4") throw new Error("Fixture requires IPv4");
    peer.send(secondary.from, masterPacket([peer.address], true)); await poll();
    expect(browser.q3List(1).addresses).toEqual([peer.address]); expect(browser.q3List(2).addresses).toEqual([first, second]);
    browser.addQ3(3, peer.address);
    const status = browser.q3Core.request(peer.address, performance.now(), "status"); if (status === null) throw new Error("No status request");
    const query = await receive(), challenge = decodeConnectionless(query.payload, "server").arguments[0];
    if (challenge === undefined) throw new Error("No status challenge");
    peer.send(query.from, encodeQ3Status(`\\challenge\\${challenge}\\sv_hostname\\Actual status\\mapname\\q3dm1\\sv_maxclients\\8`, [{ name: "Player", score: 4, ping: 12 }])); await poll();
    expect(browser.q3Core.requestResult(status)?.kind).toBe("completed"); browser.q3Core.releaseRequest(status);
    const view: Q3BrowserCacheView = { lists: [
      { source: 1, rows: [{ address: peer.address, name: "Authored name", visible: 7, ping: 23 }] },
      { source: 2, rows: [second, first].map(address => ({ address, name: "Global", visible: 1, ping: -1 })) },
      { source: 3, rows: [{ address: peer.address, name: "Favorite", visible: 3, ping: 24 }] },
    ] };
    await browser.saveQ3Cache(view);
    const newer = browser.q3Core.request(peer.address, performance.now(), "status"); if (newer === null) throw new Error("No refresh request");
    const freshQuery = await receive(), freshChallenge = decodeConnectionless(freshQuery.payload, "server").arguments[0];
    if (freshChallenge === undefined) throw new Error("No refreshed status challenge");
    peer.send(freshQuery.from, encodeQ3Status(`\\challenge\\${freshChallenge}\\sv_hostname\\New live status\\mapname\\q3dm1\\sv_maxclients\\8`, [{ name: "Player", score: 4, ping: 12 }])); await poll();
    await browser.loadQ3Cache(); expect(browser.q3Core.entry(peer.address)?.status?.name).toBe("New live status"); browser.q3Core.releaseRequest(newer);
    browser.choose("q3"); browser.address = "127.0.0.1:20003"; await browser.favorite();
    const saved = await config.loadText("servers-cache-q3"); if (saved === null) throw new Error("Cache was not saved");
    expect(readQ3BrowserCache(saved).view?.lists[0]?.rows[0]?.name).toBe("Authored name");
    expect(readQ3BrowserCache(saved).view?.lists[1]?.rows.map(row => row.address)).toEqual([second, first]);
    const entries = browser.q3Core.list();
    expect(() => writeQ3BrowserCache(entries, { lists: [{ source: 1, rows: [{ address: first, name: "Wrong source", visible: 1, ping: 0 }] }, { source: 2, rows: [] }, { source: 3, rows: [] }] })).toThrow("membership");
    expect(() => writeQ3BrowserCache(entries, { lists: [{ source: 1, rows: [] }, { source: 2, rows: [{ address: first, name: "A", visible: 1, ping: 0 }, { address: first, name: "B", visible: 1, ping: 0 }] }, { source: 3, rows: [] }] })).toThrow("membership");
    await browser.close(); browser = await StartupServerBrowser.open(config);
    expect(browser.q3List(2).addresses).toEqual([first, second]);
    expect(browser.q3Core.entry(peer.address)?.status?.playerDetails).toEqual([{ name: "Player", score: 4, ping: 12 }]);
    expect(browser.q3Core.entry(peer.address)?.status?.rules.get("mapname")).toBe("q3dm1");
    expect(browser.q3List(3).addresses.map(address => addressKey(address))).toContain("127.0.0.1:20003");
    const before = browser.q3List(2), load = config.loadText.bind(config);
    let unblock = (): void => { throw new Error("Cache gate was not initialized"); };
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const reading = spyOn(config, "loadText").mockImplementation(async name => { await gate; return load(name); });
    let cacheCurrent = true;
    try {
      const pendingLoad = browser.loadQ3Cache(() => { if (!cacheCurrent) throw new Error("Retired cache view"); });
      await Promise.resolve(); cacheCurrent = false; unblock();
      await expect(pendingLoad).rejects.toThrow("Retired cache view"); expect(browser.q3List(2)).toEqual(before);
    } finally { unblock(); reading.mockRestore(); }
    let current = true;
    const retired = browser.requestQ3Master(2, "localhost:27950", 68, [], () => { if (!current) throw new Error("Retired UI"); });
    current = false; await expect(retired).rejects.toThrow("Retired UI");
    const pending = browser.resolveQ3("localhost"), close = browser.close();
    expect(browser.close()).toBe(close); await expect(pending).rejects.toThrow("retired"); await close;
  } finally { await browser.close(); peer.close(); stranger.close(); await rm(root, { recursive: true, force: true }); }
});

async function openMenu(config: ConfigStore) {
  const browser = await StartupServerBrowser.open(config), catalog = await discoverInstalledContent({ corpusRoot: config.root, discoverMods: false });
  const command = parseApplicationCommand(["--content-root", config.root]);
  if (command.kind !== "run" && command.kind !== "menu") throw new Error("Expected menu options");
  const model = new StartupSelectionModel(catalog, command.options), identity = createIdentityOwner("browser-persistence"), seat = identity.seat(0);
  const images = new SceneImageRegistry({ identity: Symbol("browser menu"), session: identity.session, generation: 0 });
  const font: TextFontSelection = { kind: "classic", classic: classicCharset(images.allocate(128, 128, { kind: "generated", name: "browser font" })), unicode: null };
  const art = await loadNativeUiArt("resource:test:browser-font", images, async path => decodePng(await Bun.file(resolve(import.meta.dir, "../..", path)).bytes(), path));
  const connections: BrowserConnection[] = [];
  const menu = new StartupMenu({ seat, model, art, font, titleFont: font, browser, now: () => 0, connect: connection => { connections.push(connection); },
    play: () => undefined, load: () => undefined, saves: () => ({ rows: [], error: null }), refreshSaves: () => undefined,
    quit: () => undefined, applyDisplay: () => undefined });
  const click = (x: number, y: number): void => {
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-motion", position: { x, y }, delta: { x: 0, y: 0 } });
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: true });
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: false });
  };
  const key = (code: number, down: boolean): void => { menu.input({ seat, timeMilliseconds: 0, kind: "key", code, down, repeat: false }); };
  const address = (text: string): void => {
    click(100, 158); key(KeyCode.Control, true); key(117, true); key(117, false); key(KeyCode.Control, false);
    menu.input({ seat, timeMilliseconds: 0, kind: "text", text });
  };
  click(100, 160);
  expect(menu.controller.activeMenu).toBe("menu:startup:session");
  click(100, 400);
  expect(menu.controller.activeMenu).toBe("menu:startup:servers");
  click(400, 122);
  expect(browser.protocol).toBe("q2");
  return { browser, menu, connections, click, address,
    async close() { menu.close(); await browser.close(); art.close(); images.close(); } };
}

test("normal browser menu persists favorites, removal, selected addresses and direct connect across immediate close", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "quake-browser-menu-")), config = new ConfigStore(directory);
  try {
    const first = await openMenu(config);
    try {
      first.address("127.0.0.1:27911");
      expect(first.browser.address).toBe("127.0.0.1:27911");
      first.click(460, 194);
    } finally { await first.close(); }
    const savedFavorite = await config.loadText("servers-q2");
    expect(savedFavorite).toBe('[{"kind":"ipv4","host":[127,0,0,1],"port":27911}]');

    const second = await openMenu(config);
    try {
      expect(second.browser.rows()).toHaveLength(1);
      second.click(100, 265);
      expect(second.browser.selected).toBe("127.0.0.1:27911");
      expect(second.browser.address).toBe("127.0.0.1:27911");
      second.click(460, 194);
    } finally { await second.close(); }
    expect(await config.loadText("servers-q2")).toBe("[]");

    const third = await openMenu(config);
    try {
      expect(third.browser.rows()).toHaveLength(0);
      third.address("localhost:27912");
      third.click(100, 409);
    } finally { await third.close(); }
    expect(third.connections).toEqual([{ protocol: "q2", remote: "localhost:27912" }]);
    const direct = await config.loadText("servers-direct-q2");
    expect(direct === null ? [] : readDirectServers(direct).map(server => server.remote)).toEqual(["localhost:27912"]);

    const fourth = await openMenu(config);
    try {
      expect(fourth.browser.address).toBe("localhost:27912");
      expect(fourth.browser.rows()[0]?.sources).toEqual(["direct"]);
      fourth.click(100, 265);
      expect(fourth.browser.selected).toBe("127.0.0.1:27912");
      expect(fourth.browser.address).toBe("localhost:27912");
      fourth.click(100, 409);
      fourth.click(460, 194);
    } finally { await fourth.close(); }
    expect(fourth.connections).toEqual([{ protocol: "q2", remote: "localhost:27912" }]);
    const reconnected = await config.loadText("servers-direct-q2");
    expect(reconnected === null ? [] : readDirectServers(reconnected).map(server => server.remote)).toEqual(["localhost:27912"]);
    const fifth = await openMenu(config);
    try {
      expect(fifth.browser.rows()[0]?.sources).toEqual(["favorite", "direct"]);
      fifth.click(100, 265); fifth.click(460, 194);
    } finally { await fifth.close(); }
    const sixth = await openMenu(config);
    try {
      expect(sixth.browser.rows()[0]?.sources).toEqual(["direct"]);
      sixth.click(400, 372);
      expect(sixth.browser.rows()).toHaveLength(0);
      sixth.click(400, 372);
      expect(sixth.browser.rows()).toHaveLength(1);
    } finally { await sixth.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30000);

test("direct address recall is protocol-specific and failed favorite writes leave the list unchanged", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "quake-browser-addresses-")), config = new ConfigStore(directory);
  let browser = await StartupServerBrowser.open(config);
  try {
    browser.choose("q2"); browser.address = "127.0.0.1:27911"; await browser.connection();
    browser.choose("q3"); browser.address = "127.0.0.1:27961"; await browser.connection();
    browser.choose("q2"); expect(browser.address).toBe("127.0.0.1:27911");
    browser.address = "127.0.0.1:27912"; await browser.connection();
    await browser.close(); browser = await StartupServerBrowser.open(config); browser.choose("q2");
    expect(browser.address).toBe("127.0.0.1:27912");
    expect(browser.rows()).toHaveLength(2);
    browser.choose("q3"); expect(browser.address).toBe("127.0.0.1:27961"); expect(browser.rows()).toHaveLength(1);
    browser.choose("q1"); expect(browser.address).toBe("localhost:26000"); expect(browser.rows()).toHaveLength(0);
    browser.address = ""; await expect(browser.connection()).rejects.toThrow("Invalid direct server address");
    await rm(directory, { recursive: true }); await Bun.write(directory, "not a settings directory");
    browser.address = "127.0.0.1:26001"; await expect(browser.favorite()).rejects.toThrow();
    expect(browser.rows()).toHaveLength(0);
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});
