import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StartupServerBrowser, browserAddress } from "../../src/app/bootstrap/server-browser.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { UdpTransport } from "../../src/network/common/transport.ts";
import { q2OutOfBand } from "../../src/network/q2/handshake.ts";
import { quakeWorldOutOfBand } from "../../src/network/q1/handshake.ts";
import { readQuakeWorldDiscovery } from "../../src/network/q1/discovery.ts";
import { addressKey } from "../../src/network/common/endpoint.ts";

test("Q2 UDP master discovery queries advertised servers and exposes rules and player details", async () => {
  const root = await mkdtemp(join(tmpdir(), "server-master-")), browser = await StartupServerBrowser.open(new ConfigStore(root));
  const master = await UdpTransport.bind({ host: "127.0.0.1", port: 0 }), server = await UdpTransport.bind({ host: "127.0.0.1", port: 0 });
  try {
    browser.choose("q2"); browser.masterAddress = browserAddress(master.address); await browser.discover();
    for (let frame = 0; frame < 150 && browser.rows()[0]?.status == null; frame++) {
      const request = master.poll();
      if (request?.kind === "packet") {
        expect(new TextDecoder().decode(request.payload)).toBe("query");
        if (server.address.kind !== "ipv4") throw new Error("Expected IPv4 server");
        master.send(request.from, Uint8Array.from([...new TextEncoder().encode("servers "), ...server.address.host, server.address.port >>> 8, server.address.port & 255]));
      }
      const status = server.poll();
      if (status?.kind === "packet") server.send(status.from, q2OutOfBand('print\n\\hostname\\Arena\\mapname\\q2dm1\\maxclients\\8\\gamedir\\ctf\\timelimit\\20\n7 40 "Ranger"\n'));
      await Bun.sleep(1); browser.poll();
    }
    const entry = browser.rows()[0]; if (entry === undefined) throw new Error("Missing browser row");
    browser.select(addressKey(entry.address));
    expect(entry.status?.name).toBe("Arena"); expect(entry.sources).toContain("master");
    expect(browser.details()).toContain("Ranger  score 7  ping 40"); expect(browser.details()).toContain("gamedir: ctf");
    browser.filter = "ctf"; expect(browser.rows()).toHaveLength(1);
    browser.filter = "rAnGeR"; expect(browser.rows()).toHaveLength(1);
    browser.filter = "missing player"; expect(browser.rows()).toHaveLength(0);
    await browser.close(); const restored = await StartupServerBrowser.open(new ConfigStore(root)); restored.choose("q2");
    expect(restored.masterAddress).toBe(browserAddress(master.address)); await restored.close();
  } finally { master.close(); server.close(); await browser.close(); await rm(root, { recursive: true, force: true }); }
});

test("HTTP lists feed the shared QuakeWorld browser and retain source player fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "qw-master-")), browser = await StartupServerBrowser.open(new ConfigStore(root));
  const peer = await UdpTransport.bind({ host: "127.0.0.1", port: 0 });
  const master = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(`# public servers\n${browserAddress(peer.address)}\n${browserAddress(peer.address)}\n`) });
  const packet = quakeWorldOutOfBand('n\\hostname\\QW Arena\\map\\dm2\\maxclients\\16\\*gamedir\\qw\n1 12 3 45 "Player one" "base" 4 13\n');
  try {
    expect(readQuakeWorldDiscovery(packet).playerDetails).toEqual([{ name: "Player one", score: 12, ping: 45 }]);
    browser.choose("qw"); browser.masterAddress = `http://127.0.0.1:${master.port}/servers`; await browser.discover();
    for (let frame = 0; frame < 150 && browser.rows()[0]?.status == null; frame++) {
      browser.poll(); const request = peer.poll(); if (request?.kind === "packet") peer.send(request.from, packet); await Bun.sleep(1);
    }
    expect(browser.rows()).toHaveLength(1); expect(browser.rows()[0]?.status?.map).toBe("dm2");
    browser.filter = "Player one"; expect(browser.rows()).toHaveLength(1); browser.filter = "";
    browser.address = browserAddress(peer.address); expect((await browser.connection()).protocol).toBe("qw");
  } finally { master.stop(true); peer.close(); await browser.close(); await rm(root, { recursive: true, force: true }); }
});
