import { expect, test } from "bun:test";
import { Q3BrowserView } from "../../../src/network/q3/browser-view.ts";
import type { Q3BrowserCacheView, Q3BrowserHost, Q3BrowserSource } from "../../../src/network/q3/browser-view.ts";
import { ServerBrowser } from "../../../src/network/services/discovery.ts";
import { addressKey, ipv4Address } from "../../../src/network/common/endpoint.ts";
import type { NetworkAddress } from "../../../src/network/common/endpoint.ts";
import { decodeQ3ServerStatus, encodeQ3Info, encodeQ3Status, q3DiscoveryWire } from "../../../src/network/q3/discovery.ts";
import { decodeConnectionless } from "../../../src/network/q3/connectionless.ts";
import { qvmClientBrowserSyscall } from "../../../src/compat/qvm/client-browser-syscalls.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import { QvmUiImport } from "../../../src/compat/qvm/abi.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";

function fixture() {
  let now = 1000, revision = 0, reset = 0, saved: Q3BrowserCacheView | null = null;
  const sent: { address: NetworkAddress; bytes: Uint8Array }[] = [], printed: string[] = [];
  const core = new ServerBrowser(q3DiscoveryWire(), { send(address, bytes) { sent.push({ address, bytes }); return true; } });
  const lists = new Map<Q3BrowserSource, NetworkAddress[]>([[0, []], [1, []], [2, []], [3, []]]);
  const host: Q3BrowserHost = {
    q3Core: core,
    q3List(source) { return { addresses: lists.get(source) ?? [], pending: false, generation: revision, resetGeneration: reset }; },
    async resolveQ3(text) { const port = Number(text.split(":")[1] ?? "27960"); return ipv4Address([127, 0, 0, 1], port); },
    addQ3(source, address) { const rows = lists.get(source); if (rows === undefined) throw new Error("Missing list");
      if (!rows.some(row => addressKey(row) === addressKey(address))) rows.push(address); core.add(address, "direct"); revision++; },
    removeQ3(source, address) { lists.set(source, (lists.get(source) ?? []).filter(row => addressKey(row) !== addressKey(address))); revision++; },
    scanQ3() { lists.set(0, []); revision++; reset++; },
    async requestQ3Master() { throw new Error("Unexpected master request"); },
    async loadQ3Cache() { if (saved !== null) for (const list of saved.lists) lists.set(list.source, list.rows.map(row => row.address)); revision++; return saved; },
    async saveQ3Cache(value) { saved = value; },
    assertOpen() {},
  };
  const view = new Q3BrowserView({ browser: host, now: () => now, maxPing: () => 800, statusResendTime: () => 750, print: text => { printed.push(text); } });
  const guest = new QvmMemory(new Uint8Array(4096));
  function call(code: QvmUiImport, args: readonly number[] = []) {
    const words = new DataView(new ArrayBuffer((args.length + 1) * 4)); words.setInt32(0, code, true);
    args.forEach((value, index) => words.setInt32((index + 1) * 4, value, true));
    const call: QvmHostCall = { kind: "engine", role: "ui", code, words, guest, memory: guest.bytes, commandArguments: null,
      invoke: () => { throw new Error("Unexpected reentry"); }, invokeAsync: async () => { throw new Error("Unexpected reentry"); } };
    return qvmClientBrowserSyscall(call, view);
  }
  function add(source = 3, port = 27960, name = "Arena") {
    guest.writeString(16, name, 64); guest.writeString(80, `127.0.0.1:${port}`, 64);
    return call(QvmUiImport.UI_LAN_ADDSERVER, [source, 16, 80]);
  }
  function reply(index: number, kind: "info" | "status" = "info") {
    const packet = sent[index]; if (packet === undefined) throw new Error("Missing sent packet");
    const challenge = decodeConnectionless(packet.bytes, "server").arguments[0] ?? "";
    const text = `\\challenge\\${challenge}\\protocol\\68\\hostname\\Live\\mapname\\q3dm1\\clients\\2\\sv_maxclients\\8`;
    const decoded = decodeQ3ServerStatus(kind === "info" ? encodeQ3Info(text) : encodeQ3Status(text, [{ name: "Player", score: 7, ping: 42 }]));
    return core.receive(packet.address, decoded.status, decoded.challenge, now, kind);
  }
  return { host, core, view, guest, call, add, reply, sent, printed, time(value: number) { now = value; }, saved: () => saved };
}

test("LAN lists retain stable capacity slots, source separation, lazy pointers and raw visibility", async () => {
  const f = fixture();
  expect(await f.call(QvmUiImport.UI_LAN_ADDSERVER, [99, 0, 0])).toBe(-1);
  expect(await f.call(QvmUiImport.UI_LAN_REMOVESERVER, [99, 0])).toBe(0);
  for (const source of [0, 1, 2, 3]) {
    expect(await f.add(source, 27960, "Zulu")).toBe(1);
    expect(await f.add(source, 27961, "Alpha")).toBe(1);
    expect(f.call(QvmUiImport.UI_LAN_GETSERVERCOUNT, [source])).toBe(2);
    expect(f.call(QvmUiImport.UI_LAN_COMPARESERVERS, [source, 0, 0, 0, 1])).toBe(1);
    expect(f.call(QvmUiImport.UI_LAN_COMPARESERVERS, [source, 0, 7, 0, 1])).toBe(-1);
    f.call(QvmUiImport.UI_LAN_MARKSERVERVISIBLE, [source, -1, -123]);
    expect(f.call(QvmUiImport.UI_LAN_SERVERISVISIBLE, [source, 127])).toBe(-123);
    f.call(QvmUiImport.UI_LAN_RESETPINGS, [source]);
    expect(f.call(QvmUiImport.UI_LAN_GETSERVERPING, [source, 127])).toBe(-1);
    expect(await f.call(QvmUiImport.UI_LAN_REMOVESERVER, [source, 80])).toBe(0);
    expect(f.call(QvmUiImport.UI_LAN_GETSERVERCOUNT, [source])).toBe(1);
    f.call(QvmUiImport.UI_LAN_GETSERVERADDRESSSTRING, [source, 1, 160, 64]);
    expect(f.guest.readString(160)).toBe("127.0.0.1:27961");
  }
  f.guest.writeString(80, "127.0.0.1:27960", 64);
  expect(await f.call(QvmUiImport.UI_LAN_ADDSERVER, [3, 0, 80])).toBe(0);
  f.guest.writeString(80, "127.0.0.1:27962", 64);
  await expect(Promise.resolve(f.call(QvmUiImport.UI_LAN_ADDSERVER, [3, 0, 80]))).rejects.toThrow("NULL src");
  f.call(QvmUiImport.UI_LAN_GETSERVERADDRESSSTRING, [3, 1, 160, 64]);
  expect(f.guest.readString(160)).toBe("127.0.0.1:27962");
  expect(f.call(QvmUiImport.UI_LAN_GETSERVERCOUNT, [3])).toBe(1);
  f.view.close();
});

test("LAN guest output follows capacity and null-pointer order", () => {
  const f = fixture(); f.guest.bytes.fill(0xaa);
  f.call(QvmUiImport.UI_LAN_GETSERVERADDRESSSTRING, [3, 127, 4256, 8]);
  expect(f.guest.span(160, 9)).toEqual(new Uint8Array([98, 111, 116, 0, 0, 0, 0, 0, 0xaa]));
  for (const trap of [QvmUiImport.UI_LAN_GETSERVERADDRESSSTRING, QvmUiImport.UI_LAN_GETSERVERINFO]) {
    f.guest.bytes[4095] = 0xaa; expect(f.call(trap, [99, 4096, 4095, -1])).toBe(0); expect(f.guest.bytes[4095]).toBe(0);
  }
  expect(f.call(QvmUiImport.UI_LAN_GETSERVERINFO, [3, 0, 0, -1])).toBe(0);
  expect(() => f.call(QvmUiImport.UI_LAN_GETSERVERADDRESSSTRING, [3, 0, 0, 0])).toThrow("NULL dest");
  expect(() => f.call(QvmUiImport.UI_LAN_GETSERVERADDRESSSTRING, [99, 0, 0, 0])).toThrow("nonnull pointer");
  expect(() => f.call(QvmUiImport.UI_LAN_GETSERVERINFO, [3, 0, 160, 0])).toThrow("destsize");
  expect(f.guest.bytes[160]).toBe(0);
  expect(f.call(QvmUiImport.UI_LAN_GETPINGINFO, [0, 0, 0])).toBe(0);
  expect(f.call(QvmUiImport.UI_LAN_GETPING, [0, 160, -1, 240])).toBe(0);
  expect(f.guest.view(240, 4).getInt32(0, true)).toBe(0);
  for (const index of [-1, 32]) {
    expect(f.call(QvmUiImport.UI_LAN_CLEARPING, [index])).toBe(0);
    expect(() => f.call(QvmUiImport.UI_LAN_GETPING, [index, 160, 64, 240])).toThrow("source index");
  }
  f.view.close();
});

test("32 ping slots schedule visible rows, preserve completed info, and publish real shared responses", async () => {
  const f = fixture();
  for (let index = 0; index < 33; index++) await f.add(3, 27960 + index);
  f.call(QvmUiImport.UI_LAN_RESETPINGS, [3]);
  expect(f.call(QvmUiImport.UI_LAN_UPDATEVISIBLEPINGS, [3])).toBe(1);
  expect(f.call(QvmUiImport.UI_LAN_GETPINGQUEUECOUNT)).toBe(32); expect(f.sent).toHaveLength(32);
  f.call(QvmUiImport.UI_LAN_GETPING, [0, 160, 64, 240]); expect(f.guest.view(240, 4).getInt32(0, true)).toBe(0);
  f.time(1040); expect(f.reply(0)).toBe(true); f.view.poll();
  expect(f.call(QvmUiImport.UI_LAN_GETSERVERPING, [3, 0])).toBe(41);
  f.call(QvmUiImport.UI_LAN_GETPINGINFO, [0, 256, 1024]); expect(f.guest.readString(256)).toContain("\\hostname\\Live");
  f.call(QvmUiImport.UI_LAN_GETPING, [0, 160, 64, 240]); expect(f.guest.view(240, 4).getInt32(0, true)).toBe(41);
  expect(f.call(QvmUiImport.UI_LAN_GETSERVERPING, [3, 0])).toBe(41);
  f.call(QvmUiImport.UI_LAN_GETSERVERINFO, [3, 0, 256, 1024]); expect(f.guest.readString(256)).toContain("\\mapname\\q3dm1");
  f.call(QvmUiImport.UI_LAN_CLEARPING, [0]);
  expect(f.call(QvmUiImport.UI_LAN_GETPINGQUEUECOUNT)).toBe(31);
  f.call(QvmUiImport.UI_LAN_UPDATEVISIBLEPINGS, [3]); expect(f.sent).toHaveLength(33);
  f.time(1900); f.call(QvmUiImport.UI_LAN_GETPING, [1, 160, 64, 240]); expect(f.guest.view(240, 4).getInt32(0, true)).toBe(900);
  f.call(QvmUiImport.UI_LAN_UPDATEVISIBLEPINGS, [3]); expect(f.call(QvmUiImport.UI_LAN_GETPINGQUEUECOUNT)).toBe(0);
  f.view.close();
});

test("status requests coexist with pings, poll decoded players, resend and release on null pointers", async () => {
  const f = fixture(); await f.add(); await f.view.ping("127.0.0.1:27960");
  expect(await f.call(QvmUiImport.UI_LAN_SERVERSTATUS, [80, 256, 1024])).toBe(0);
  expect(f.sent).toHaveLength(2); f.time(1020); expect(f.reply(1, "status")).toBe(true); expect(f.reply(0)).toBe(true);
  expect(await f.call(QvmUiImport.UI_LAN_SERVERSTATUS, [80, 256, 1024])).toBe(1);
  expect(f.guest.readString(256)).toContain('\\\\7 42 "Player"\\');
  expect(await f.call(QvmUiImport.UI_LAN_SERVERSTATUS, [80, 0, -1])).toBe(0);
  expect(await f.call(QvmUiImport.UI_LAN_SERVERSTATUS, [80, 4095, 1024])).toBe(0);
  f.time(1800); expect(await f.call(QvmUiImport.UI_LAN_SERVERSTATUS, [80, 256, 1024])).toBe(0);
  expect(f.sent).toHaveLength(4); expect(f.reply(2, "status")).toBe(false);
  expect(await f.call(QvmUiImport.UI_LAN_SERVERSTATUS, [0, 0, 0])).toBe(0); expect(f.reply(3, "status")).toBe(false);
  await f.view.serverStatusCommand("127.0.0.1:27960"); f.time(1820); expect(f.reply(4, "status")).toBe(true);
  f.view.poll(); expect(f.printed.join("")).toContain('"Player"'); const length = f.printed.length;
  f.view.poll(); expect(f.printed).toHaveLength(length); f.view.close();
});

test("cache traps persist active metadata and reset unused tails through the shared owner", async () => {
  const f = fixture(); await f.add(1, 27961, "Mplayer"); await f.add(2, 27962, "Global"); await f.add(3, 27963, "Favorite");
  f.call(QvmUiImport.UI_LAN_MARKSERVERVISIBLE, [3, -1, -17]);
  expect(await f.call(QvmUiImport.UI_LAN_SAVECACHEDSERVERS)).toBe(0);
  expect(f.saved()?.lists.map(list => list.rows.length)).toEqual([1, 1, 1]);
  f.call(QvmUiImport.UI_LAN_MARKSERVERVISIBLE, [3, -1, 1]);
  expect(await f.call(QvmUiImport.UI_LAN_LOADCACHEDSERVERS)).toBe(0);
  expect(f.call(QvmUiImport.UI_LAN_SERVERISVISIBLE, [3, 0])).toBe(-17);
  expect(f.call(QvmUiImport.UI_LAN_SERVERISVISIBLE, [3, 127])).toBe(0);
  f.call(QvmUiImport.UI_LAN_GETSERVERINFO, [1, 0, 256, 1024]); expect(f.guest.readString(256)).toContain("Mplayer");
  f.call(QvmUiImport.UI_LAN_GETSERVERINFO, [2, 0, 256, 1024]); expect(f.guest.readString(256)).toContain("Global"); f.view.close();
});

test("closing the view during DNS prevents a ping, status or add mutation", async () => {
  for (const kind of ["ping", "status", "add"]) {
    const f = fixture(); let finish: (address: NetworkAddress | null) => void = () => { throw new Error("DNS not started"); };
    f.host.resolveQ3 = () => new Promise(resolve => { finish = resolve; });
    const pending = kind === "ping" ? f.view.ping("example") : kind === "status" ? f.view.serverStatus("example", 128) : f.view.addServer(3, () => "name", () => "example");
    f.view.close(); finish(ipv4Address([127, 0, 0, 1], 27960)); await expect(pending).rejects.toThrow("after close");
    expect(f.sent).toHaveLength(0); expect(f.core.list()).toHaveLength(0);
  }
});


test("full lists skip guest strings and busy status slots never cancel an unrelated request", async () => {
  const f = fixture();
  for (let index = 0; index < 128; index++) await f.add(3, 27960 + index);
  expect(await f.call(QvmUiImport.UI_LAN_ADDSERVER, [3, 0, 0])).toBe(-1);
  for (let index = 0; index < 17; index++) expect(await f.view.serverStatus(`127.0.0.1:${27960 + index}`, 1024)).toBeNull();
  expect(f.sent).toHaveLength(16);
  await f.view.serverStatus("127.0.0.1:28000", null); expect(f.reply(0, "status")).toBe(true);
  expect(await f.view.serverStatus("127.0.0.1:27960", 1024)).toContain('"Player"');
  await f.view.serverStatus("127.0.0.1:28000", 1024); expect(f.sent).toHaveLength(17);
  f.view.close(); expect(f.reply(16, "status")).toBe(false);
});

test("a scan reset clears old row ping and name even when replies arrive before the next view read", async () => {
  const f = fixture(); await f.add(0, 27960, "Old authored name");
  f.view.markServerVisibleValue(0, 0, -7); await f.view.ping("127.0.0.1:27960");
  f.time(1010); f.reply(0); f.view.poll(); expect(f.view.getServerPing(0, 0)).toBe(11);
  f.host.scanQ3(); f.host.addQ3(0, ipv4Address([127, 0, 0, 1], 27960));
  expect(f.view.getServerPing(0, 0)).toBe(-1); expect(f.view.serverVisibilityValue(0, 0)).toBe(-7);
  f.view.resetPings(0); f.view.poll(); expect(f.view.getServerPing(0, 0)).toBe(-1); f.view.close();
});

test("master resolution checks the borrowed view before publishing or sending", async () => {
  const f = fixture(); let finish: () => void = () => { throw new Error("DNS not started"); }, sends = 0;
  f.host.requestQ3Master = async (_source, _remote, _protocol, _keywords, assertCurrent) => {
    await new Promise<void>(resolve => { finish = resolve; }); assertCurrent?.(); sends++;
  };
  const pending = f.view.globalServers(2, "master.example", 68, []); f.view.close(); finish();
  await expect(pending).rejects.toThrow("after close"); expect(sends).toBe(0);
});


test("global overflow replaces timed-out slots in LIFO order and append revisions retain selected rows", async () => {
  const f = fixture();
  for (let index = 0; index < 4098; index++) f.host.addQ3(2, ipv4Address([127, 0, 0, 1], 10000 + index));
  expect(f.view.getServerCount(2)).toBe(4096);
  f.view.markServerVisibleValue(2, 0, -9); expect(f.view.updateVisiblePings(2)).toBe(true); expect(f.sent).toHaveLength(1);
  f.time(1900); f.view.updateVisiblePings(2); expect(f.view.getServerAddressString(2, 0, 64)).toBe("127.0.0.1:14097");
  expect(f.view.serverVisibilityValue(2, 0)).toBe(-9); expect(f.view.getServerPing(2, 0)).toBe(-1);
  f.host.addQ3(2, ipv4Address([127, 0, 0, 1], 14098));
  expect(f.view.getServerAddressString(2, 0, 64)).toBe("127.0.0.1:14097");
  await f.view.saveServersToCache(); await f.view.loadCachedServers();
  expect(f.view.getServerAddressString(2, 0, 64)).toBe("127.0.0.1:14097"); expect(f.view.getServerCount(2)).toBe(4096);
  f.view.updateVisiblePings(2); f.time(2800); f.view.updateVisiblePings(2); f.view.updateVisiblePings(2);
  expect(f.view.getServerAddressString(2, 0, 64)).toBe("127.0.0.1:14097"); f.view.close();
});


test("cache load checks the retired borrowed view before publishing awaited disk contents", async () => {
  const f = fixture(); let finish: () => void = () => { throw new Error("Read not started"); }, published = false;
  f.host.loadQ3Cache = async assertCurrent => {
    await new Promise<void>(resolve => { finish = resolve; }); assertCurrent?.(); published = true; return null;
  };
  const pending = f.view.loadCachedServers(); f.view.close(); finish();
  await expect(pending).rejects.toThrow("after close"); expect(published).toBe(false);
});


test("retained Q3 replies survive the menu timeout and changing cvars until explicit clear or cancel", async () => {
  const f = fixture(); await f.add(); await f.view.ping("127.0.0.1:27960");
  await f.view.serverStatus("127.0.0.1:27960", 1024);
  f.view.options.maxPing = () => 5000; f.view.options.statusResendTime = () => 6000;
  f.time(5000); expect(f.core.expireQueries(5000, 3000)).toEqual([]);
  expect(f.view.getPing(0, 64).time).toBe(0);
  expect(f.reply(0)).toBe(true); expect(f.reply(1, "status")).toBe(true); f.view.poll();
  expect(f.view.getPing(0, 64).time).toBe(4001);
  expect(await f.view.serverStatus("127.0.0.1:27960", 1024)).toContain('"Player"');
  f.view.clearPing(0); await f.view.serverStatus("127.0.0.1:27960", null);
  await f.view.ping("127.0.0.1:27960"); await f.view.serverStatus("127.0.0.1:27960", 1024);
  f.view.clearPing(0); await f.view.serverStatus("127.0.0.1:27960", null);
  f.time(9000); expect(f.reply(2)).toBe(false); expect(f.reply(3, "status")).toBe(false);
  expect(f.view.getPingQueueCount()).toBe(0); f.view.close();
});
