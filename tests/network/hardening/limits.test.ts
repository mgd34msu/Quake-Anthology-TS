// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { ConnectionlessGate } from "../../../src/network/services/admin.ts";
import { RconGuard, passwordMatches } from "../../../src/network/common/rcon-guard.ts";
import { Q2ChallengeTable, readQ2DownloadServer } from "../../../src/network/q2/handshake.ts";
import { hasNonFinite, zeroNonFinite } from "../../../src/app/bootstrap/network/unified-finite.ts";
import { printablePeerText } from "../../../src/network/common/diagnostics.ts";
import type { Ipv4Address } from "../../../src/network/common/endpoint.ts";

const remote: Ipv4Address = { kind: "ipv4", host: [203, 0, 113, 9], port: 4000 };
const lan: Ipv4Address = { kind: "ipv4", host: [192, 168, 1, 5], port: 27910 };

test("connectionless replies are limited per source address and exempt loopback", () => {
  const gate = new ConnectionlessGate();
  let allowed = 0;
  for (let index = 0; index < 100; index++) if (gate.allow({ ...remote, port: 1000 + index }, 0)) allowed++;
  expect(allowed).toBe(10);
  expect(gate.allow({ ...remote, port: 5 }, 10_000)).toBe(true);
  for (let index = 0; index < 1000; index++) expect(gate.allow({ kind: "loopback", id: "a" }, 0)).toBe(true);
});

test("rcon guesses back off per source and passwords compare by digest", () => {
  const guard = new RconGuard();
  for (let index = 0; index < 3; index++) {
    expect(guard.permitted(remote, 0)).toBe(true);
    guard.failed(remote, 0);
  }
  expect(guard.permitted(remote, 500)).toBe(false);
  expect(guard.permitted(remote, 1500)).toBe(true);
  expect(guard.permitted(lan, 0)).toBe(true);
  expect(passwordMatches("secret", "secret")).toBe(true);
  expect(passwordMatches("secret", "secreT")).toBe(false);
  expect(passwordMatches("", "")).toBe(false);
});

test("Q2 challenges are 31 bit values that expire", () => {
  const table = new Q2ChallengeTable(() => 0x7fffffff);
  const value = table.issue(remote, 0);
  expect(value).toBe(0x7fffffff);
  expect(table.validate(remote, value, 1000)).toBe(true);
  expect(table.validate(remote, value, 60_000)).toBe(false);
});

test("a download server on a private host is accepted only from a private game server", () => {
  const advertised = ["dlserver=http://10.0.0.7:8080/"];
  expect(readQ2DownloadServer(advertised, remote)).toBeNull();
  expect(readQ2DownloadServer(advertised, lan)?.hostname).toBe("10.0.0.7");
  expect(readQ2DownloadServer(["dlserver=http://files.example.com/"], remote)?.hostname).toBe("files.example.com");
  expect(readQ2DownloadServer(["dlserver=http://localhost/"], remote)).toBeNull();
});

test("non-finite numbers are found and zeroed without touching finite paths", () => {
  const clean = { a: [1, 2], b: { c: 3 } };
  expect(hasNonFinite(clean)).toBe(false);
  expect(zeroNonFinite(clean)).toBe(clean);
  const dirty = { a: [1, Number.NaN], b: { c: Number.POSITIVE_INFINITY }, keep: clean };
  expect(hasNonFinite(dirty)).toBe(true);
  const fixed = zeroNonFinite(dirty);
  expect(fixed).toEqual({ a: [1, 0], b: { c: 0 }, keep: clean });
  expect(fixed.keep).toBe(clean);
});

test("peer text loses control characters and is bounded", () => {
  expect(printablePeerText("a\u001b[2Jb\n")).toBe("a?[2Jb\n");
  expect(printablePeerText("x".repeat(1000))).toHaveLength(256);
});
