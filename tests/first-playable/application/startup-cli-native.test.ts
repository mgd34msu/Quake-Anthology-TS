import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { userProductDirectory } from "../../../src/content/user-data.ts";

const enabled = process.env["QUAKE_STARTUP_NATIVE_TEST"] === "1";
async function fixture(game = "q2-classic-baseq2", map = "base1", extra: readonly string[] = []) {
  const root = await mkdtemp(join(tmpdir(), "quake-startup-native-"));
  const command = parseApplicationCommand(["--game", game, "--map", map, "--renderer", "cpu", "--hidden", ...extra,
    "--width", "320", "--height", "240", "--user-content-root", root]);
  if (command.kind !== "run") throw new Error("Expected native launch");
  const content = await loadApplicationContent(command.options);
  try {
    const product = content.catalog.product(content.recipe.engineBehavior.content);
    const productRoot = userProductDirectory(root, product.expectation.contentDirectory);
    const sourcePath = join(productRoot, "cvars", "source", encodeURIComponent(content.recipe.map.entities.content), `${encodeURIComponent(content.recipe.map.entities.provider)}.json`);
    const clientPath = join(productRoot, "cvars", "client", encodeURIComponent(content.recipe.engineBehavior.content), encodeURIComponent(content.recipe.engineBehavior.provider), "0.json");
    await mkdir(productRoot, { recursive: true });
    return { root, productRoot, sourcePath, clientPath, options: command.options };
  } finally { await content.close(); }
}

for (const game of ["q1-classic-id1", "q1-quakeworld"]) test.skipIf(!enabled)(`${game} actual CLI map wait tail follows donor stuffcmds order`, async () => {
  const qw = game === "q1-quakeworld", map = qw ? "e1m1" : "start";
  const data = await fixture(game, map, ["--dedicated", "--movement", "q1", "--character", "q1",
    ...(qw ? ["--mode", "deathmatch"] : ["--progs", "progs.dat"]), "+skill", "0", "+map", map, "+wait", "+skill", "3", "+echo", "CLI_TAIL"]);
  let app: Application | null = null; const output: string[] = [];
  try {
    await writeFile(join(data.productRoot, qw ? "server.cfg" : "quake.rc"), qw
      ? "echo SERVER_CFG\nskill 1\n" : "exec default.cfg\nexec config.cfg\necho BEFORE_STUFF\nstuffcmds\necho AFTER_STUFF\n");
    app = await Application.open(data.options, { print: text => { output.push(text); }, saveDirectory: join(data.root, "saves") });
    const first = app.simulation, initial = first.quakecSource();
    if (initial === null) throw new Error("Missing actual QC source");
    expect(initial.prepared.program.digest.startsWith("sha256:")).toBe(true);
    expect(initial.cvars.variableValue("skill")).toBe(0);
    expect(output.join("")).not.toContain("CLI_TAIL");
    if (qw) expect(output.join("")).not.toContain("SERVER_CFG");
    else expect(output.join("")).toContain("BEFORE_STUFF");
    await app.step(25); expect(app.simulation).not.toBe(first);
    await app.step(25);
    const current = app.simulation.quakecSource();
    if (current === null) throw new Error("QC source lost across CLI map");
    expect(current.cvars).not.toBe(initial.cvars);
    expect(initial.cvars.variableValue("skill")).toBe(0);
    expect(current.cvars.variableValue("skill")).toBe(qw ? 1 : 3);
    const log = output.join("");
    expect(log.indexOf("CLI_TAIL")).toBeGreaterThan(-1);
    expect(log.indexOf(qw ? "SERVER_CFG" : "AFTER_STUFF")).toBeGreaterThan(log.indexOf("CLI_TAIL"));
  } finally { await app?.close(); await rm(data.root, { recursive: true, force: true }); }
}, 120000);

test.skipIf(!enabled)("Q2 actual CLI early set survives config and resolves first-world skill", async () => {
  const data = await fixture("q2-classic-baseq2", "base1", ["+set", "skill", "3", "+set", "coop", "1", "+set", "maxclients", "4"]);
  let app: Application | null = null; const output: string[] = [];
  try {
    await writeFile(join(data.productRoot, "config.cfg"), "set skill 0\n");
    await writeFile(join(data.productRoot, "autoexec.cfg"), "echo AUTOEXEC_SKILL\nskill\nwait\n");
    app = await Application.open(data.options, { print: text => { output.push(text); }, saveDirectory: join(data.root, "saves") });
    expect(output.join("")).toContain('"skill" is "3"');
    expect(app.simulation.options.skill).toBe(3); expect(app.simulation.q2Source()?.game.options.skill).toBe(3);
    expect(app.simulation.options.mode).toBe("coop"); expect(app.simulation.options.maxClients).toBe(4);
  } finally { await app?.close(); await rm(data.root, { recursive: true, force: true }); }
}, 120000);

test.skipIf(!enabled)("Q3 actual safe startup skips saved config and exposes forced variables to autoexec", async () => {
  const data = await fixture("q3-baseq3", "q3dm1", ["--dedicated", "--movement", "q3", "--character", "q3", "+safe", "+set", "g_gametype", "3", "+set", "g_restarted", "7"]);
  let app: Application | null = null; const output: string[] = [];
  try {
    await mkdir(dirname(data.sourcePath), { recursive: true });
    await writeFile(data.sourcePath, JSON.stringify({ version: 1, dialect: "q3", entries: [{ name: "g_gametype", value: "1" }] }));
    await writeFile(join(data.productRoot, "q3config.cfg"), "echo UNSAFE_SAVED_CONFIG\nset g_gametype 1\n");
    await writeFile(join(data.productRoot, "autoexec.cfg"), "echo Q3_AUTOEXEC\ng_gametype\ng_restarted\nwait\n");
    app = await Application.open(data.options, { print: text => { output.push(text); }, saveDirectory: join(data.root, "saves") });
    const log = output.join("");
    expect(log).toContain("Q3_AUTOEXEC"); expect(log).not.toContain("UNSAFE_SAVED_CONFIG");
    expect(log).toContain('"g_gametype" is:"3^7"'); expect(log).toContain('"g_restarted" is:"7^7"');
    expect(app.simulation.q3Source()?.host.cvars.variableValue("g_gametype")).toBe(3);
  } finally { await app?.close(); await rm(data.root, { recursive: true, force: true }); }
}, 120000);
