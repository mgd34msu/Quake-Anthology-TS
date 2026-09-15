import { ApplicationInput } from "../../../src/app/bootstrap/input.ts";
import { CommandBuffer, type CommandHandler } from "../../../src/core/commands/index.ts";
import { SharedSimulation } from "../../../src/app/bootstrap/simulation/runtime.ts";
import { ConfigStore } from "../../../src/settings/config.ts";
import { userProductDirectory } from "../../../src/content/user-data.ts";
import { loadCvarArchive } from "../../../src/app/bootstrap/cvar-archives.ts";
import { expect, spyOn, test } from "bun:test";
import { PreparedStartup } from "../../../src/app/bootstrap/prepared-startup.ts";
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
  const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--seats", "2", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing options");
  const presentation = (app: Application, index: number): WorldSeatPresentation => {
    const value = app.localPlayers[index]?.seat.presentation;
    if (!(value instanceof WorldSeatPresentation)) throw new Error("Missing local presentation");
    return value;
  };
  let observedClient: CommandBuffer | null = null;
  const authorityOwners = new Set<CommandBuffer>(), executeAsync = CommandBuffer.prototype.executeAsync;
  const authorityDriver = spyOn(CommandBuffer.prototype, "executeAsync").mockImplementation(function(this: CommandBuffer, ...args: Parameters<CommandBuffer["executeAsync"]>) {
    if (observedClient !== null && this !== observedClient && this.context.session === observedClient.context.session
      && this.context.origin.kind === "server-console") {
      const established = authorityOwners.values().next().value;
      if (established === undefined) authorityOwners.add(this);
      else expect(this).toBe(established);
    }
    return executeAsync.apply(this, args);
  });
  const owners: PreparedStartup[] = [], bindOutput = PreparedStartup.prototype.bindOutput;
  const outputOwner = spyOn(PreparedStartup.prototype, "bindOutput").mockImplementation(function(this: PreparedStartup, ...args: Parameters<PreparedStartup["bindOutput"]>) {
    owners.push(this); return bindOutput.apply(this, args);
  });
  const verifyPrivateOutput = async (application: Application, phase: string): Promise<void> => {
    for (const index of [0, 1]) {
      await application.step(1);
      if (phase === "before_q2") for (const seat of [0, 1]) {
        const delivered = presentation(application, seat).local.console.buffer.dump();
        expect(delivered).toContain("Locate base installation\nelevator.");
        expect(delivered).toContain("Establish communication\nlink to command ship.");
      }
      const local = presentation(application, index).local, other = presentation(application, 1 - index).local.console;
      const unchanged = other.buffer.dump(), before = local.console.buffer.dump().length, marker = phase + "_seat" + index;
      local.console.field.setText('/echo ' + marker + '; bind w; cl_run; set cl_run invalid; help missing_' + marker); local.console.submit();
      await application.step(1); await application.step(1);
      const result = local.console.buffer.dump().slice(before);
      expect(result).toContain("\n" + marker); expect(result).toContain('"cl_run" is'); expect(result).toContain("Always run must be 0 or 1");
      expect(result).toContain("No command, setting, or alias"); expect(other.buffer.dump()).toBe(unchanged);
    }
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
    const q2 = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q1", "--seats", "2", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
    if (q2.kind !== "run") throw new Error("Missing Q2 options");
    app = await Application.open(q2.options, { print: () => undefined });
    const persistent = owners.at(-1); if (persistent === undefined) throw new Error("Missing native prepared owner");
    const commands = persistent.commands, session = app.session, seats = app.localPlayers.map(player => player.seat);
    observedClient = commands;
    await app.step(1);
    expect(authorityOwners.size).toBe(1);
    const authority = authorityOwners.values().next().value;
    if (authority === undefined) throw new Error("Missing running authority buffer");
    const retainedApplication = app;
    const inputs = app.localPlayers.map((_, index) => presentation(retainedApplication, index).local.input);
    const checkOwners = (application: Application, sourceDialect: "q2-classic" | "q3", inputDialect: "q1-netquake" | "q3"): void => {
      expect(owners.at(-1)).toBe(persistent); expect(persistent.commands).toBe(commands); expect(commands.dialect).toBe(sourceDialect); expect(application.session).toBe(session);
      expect(application.content.recipe.movement.provider).toBe(inputDialect === "q1-netquake" ? "q1:movement" : "q3:movement");
      expect(persistent.movement.dialect).toBe(inputDialect);
      expect([...authorityOwners]).toEqual([authority]);
      for (const [index, seat] of seats.entries()) { expect(application.localPlayers[index]?.seat).toBe(seat); expect(application.localPlayers[index]?.seat.client).toBe(seat.client);
        const input = inputs[index]; if (input === undefined) throw new Error("Missing retained seat input");
        expect(presentation(application, index).local.input).toBe(input); expect(presentation(application, index).local.input.dialect).toBe(inputDialect); }
    };
    await verifyPrivateOutput(app, "before_q2");
    const previousContent = app.content, product = previousContent.catalog.product(previousContent.recipe.map.entities.content);
    const oldStore = new ConfigStore(product.userContent?.root ?? userProductDirectory(root, product.expectation.contentDirectory));
    const oldConsole = presentation(app, 0).local.console;
    oldConsole.field.setText("/seta dmflags 16; seta retired_probe q2-owner"); oldConsole.submit();
    await app.step(1);
    expect(app.simulation.q2ServerCvars()?.variableValue("dmflags")).toBe(16);
    const q2Save = join(root, "return-q2.sav"); await app.saveGame(q2Save);
    const held = presentation(app, 0).local.input, window = app.window;
    app.input({ kind: "key", seat: held.seat, code: 119, down: true, repeat: false, timeMilliseconds: performance.now() }); await app.step(1);
    expect(held.isDown({ kind: "key", code: 119 })).toBe(true);
    const preflight = spyOn(app.session, "validateWorldReplacement").mockImplementationOnce(() => { throw new Error("profile preflight rejection"); });
    try { await expect(app.loadGame(savePath)).rejects.toThrow("profile preflight rejection"); } finally { preflight.mockRestore(); }
    checkOwners(app, "q2-classic", "q1-netquake"); expect(app.window).toBe(window); expect(held.isDown({ kind: "key", code: 119 })).toBe(true);
    app.input({ kind: "key", seat: held.seat, code: 119, down: false, repeat: false, timeMilliseconds: performance.now() }); await app.step(1);
    const publications: SharedSimulation[] = [], gives: SharedSimulation[] = [];
    const replaceWorld = app.session.replaceWorld.bind(app.session), playerCommand = SharedSimulation.prototype.playerCommand;
    const publication = spyOn(app.session, "replaceWorld").mockImplementation((...args: Parameters<typeof replaceWorld>) => {
      const world = args[0]; if (!(world instanceof SharedSimulation)) throw new Error("Expected application world");
      const result = replaceWorld(...args); publications.push(world); return result;
    });
    const give = spyOn(SharedSimulation.prototype, "playerCommand").mockImplementation(function(this: SharedSimulation, ...args: Parameters<SharedSimulation["playerCommand"]>) {
      if (args[1] === "give") gives.push(this); return playerCommand.apply(this, args);
    });
    const authorityProbes: SharedSimulation[] = [];
    const probe: CommandHandler = invocation => {
      expect(invocation.argv).toEqual(["authority_publication_probe", "a/*retained*/b"]);
      expect(invocation.dialect).toBe("q2-classic");
      expect(invocation.source).toBe(authority.context);
      expect(invocation.source.origin.kind).toBe("server-console");
      authorityProbes.push(retainedApplication.simulation);
    };
    expect(authority.register("authority_publication_probe", probe)).toBe(true);
    try {
      authority.append("authority_publication_probe a/*retained*/b\n");
      const local = presentation(app, 0).local;
      local.console.field.setText('/load "' + savePath + '"; give all; map q3dm1; echo ordered_after_map'); local.console.submit();
      await app.step(1);
      expect(publications).toHaveLength(2);
      const firstWorld = publications[0], lastWorld = publications[1];
      if (firstWorld === undefined || lastWorld === undefined) throw new Error("Missing ordered publications");
      expect(gives).toEqual([firstWorld]); expect(app.simulation).toBe(lastWorld);
      expect(authorityProbes).toEqual([lastWorld]);
      expect(presentation(app, 0).local.console.buffer.dump()).toContain("ordered_after_map");
      publications.length = 0; gives.length = 0;
      commands.register("publication_batch", invocation => {
        invocation.executeNow("map q3dm1");
        invocation.executeNow("give all");
        invocation.executeNow("map q3dm1");
      });
      try {
        const console = presentation(app, 0).local.console;
        console.field.setText("/publication_batch; echo ordered_after_batch"); console.submit();
        await app.step(1);
        expect(publications).toHaveLength(2);
        const intermediate = publications[0], destination = publications[1];
        if (intermediate === undefined || destination === undefined) throw new Error("Missing batched publications");
        expect(gives).toEqual([intermediate]); expect(app.simulation).toBe(destination);
        expect(authorityProbes).toEqual([lastWorld]);
        expect(presentation(app, 0).local.console.buffer.dump()).toContain("ordered_after_batch");
      } finally { commands.unregister("publication_batch"); }
    } finally { authority.unregister("authority_publication_probe", probe); publication.mockRestore(); give.mockRestore(); }
    checkOwners(app, "q3", "q3"); await verifyPrivateOutput(app, "after_q3");
    const retiredSource = await loadCvarArchive(oldStore, ["source", previousContent.recipe.map.entities.content, previousContent.recipe.map.entities.provider], "q2-classic");
    expect(retiredSource).toContainEqual({ name: "dmflags", value: "16" });
    const retiredClient = await loadCvarArchive(oldStore, ["client", previousContent.recipe.engineBehavior.content, previousContent.recipe.engineBehavior.provider, "0"], "q2-classic");
    expect(retiredClient).toContainEqual({ name: "retired_probe", value: "q2-owner" });
    expect(presentation(app, 0).q3Client?.cvars.find("retired_probe")).toBeUndefined();
    const retiredQ3 = presentation(app, 0).local.console, retiredQ3Text = retiredQ3.buffer.dump();
    await app.loadGame(q2Save); checkOwners(app, "q2-classic", "q1-netquake"); await verifyPrivateOutput(app, "return_q2");
    expect(retiredQ3.buffer.dump()).toBe(retiredQ3Text);
    const retiringWorld = app.simulation, retiringContent = app.content;
    const worldClosed = spyOn(retiringWorld, "close"), contentClosed = spyOn(retiringContent, "close");
    const replaceForFailure = app.session.replaceWorld.bind(app.session);
    let published = false, failed = false;
    const publishFailure = spyOn(app.session, "replaceWorld").mockImplementation((...args: Parameters<typeof replaceForFailure>) => {
      const result = replaceForFailure(...args); published = true; return result;
    });
    const enqueueReliable = ApplicationInput.prototype.enqueueClientReliable;
    const finalizeFailure = spyOn(ApplicationInput.prototype, "enqueueClientReliable").mockImplementation(function(this: ApplicationInput, ...args: Parameters<ApplicationInput["enqueueClientReliable"]>) {
      if (published && !failed && args[0] === "score") { failed = true; throw new Error("post-publication score failure"); }
      return enqueueReliable.apply(this, args);
    });
    try {
      await expect(app.loadGame(savePath)).rejects.toThrow("post-publication score failure");
      expect(published).toBe(true); expect(failed).toBe(true);
      expect(app.simulation).not.toBe(retiringWorld); expect(app.content).not.toBe(retiringContent);
      expect(worldClosed).toHaveBeenCalledTimes(1); expect(contentClosed).toHaveBeenCalledTimes(1);
      checkOwners(app, "q3", "q3"); await app.step(1);
    } finally { publishFailure.mockRestore(); finalizeFailure.mockRestore(); worldClosed.mockRestore(); contentClosed.mockRestore(); }
    await verifyPrivateOutput(app, "return_q3");
    expect([...authorityOwners].filter(owner => owner.context.session === session.session)).toHaveLength(1);
    const console = presentation(app, 1).local.console; console.open(); console.field.setText("/set sv_mapname forbidden"); console.submit();
    await app.step(1); expect(console.buffer.dump()).toContain("sv_mapname is read only");
    const image = app.captureNextFrame(); await app.step(100);
    await Bun.write(process.env["QUAKE_PROFILE_CAPTURE"] ?? "/tmp/quake-profile-console.png", encodePng(320, 240, await image));
    presentation(app, 0).local.console.field.setText("/seta cg_drawFPS 9"); presentation(app, 0).local.console.submit();
    await app.step(1);
    await app.close(); app = null;
    app = await Application.open(parsed.options, { print: () => undefined });
    expect(presentation(app, 0).q3Client?.cvars.variableValue("cg_drawFPS")).toBe(9);
    expect(presentation(app, 1).q3Client?.cvars.variableValue("cg_drawFPS")).toBe(2);
  } finally { authorityDriver.mockRestore(); outputOwner.mockRestore(); await app?.close(); await rm(root, { recursive: true, force: true }); }
}, 120000);
