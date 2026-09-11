import { expect, test } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { RemoteApplication } from "../../../src/app/bootstrap/remote-application.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { addressKey } from "../../../src/network/common/endpoint.ts";
import type { SimulationPresentationEvent } from "../../../src/app/bootstrap/simulation/types.ts";

test("native remote frontend renders, moves, fires, travels and disconnects through actual Q2 UDP", async () => {
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
      "--connect-q2", addressKey(address), "--mode", "coop", "--renderer", "cpu", "--width", "160", "--height", "120", "--hidden"]);
    if (selection.kind !== "run") throw new Error("No remote launch");
    client = await RemoteApplication.open(selection.options, host);
    const remote = client, events: SimulationPresentationEvent[] = [];
    const exchange = async (): Promise<void> => {
      await remote.step(100); await Bun.sleep(1); await server.step(100); await Bun.sleep(1); await remote.step(100);
      events.push(...remote.presentationEvents);
    };
    for (let index = 0; index < 80 && remote.localPlayers.length === 0; index++) await exchange();
    expect(remote.networkPhase).toBe("active");
    expect(remote.session.world).toBeNull();
    const local = remote.localPlayers[0], admitted = server.networkClients[0];
    if (local === undefined || admitted === undefined) throw new Error(`No remote player: ${prints.join("")}`);
    expect(local.actor.equals(admitted.actor)).toBe(false);
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
    expect(prints.some(text => text.includes("Player: remote-frontend-chat"))).toBe(true);
    const firstActor = local.actor, seat = local.seat, window = remote.window;
    server.queueCommand("map", ["base2"], null);
    for (let index = 0; index < 80 && (remote.content.recipe.map.geometry.requestedPath !== "maps/base2.bsp"
      || remote.localPlayers[0]?.actor.equals(firstActor) || remote.remote.output === null); index++) await exchange();
    expect(remote.content.recipe.map.geometry.requestedPath).toBe("maps/base2.bsp");
    expect(remote.networkPhase).toBe("active");
    expect(remote.localPlayers[0]?.actor.equals(firstActor)).toBe(false);
    expect(remote.localPlayers[0]?.seat).toBe(seat);
    expect(remote.window).toBe(window);
    expect(remote.session.world).toBeNull();
    expect(new Set(remote.readPixels()).size).toBeGreaterThan(16);
    const secondActor = remote.localPlayers[0]?.actor;
    if (secondActor === undefined) throw new Error("Travel lost the client player");
    server.queueCommand("map", ["base2"], null);
    for (let index = 0; index < 80 && (remote.localPlayers[0]?.actor.equals(secondActor) || remote.remote.output === null); index++) await exchange();
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
