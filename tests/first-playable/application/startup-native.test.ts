import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
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

test.skipIf(!enabled)("actual first world consumes wait-completed difficulty and capacity", async () => {
  const data = await fixture(); let app: Application | null = null;
  try {
    await writeFile(join(data.productRoot, "autoexec.cfg"), "wait\nset skill 3\nset coop 1\nset maxclients 4\n");
    app = await Application.open(data.options, { print: () => undefined, saveDirectory: join(data.root, "saves") });
    expect(app.simulation.options.skill).toBe(3);
    expect(app.simulation.q2Source()?.game.options.skill).toBe(3);
    expect(app.simulation.options.mode).toBe("coop"); expect(app.simulation.options.maxClients).toBe(4);
  } finally { await app?.close(); await rm(data.root, { recursive: true, force: true }); }
}, 120000);

test.skipIf(!enabled)("actual map replacement resumes mounted exec and later ordinary exec on current content", async () => {
  const data = await fixture(); let app: Application | null = null;
  try {
    await writeFile(join(data.productRoot, "autoexec.cfg"), "set skill 0\nmap base1\nwait\nexec default.cfg\nset skill 3\n");
    app = await Application.open(data.options, { print: () => undefined, saveDirectory: join(data.root, "saves") });
    const first = app.simulation;
    expect(first.options.skill).toBe(0);
    await app.step(25); expect(app.simulation).not.toBe(first); expect(app.simulation.options.skill).toBe(0);
    await app.step(25); expect(app.simulation.q2ServerCvars()?.variableValue("skill")).toBe(3);
    const local = app.localPlayers[0];
    if (local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing live console");
    local.seat.presentation.local.console.field.setText("exec default.cfg"); local.seat.presentation.local.console.submit();
    for (let frame = 0; frame < 4; frame++) { await app.step(25); await Bun.sleep(5); }
    local.seat.presentation.local.console.field.setText("map base1"); local.seat.presentation.local.console.submit();
    await app.step(25); await app.step(25);
    expect(app.simulation.options.skill).toBe(3);
  } finally { await app?.close(); await rm(data.root, { recursive: true, force: true }); }
}, 120000);

test.skipIf(!enabled)("closing before pending startup completes preserves source client mouse and image archives", async () => {
  const data = await fixture(); let app: Application | null = null;
  const saved = new Map<string, string>([
    [data.sourcePath, JSON.stringify({ version: 1, dialect: "q2-classic", entries: [{ name: "startup_marker", value: "saved" }] }) + "\n"],
    [data.clientPath, JSON.stringify({ version: 1, dialect: "q2-classic", entries: [{ name: "startup_client", value: "saved" }] }) + "\n"],
    [join(data.productRoot, "cvars/input/q2-classic/0.json"), JSON.stringify({ version: 1, dialect: "q2-classic", entries: [{ name: "sensitivity", value: "5" }] }) + "\n"],
    [join(data.root, "settings/images.cfg"), 'seta r_gamma "1"\n'],
  ]);
  try {
    for (const [path, text] of saved) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); }
    await writeFile(join(data.productRoot, "autoexec.cfg"), 'set startup_marker partial\nset startup_client partial\nset sensitivity 9\nset r_gamma 1.5\nmap base1\nwait\nset startup_marker complete\n');
    app = await Application.open(data.options, { print: () => undefined, saveDirectory: join(data.root, "saves") });
    expect(app.simulation.q2ServerCvars()?.variableString("startup_marker")).toBe("partial");
    await app.close(); app = null;
    for (const [path, text] of saved) expect(await readFile(path, "utf8")).toBe(text);
  } finally { await app?.close(); await rm(data.root, { recursive: true, force: true }); }
}, 120000);

for (const game of ["q1-classic-id1", "q1-quakeworld"]) test.skipIf(!enabled)(`${game} actual QC source retains bare skill across map replacement`, async () => {
  const map = game === "q1-quakeworld" ? "e1m1" : "start";
  const data = await fixture(game, map, ["--dedicated", "--movement", "q1", "--character", "q1",
    ...(game === "q1-quakeworld" ? ["--mode", "deathmatch"] : ["--progs", "progs.dat"])]);
  let app: Application | null = null;
  try {
    await writeFile(join(data.productRoot, game === "q1-quakeworld" ? "server.cfg" : "quake.rc"), `exec default.cfg\nexec config.cfg\nskill 0\nmap ${map}\nskill 3\n`);
    app = await Application.open(data.options, { print: () => undefined, saveDirectory: join(data.root, "saves") });
    const first = app.simulation, firstSource = first.quakecSource();
    if (firstSource === null) throw new Error("Expected real QC source");
    expect(first.q1Source()).toBeNull(); expect(firstSource.cvars.variableValue("skill")).toBe(0);
    expect(firstSource.prepared.program.digest.startsWith("sha256:")).toBe(true);
    await app.step(25);
    const current = app.simulation.quakecSource();
    if (current === null) throw new Error("QC source was lost after map replacement");
    expect(app.simulation).not.toBe(first); expect(current.cvars).not.toBe(firstSource.cvars);
    expect(current.cvars.variableValue("skill")).toBe(3); expect(firstSource.cvars.variableValue("skill")).toBe(0);
  } finally { await app?.close(); await rm(data.root, { recursive: true, force: true }); }
}, 120000);
