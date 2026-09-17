import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSourceAdministrationCvars, ServerOperatorState, sourceServerAdministration, type ServerOperatorHost } from "../../src/app/bootstrap/server-administration.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { addressKey, ipAddress } from "../../src/network/common/endpoint.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { handleQ2Rcon } from "../../src/network/q2/connectionless.ts";
import { q2OutOfBand, readQ2OutOfBand } from "../../src/network/q2/handshake.ts";

test("early administration registration preserves configured Q1 values without duplicate warnings", () => {
  const identity = createIdentityOwner("operator-registration"), output: string[] = [];
  const cvars = new CvarRegistry({ dialect: "q1-quakeworld", context: { session: identity.session, origin: { kind: "server-console" } }, print: text => output.push(text) });
  registerSourceAdministrationCvars(cvars);
  cvars.set("rcon_password", "configured"); cvars.set("filterban", "0");
  registerSourceAdministrationCvars(cvars);
  expect(cvars.variableString("rcon_password")).toBe("configured");
  expect(cvars.variableString("filterban")).toBe("0");
  expect(output).toEqual([]);
});

test("operator filters persist source masks and write executable Q2 filter commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-admin-"));
  try {
    const store = new ConfigStore(root), state = await ServerOperatorState.open(store, "filters.json");
    const identity = createIdentityOwner("operator-filters"), output: string[] = [];
    const cvars = new CvarRegistry({ dialect: "q2-classic", context: { session: identity.session, origin: { kind: "server-console" } } });
    const administration = sourceServerAdministration({ state, cvars, dedicated: true, dialect: "q2-classic", execute: async () => {}, record: () => {} });
    const sent: string[] = [];
    const host: ServerOperatorHost = { dialect: "q2-classic", cvars, dedicated: true, print: text => output.push(text),
      send: (to, bytes) => { sent.push(`${addressKey(to)}:${new TextDecoder().decode(bytes.subarray(4))}`); return true; },
      writeConfig: (name, text) => store.dump(name, text), heartbeat: () => output.push("heartbeat") };
    expect(administration.masters()).toHaveLength(0);
    expect(await state.filterCommand(host, "sv", ["addip", "192.168.0.0"])).toBe(true);
    expect(administration.rejects(ipAddress("192.168.7.8", 27910))).toBe(true);
    expect(administration.rejects(ipAddress("10.1.2.3", 27910))).toBe(false);
    const restored = await ServerOperatorState.open(store, "filters.json");
    expect(restored.rejects(ipAddress("192.168.9.10", 27910), 1)).toBe(true);
    expect(restored.rejects(ipAddress("192.168.9.10", 27910), 0.5)).toBe(false);
    expect(restored.rejects(ipAddress("10.1.2.3", 27910), 0.5)).toBe(false);
    expect(await state.filterCommand(host, "sv", ["writeip"])).toBe(true);
    expect(await store.loadText("listip.cfg")).toBe("set filterban 1\nsv addip 192.168.0.0\n");
    cvars.set("public", "1");
    await state.setMasters(host, ["127.0.0.1:27901"]);
    expect(sent).toEqual(["127.0.0.1:27901:ping"]);
    expect(administration.masters().map(address => addressKey(address))).toEqual(["192.246.40.37:27900", "127.0.0.1:27901"]);
    expect(await state.filterCommand(host, "sv", ["removeip", "192.168.0.0"])).toBe(true);
    expect(administration.rejects(ipAddress("192.168.7.8", 27910))).toBe(false);
    cvars.set("rcon_password", "operator"); expect(administration.rconPassword()).toBe("operator");
    expect(await state.filterCommand(host, "sv", ["unrecognized"])).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Q3 administration leaves bans to game admission and publishes only public dedicated hosts", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-admin-q3-"));
  try {
    const state = await ServerOperatorState.open(new ConfigStore(root), "filters.json"), identity = createIdentityOwner("operator-q3");
    const cvars = new CvarRegistry({ dialect: "q3", context: { session: identity.session, origin: { kind: "server-console" } } });
    cvars.register("dedicated", "1", 0);
    const administration = sourceServerAdministration({ state, cvars, dedicated: true, dialect: "q3", execute: async () => {}, record: () => {} });
    cvars.set("sv_master1", "127.0.0.1:27951");
    expect(state.refreshQ3Masters(cvars, () => {})).toBeUndefined();
    await Promise.resolve();
    expect(administration.masters()).toEqual([]);
    cvars.set("dedicated", "2");
    expect(administration.masters().map(address => addressKey(address))).toEqual(["127.0.0.1:27951"]);
    expect(administration.rejects(ipAddress("10.1.2.3", 27960))).toBe(false);
    expect(administration.rejects(ipAddress("10.1.2.4", 27960))).toBe(false);
    cvars.set("rconPassword", "new-password"); expect(administration.rconPassword()).toBe("new-password");
    cvars.set("sv_master1", "127.0.0.1:27952"); state.refreshQ3Masters(cvars, () => {});
    expect(administration.masters().map(address => addressKey(address))).toEqual(["127.0.0.1:27951"]);
    cvars.set("sv_master1", "127.0.0.1:27953"); state.refreshQ3Masters(cvars, () => {});
    await Promise.resolve();
    expect(administration.masters().map(address => addressKey(address))).toEqual(["127.0.0.1:27953"]);
    cvars.set("sv_master1", "127.0.0.1:27954"); state.refreshQ3Masters(cvars, () => {}); state.close();
    await Promise.resolve();
    expect(administration.masters().map(address => addressKey(address))).toEqual(["127.0.0.1:27953"]);

  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Q2 limited rcon preserves raw prefixes and refunds authenticated rate credit", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-lrcon-"));
  try {
    const state = await ServerOperatorState.open(new ConfigStore(root), "filters.json"), identity = createIdentityOwner("operator-lrcon");
    const cvars = new CvarRegistry({ dialect: "q2-rerelease", context: { session: identity.session, origin: { kind: "server-console" } } });
    registerSourceAdministrationCvars(cvars);
    cvars.set("lrcon_password", "limited"); cvars.set("rcon_password", "full"); cvars.set("sv_rcon_limit", "2/min*2");
    const output: string[] = [], executed: string[] = [], print = (text: string): void => { output.push(text); };
    state.limitedRconCommand("addlrconcmd", '"say  "', print);
    state.limitedRconCommand("addlrconcmd", "status", print);
    state.limitedRconCommand("addlrconcmd", "status", print);
    expect(state.limitedRcon(cvars).prefixes).toEqual(["say  ", "status"]);
    expect(output.pop()).toBe("Lrconcmd already exists: status\n");
    const message = (bytes: Uint8Array) => { const parsed = readQ2OutOfBand(bytes); if (parsed === null) throw new Error("Missing rcon packet"); return parsed; };
    const run = (command: string, now = 0) => handleQ2Rcon({ profile: "rerelease", reply: (_from, bytes) => print(message(bytes).text),
      rconPassword: () => cvars.variableString("rcon_password"), limitedRcon: () => state.limitedRcon(cvars),
      rconRateAllowed: time => state.rconRateAllowed(cvars, time, print), rechargeRconRate: () => state.rechargeRconRate(),
      executeRcon: async (text, limited, write) => { executed.push(`${limited}:${text}`); write("done\n"); } }, ipAddress("127.0.0.1", 27910), message(q2OutOfBand(command)), now);
    await run("rcon wrong status");
    await run("rcon limited quit"); expect(output.at(-1)).toContain("not permitted");
    await run('rcon limited say  "hello world"');
    await run("rcon limited status");
    expect(executed).toEqual(['true:say  "hello world"', "true:status"]);
    await run("rcon wrong status");
    const before = output.length; await run("rcon full status"); expect(output).toHaveLength(before);
    await run("rcon full status", 30000); expect(executed.at(-1)).toBe("false:status");
    state.limitedRconCommand("dellrconcmd", "1", print); expect(state.limitedRcon(cvars).prefixes).toEqual(["status"]);
    state.limitedRconCommand("dellrconcmd", "all", print); expect(state.limitedRcon(cvars).prefixes).toEqual([]);
    cvars.set("sv_rcon_limit", "0"); expect(state.rconRateAllowed(cvars, 30000, print)).toBe(true);
    cvars.set("sv_rcon_limit", "1/2sec*1"); expect(state.rconRateAllowed(cvars, 30000, print)).toBe(true);
    expect(state.rconRateAllowed(cvars, 31999, print)).toBe(false);
    expect(state.rconRateAllowed(cvars, 32000, print)).toBe(true);
    const next = new CvarRegistry({ dialect: "q2-rerelease", context: { session: identity.session, origin: { kind: "server-console" } } });
    registerSourceAdministrationCvars(next); next.set("sv_rcon_limit", "1/2sec*1");
    expect(state.rconRateAllowed(next, 32000, print)).toBe(false);
    next.set("sv_rcon_limit", "1/4294967295hour");
    expect(state.rconRateAllowed(next, 32000, print)).toBe(false);
    expect(output.at(-1)).toBe("Period too large: 4294967295\n");
    expect(state.rconRateAllowed(next, 34000, print)).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
