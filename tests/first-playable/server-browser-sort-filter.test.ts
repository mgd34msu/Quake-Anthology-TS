import { decodePng } from "../../src/formats/images/png.ts";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { StartupServerBrowser, browserAddress } from "../../src/app/bootstrap/server-browser.ts";
import type { BrowserProtocol, BrowserSortOrder } from "../../src/app/bootstrap/server-browser.ts";
import { StartupMenu } from "../../src/app/bootstrap/startup-menu.ts";
import { StartupSelectionModel } from "../../src/app/bootstrap/startup-selection.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { loadMenuFont, loadMenuTypography } from "../../src/app/bootstrap/menu-font.ts";
import { discoverInstalledContent } from "../../src/content/catalog/index.ts";
import { openMountPlan } from "../../src/content/mounts/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { UiDrawContext } from "../../src/contracts/ui.ts";
import type { ProviderReference } from "../../src/contracts/content.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { KeyCode } from "../../src/input/key-codes.ts";
import { UdpTransport } from "../../src/network/common/transport.ts";
import { encodeNetQuakeControl } from "../../src/network/q1/handshake.ts";
import { q2OutOfBand } from "../../src/network/q2/handshake.ts";
import { q2StatusText } from "../../src/network/q2/connectionless.ts";
import { decodeConnectionless } from "../../src/network/q3/connectionless.ts";
import { encodeQ3Status } from "../../src/network/q3/discovery.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { SceneFrameBuilder } from "../../src/render/commands/frame.ts";
import { CpuRenderTarget, SoftwareRenderer } from "../../src/render/cpu/index.ts";
import { encodePng } from "../../src/formats/images/png.ts";
import { loadNativeUiArt } from "../../src/ui/common/index.ts";

const servers = [
  { name: "Alpha Arena", map: "zbase", players: 0, maxPlayers: 8 },
  { name: "Bravo Base", map: "abase", players: 8, maxPlayers: 8 },
  { name: "Charlie Coop", map: "mhub", players: 3, maxPlayers: 8 },
  { name: "Unknown capacity", map: "unknown", players: 0, maxPlayers: 0 },
];

async function populate(browser: StartupServerBrowser, peers: readonly UdpTransport[], protocol: BrowserProtocol): Promise<void> {
  for (const [index, peer] of peers.entries()) {
    browser.address = browserAddress(peer.address);
    const server = servers[index];
    if (server === undefined) { await browser.connection(); continue; }
    await browser.query();
    let answered = false;
    for (let attempt = 0; attempt < 100 && !answered; attempt++) {
      const event = peer.poll();
      if (event?.kind === "packet") {
        const players = Array.from({ length: server.players }, (_, index) => ({ name: `Player ${index}`, score: index, ping: 20 }));
        const bytes = protocol === "q1" ? encodeNetQuakeControl({ kind: "server-info", version: 3, address: browserAddress(peer.address), ...server })
          : protocol === "q2" ? q2OutOfBand(`print\n${q2StatusText({ serverInfo: `\\hostname\\${server.name}\\mapname\\${server.map}\\maxclients\\${server.maxPlayers}`, players })}`)
            : encodeQ3Status(`\\sv_hostname\\${server.name}\\mapname\\${server.map}\\sv_maxclients\\${server.maxPlayers}\\challenge\\${decodeConnectionless(event.payload, "server").arguments[0] ?? ""}`, players);
        peer.send(event.from, bytes); answered = true;
      } else await Bun.sleep(1);
    }
    expect(answered).toBe(true);
    for (let attempt = 0; attempt < 100 && !browser.rows().some(entry => entry.status?.name === server.name); attempt++) { await Bun.sleep(1); browser.poll(); }
    expect(browser.rows().some(entry => entry.status?.name === server.name)).toBe(true);
  }
}

test("ordinary shared browser controls sort and filter received Q1/Q2/Q3 servers and render offscreen", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "quake-browser-sorting-")), config = new ConfigStore(directory);
  const browser = await StartupServerBrowser.open(config), peers: UdpTransport[] = [];
  const corpusRoot = resolve(import.meta.dir, "../../../qfiles"), catalog = await discoverInstalledContent({ corpusRoot, discoverMods: false });
  const command = parseApplicationCommand(["--content-root", corpusRoot]);
  if (command.kind !== "run" && command.kind !== "menu") throw new Error("Expected menu options");
  const model = new StartupSelectionModel(catalog, command.options), identity = createIdentityOwner("browser-sort-filter"), seat = identity.seat(0);
  const owner = { identity: Symbol("browser sort screenshot"), session: identity.session, generation: 0 }, images = new SceneImageRegistry(owner);
  const product = catalog.require("q2-classic-baseq2"), mounts = await catalog.mountsFor(product.id);
  using mounted = await openMountPlan({ id: "mount-plan:browser-sort:font", mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
  const font = await loadMenuFont({ catalog, mounts: mounted, family: "q2", rerelease: false, images });
  const typography = await loadMenuTypography(catalog, images, font.font.classic);
  const art = await loadNativeUiArt("resource:test:browser-sort-font", images, async path => decodePng(await Bun.file(resolve(import.meta.dir, "../..", path)).bytes(), path));
  const menu = new StartupMenu({ seat, model, art, font: typography.body, titleFont: typography.title, browser, now: () => 0,
    play: () => undefined, load: () => undefined, saves: () => ({ rows: [], error: null }), refreshSaves: () => undefined,
    quit: () => undefined });
  const renderer = new SoftwareRenderer(640, 480, owner), target = new CpuRenderTarget(renderer);
  const click = (x: number, y: number): void => {
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-motion", position: { x, y }, delta: { x: 0, y: 0 } });
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: true });
    menu.input({ seat, timeMilliseconds: 0, kind: "mouse-button", button: 1, down: false });
  };
  const key = (code: number, down: boolean): void => { menu.input({ seat, timeMilliseconds: 0, kind: "key", code, down, repeat: false }); };
  const search = (text: string): void => {
    click(100, 230); key(KeyCode.Control, true); key(117, true); key(117, false); key(KeyCode.Control, false);
    menu.input({ seat, timeMilliseconds: 0, kind: "text", text });
  };
  const captureRoot = process.env["QUAKE_BROWSER_CAPTURE_DIR"];
  const capture = async (name: string): Promise<void> => {
    if (captureRoot === undefined) return;
    const provider: ProviderReference = { provider: "q2:official", content: product.id };
    const context: UiDrawContext = { binding: { seat, client: identity.client(0, 0), viewport: { x: 0, y: 0, width: 640, height: 480 }, safeArea: { x: 0, y: 0, width: 640, height: 480 }, hudScale: 1,
      presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: product.id, hud: provider, effects: provider, audio: provider } }, timeMilliseconds: 0 };
    const frame = new SceneFrameBuilder(images); frame.begin("back", false);
    menu.draw(context, draw => frame.command(draw), () => { throw new Error("Image menu requested material text"); });
    target.execute(frame.finish(false));
    await mkdir(captureRoot, { recursive: true });
    await Bun.write(resolve(captureRoot, `${name}.png`), encodePng(640, 480, renderer.pixels));
  };
  try {
    for (let index = 0; index < 5; index++) peers.push(await UdpTransport.bind({ host: "127.0.0.1", port: 0 }));
    click(100, 130); click(100, 300); click(100, 400);
    expect(menu.controller.activeMenu).toBe("menu:startup:servers");
    const protocols: readonly BrowserProtocol[] = ["q1", "q2", "q3"];
    for (const protocol of protocols) {
      expect(browser.protocol).toBe(protocol);
      await populate(browser, peers, protocol);
      if (process.env["QUAKE_BROWSER_CAPTURE_STAGE"] === "before") {
        if (protocol === "q2") { await capture("before-browser"); break; }
        click(400, 122); continue;
      }
      const names = () => browser.rows().map(entry => entry.status?.name ?? "Unanswered");
      expect(browser.rows()).toHaveLength(5);
      click(470, 230);
      expect(menu.controller.activeMenu).toBe("menu:startup:server-filters");
      const orders: readonly BrowserSortOrder[] = ["ping-low", "ping-high", "name-az", "name-za", "map-az", "map-za", "players-most", "players-fewest"];
      const ascendingPing = names();
      for (const [index, order] of orders.entries()) {
        expect(browser.sortOrder).toBe(order);
        expect(names().at(-1)).toBe("Unanswered");
        if (order === "ping-high") expect(names().slice(0, 4)).toEqual(ascendingPing.slice(0, 4).reverse());
        if (order === "name-az") expect(names().slice(0, 4)).toEqual(["Alpha Arena", "Bravo Base", "Charlie Coop", "Unknown capacity"]);
        if (order === "name-za") expect(names().slice(0, 4)).toEqual(["Unknown capacity", "Charlie Coop", "Bravo Base", "Alpha Arena"]);
        if (order === "map-az") expect(names().slice(0, 4)).toEqual(["Bravo Base", "Charlie Coop", "Unknown capacity", "Alpha Arena"]);
        if (order === "map-za") expect(names().slice(0, 4)).toEqual(["Alpha Arena", "Unknown capacity", "Charlie Coop", "Bravo Base"]);
        if (order === "players-most") expect(names().slice(0, 2)).toEqual(["Bravo Base", "Charlie Coop"]);
        if (order === "players-fewest") expect(names().slice(2, 4)).toEqual(["Charlie Coop", "Bravo Base"]);
        if (index < orders.length - 1) click(450, 130);
      }
      click(100, 164); expect(browser.hideEmpty).toBe(true); expect(names()).not.toContain("Alpha Arena");
      click(100, 198); expect(browser.hideFull).toBe(true); expect(names()).toContain("Unknown capacity"); expect(names()).toContain("Unanswered");
      expect(names()).not.toContain("Bravo Base"); expect(names()).toContain("Charlie Coop");
      if (protocol === "q2") await capture("after-filters");
      click(100, 266);
      expect(menu.controller.activeMenu).toBe("menu:startup:servers");
      if (protocol === "q2") await capture("after-browser");
      search("mhub"); expect(names()).toEqual(["Charlie Coop"]);
      search("absent-server"); expect(names()).toEqual([]); expect(browser.emptyMessage).toBe("No servers match these filters.");
      if (protocol === "q2") await capture("after-empty");
      search(""); click(470, 230); click(100, 164); click(100, 198); click(450, 130); click(100, 266);
      expect(browser.rows()).toHaveLength(5); expect(browser.sortOrder).toBe("ping-low");
      click(400, 122);
    }
  } finally { menu.close(); await browser.close(); for (const peer of peers) peer.close(); art.close(); typography.close(); font.close(); target.close(); images.close(); await rm(directory, { recursive: true, force: true }); }
}, 60000);
