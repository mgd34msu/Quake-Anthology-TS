import { expect, spyOn, test } from "bun:test";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { RemoteApplication } from "../../../src/app/bootstrap/remote-application.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { addressKey } from "../../../src/network/common/endpoint.ts";
import type { SimulationPresentationEvent } from "../../../src/app/bootstrap/simulation/types.ts";

test("native remote seats render, move, fire, promote, rejoin, travel and disconnect through actual Q2 UDP", async () => {
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--movement", "q2", "--character", "q2",
    "--dedicated", "--mode", "coop", "--listen-q2", "0", "--bind", "127.0.0.1"]);
  if (parsed.kind !== "run") throw new Error("No server launch");
  const prints: string[] = [], host = { print: (text: string): undefined => { prints.push(text); return undefined; } };
  const server = await Application.open(parsed.options, host);
  let client: RemoteApplication | null = null;
  try {
    const address = server.networkAddress;
    if (address === null) throw new Error("Server did not bind UDP");
    const selection = parseApplicationCommand(["--game", "q2-classic-baseq2", "--movement", "q2", "--character", "q2",
      "--connect-q2", addressKey(address), "--mode", "coop", "--renderer", "cpu", "--width", "160", "--height", "120", "--hidden", "--seats", "2", "+name", "T05Player"]);
    if (selection.kind !== "run") throw new Error("No remote launch");
    client = await RemoteApplication.open(selection.options, host);
    const remote = client, events: SimulationPresentationEvent[] = [];
    const exchange = async (): Promise<void> => {
      await remote.step(100);
      await Bun.sleep(1);
      await server.step(100);
      await Bun.sleep(1);
      await remote.step(100);
      events.push(...remote.presentationEvents);
    };
    const waitForPeers = async (pending: () => boolean): Promise<void> => {
      const deadline = performance.now() + 10000;
      while (pending() && performance.now() < deadline) { await exchange(); await Bun.sleep(10); }
      if (pending()) {
        const consoles = remote.localPlayers.flatMap(player => player.seat.presentation instanceof WorldSeatPresentation ? [player.seat.presentation.local.console.buffer.dump()] : []);
        throw new Error(`Remote admission stopped at ${remote.localPlayers.length} views, ${remote.options.seats} selected seats and ${server.networkClients.length} server clients on ${remote.captureMap}: ${prints.join("")}\n${consoles.join("\n")}`);
      }
    };
    await waitForPeers(() => remote.localPlayers.length < 2);
    expect(remote.networkPhase).toBe("active");
    expect(remote.localPlayers.length).toBe(2);
    expect(server.networkClients.length).toBe(2);
    expect(remote.session.world).toBeNull();
    const local = remote.localPlayers[0], admitted = server.networkClients[0];
    if (local === undefined || admitted === undefined) throw new Error(`No remote player: ${prints.join("")}`);
    expect(local.actor.equals(admitted.actor)).toBe(false);
    if (!(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing remote input presentation");
    const localInput = local.seat.presentation.local;
    const forwarded = spyOn(remote.remote, "playerCommand");
    try {
      remote.input({ kind: "mouse-motion", seat: local.seat.id, position: { x: 0, y: 0 }, delta: { x: 0, y: 137 }, timeMilliseconds: performance.now() });
      await exchange();
      expect(Math.abs(localInput.builder.viewAngles.x)).toBeGreaterThan(1);
      localInput.console.field.setText("/centerview"); localInput.console.submit();
      await exchange(); await exchange();
      expect(localInput.builder.viewAngles.x).toBe(0);
      expect(Math.abs(remote.remote.playerView(local.actor).angles.x)).toBeLessThan(0.02);
      expect(forwarded.mock.calls.some(call => call[1] === "centerview")).toBe(false);
    } finally { forwarded.mockRestore(); }
    expect(remote.input({ seat: createIdentityOwner("other application").seat(0), kind: "key", code: 119,
      down: true, repeat: false, timeMilliseconds: performance.now() })).toBe(false);
    const pixels = remote.readPixels();
    expect(pixels.length).toBe(160 * 120 * 4);
    expect(new Set(pixels).size).toBeGreaterThan(16);
    const before = server.simulation.bodies.read(admitted.actor)?.origin;
    if (before === undefined) throw new Error("Source network player has no body");
    expect(remote.input({ seat: local.seat.id, kind: "key", code: 119, down: true, repeat: false, timeMilliseconds: performance.now() })).toBe(true);
    for (let index = 0; index < 6; index++) await exchange();
    remote.input({ seat: local.seat.id, kind: "key", code: 119, down: false, repeat: false, timeMilliseconds: performance.now() });
    const after = server.simulation.bodies.read(admitted.actor)?.origin;
    expect(after).not.toEqual(before);
    expect(remote.remote.playerUi(local.actor).health).toBe(server.simulation.playerUi(admitted.actor).health);
    remote.input({ seat: local.seat.id, kind: "mouse-button", button: 1, down: true, timeMilliseconds: performance.now() });
    for (let index = 0; index < 12; index++) await exchange();
    remote.input({ seat: local.seat.id, kind: "mouse-button", button: 1, down: false, timeMilliseconds: performance.now() });
    expect(events.some(event => event.kind === "q2-weapon" && event.event.kind === "muzzleflash")).toBe(true);
    remote.queueCommand("say", ["remote-frontend-chat"], local.seat.id);
    await exchange(); await exchange();
    expect(prints.some(text => text.includes("T05Player: remote-frontend-chat"))).toBe(true);
    const second = remote.localPlayers[1];
    if (second === undefined) throw new Error("Missing second remote player");
    expect(second.actor.equals(local.actor)).toBe(false);
    remote.queueCommand("local_drop", [String(local.seat.id.index + 1)], local.seat.id);
    await exchange(); await exchange();
    expect(remote.localPlayers.length).toBe(1);
    expect(remote.localPlayers[0]?.seat).toBe(second.seat);
    expect(remote.localPlayers[0]?.actor.equals(second.actor)).toBe(true);
    remote.queueCommand("local_join", [], second.seat.id);
    await waitForPeers(() => remote.localPlayers.length < 2);
    expect(remote.localPlayers.length).toBe(2);
    expect(server.networkClients.length).toBe(2);
    expect(remote.localPlayers[0]?.seat).toBe(second.seat);
    expect(remote.localPlayers.some(player => player.seat === local.seat)).toBe(true);
    const firstActor = second.actor, seat = second.seat, window = remote.window;
    const firstActors = remote.localPlayers.map(player => player.actor);
    server.queueCommand("map", ["base2"], null);
    await waitForPeers(() => remote.content.recipe.map.geometry.requestedPath !== "maps/base2.bsp"
      || remote.localPlayers.length < 2 || remote.localPlayers.some(player => firstActors.some(actor => actor.equals(player.actor))) || remote.remote.output === null);
    expect(remote.content.recipe.map.geometry.requestedPath).toBe("maps/base2.bsp");
    expect(remote.networkPhase).toBe("active");
    expect(remote.localPlayers[0]?.actor.equals(firstActor)).toBe(false);
    expect(remote.localPlayers[0]?.seat).toBe(seat);
    expect(remote.localPlayers.length).toBe(2);
    expect(remote.window).toBe(window);
    expect(remote.session.world).toBeNull();
    expect(new Set(remote.readPixels()).size).toBeGreaterThan(16);
    const secondActor = remote.localPlayers[0]?.actor;
    if (secondActor === undefined) throw new Error("Travel lost the client player");
    const secondActors = remote.localPlayers.map(player => player.actor);
    server.queueCommand("map", ["base2"], null);
    await waitForPeers(() => remote.localPlayers.length < 2
      || remote.localPlayers.some(player => secondActors.some(actor => actor.equals(player.actor))) || remote.remote.output === null);
    expect(remote.localPlayers[0]?.actor.equals(secondActor)).toBe(false);
    expect(remote.localPlayers[0]?.seat).toBe(seat);
    expect(remote.window).toBe(window);
    expect(new Set(remote.readPixels()).size).toBeGreaterThan(16);
    await remote.close();
    await Bun.sleep(1); await server.step(100);
    expect(server.networkClients.length).toBe(0);
    expect(remote.networkPhase).toBe("closed");
  } finally { await client?.close(); await server.close(); }
}, 60000);
