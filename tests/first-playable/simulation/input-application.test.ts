import { expect, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { UserCommand } from "../../../src/contracts/protocol.ts";
import type { ModClientApplicationEvent } from "../../../src/world/session/mod-clients.ts";
import type { MovementState } from "../../../src/contracts/movement.ts";
import type { ExecutableRecipe } from "../../../src/contracts/content.ts";
import { encodeSaveImage, decodeSaveImage } from "../../../src/persistence/index.ts";
import { ModClientApplications } from "../../../src/world/session/mod-client-applications.ts";

function command(state: MovementState): UserCommand {
  switch (state.kind) {
    case "q1-netquake": return { kind: state.kind, acknowledgedServerTimeSeconds: 999, viewAngles: { x: 0, y: 90, z: 0 }, forwardMove: 120, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 };
    case "q1-quakeworld": return { kind: state.kind, milliseconds: 125, angles: { x: 0, y: 90, z: 0 }, forwardMove: 120, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 };
    case "q2-classic": return { kind: state.kind, milliseconds: 33, angleShorts: [0, 16384, 0], forwardMove: 120, sideMove: 0, upMove: 0, buttons: 0, impulse: 0, lightLevel: 0 };
    case "q2-rerelease": return { kind: state.kind, milliseconds: 33, angles: { x: 0, y: 90, z: 0 }, forwardMove: 120, sideMove: 0, buttons: 0, serverFrame: 0 };
    case "q3": return { kind: state.kind, serverTimeMilliseconds: state.commandTimeMilliseconds + 1300, angleWords: [20000, 16384, 0], forwardMove: 120, rightMove: 0, upMove: 0, buttons: 0, weapon: 2 };
  }
}

test("shared input applies exact source slices in order, preserves physics and saved continuation", async () => {
  for (const movement of ["q1", "qw", "q2", "q2-rerelease-baseq2", "q3"]) {
    const launch = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "start", "--movement", movement, "--character", "q3", "--dedicated"]);
    if (launch.kind !== "run") throw new Error("Expected launch");
    const content = await loadApplicationContent(launch.options);
    const firstIdentity = createIdentityOwner(`input-${movement}`), secondIdentity = createIdentityOwner(`baseline-${movement}`);
    const recipe: ExecutableRecipe = { ...content.recipe, timing: content.recipe.timing.map(value => value.clock.kind === "q1-quakeworld"
      ? { ...value, clock: { ...value.clock, maximumCommandMilliseconds: 50 } } : value) };
    const options = { recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "singleplayer", seed: 17, maxClients: 1 } satisfies Omit<Parameters<typeof createSimulation>[0], "identity">;
    const simulation = createSimulation({ ...options, identity: firstIdentity }), baseline = createSimulation({ ...options, identity: secondIdentity });
    try {
      const client = firstIdentity.client(0, 0), plainClient = secondIdentity.client(0, 0);
      const actor = simulation.admitPlayer(client).actor, plainActor = baseline.admitPlayer(plainClient).actor;
      const player = simulation.movementPlayer(actor), plainPlayer = baseline.movementPlayer(plainActor);
      if (player === null || plainPlayer === null) throw new Error("Missing admitted movement");
      const events: ModClientApplicationEvent[] = [], order: string[] = [];
      let removeLate = () => undefined;
      simulation.modClients.subscribeApplication(event => { events.push(event); order.push(`first:${event.phase}:${event.application.scope}`); removeLate(); return undefined; });
      simulation.modClients.subscribeApplication(event => { order.push(`second:${event.phase}:${event.application.scope}`); return undefined; });
      removeLate = simulation.modClients.subscribeApplication(() => { throw new Error("Removed subscription was invoked"); });
      const input = command(player.state);
      simulation.step({ elapsedMilliseconds: 17, commands: [{ actor, source: { kind: "remote-client", client }, sequence: 1, command: input }] });
      baseline.step({ elapsedMilliseconds: 17, commands: [{ actor: plainActor, source: { kind: "remote-client", client: plainClient }, sequence: 1, command: command(plainPlayer.state) }] });
      expect(simulation.playerView(actor)).toEqual(baseline.playerView(plainActor));
      expect(player.readState()).toEqual(plainPlayer.readState());
      expect(order.length).toBe(events.length * 2);
      for (let index = 0; index < order.length; index += 2) expect(order[index]?.replace("first:", "")).toBe(order[index + 1]?.replace("second:", ""));
      const begins = events.filter(event => event.phase === "before"), outer = begins[0]?.application;
      if (outer === undefined) throw new Error(`No ${movement} application`);
      expect(outer.scope).toBe("client-command"); expect(outer.parentInvocation).toBeNull();
      expect(outer.accepted?.input.sequence).toBe(1);
      const slices = begins.filter(event => event.application.scope === "movement-slice").map(event => event.application);
      expect(slices.every(slice => slice.parentInvocation === outer.invocation)).toBe(true);
      if (input.kind === "q1-netquake") expect(slices.map(slice => slice.frame.elapsed)).toEqual([{ kind: "seconds", value: 0.017 }]);
      else if (input.kind === "q1-quakeworld") expect(slices.map(slice => slice.frame.elapsed.value)).toEqual([31, 31, 31, 31]);
      else if (input.kind === "q3") {
        expect(slices.map(slice => slice.frame.elapsed.value)).toEqual([...Array<number>(15).fill(66), 10]);
        expect(slices[0]?.absoluteAim.x).toBe(87.890625);
        expect(slices.at(-1)?.command).toMatchObject({ serverTimeMilliseconds: input.serverTimeMilliseconds });
      } else expect(slices.map(slice => slice.frame.elapsed.value)).toEqual([33]);
      expect(events.at(-1)).toMatchObject({ phase: "after", outcome: "completed", application: { invocation: outer.invocation } });
      const lastOrdinal = Math.max(...begins.map(event => event.application.invocation));
      if (input.kind === "q1-netquake") {
        events.length = 0;
        simulation.step({ elapsedMilliseconds: 31, commands: [] });
        expect(events[0]).toMatchObject({ phase: "before", application: { accepted: { input: { sequence: 1 } }, frame: { elapsed: { kind: "seconds", value: 0.031 } } } });
      }
      const image = decodeSaveImage(encodeSaveImage(simulation.checkpoint()));
      const identity = createIdentityOwner(`restore-${movement}`), restoredClient = identity.client(0, 0);
      const restored = createSimulation({ ...options, identity, restoredClients: [restoredClient], restore: image });
      try {
        const restoredActor = restored.players()[0]; if (restoredActor === undefined) throw new Error("Missing restored client");
        const restoredPlayer = restored.movementPlayer(restoredActor); if (restoredPlayer === null) throw new Error("Missing restored movement");
        const resumed: ModClientApplicationEvent[] = [];
        restored.modClients.subscribeApplication(event => { resumed.push(event); return undefined; });
        expect(resumed).toHaveLength(0);
        restored.step({ elapsedMilliseconds: 17, commands: [{ actor: restoredActor, source: { kind: "remote-client", client: restoredClient }, sequence: 2, command: command(restoredPlayer.state) }] });
        expect(resumed[0]?.application.invocation).toBeGreaterThan(lastOrdinal);
      } finally { restored.close(); }
      if (movement === "q2") {
        events.length = 0;
        let reentered = false;
        const remove = simulation.modClients.subscribeApplication(event => {
          if (event.application.scope !== "client-command") return undefined;
          if (event.phase === "before" && !reentered) {
            reentered = true;
            const nested = command(player.state); if (nested.kind !== "q2-classic") throw new Error("Expected Q2 command");
            player.move({ actor, source: { kind: "remote-client", client }, sequence: 2, command: { ...nested, milliseconds: 0 } }, event.application.frame);
          } else if (event.phase === "after" && event.outcome === "completed" && event.application.parentInvocation === null) {
            const body = simulation.bodies.read(actor), owned = simulation.actors.resolveOwned(actor);
            if (body === null || owned === null) throw new Error("Missing callback body");
            simulation.bodies.write(owned, { ...body, velocity: { x: 123, y: 0, z: 0 } });
          }
          return undefined;
        });
        const result = player.move({ actor, source: { kind: "remote-client", client }, sequence: 2, command: command(player.state) },
          { ...image.frame, phase: "client-command", elapsed: { kind: "milliseconds", value: 33 } });
        if (result.kind !== "q2-classic" || result.status !== "active") throw new Error("Input callback lost its Q2 result");
        expect(result.state.velocityEighths).toEqual([984, 0, 0]);
        const current = player.readState(); if (current.kind !== "q2-classic") throw new Error("Input callback changed its movement family");
        expect(result.state).toEqual(current);
        const commands = events.filter(event => event.phase === "before" && event.application.scope === "client-command");
        expect(commands).toHaveLength(2);
        expect(commands[1]?.application.parentInvocation).toBe(commands[0]?.application.invocation);
        remove();
      }
      events.length = 0;
      simulation.modClients.subscribeApplication(event => {
        if (event.phase === "before" && event.application.scope === "movement-slice") {
          const owned = simulation.actors.resolveOwned(actor); if (owned !== null) simulation.actors.release(owned);
        }
        return undefined;
      });
      simulation.step({ elapsedMilliseconds: 17, commands: [{ actor, source: { kind: "remote-client", client }, sequence: 3, command: command(player.state) }] });
      expect(simulation.actors.isLive(actor)).toBe(false);
      expect(events.some(event => event.phase === "after" && event.outcome === "actor-removed")).toBe(true);
    } finally { simulation.close(); baseline.close(); await content.close(); }
  }
}, 60000);

test("terminal input callbacks drain entered observers and scopes before propagating failures", () => {
  const owner = createIdentityOwner("input-terminal"), actor = owner.actor(1, 0), client = owner.client(0, 0);
  let live = true;
  const applications = new ModClientApplications(() => live), order: string[] = [];
  for (const name of ["first", "second"]) applications.subscribe(event => {
    order.push(`${name}:${event.phase}:${event.application.scope}`);
    if (event.phase === "after" && name === "first") throw new Error("Authored cleanup failed");
    return undefined;
  });
  const input = { identity: { actor, client }, command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: 0,
    viewAngles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 },
    angleSpace: "absolute", absoluteAim: { x: 0, y: 0, z: 0 }, accepted: null,
    frame: { frame: 1, phase: "client-command", time: { kind: "seconds", value: 1 }, elapsed: { kind: "seconds", value: 0.02 } },
  } satisfies Omit<Parameters<ModClientApplications["begin"]>[0], "scope">;
  const commandScope = applications.begin({ ...input, scope: "client-command" });
  applications.begin({ ...input, scope: "movement-slice", parentInvocation: commandScope?.invocation ?? null });
  live = false;
  expect(() => applications.release(actor)).toThrow("Client input release callbacks failed");
  expect(order.slice(-4)).toEqual(["first:after:movement-slice", "second:after:movement-slice", "first:after:client-command", "second:after:client-command"]);
  expect(applications.checkpoint()).toBe(2);
  applications.restore(2);
  expect(order).toHaveLength(8);
});

test("effective output reaches every shared movement profile before source and weapon command work", async () => {
  for (const movement of ["q1", "qw", "q2", "q2-rerelease-baseq2", "q3"]) {
    const launch = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "start", "--movement", movement, "--character", "q3", "--dedicated"]);
    if (launch.kind !== "run") throw new Error("Expected launch");
    const content = await loadApplicationContent(launch.options);
    const identity = createIdentityOwner(`output-${movement}`), baselineIdentity = createIdentityOwner(`output-baseline-${movement}`);
    const options = { recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "singleplayer", seed: 17, maxClients: 1 } satisfies Omit<Parameters<typeof createSimulation>[0], "identity">;
    const simulation = createSimulation({ ...options, identity }), baseline = createSimulation({ ...options, identity: baselineIdentity });
    try {
      const client = identity.client(0, 0), plainClient = baselineIdentity.client(0, 0), actor = simulation.admitPlayer(client).actor, plainActor = baseline.admitPlayer(plainClient).actor;
      const player = simulation.movementPlayer(actor), plain = baseline.movementPlayer(plainActor);
      if (player === null || plain === null) throw new Error("Missing movement");
      const raw = { ...command(player.state), buttons: 1 }, retained = structuredClone(raw);
      const expected = { ...command(plain.state), forwardMove: 0, buttons: 0 };
      const applications: ModClientApplicationEvent[] = [], heights: number[] = [];
      simulation.modClients.subscribeApplication(event => {
        applications.push(event);
        if (event.phase === "after" && event.application.scope === "movement-slice") { const view = simulation.modClients.playerView?.(client); if (view === undefined) throw new Error("Missing live pose"); heights.push(view.viewOffset.z); }
        if (event.phase === "before" && event.application.scope === "client-command") event.output({ kind: "consume", inputs: ["attack"] });
        if (event.phase === "before" && event.application.scope === "movement-slice") event.output({ kind: "consume", inputs: ["forward-move"] });
        return undefined;
      });
      simulation.step({ elapsedMilliseconds: 17, commands: [{ actor, source: { kind: "remote-client", client }, sequence: 1, command: raw }] });
      baseline.step({ elapsedMilliseconds: 17, commands: [{ actor: plainActor, source: { kind: "remote-client", client: plainClient }, sequence: 1, command: expected }] });
      expect(player.readState()).toEqual(plain.readState());
      expect(player.arsenal).toEqual(plain.arsenal);
      expect(heights.at(-1)).toBe(plain.viewHeight);
      expect(raw).toEqual(retained);
      expect(applications.filter(event => event.phase === "before" && event.application.scope === "client-command")).toHaveLength(1);
      for (const event of applications) if (event.phase === "before" && event.application.scope === "movement-slice") {
        expect(event.application.command.forwardMove).toBe(0); expect(event.application.command.buttons & 1).toBe(0);
      }
    } finally { simulation.close(); baseline.close(); await content.close(); }
  }
}, 60000);
