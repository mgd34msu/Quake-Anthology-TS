import { expect, test } from "bun:test";
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

async function openMenu(config: ConfigStore) {
  const browser = await StartupServerBrowser.open(config), catalog = await discoverInstalledContent({ corpusRoot: config.root, discoverMods: false });
  const command = parseApplicationCommand(["--content-root", config.root]);
  if (command.kind !== "run" && command.kind !== "menu") throw new Error("Expected menu options");
  const model = new StartupSelectionModel(catalog, command.options), identity = createIdentityOwner("browser-persistence"), seat = identity.seat(0);
  const images = new SceneImageRegistry({ identity: Symbol("browser menu"), session: identity.session, generation: 0 });
  const font: TextFontSelection = { kind: "classic", classic: classicCharset(images.allocate(128, 128, { kind: "generated", name: "browser font" })), unicode: null };
  const art = await loadNativeUiArt("resource:test:browser-font", images, async path => new Uint8Array(await Bun.file(resolve(import.meta.dir, "../..", path)).arrayBuffer()));
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
