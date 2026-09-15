import { ConfigStore } from "../../../src/settings/config.ts";
import { userProductDirectory } from "../../../src/content/user-data.ts";
import { loadCvarArchive } from "../../../src/app/bootstrap/cvar-archives.ts";
import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { encodePng } from "../../../src/formats/images/png.ts";
import { InputRouter } from "../../../src/input/router.ts";

for (const family of ["q2", "q3"]) test(`actual ${family} SDL console toggle and unprefixed command output`, async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-console-input-"));
  const parsed = parseApplicationCommand(["--game", family === "q2" ? "q2-classic-baseq2" : "q3-baseq3", "--map", family === "q2" ? "base1" : "q3dm1", "--renderer", "cpu", "--hidden", "--width", "640", "--height", "480", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing options");
  const app = await Application.open(parsed.options, { print: () => undefined });
  let router: InputRouter | null = null;
  try {
    await app.step(1);
    const player = app.localPlayers[0]; if (player === undefined || !(player.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing local UI");
    const local = player.seat.presentation.ui.local, console = local.console;
    const route = router = new InputRouter({ seats: [{ input: local.input, controller: { kind: "none" } }], keyboardSeat: player.seat.id, controllers: null, now: () => performance.now(), ticks: () => 0, subframe: false, unhandled: () => undefined });
    const key = (code: number, down = true, repeat = false): void => route.handlePlatform({ kind: "key", timestamp: 0, scancode: code, keycode: code, modifiers: 0, down, repeat });
    const text = (value: string): void => route.handlePlatform({ kind: "text", timestamp: 0, text: value });
    const submit = async (value: string): Promise<void> => { text(value); key(13); key(13, false); await app.step(1); await app.step(1); };
    key(96); key(96, false); text("`"); expect(local.input.focus.kind).toBe("console"); expect(console.field.text).toBe("");
    key(96, true, true); text("`"); expect(local.input.focus.kind).toBe("console"); expect(console.field.text).toBe("");
    await submit("echo console_plain_probe"); expect(console.buffer.dump()).toContain("\nconsole_plain_probe");
    await submit("/echo console_slash_probe"); expect(console.buffer.dump()).toContain("\nconsole_slash_probe");
    await submit("set console_probe 17"); await submit("console_probe"); expect(console.buffer.dump()).toContain('"console_probe" is');
    if (family === "q2") { await submit("god"); expect(console.buffer.dump()).toContain("godmode ON"); }
    else {
      await submit("/unknown_console_probe"); await app.step(100); await app.step(100);
      expect(console.buffer.dump()).toContain("unknown cmd unknown_console_probe");
      await submit("console chat probe"); await app.step(100); await app.step(100);
      expect(console.buffer.dump().split("\n").some(line => !line.startsWith("]") && line.includes("console chat probe"))).toBe(true);
    }
    if (family === "q2") {
      console.field.setText("ec"); key(9); key(9, false);
      expect(console.field.text).toBe("/echo"); expect(console.selectedCompletionEntry?.name).toBe("echo");
      const image = app.captureNextFrame(); await app.step(100);
      await Bun.write("/tmp/quake-console-selected-help640.png", encodePng(640, 480, await image));
      console.field.clear();
    }
    const history = console.history.lines.length; await submit(""); expect(console.history.lines.length).toBe(history);
    key(96); key(96, false); text("`"); expect(local.input.focus.kind).toBe("game"); expect(console.field.text).toBe("");
    key(96); key(96, false); text("echo first_character_kept"); expect(console.field.text).toBe("echo first_character_kept");
  } finally { router?.close(); await app.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);

test("local archived cvars retain seat ownership before fresh client initialization", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-local-archives-"));
  const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--seats", "2", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing options");
  const presentation = (app: Application, index: number): WorldSeatPresentation => {
    const value = app.localPlayers[index]?.seat.presentation;
    if (!(value instanceof WorldSeatPresentation)) throw new Error("Missing local presentation");
    return value;
  };
  let app: Application | null = null;
  try {
    app = await Application.open(parsed.options, { print: () => undefined });
    for (const index of app.localPlayers.keys()) {
      const local = presentation(app, index).local;
      local.console.field.setText(`/seta archive_probe seat${index}; seta cg_drawFPS ${index + 1}${index === 0 ? "; seta g_speed 333" : ""}`);
      local.console.submit();
    }
    await app.step(1);
    expect(app.simulation.q3Source()?.host.cvars.variableValue("g_speed")).toBe(333);
    expect(presentation(app, 0).q3Client?.cvars.variableString("archive_probe")).toBe("seat0");
    expect(presentation(app, 1).q3Client?.cvars.variableString("archive_probe")).toBe("seat1");
    presentation(app, 0).q3Client?.cvars.set("model", "visor/default", true);
    await app.close(); app = null;
    const persisted = new Map<string, string>();
    for (const path of await readdir(root, { recursive: true })) if (path.split(sep).includes("cvars") && path.endsWith(".json"))
      persisted.set(path, await Bun.file(join(root, path)).text());
    expect(persisted.size).toBeGreaterThan(2);
    await expect(Application.open({ ...parsed.options, characterModel: "visor" }, { print: () => undefined,
      loading: { deferWindowVisibility: true, stage: message => { if (message === "Starting game...") throw new Error("archive readiness failure"); } },
    })).rejects.toThrow("archive readiness failure");
    for (const [path, bytes] of persisted) expect(await Bun.file(join(root, path)).text()).toBe(bytes);
    app = await Application.open(parsed.options, { print: () => undefined });
    expect(app.simulation.q3Source()?.host.cvars.variableValue("g_speed")).toBe(333);
    for (const index of [0, 1]) {
      const cvars = presentation(app, index).q3Client?.cvars;
      expect(cvars?.variableString("archive_probe")).toBe(`seat${index}`);
      expect(cvars?.variableValue("cg_drawFPS")).toBe(index + 1);
      expect(cvars?.variableString("model")).toBe(`${parsed.options.characterModel}/default`);
    }
    await app.step(1);
    const savePath = join(root, "destination.sav");
    await app.saveGame(savePath);
    await app.close(); app = null;
    const q2 = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--seats", "2", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
    if (q2.kind !== "run") throw new Error("Missing Q2 options");
    app = await Application.open(q2.options, { print: () => undefined });
    const previousContent = app.content, product = previousContent.catalog.product(previousContent.recipe.map.entities.content);
    const oldStore = new ConfigStore(product.userContent?.root ?? userProductDirectory(root, product.expectation.contentDirectory));
    const oldConsole = presentation(app, 0).local.console;
    oldConsole.field.setText("/seta dmflags 16; seta retired_probe q2-owner"); oldConsole.submit();
    await app.step(1);
    expect(app.simulation.q2ServerCvars()?.variableValue("dmflags")).toBe(16);
    await app.loadGame(savePath);
    const retiredSource = await loadCvarArchive(oldStore, ["source", previousContent.recipe.map.entities.content, previousContent.recipe.map.entities.provider], "q2-classic");
    expect(retiredSource).toContainEqual({ name: "dmflags", value: "16" });
    const retiredClient = await loadCvarArchive(oldStore, ["client", previousContent.recipe.engineBehavior.content, previousContent.recipe.engineBehavior.provider, "0"], "q2-classic");
    expect(retiredClient).toContainEqual({ name: "retired_probe", value: "q2-owner" });
    expect(presentation(app, 0).q3Client?.cvars.find("retired_probe")).toBeUndefined();
    presentation(app, 0).local.console.field.setText("/seta cg_drawFPS 9"); presentation(app, 0).local.console.submit();
    await app.step(1);
    await app.close(); app = null;
    app = await Application.open(parsed.options, { print: () => undefined });
    expect(presentation(app, 0).q3Client?.cvars.variableValue("cg_drawFPS")).toBe(9);
    expect(presentation(app, 1).q3Client?.cvars.variableValue("cg_drawFPS")).toBe(2);
  } finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
}, 120000);
