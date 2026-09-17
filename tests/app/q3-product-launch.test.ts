import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContentId, createMountIdentity, createMountPlanId } from "../../src/contracts/content.ts";
import { InstalledCatalog, expectedProducts, type CatalogProduct } from "../../src/content/catalog/index.ts";
import { openArchive } from "../../src/content/archive/index.ts";
import { openMountPlan } from "../../src/content/mounts/index.ts";
import { prepareQ3ApplicationProduct } from "../../src/app/bootstrap/q3-product.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { openInitialConfigurationContent } from "../../src/app/bootstrap/configuration.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { q3MapLaunch } from "../../src/app/bootstrap/q3-map-command.ts";
import { readTeamArenaCampaign } from "../../src/app/bootstrap/team-arena-skirmish.ts";

function catalog(root: string): InstalledCatalog {
  const products: CatalogProduct[] = expectedProducts.filter(product => ["q3-baseq3", "q3-missionpack", "q3-demota"].includes(product.id)).map(expectation => ({
    id: createContentId({ family: expectation.family, edition: expectation.edition, package: expectation.campaign, revision: "installed" }), expectation,
    availability: expectation.id === "q3-demota" ? { kind: "missing", requirements: ["q3a/demota/pak0.pk3"] } : { kind: "installed" },
    archives: [], looseRoot: root, userContent: null, maps: [], diagnostics: [],
  }));
  return new InstalledCatalog(root, products, [], 0);
}
async function retailId(): Promise<Uint8Array> {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q3a/baseq3/pak0.pk3", "pk3");
  try {
    const entry = archive.findEntries("productid.txt")[0]; if (entry === undefined) throw new Error("Missing retail product identification");
    return await archive.readEntry(entry);
  } finally { archive.close(); }
}

test("public Q3 launch resolves product identification before map assets and honors independent startup selectors", async () => {
  const root = await mkdtemp(join(tmpdir(), "q3-product-launch-"));
  try {
    const installed = catalog(root), command = parseApplicationCommand(["--game", "q3-baseq3", "--movement", "q3", "--character", "q3", "--content-root", root]);
    if (command.kind !== "run" && command.kind !== "menu") throw new Error("Missing options");
    await writeFile(join(root, "productid.txt"), "corrupt");
    await expect(loadApplicationContent(command.options, undefined, undefined, installed)).rejects.toThrow("Invalid product identification");
    await expect(prepareQ3ApplicationProduct(installed, "q3-baseq3", { startupCommands: ['set com_prereleaseDemo "1"'] })).rejects.toThrow("q3a/demota/pak0.pk3");
    await expect(prepareQ3ApplicationProduct(installed, "q3-baseq3", { startupCommands: ['set fs_restrict "1"'] })).rejects.toThrow("q3a/demota/pak0.pk3");
    await rm(join(root, "productid.txt"));
    await expect(prepareQ3ApplicationProduct(installed, "q3-baseq3")).rejects.toThrow("q3a/demota/pak0.pk3");
    await writeFile(join(root, "productid.txt"), await retailId());
    const configured = await openInitialConfigurationContent({ ...command.options, startupCommands: ['set com_prereleaseTeamArenaDemo "1"'] }, undefined, installed);
    try {
      expect(configured.q3Product).toEqual({ policy: { kind: "prerelease-ta-demo" }, restriction: { kind: "none" } });
      expect(configured.mounts.options.q3Restriction).toBeUndefined();
      expect(configured.selection.source.content).toBe(installed.require("q3-baseq3").id);
    } finally { await configured.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Team Arena catalog honors UI policy without inferring it from unrestricted mounts", async () => {
  const root = await mkdtemp(join(tmpdir(), "q3-ta-policy-"));
  try {
    await writeFile(join(root, "gameinfo.txt"), 'gametypes { { CTF 4 } } maps { { Retail retail 2 Enemy 2 0 4 30 } }');
    await writeFile(join(root, "demogameinfo.txt"), 'gametypes { { CTF 4 } } maps { { Demo demo 2 Enemy 2 0 4 30 } }');
    const teams = 'teams { { Pagans icon A B C D E } { Stroggs icon F G H I J } }';
    await writeFile(join(root, "teaminfo.txt"), teams); await writeFile(join(root, "demoteaminfo.txt"), teams);
    const mount = { kind: "loose", identity: createMountIdentity("mount:q3:policy", "q3:classic:missionpack:installed", 0), rootPath: root } satisfies import("../../src/contracts/content.ts").LooseMount;
    using mounted = await openMountPlan({ id: createMountPlanId("ta-policy", "test"), mounts: [mount], defaultOrder: [mount.identity.id], prefixOrders: [] });
    expect((await readTeamArenaCampaign(mounted, { kind: "retail" })).maps[0]?.title).toBe("Retail");
    expect((await readTeamArenaCampaign(mounted, { kind: "prerelease-ta-demo" })).maps[0]?.title).toBe("Demo");
    expect((await readTeamArenaCampaign(mounted, { kind: "prerelease-demo", teamArenaUi: "retail" })).maps[0]?.title).toBe("Retail");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Q3 operator map semantics retain donor single-player and cheat branches", () => {
  expect(q3MapLaunch({ kind: "retail" }, "spmap", 4)).toMatchObject({ gameType: 2, singlePlayer: true, maxClients: 8, killBots: true });
  expect(q3MapLaunch({ kind: "retail" }, "spdevmap", 4).cvars).toContainEqual({ name: "sv_cheats", value: "0" });
  expect(q3MapLaunch({ kind: "retail" }, "devmap", 2)).toMatchObject({ gameType: 0, killBots: true });
  expect(q3MapLaunch({ kind: "retail" }, "devmap", 4).cvars).toContainEqual({ name: "sv_cheats", value: "1" });
  expect(q3MapLaunch({ kind: "retail" }, "map", 2)).toMatchObject({ gameType: 0, killBots: false });
  expect(() => q3MapLaunch({ kind: "prerelease-demo", teamArenaUi: "retail" }, "devmap", 0)).toThrow("Unknown Q3 map command");
});

test("prepared Q3 command owner registers retail aliases and rejects prerelease aliases", async () => {
  const { PreparedStartup } = await import("../../src/app/bootstrap/prepared-startup.ts");
  const { ConsoleScriptFiles } = await import("../../src/app/bootstrap/config-scripts.ts");
  const { ConfigStore } = await import("../../src/settings/config.ts");
  const { CvarRegistry } = await import("../../src/core/cvars/index.ts");
  const { createIdentityOwner } = await import("../../src/contracts/identity.ts");
  for (const demo of [false, true]) {
    const identity = createIdentityOwner(`policy-${demo}`), context = { session: identity.session, origin: { kind: "server-console" } } satisfies import("../../src/contracts/common.ts").CommandContext;
    const source = new CvarRegistry({ dialect: "q3", context }), forwarded: string[] = [];
    const scripts = new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined });
    const policy = demo ? { kind: "prerelease-demo", teamArenaUi: "retail" } satisfies import("../../src/core/q3-product-policy.ts").Q3ProductPolicy
      : { kind: "prerelease-ta-demo" } satisfies import("../../src/core/q3-product-policy.ts").Q3ProductPolicy;
    const prepared = new PreparedStartup(source, source, scripts, { dialect: "q3", movementDialect: "q3", q3Policy: policy,
      seats: [], shared: null, sharedNames: [], print: () => {}, forward: name => { forwarded.push(name); return undefined; } });
    prepared.commands.executeNow("devmap q3dm1"); prepared.commands.executeNow("spmap q3dm0"); prepared.commands.executeNow("map q3dm2");
    expect(forwarded).toEqual(demo ? ["map"] : ["devmap", "spmap", "map"]);
    await scripts.close();
  }
});

test("initial spmap applies to the staged source and clears conflicting latches before capacity resolution", async () => {
  const { CvarRegistry, CvarFlag } = await import("../../src/core/cvars/index.ts");
  const { createIdentityOwner } = await import("../../src/contracts/identity.ts");
  const { applyQ3MapLaunch } = await import("../../src/app/bootstrap/q3-map-command.ts");
  const { resolveStartupRules } = await import("../../src/app/bootstrap/startup-source.ts");
  const identity = createIdentityOwner("q3-map-stage"), context = { session: identity.session, origin: { kind: "server-console" } } satisfies import("../../src/contracts/common.ts").CommandContext;
  const current = new CvarRegistry({ dialect: "q3", context });
  current.register("g_gametype", "4", CvarFlag.Latch); current.register("sv_maxclients", "16", CvarFlag.Latch);
  current.set("g_gametype", "3"); current.set("sv_maxclients", "12");
  const staged = new CvarRegistry({ dialect: "q3", context }); staged.restoreSaveState(current.captureWorldTransferState());
  const launch = q3MapLaunch({ kind: "retail" }, "spmap", 3); applyQ3MapLaunch(staged, launch);
  const command = parseApplicationCommand(["--game", "q3-baseq3", "--movement", "q3", "--character", "q3"]);
  if (command.kind !== "menu" && command.kind !== "run") throw new Error("Missing options");
  const resolved = resolveStartupRules({ ...command.options, q3MapLaunch: launch }, staged, 8, [], false);
  expect(resolved.maxClients).toBe(8); expect(resolved.options.mode).toBe("singleplayer");
  expect(staged.variableValue("g_gametype")).toBe(2); expect(staged.variableValue("g_doWarmup")).toBe(0);
  expect(current.variableValue("g_gametype")).toBe(4); expect(current.find("g_gametype")?.latchedValue).toBe("3");
});
