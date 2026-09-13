import { expect, test } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { Weapon } from "../../../src/movement/q3/constants.ts";

test("retail q3dm1 runs independent cgame snapshots, weapon events and HUDs in two native seats", async () => {
  const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3",
    "--mode", "deathmatch", "--seats", "2", "--renderer", "cpu", "--width", "320", "--height", "120", "--hidden"]);
  if (parsed.kind !== "run") throw new Error("No Q3 retail launch");
  const prints: string[] = [];
  const application = await Application.open(parsed.options, { print: text => { prints.push(text); return undefined; } });
  try {
    const [first, second] = application.localPlayers;
    if (first === undefined || second === undefined) throw new Error("Two source players were not admitted");
    const a = first.seat.presentation, b = second.seat.presentation;
    if (!(a instanceof WorldSeatPresentation) || !(b instanceof WorldSeatPresentation) || a.q3Client === null || b.q3Client === null) throw new Error("Native seats lack cgame");
    const left = a.q3Client, right = b.q3Client;
    const sourcePlayer = application.simulation.q3Source()?.records.byActor(first.actor)?.client?.ps;
    expect(sourcePlayer?.ammo.get(Weapon.WP_GAUNTLET)).toBe(-1);
    expect(sourcePlayer?.ammo.get(Weapon.WP_GRAPPLING_HOOK)).toBe(-1);
    expect(sourcePlayer?.ammo.get(Weapon.WP_MACHINEGUN)).toBe(100);
    expect(sourcePlayer?.ammo.get(Weapon.WP_SHOTGUN)).toBe(0);
    expect(application.simulation.inventory.entries(first.actor).every(entry => entry.count >= 0)).toBe(true);
    expect(left.cgame.state).not.toBe(right.cgame.state);
    expect(left.cvars).not.toBe(right.cvars);
    await application.step(50);
    expect(left.cgame.state.snap?.playerState.clientNum).toBe(left.source.clientNumber);
    expect(left.cgame.state.snap?.playerState.ammo.get(Weapon.WP_GAUNTLET)).toBe(-1);
    expect(left.cgame.state.snap?.playerState.ammo.get(Weapon.WP_GRAPPLING_HOOK)).toBe(-1);
    expect(right.cgame.state.snap?.playerState.clientNum).toBe(right.source.clientNumber);
    expect(left.source.clientNumber).not.toBe(right.source.clientNumber);
    expect(left.camera().viewport.x).toBe(0);
    expect(right.camera().viewport).toEqual(b.viewport);
    expect(right.camera().viewport).not.toEqual(left.camera().viewport);
    expect(new Set(application.readPixels()).size).toBeGreaterThan(16);
    expect(left.frame().commands.some(command => command.kind === "view" && command.view.clear === null
      && command.view.operations.some(operation => operation.kind === "draw" && operation.batches.some(batch => batch.indices.length !== 0)))).toBe(true);
    expect(right.frame().commands.some(command => command.kind === "view")).toBe(true);
    const before = application.simulation.playerView(first.actor).origin;
    application.input({ seat: first.seat.id, kind: "key", code: 119, down: true, repeat: false, timeMilliseconds: performance.now() });
    for (let step = 0; step < 5; step++) await application.step(50);
    application.input({ seat: first.seat.id, kind: "key", code: 119, down: false, repeat: false, timeMilliseconds: performance.now() });
    expect(application.simulation.playerView(first.actor).origin).not.toEqual(before);
    await left.options.audio.playMusic(left.media.content, "");
    const eventCount = left.presentedEvents;
    application.input({ seat: first.seat.id, kind: "mouse-button", button: 1, down: true, timeMilliseconds: performance.now() });
    for (let step = 0; step < 8; step++) await application.step(50);
    application.input({ seat: first.seat.id, kind: "mouse-button", button: 1, down: false, timeMilliseconds: performance.now() });
    expect(left.presentedEvents).toBeGreaterThan(eventCount);
    expect(left.cgame.state.predictedPlayerEntity.muzzleFlashTime).toBeGreaterThan(0);
    expect(left.media.bank.registrations().some(registration => registration.path.includes("machinegun") && registration.sound !== null)).toBe(true);
    expect(left.options.audio.engine.mix(1024).some(sample => sample !== 0)).toBe(true);
    const presented = left.presentedEvents, muzzleTime = left.cgame.state.predictedPlayerEntity.muzzleFlashTime;
    await left.prepare(application.frameCount, a.viewport, application.simulation.presentations());
    expect(left.presentedEvents).toBe(presented);
    expect(left.cgame.state.predictedPlayerEntity.muzzleFlashTime).toBe(muzzleTime);
    expect(application.unhandledPresentationEffects).toEqual([]);
    await left.command(["+scores"]);
    expect(left.cgame.state.showScores).toBe(true);
    expect(right.cgame.state.showScores).toBe(false);
    await application.step(50);
    await left.command(["-scores"]);
    application.queueCommand("say", ["native-cgame-chat"], first.seat.id);
    await application.step(50); await application.step(50);
    expect(prints.filter(text => text.includes("native-cgame-chat")).length).toBeGreaterThanOrEqual(2);
    const sound = left.media.bank.registrations().find(registration => registration.path.includes("machinegun/") && registration.sound !== null)?.sound;
    if (sound === undefined || sound === null) throw new Error("Actual source weapon PCM was not registered");
    const engine = left.options.audio.engine;
    engine.stopAll();
    engine.loop({ sound, family: "q3", actor: second.actor, origin: { kind: "local" }, audience: { kind: "seat", seat: second.seat.id },
      velocity: { x: 0, y: 0, z: 0 }, frameNumber: application.frameCount, volume: 1, attenuation: 0, lifetime: "persistent" });
    engine.clearQ3SeatLoops(first.seat.id, true); engine.endLoopFrame();
    expect(engine.mix(2048).some(sample => sample !== 0)).toBe(true);
    engine.stopQ3SeatLoop(second.seat.id, second.actor); engine.endLoopFrame();
    expect(engine.mix(2048).every(sample => sample === 0)).toBe(true);
    engine.loop({ sound, family: "q3", actor: second.actor, origin: { kind: "local" }, audience: { kind: "world" },
      velocity: { x: 0, y: 0, z: 0 }, frameNumber: application.frameCount, volume: 1, attenuation: 0, lifetime: "persistent" });
    engine.clearQ3SeatLoops(first.seat.id, true); engine.clearQ3SeatLoops(second.seat.id, true); engine.endLoopFrame();
    expect(engine.mix(2048).some(sample => sample !== 0)).toBe(true);
  } finally { await application.close(); }
}, 60000);

test("Team Arena give weapons registers newly owned media before synchronous presentation", async () => {
  const parsed = parseApplicationCommand(["--game", "q3-missionpack", "--map", "mpteam1", "--movement", "q3", "--character", "q3",
    "--mode", "deathmatch", "--renderer", "cpu", "--width", "320", "--height", "200", "--hidden"]);
  if (parsed.kind !== "run") throw new Error("No Team Arena launch");
  const application = await Application.open(parsed.options, { print: () => undefined });
  try {
    const local = application.localPlayers[0], source = application.simulation.q3Source();
    if (local === undefined || source === null || !(local.seat.presentation instanceof WorldSeatPresentation) || local.seat.presentation.q3Client === null)
      throw new Error("Missing native Team Arena source and presentation");
    const client = local.seat.presentation.q3Client, registry = client.cgame.media.weaponRegistry;
    const sourcePlayer = source.records.byActor(local.actor)?.client?.ps;
    expect(sourcePlayer?.ammo.get(Weapon.WP_GAUNTLET)).toBe(-1);
    expect(sourcePlayer?.ammo.get(Weapon.WP_GRAPPLING_HOOK)).toBe(-1);
    expect(sourcePlayer?.ammo.get(Weapon.WP_MACHINEGUN)).toBe(100);
    expect(sourcePlayer?.ammo.get(Weapon.WP_SHOTGUN)).toBe(0);
    expect(application.simulation.inventory.entries(local.actor).every(entry => entry.count >= 0)).toBe(true);
    await application.step(50);
    expect(client.cgame.state.snap?.playerState.ammo.get(Weapon.WP_GAUNTLET)).toBe(-1);
    expect(client.cgame.state.snap?.playerState.ammo.get(Weapon.WP_GRAPPLING_HOOK)).toBe(-1);
    expect(() => registry.requireWeapon(3)).toThrow("must finish registration");
    source.host.cvars.set("sv_cheats", "1", true);
    application.queueCommand("give", ["weapons"], local.seat.id);
    application.queueCommand("give", ["ammo"], local.seat.id);
    await application.step(50);
    expect(application.simulation.inventory.count(local.actor, "q3:weapon/shotgun")).toBe(1);
    await application.step(50);
    expect(registry.requireWeapon(3).weaponModel.kind).not.toBe("default");
    expect(registry.requireWeapon(11).weaponModel.kind).not.toBe("default");
    await client.command(["weapon", "3"]);
    for (let frame = 0; frame < 8; frame++) await application.step(50);
    expect(client.cgame.state.predictedPlayerState.weapon).toBe(3);
    expect(new Set(application.readPixels()).size).toBeGreaterThan(16);
  } finally { await application.close(); }
}, 60_000);
