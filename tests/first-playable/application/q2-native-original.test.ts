import { expect, test } from "bun:test";
import { link, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serviceLoading } from "../../../src/app/bootstrap/loading.ts";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

/** Requires the installed retail corpus and the serialized native graphics lane. */
test.skipIf(process.env["QUAKE_Q2_NATIVE_APP"] !== "1")("discovered Q2 add-on launches its mounted DLL and full authored map through Application", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-q2-app-"));
  const addon = join(directory, "q2", "native-app-addon");
  await mkdir(addon, { recursive: true });
  await link("/home/buzzkill/Projects/qfiles/q2/xatrix/gamex86.dll", join(addon, "gamex86.dll"));
  await link("/home/buzzkill/Projects/qfiles/q2/xatrix/pak0.pak", join(addon, "pak0.pak"));
  const command = parseApplicationCommand(["--content-root", "/home/buzzkill/Projects/qfiles", "--user-content-root", directory,
    "--game", "q2-classic-native-app-addon", "--map", "xswamp",
    "--movement", "q2", "--character", "q2", "--mode", "singleplayer", "--renderer", "gl", "--hidden", "--width", "320", "--height", "240", "--seats", "1"]);
  if (command.kind !== "run") throw new Error("Missing native Q2 launch options");
  let app: Application | null = null;
  try {
    const openedAt = performance.now();
    let loadingYields = 0, servicedFrames = 0, lastService = performance.now(), maximumServiceGap = 0;
    app = await serviceLoading(nextFrame => Application.open(command.options, { print: () => undefined, saveDirectory: directory,
      loading: { deferWindowVisibility: true, stage: () => {}, nextFrame: async () => { loadingYields++; await nextFrame(); } } }), () => {
      const now = performance.now(); maximumServiceGap = Math.max(maximumServiceGap, now - lastService); lastService = now; servicedFrames++;
    });
    const first = app.simulation.q2Native(), local = app.localPlayers[0];
    if (first === null || local === undefined) throw new Error("Native source/local seat was not admitted");
    console.log("Native full-map launch", { map: "xswamp", milliseconds: performance.now() - openedAt, spawnInstructions: String(first.source.host.spawnInstructions), loadingYields, servicedFrames, maximumServiceGap, maximumGuestSliceMilliseconds: first.source.host.options.runner.maximumLoadingSliceMilliseconds });
    expect(loadingYields).toBeGreaterThan(100);
    expect(servicedFrames).toBeGreaterThan(100);
    expect(command.options.q2GameLibrary).toBeUndefined();
    expect(first.module.artifactPath).toBe("gamex86.dll");
    expect(first.source.host.options.instructionBudget).toBe(5_000_000);
    expect(first.source.host.spawnInstructions).toBeGreaterThan(5_000_000n);
    app.simulation.playerCommand(local.actor, "give", ["health", "137"]);
    const frameStarted = performance.now();
    await app.step(100);
    console.log("Native App frame milliseconds", performance.now() - frameStarted);
    expect(app.simulation.playerUi(local.actor).health).toBe(137);
    const capture = app.captureNextFrame(); await app.step(100);
    expect((await capture).length).toBe(320 * 240 * 4);
  } finally {
    try { await app?.close(); } finally { await rm(directory, { recursive: true, force: true }); }
  }
}, 180_000);
