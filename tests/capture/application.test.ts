import { ApplicationAudio } from "../../src/app/bootstrap/audio.ts";
import { WorldSeatPresentation } from "../../src/app/bootstrap/presentation.ts";
import { ApplicationInput } from "../../src/app/bootstrap/input.ts";
import { PreparedStartup } from "../../src/app/bootstrap/prepared-startup.ts";
import { SharedSimulation } from "../../src/app/bootstrap/simulation/runtime.ts";
import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addressKey } from "../../src/network/common/endpoint.ts";
import { Application } from "../../src/app/bootstrap/application.ts";
import { RemoteApplication } from "../../src/app/bootstrap/remote-application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { NativeRenderer } from "../../src/app/bootstrap/renderer.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { decodePng } from "../../src/formats/images/png.ts";
import { decodeTga } from "../../src/formats/images/tga.ts";
import type { ImageLevel } from "../../src/contracts/render.ts";
import type { SeatId } from "../../src/contracts/identity.ts";
import type { SeatInputEvent } from "../../src/contracts/ui.ts";

const captureArtifactRoot = process.env["CAPTURE_ARTIFACT_ROOT"];
async function captureDirectory(prefix: string): Promise<string> {
  if (captureArtifactRoot !== undefined) await mkdir(captureArtifactRoot, { recursive: true });
  return mkdtemp(join(captureArtifactRoot ?? tmpdir(), prefix));
}
async function releaseCaptureDirectory(root: string): Promise<void> {
  if (captureArtifactRoot === undefined) await rm(root, { recursive: true, force: true });
}

function submit(application: { input(event: SeatInputEvent): boolean }, seat: SeatId, text: string): void {
  const key = (code: number): void => {
    application.input({ kind: "key", seat, timeMilliseconds: performance.now(), code, down: true, repeat: false });
    application.input({ kind: "key", seat, timeMilliseconds: performance.now(), code, down: false, repeat: false });
  };
  key(96);
  application.input({ kind: "text", seat, timeMilliseconds: performance.now(), text: `/${text}` });
  key(13); key(96);
}
function nonblank(image: ImageLevel): void {
  expect(image.width).toBe(320); expect(image.height).toBe(240);
  const colors = new Set<number>();
  for (let index = image.pixels.length / 2; index < image.pixels.length; index += 4) {
    colors.add((image.pixels[index] ?? 0) * 65536 + (image.pixels[index + 1] ?? 0) * 256 + (image.pixels[index + 2] ?? 0));
  }
  expect(colors.size).toBeGreaterThan(16);
}

for (const renderer of ["cpu", "gl"]) test.skipIf(process.env["SDL_VIDEODRIVER"] !== "offscreen")(`local ${renderer} console saves actual frames and snapshots settings before later commands`, async () => {
  const root = await captureDirectory("quake-console-capture-");
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2",
    "--renderer", renderer, "--width", "320", "--height", "240", "--hidden", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("No application launch");
  const owners: PreparedStartup[] = [], bindOutput = PreparedStartup.prototype.bindOutput;
  const ownerProbe = spyOn(PreparedStartup.prototype, "bindOutput").mockImplementation(function(this: PreparedStartup, ...args: Parameters<PreparedStartup["bindOutput"]>) {
    owners.push(this); return bindOutput.apply(this, args);
  });
  const output: string[] = [];
  let application: Application;
  try { application = await Application.open(parsed.options, { print: text => { output.push(text); return undefined; } }); }
  finally { ownerProbe.mockRestore(); }
  try {
    await application.step(100);
    const player = application.localPlayers[0]; if (player === undefined) throw new Error("No local seat");
    submit(application, player.seat.id, "screenshotPNG actual; screenshot silent; screenshot levelshot; seta capture_setting before; bind x +jump; writeconfig capture; seta capture_setting after; condump capture; writeconfig ordered; seta capture_setting final; writeconfig ordered");
    await application.step(100);
    nonblank(decodePng(new Uint8Array(await Bun.file(join(root, "console/screenshots/actual.png")).arrayBuffer())));
    nonblank(decodeTga(new Uint8Array(await Bun.file(join(root, "console/screenshots/shot0000.tga")).arrayBuffer())));
    const level = decodeTga(new Uint8Array(await Bun.file(join(root, "console/levelshots/base1.tga")).arrayBuffer()));
    expect(level.width).toBe(128); expect(level.height).toBe(128);
    const cfg = await Bun.file(join(root, "console/settings/seat-0/capture.cfg")).text();
    expect(cfg).toContain('seta capture_setting "before"'); expect(cfg).not.toContain('capture_setting "after"');
    expect(cfg).toContain('bind "x" "+jump"');
    expect(await Bun.file(join(root, "console/settings/seat-0/ordered.cfg")).text()).toContain('capture_setting "final"');
    expect(await Bun.file(join(root, "console/settings/seat-0/capture.txt")).text()).toContain("capture_setting");
    submit(application, player.seat.id, "exec capture.cfg; writeconfig reread; seta capture_setting altered; exec reread.cfg; writeconfig replayed");
    const replayed = join(root, "console/settings/seat-0/replayed.cfg");
    for (let attempts = 0; attempts < 20 && !await Bun.file(replayed).exists(); attempts++) { await application.step(100); await Bun.sleep(1); }
    expect(await Bun.file(replayed).text()).toContain('seta capture_setting "before"');
    expect(await Bun.file(replayed).text()).toContain('bind "x" "+jump"');
    expect(output.some(text => text.includes("Console output failed"))).toBe(false);
    submit(application, player.seat.id, "screenshotPNG before-travel; map base1; echo orderedtail; condump ordered-tail");
    await application.step(100);
    nonblank(decodePng(new Uint8Array(await Bun.file(join(root, "console/screenshots/before-travel.png")).arrayBuffer())));
    expect(output.some(text => text.includes("Entered maps/base1.bsp"))).toBe(true);
    await application.step(100);
    expect(await Bun.file(join(root, "console/settings/seat-0/ordered-tail.txt")).text()).toContain("orderedtail");
    const afterTravel = application.localPlayers[0]; if (afterTravel === undefined) throw new Error("Travel lost local seat");
    submit(application, afterTravel.seat.id, "echo aftertravel; condump after-travel; writeconfig after-travel; screenshotPNG after-travel");
    await application.step(100);
    expect(await Bun.file(join(root, "console/settings/seat-0/after-travel.txt")).text()).toContain("aftertravel");
    expect(await Bun.file(join(root, "console/settings/seat-0/after-travel.cfg")).text()).toContain('bind "x" "+jump"');
    nonblank(decodePng(new Uint8Array(await Bun.file(join(root, "console/screenshots/after-travel.png")).arrayBuffer())));
    const persistent = owners.at(-1); if (persistent === undefined) throw new Error("Missing actual command owner");
    const publications: SharedSimulation[] = [], gives: SharedSimulation[] = [], initializationGives: SharedSimulation[] = [];
    const commandOrder: string[] = [];
    const replaceWorld = application.session.replaceWorld.bind(application.session), playerCommand = SharedSimulation.prototype.playerCommand;
    const publication = spyOn(application.session, "replaceWorld").mockImplementation((...args: Parameters<typeof replaceWorld>) => {
      const world = args[0]; if (!(world instanceof SharedSimulation)) throw new Error("Expected actual world");
      const result = replaceWorld(...args); publications.push(world); return result;
    });
    const give = spyOn(SharedSimulation.prototype, "playerCommand").mockImplementation(function(this: SharedSimulation, ...args: Parameters<SharedSimulation["playerCommand"]>) {
      if (args[1] === "give") {
        if (args[2][0] === "all") { gives.push(this); commandOrder.push("user"); }
        else { initializationGives.push(this); commandOrder.push("initialization"); }
      }
      return playerCommand.apply(this, args);
    });
    const transferForBatch = ApplicationInput.prototype.transferPlatformTo;
    const initialization = spyOn(ApplicationInput.prototype, "transferPlatformTo").mockImplementation(function(this: ApplicationInput, next: ApplicationInput) {
      transferForBatch.call(this, next); application.queueCommand("give", ["health", "17"], afterTravel.seat.id);
    });
    expect(persistent.commands.register("travelbatch", () => {
      application.queueCommand("map", ["base1"], afterTravel.seat.id);
      application.queueCommand("map", ["base2"], afterTravel.seat.id);
      application.queueCommand("give", ["all"], afterTravel.seat.id);
    })).toBe(true);
    try {
      submit(application, afterTravel.seat.id, "screenshotPNG before-batch; travelbatch");
      await application.step(100);
      nonblank(decodePng(new Uint8Array(await Bun.file(join(root, "console/screenshots/before-batch.png")).arrayBuffer())));
      expect(publications).toHaveLength(2);
      const destination = publications[1]; if (destination === undefined) throw new Error("Missing second published world");
      expect(application.simulation).toBe(destination); expect(gives).toEqual([destination]);
      expect(initializationGives).toEqual(publications);
      expect(commandOrder).toEqual(["initialization", "initialization", "user"]);
      expect(application.content.recipe.map.geometry.requestedPath).toBe("maps/base2.bsp");
    } finally { persistent.commands.unregister("travelbatch"); publication.mockRestore(); give.mockRestore(); initialization.mockRestore(); }
    await expect(application.changeLevel("capture-missing-map")).rejects.toThrow();
    expect(application.localPlayers[0]?.seat.id).toEqual(afterTravel.seat.id);
    submit(application, afterTravel.seat.id, "echo retainedowner; condump failed-travel; writeconfig failed-travel; screenshotPNG failed-travel");
    await application.step(100);
    expect(await Bun.file(join(root, "console/settings/seat-0/failed-travel.txt")).text()).toContain("retainedowner");
    expect(await Bun.file(join(root, "console/settings/seat-0/failed-travel.cfg")).text()).toContain('bind "x" "+jump"');
    nonblank(decodePng(new Uint8Array(await Bun.file(join(root, "console/screenshots/failed-travel.png")).arrayBuffer())));
  } finally { await application.close(); if (captureArtifactRoot !== undefined) await Bun.write(join(root, "host-output.log"), output.join("")); await releaseCaptureDirectory(root); }
}, 60000);

for (const operation of ["travel", "load", "queued-load"]) test.skipIf(process.env["SDL_VIDEODRIVER"] !== "offscreen")(
  `committed publication failure closes application during ${operation}`, async () => {
  const root = await captureDirectory("quake-publication-failure-");
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2",
    "--renderer", "cpu", "--width", "320", "--height", "240", "--hidden", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("No application launch");
  const application = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(root, "saves") });
  try {
    await application.step(100);
    const player = application.localPlayers[0];
    if (player === undefined || !(player.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing local presentation");
    const ui = player.seat.presentation.ui;
    const save = join(root, "saves/q2-classic-baseq2/autosave.sav");
    await application.saveGame(save);
    const key = (code: number): void => {
      for (const down of [true, false]) application.input({ kind: "key", seat: player.seat.id, code, down, repeat: false, timeMilliseconds: performance.now() });
    };
    const enter = (control: string): void => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const focus = ui.controller.state().focus;
        if (focus.kind === "menu" && focus.control === control) { key(13); return; }
        key(9);
      }
      throw new Error(`Missing menu control ${control}`);
    };
    if (operation === "queued-load") {
      key(27); enter("ui:application:load");
      for (let attempt = 0; attempt < 100; attempt++) {
        await Bun.sleep(10); await application.step(1);
        if (ui.controller.state().focus.kind === "menu") {
          const state = ui.controller.state();
          if (state.focus.kind === "menu" && state.focus.control === "ui:saves:slot:q2-classic-baseq2/autosave.sav") break;
          key(9);
        }
      }
    }
    const original = new Error("committed publication callback failure"), previousWorld = application.simulation;
    const transfer = ApplicationInput.prototype.transferPlatformTo, commandOwners: ApplicationInput[] = [];
    const failure = spyOn(ApplicationInput.prototype, "transferPlatformTo").mockImplementationOnce(function(this: ApplicationInput, next: ApplicationInput) {
      commandOwners.push(this, next); transfer.call(this, next); throw original;
    });
    const audioClose = spyOn(ApplicationAudio.prototype, "close"), inputClose = spyOn(ApplicationInput.prototype, "close");
    const worldClose = spyOn(SharedSimulation.prototype, "close"), rendererClose = spyOn(NativeRenderer.prototype, "close");
    try {
      if (operation === "travel") await expect(application.changeLevel("base1")).rejects.toBe(original);
      else if (operation === "load") await expect(application.loadGame(save)).rejects.toBe(original);
      else {
        enter("ui:saves:slot:q2-classic-baseq2/autosave.sav");
        await expect(application.step(100)).rejects.toBe(original);
      }
      expect(application.simulation).not.toBe(previousWorld);
      expect(application.localPlayers).toHaveLength(0);
      expect(audioClose).toHaveBeenCalledTimes(2); expect(inputClose).toHaveBeenCalledTimes(2);
      expect(worldClose).toHaveBeenCalledTimes(2); expect(rendererClose).toHaveBeenCalledTimes(1);
      const commands = commandOwners[0]?.commands; if (commands === undefined) throw new Error("Missing committed command owner");
      expect(commands.registeredNames()).not.toContain("condump");
      expect(commands.registeredNames()).not.toContain("writeconfig");
      await expect(application.step(100)).rejects.toThrow("Application is closed");
      await application.close(); expect(rendererClose).toHaveBeenCalledTimes(1);
    } finally { failure.mockRestore(); audioClose.mockRestore(); inputClose.mockRestore(); worldClose.mockRestore(); rendererClose.mockRestore(); }
  } finally { await application.close(); await releaseCaptureDirectory(root); }
}, 60000);

for (const renderer of ["cpu", "gl"]) test.skipIf(process.env["SDL_VIDEODRIVER"] !== "offscreen")(`remote ${renderer} console saves a real native Q2 server frame`, async () => {
  const root = await captureDirectory("quake-remote-capture-");
  const launch = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2",
    "--mode", "coop", "--dedicated", "--listen-q2", "0", "--bind", "127.0.0.1", "--user-content-root", root]);
  if (launch.kind !== "run") throw new Error("No server launch");
  const server = await Application.open(launch.options, { print: () => undefined });
  let remote: RemoteApplication | null = null;
  try {
    const address = server.networkAddress; if (address === null) throw new Error("Server did not bind");
    const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2",
      "--renderer", renderer, "--width", "320", "--height", "240", "--hidden", "--connect-q2", addressKey(address), "--user-content-root", root]);
    if (parsed.kind !== "run") throw new Error("No remote launch");
    remote = await RemoteApplication.open(parsed.options, { print: () => undefined });
    for (let step = 0; step < 80 && remote.localPlayers.length === 0; step++) {
      await server.step(100); await remote.step(100); await Bun.sleep(1);
    }
    expect(remote.networkPhase).toBe("active");
    const player = remote.localPlayers[0]; if (player === undefined) throw new Error("No remote local seat");
    submit(remote, player.seat.id, "screenshotPNG remote");
    await server.step(100); await remote.step(100);
    nonblank(decodePng(new Uint8Array(await Bun.file(join(root, "console/screenshots/remote.png")).arrayBuffer())));
    submit(remote, player.seat.id, "seta remote_config original; writeconfig remote-roundtrip; seta remote_config changed; exec remote-roundtrip.cfg; writeconfig remote-replayed");
    const replayed = join(root, "console/settings/seat-0/remote-replayed.cfg");
    for (let attempts = 0; attempts < 20 && !await Bun.file(replayed).exists(); attempts++) { await server.step(100); await remote.step(100); await Bun.sleep(1); }
    expect(await Bun.file(replayed).text()).toContain('seta remote_config "original"');
  } finally { await remote?.close(); await server.close(); await releaseCaptureDirectory(root); }
}, 60000);

test.skipIf(process.env["SDL_VIDEODRIVER"] !== "offscreen")("cancelled native readbacks do not wait for a future frame or survive renderer close", async () => {
  const identity = createIdentityOwner("cancelled-captures"), owner = { identity: Symbol("capture"), session: identity.session, generation: 0 };
  const renderer = NativeRenderer.open({ renderer: "cpu", width: 8, height: 8, hidden: true, gamma: 1 }, owner);
  try {
    for (let index = 0; index < 32; index++) {
      const controller = new AbortController(), capture = renderer.captureNextFrame(controller.signal);
      controller.abort(new Error("travel")); await expect(capture).rejects.toThrow("travel");
    }
    const aborted = new AbortController(); aborted.abort(new Error("already cancelled"));
    await expect(renderer.captureNextFrame(aborted.signal)).rejects.toThrow("already cancelled");
    const live = renderer.captureNextFrame();
    renderer.execute({ owner, sequence: 0, commands: [{ kind: "draw-buffer", buffer: "back", clear: true }, { kind: "swap-buffers" }] });
    expect((await live).length).toBe(8 * 8 * 4);
    const closing = renderer.captureNextFrame(); renderer.close();
    await expect(closing).rejects.toThrow("Renderer closed");
  } finally { renderer.close(); }
});
