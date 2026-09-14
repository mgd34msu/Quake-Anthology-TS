import { expect, test } from "bun:test";
import { ipv4Address } from "../../../src/network/common/endpoint.ts";
import { decodeConnectionless } from "../../../src/network/q3/connectionless.ts";
import { decodeQ3ServerStatus, encodeQ3Info, encodeQ3Status, q3DiscoveryWire } from "../../../src/network/q3/discovery.ts";
import { ServerBrowser } from "../../../src/network/services/discovery.ts";
import type { DiscoveryRequestHandle, DiscoveryRequestKind } from "../../../src/network/services/discovery.ts";

const address = ipv4Address([127, 0, 0, 1], 27960), other = ipv4Address([127, 0, 0, 2], 27960);
function fixture() {
  const sent: Uint8Array[] = [];
  const browser = new ServerBrowser(q3DiscoveryWire(), { send(_to, bytes) { sent.push(bytes); return true; } });
  function challenge(index: number): string {
    const bytes = sent[index];
    if (bytes === undefined) throw new Error("Missing sent query");
    const value = decodeConnectionless(bytes, "server").arguments[0];
    if (value === undefined) throw new Error("Missing challenge");
    return value;
  }
  function response(index: number, kind: DiscoveryRequestKind = "info") {
    const info = `\\challenge\\${challenge(index)}\\protocol\\68\\hostname\\Arena\\mapname\\q3dm1\\clients\\1\\sv_maxclients\\8`;
    return decodeQ3ServerStatus(kind === "info" ? encodeQ3Info(info) : encodeQ3Status(info, [{ name: "Player", score: 7, ping: 42 }]));
  }
  function request(now: number, kind: DiscoveryRequestKind = "info"): DiscoveryRequestHandle {
    const handle = browser.request(address, now, kind);
    if (handle === null) throw new Error("Request failed");
    return handle;
  }
  return { browser, sent, challenge, response, request };
}

test("LAN discovery adds membership to existing favorites and cache restore retains live status", () => {
  const f = fixture(); f.browser.add(address, "favorite");
  f.browser.broadcast([ipv4Address([255, 255, 255, 255], 27960)], 10);
  const reply = f.response(0);
  expect(f.browser.receive(address, reply.status, reply.challenge, 20)).toBe(true);
  expect(f.browser.entry(address)?.sources).toEqual(["favorite", "lan"]);
  f.browser.restoreEntry({ address, sources: ["secondary-master"], status: { ...reply.status, name: "Stale cache" }, pingMilliseconds: 100, updatedAt: 0 });
  expect(f.browser.entry(address)?.status?.name).toBe("Arena");
  expect(f.browser.entry(address)?.sources).toEqual(["favorite", "lan", "secondary-master"]);
  f.browser.removeSource(address, "secondary-master"); f.browser.removeFavorite(address);
  expect(f.browser.entry(address)?.sources).toEqual(["lan"]);
});

test("owner-managed requests accept late replies until release while timed requests retain explicit deadlines", () => {
  const f = fixture(), retained = f.browser.request(address, 0, "info", null), timed = f.browser.request(other, 0, "status", 100);
  if (retained === null || timed === null) throw new Error("Missing request handles");
  f.browser.expireQueries(3000, 3000);
  expect(f.browser.requestResult(retained)?.kind).toBe("pending"); expect(f.browser.requestResult(timed)?.kind).toBe("expired");
  const reply = f.response(0);
  expect(f.browser.receive(address, reply.status, reply.challenge, 4000)).toBe(true);
  expect(f.browser.requestResult(retained)).toMatchObject({ kind: "completed", pingMilliseconds: 4000 });
  f.browser.releaseRequest(retained); expect(f.browser.requestResult(retained)).toBeNull();
  const released = f.browser.request(address, 5000, "info", null); if (released === null) throw new Error("Missing released request");
  const late = f.response(2); f.browser.releaseRequest(released);
  expect(f.browser.receive(address, late.status, late.challenge, 9000)).toBe(false);
});

test("independent info/status handles complete in either order with decoded player results", () => {
  for (const statusFirst of [true, false]) {
    const f = fixture(), info = f.request(10), status = f.request(20, "status");
    const order = statusFirst ? [1, 0] : [0, 1];
    for (const index of order) {
      const reply = f.response(index, index === 0 ? "info" : "status");
      expect(f.browser.receive(address, reply.status, reply.challenge, 50 + index)).toBe(true);
    }
    expect(f.browser.requestResult(info)).toMatchObject({ kind: "completed", requestKind: "info", pingMilliseconds: 40 });
    expect(f.browser.requestResult(status)).toMatchObject({ kind: "completed", requestKind: "status", pingMilliseconds: 31,
      status: { playerDetails: [{ name: "Player", score: 7, ping: 42 }] } });
    expect(f.browser.list()).toHaveLength(1);
    expect(f.browser.expireQueries(5000, 3000)).toEqual([]);
    expect(f.browser.requestResult(info)?.kind).toBe("completed");
  }
});

test("unknown challenge, wrong endpoint and wrong kind cannot complete a request", () => {
  const f = fixture(), handle = f.request(0), reply = f.response(0);
  expect(f.browser.receive(other, reply.status, reply.challenge, 10)).toBe(false);
  expect(f.browser.receive(address, reply.status, "unknown", 10)).toBe(false);
  expect(f.browser.receive(address, reply.status, reply.challenge, 10, "status")).toBe(false);
  expect(f.browser.requestResult(handle)?.kind).toBe("pending");
  expect(f.browser.receive(address, reply.status, reply.challenge, 10)).toBe(true);
  expect(f.browser.receive(address, reply.status, reply.challenge, 20)).toBe(false);
});

test("challenge-less replies need an unambiguous request and can use explicit kind", () => {
  const f = fixture(), info = f.request(0), status = f.request(1, "status"), reply = f.response(0);
  expect(f.browser.receive(address, reply.status, null, 10)).toBe(false);
  expect(f.browser.receive(address, reply.status, null, 10, "status")).toBe(true);
  expect(f.browser.requestResult(status)?.kind).toBe("completed");
  expect(f.browser.requestResult(info)?.kind).toBe("pending");
  expect(f.browser.receive(address, reply.status, null, 11)).toBe(true);
});

test("same-kind explicit requests are independently challenge-correlated", () => {
  const f = fixture(), first = f.request(0), second = f.request(1), reply = f.response(0);
  expect(f.browser.receive(address, reply.status, null, 10, "info")).toBe(false);
  expect(f.browser.receive(address, reply.status, reply.challenge, 10)).toBe(true);
  expect(f.browser.requestResult(first)?.kind).toBe("completed");
  expect(f.browser.requestResult(second)?.kind).toBe("pending");
});

test("expiry, cancellation and release retain terminal results until explicitly released", () => {
  const f = fixture(), expired = f.request(0), cancelled = f.request(1, "status");
  const pendingSnapshot = f.browser.requestResult(expired);
  f.browser.add(address, "favorite");
  expect(f.browser.cancelRequest(cancelled)).toBe(true);
  expect(f.browser.cancelRequest(cancelled)).toBe(false);
  expect(f.browser.requestResult(cancelled)?.kind).toBe("cancelled");
  expect(f.browser.expireQueries(2999, 3000)).toEqual([]);
  expect(f.browser.expireQueries(3000, 3000)).toEqual([address]);
  expect(f.browser.requestResult(expired)?.kind).toBe("expired");
  expect(Object.isFrozen(f.browser.requestResult(expired))).toBe(true);
  expect(pendingSnapshot?.kind).toBe("pending");
  expect(f.browser.expireQueries(4000, 3000)).toEqual([]);
  for (const index of [0, 1]) {
    const reply = f.response(index);
    expect(f.browser.receive(address, reply.status, reply.challenge, 4000)).toBe(false);
  }
  f.browser.releaseRequest(expired); f.browser.releaseRequest(cancelled);
  expect(f.browser.requestResult(expired)).toBeNull();
  expect(f.browser.requestResult(cancelled)).toBeNull();
  const released = f.request(5000), reply = f.response(2);
  f.browser.releaseRequest(released);
  expect(f.browser.receive(address, reply.status, reply.challenge, 5010)).toBe(false);
  expect(f.browser.favoriteAddresses()).toEqual([address]);
});

test("expiration deduplicates addresses and retains requests without a browser row", () => {
  const f = fixture(), info = f.request(0), status = f.request(0, "status");
  expect(f.browser.expireQueries(10, 10)).toEqual([]);
  expect(f.browser.requestResult(info)?.kind).toBe("expired");
  expect(f.browser.requestResult(status)?.kind).toBe("expired");
  f.browser.add(address, "direct"); f.request(20); f.request(20, "status");
  expect(f.browser.expireQueries(30, 10)).toEqual([address]);
});

test("boolean menu queries replace only their own same-kind pending work", () => {
  const f = fixture(), retained = f.request(0);
  expect(f.browser.query(address, 1)).toBe(true);
  expect(f.browser.query(address, 2, "status")).toBe(true);
  expect(f.browser.query(address, 3)).toBe(true);
  const stale = f.response(1);
  expect(f.browser.receive(address, stale.status, stale.challenge, 10)).toBe(false);
  for (const index of [2, 3, 0]) {
    const reply = f.response(index);
    expect(f.browser.receive(address, reply.status, reply.challenge, 10)).toBe(true);
  }
  expect(f.browser.requestResult(retained)?.kind).toBe("completed");
  expect(f.browser.expireQueries(5000, 3000)).toEqual([]);
});

test("legacy challenge-less menu refresh retains latest query time", () => {
  const f = fixture();
  f.browser.query(address, 0); f.browser.query(address, 5);
  const reply = f.response(1);
  expect(f.browser.receive(address, reply.status, null, 10)).toBe(true);
  expect(f.browser.list()[0]?.pingMilliseconds).toBe(5);
  expect(f.browser.receive(address, reply.status, null, 11)).toBe(false);
});

test("LAN broadcast challenges coexist with direct status queries and multiple responders", () => {
  const f = fixture(), status = f.request(0, "status");
  const broadcast = ipv4Address([255, 255, 255, 255], 27960);
  expect(f.browser.broadcast([broadcast], 5)).toBe(1);
  const lan = f.response(1);
  expect(f.browser.receive(address, lan.status, lan.challenge, 10)).toBe(true);
  expect(f.browser.receive(other, lan.status, lan.challenge, 11)).toBe(true);
  expect(f.browser.list().map(entry => entry.sources)).toEqual([["lan"], ["lan"]]);
  expect(f.browser.requestResult(status)?.kind).toBe("pending");
  const direct = f.response(0, "status");
  expect(f.browser.receive(address, direct.status, direct.challenge, 12)).toBe(true);
  expect(f.browser.requestResult(status)?.kind).toBe("completed");
  f.browser.expireQueries(3005, 3000);
  expect(f.browser.receive(other, lan.status, lan.challenge, 3010)).toBe(false);
});

test("failed sends and thrown transport errors leave no correlatable request", () => {
  const status = fixture().browser;
  expect(status.requestResult(Symbol("foreign"))).toBeNull();
  const reply = decodeQ3ServerStatus(encodeQ3Info("\\protocol\\68\\challenge\\1"));
  for (const throws of [false, true]) {
    const browser = new ServerBrowser(q3DiscoveryWire(), { send() { if (throws) throw new Error("send failed"); return false; } });
    if (throws) expect(() => browser.request(address, 0)).toThrow("send failed");
    else expect(browser.request(address, 0)).toBeNull();
    expect(browser.receive(address, reply.status, reply.challenge, 10)).toBe(false);
    expect(browser.expireQueries(5000, 3000)).toEqual([]);
  }
});


test("entry reads the canonical current row by endpoint", () => {
  const f = fixture();
  expect(f.browser.entry(address)).toBeNull();
  const initial = f.browser.add(address, "favorite");
  expect(f.browser.entry(ipv4Address([127, 0, 0, 1], 27960))).toBe(initial);
  f.request(0);
  const reply = f.response(0);
  f.browser.receive(address, reply.status, reply.challenge, 10);
  expect(f.browser.entry(address)).toBe(f.browser.list()[0] ?? null);
  expect(f.browser.entry(address)?.status).toBe(reply.status);
  expect(f.browser.entry(other)).toBeNull();
});
