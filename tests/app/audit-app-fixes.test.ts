import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { serverMapPath } from "../../src/app/bootstrap/server-map.ts";
import { legacyClientCommand } from "../../src/compat/qvm/legacy-client-abi.ts";
import { loadAudioSettings } from "../../src/app/bootstrap/audio-settings.ts";
import { ApplicationViewSettings } from "../../src/app/bootstrap/view-settings.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { cacheEvictingRejection } from "../../src/app/bootstrap/cached-promise.ts";
import { writeQ3BrowserCache, readQ3BrowserCache } from "../../src/app/bootstrap/server-browser-cache.ts";
import { Q3_PROTOCOL } from "../../src/network/q3/adapters.ts";

const noRoot = ["--content-root", "/nonexistent-content-root"];

test("command-line options reject a flag used as a value and contradictory combinations", () => {
  expect(() => parseApplicationCommand([...noRoot, "--game", "--dedicated"])).toThrow("Missing value for --game");
  expect(() => parseApplicationCommand([...noRoot, "--connect-q2", "--seats", "2"])).toThrow("Missing value for --connect-q2");
  expect(() => parseApplicationCommand([...noRoot, "--listen", "27500", "--bind", "not a host"])).toThrow("Invalid bind address");
  expect(() => parseApplicationCommand([...noRoot, "--dedicated", "--connect-q2", "127.0.0.1"])).toThrow("dedicated server cannot connect");
  expect(() => parseApplicationCommand([...noRoot, "--mode", "singleplayer", "--seats", "2"])).toThrow("conflicts");
  expect(parseApplicationCommand([...noRoot, "--mode", "singleplayer", "--map", "e1m1"]).kind).toBe("run");
});

test("server-supplied map names are not held to the command-line name check", () => {
  expect(serverMapPath("q3dm17.v2")).toBe("maps/q3dm17.v2.bsp");
  expect(serverMapPath("maps\\ctf-2.fort.bsp")).toBe("maps/ctf-2.fort.bsp");
  expect(() => serverMapPath("../escape")).toThrow("Invalid relative resource path: ../escape");
});

test("an unmapped legacy configstring command is dropped instead of ending the client", () => {
  expect(legacyClientCommand(["cs", "20", "x"], "q3-1.16n-base")).toEqual(["cs", "12", "x"]);
  expect(legacyClientCommand(["cs", "15", "x"], "q3-1.16n-base")).toBeNull();
  expect(legacyClientCommand(["cs", "abc"], "q3-1.16n-base")).toBeNull();
  expect(legacyClientCommand(["cs", "15", "x"], "q3-modern")).toEqual(["cs", "15", "x"]);
});

test("parsable but out-of-range preference files fall back to defaults with a warning", async () => {
  const root = await mkdtemp(join(tmpdir(), "bad-preferences-"));
  try {
    const store = new ConfigStore(root), warnings: string[] = [];
    await store.dump("audio.json", JSON.stringify({ version: 1, deviceName: null, effectsVolume: 5, musicVolume: 0.5 }));
    await store.dump("view.json", JSON.stringify({ version: 1, fieldOfView: 170 }));
    expect(await loadAudioSettings(store, text => warnings.push(text))).toEqual({});
    const view = new ApplicationViewSettings(() => undefined);
    await view.load(store, text => warnings.push(text));
    expect(view.fieldOfView).toBe(90);
    expect(warnings.join("")).toContain("audio.json"); expect(warnings.join("")).toContain("view.json");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a rejected load is evicted so a transient failure can be retried", async () => {
  const cache = new Map<string, Promise<number>>();
  await expect(cacheEvictingRejection(cache, "a", Promise.reject(new Error("transient")))).rejects.toThrow("transient");
  expect(cache.has("a")).toBe(false);
  expect(await cacheEvictingRejection(cache, "a", Promise.resolve(3))).toBe(3);
  expect(cache.has("a")).toBe(true);
});

test("a listed Q3 server whose status the cache cannot hold is saved without that status", () => {
  const rules = new Map<string, string>();
  for (let index = 0; index < 1100; index++) rules.set(`k${index}`, "v");
  const entry: Parameters<typeof writeQ3BrowserCache>[0][number] = { address: { kind: "ipv4", host: [10, 0, 0, 1], port: 27960 }, sources: ["master"], pingMilliseconds: 5, updatedAt: 1,
    status: { name: "big", map: "q3dm1", players: 0, maxPlayers: 8, rules, playerDetails: [], wire: { kind: "source", protocol: Q3_PROTOCOL } } };
  const saved = writeQ3BrowserCache([entry], null);
  expect(readQ3BrowserCache(saved).entries[0]?.status).toBeNull();
});
