import { expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { ApplicationQ3Client } from "../../../src/app/bootstrap/q3-client.ts";
import { ApplicationQ3Source } from "../../../src/app/bootstrap/q3-client/source.ts";
import { ApplicationBots } from "../../../src/app/bootstrap/simulation/bots.ts";
import { SharedSimulation } from "../../../src/app/bootstrap/simulation/runtime.ts";
import { Q3SourceRuntime } from "../../../src/app/bootstrap/simulation/q3/runtime.ts";
import { Q3ServerNetwork } from "../../../src/app/bootstrap/network/q3.ts";
import { PreparedStartup } from "../../../src/app/bootstrap/prepared-startup.ts";
import type { ServerReliableCommands } from "../../../src/network/q3/reliable.ts";
import { InputCommandBuilder } from "../../../src/input/user-command.ts";
import type { UserCommand } from "../../../src/contracts/protocol.ts";
import { setImmediate } from "node:timers/promises";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { UdpTransport } from "../../../src/network/common/transport.ts";
import type { Ipv4Address } from "../../../src/network/common/endpoint.ts";
import { Q3ClientAdmission } from "../../../src/network/q3/admission.ts";
import { Q3ClientConnection } from "../../../src/network/q3/client.ts";
import { q3ChannelDelivery } from "../../../src/network/q3/transport.ts";
import type { Snapshot } from "../../../src/network/q3/server-message.ts";
import { CommandBuffer } from "../../../src/core/commands/index.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { StartupSelectionModel } from "../../../src/app/bootstrap/startup-selection.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { discoverInstalledContent } from "../../../src/content/catalog/index.ts";
import { ConnectionState } from "../../../src/content/q3/base/game/state.ts";
import { encodePng } from "../../../src/formats/images/png.ts";

test("default mpteam1 six-client warmup and manual restart retain native owners and settle once per step", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-fast-restart-"));
  const parsed = parseApplicationCommand(["--content-root", "/home/buzzkill/Projects/qfiles", "--renderer", "cpu", "--hidden",
    "--width", "320", "--height", "240", "--user-content-root", root, "--listen", "0", "--bind", "127.0.0.1"]);
  if (parsed.kind !== "menu" && parsed.kind !== "run") throw new Error("Missing restart fixture options");
  expect(parsed.options.network.kind).toBe("native-server");
  if (parsed.options.network.kind !== "native-server") throw new Error("Missing native server fixture options");
  expect(parsed.options.network.host).toBe("127.0.0.1");
  expect(parsed.options.network.port).toBe(0);
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false });
  const selection = new StartupSelectionModel(catalog, parsed.options);
  await selection.prepareMaps();
  const launch = await selection.resolvePreset("q3-missionpack", 2);
  expect(launch.options.map).toBe("maps/mpteam1.bsp");
  expect(launch.options.teamArenaSkirmish?.maxClients).toBe(6);
  const prepared: PreparedStartup[] = [], bindOutput = PreparedStartup.prototype.bindOutput;
  const prepare = spyOn(PreparedStartup.prototype, "bindOutput").mockImplementation(function(this: PreparedStartup, ...args: Parameters<PreparedStartup["bindOutput"]>) {
    prepared.push(this); return bindOutput.apply(this, args);
  });
  const created: ApplicationQ3Client[] = [], create = ApplicationQ3Client.create;
  const creation = spyOn(ApplicationQ3Client, "create").mockImplementation(async options => {
    const client = await create(options); created.push(client); return client;
  });
  let watchedBuilder: InputCommandBuilder | null = null;
  const built: UserCommand[] = [], build = InputCommandBuilder.prototype.build;
  const builder = spyOn(InputCommandBuilder.prototype, "build").mockImplementation(function(this: InputCommandBuilder, ...args: Parameters<InputCommandBuilder["build"]>) {
    const command = build.apply(this, args); if (this === watchedBuilder) built.push(command); return command;
  });
  let app: Application | null = null;
  let wireTransport: UdpTransport | null = null;
  let armed = false, settling = false;
  const rounds: { start: number; times: number[]; clientCounts: number[]; end: number; gameEnd: number }[] = [];
  const botRounds: { ring: ServerReliableCommands; before: number; after: number }[][] = [];
  const localRounds: { source: ApplicationQ3Source; before: number; bit: 0 | 4 }[] = [];
  const localBegin = ApplicationQ3Source.prototype.beginRoundRestart;
  const localRestart = spyOn(ApplicationQ3Source.prototype, "beginRoundRestart").mockImplementation(function(this: ApplicationQ3Source, ...args: Parameters<ApplicationQ3Source["beginRoundRestart"]>) {
    const snapshot = this.read(this.current().number); if (snapshot === null) throw new Error("Missing old local snapshot");
    localRounds.push({ source: this, before: snapshot.serverCommandNumber, bit: args[0] });
    localBegin.apply(this, args);
  });
  const bots = new Set<ApplicationBots>(), networks = new Set<Q3ServerNetwork>();
  const authority = new Set<CommandBuffer>();
  const beginSettlement = SharedSimulation.prototype.beginSourceRoundSettlement;
  const begin = spyOn(SharedSimulation.prototype, "beginSourceRoundSettlement").mockImplementation(function(this: SharedSimulation) {
    beginSettlement.call(this); settling = true;
    const source = this.q3Source(); if (source === null) throw new Error("Missing settling source");
    rounds.push({ start: source.host.now(), times: [], clientCounts: [], end: -1, gameEnd: -1 });
    source.host.engine.sendServerCommand(-1, `print "round_prefix_${rounds.length}"`);
  });
  const endSettlement = SharedSimulation.prototype.completeSourceRoundSettlement;
  const end = spyOn(SharedSimulation.prototype, "completeSourceRoundSettlement").mockImplementation(function(this: SharedSimulation) {
    endSettlement.call(this);
    const round = rounds.at(-1), source = this.q3Source();
    if (round === undefined || source === null) throw new Error("Missing completed round");
    round.end = source.host.now(); round.gameEnd = source.level.time; settling = false;
    for (const entry of botRounds.at(-1) ?? []) entry.after = entry.ring.sequence;
  });
  const beginFrame = Q3SourceRuntime.prototype.beginFrame;
  const frame = spyOn(Q3SourceRuntime.prototype, "beginFrame").mockImplementation(function(this: Q3SourceRuntime, ...args: Parameters<Q3SourceRuntime["beginFrame"]>) {
    beginFrame.apply(this, args);
    if (settling) {
      const round = rounds.at(-1); if (round === undefined) throw new Error("Missing source frame owner");
      if (round.times.length === 3) this.host.engine.sendServerCommand(-1, `print "round_suffix_${rounds.length}"`);
      round.times.push(this.level.time);
      round.clientCounts.push(this.pool.clients.filter(client => client.pers.connected === ConnectionState.CONNECTED).length);
    }
  });
  const receive = ApplicationQ3Source.prototype.receive;
  const snapshots = spyOn(ApplicationQ3Source.prototype, "receive").mockImplementation(function(this: ApplicationQ3Source, ...args: Parameters<ApplicationQ3Source["receive"]>) {
    expect(settling).toBe(false); return receive.apply(this, args);
  });
  const botBegin = ApplicationBots.prototype.beginRoundRestart;
  const botRestart = spyOn(ApplicationBots.prototype, "beginRoundRestart").mockImplementation(function(this: ApplicationBots) {
    bots.add(this); botRounds.push(this.clients().map(client => ({ ring: client.reliable, before: client.reliable.sequence, after: -1 })));
    return botBegin.call(this);
  });
  const networkRestart = Q3ServerNetwork.prototype.restartSourceRound;
  const network = spyOn(Q3ServerNetwork.prototype, "restartSourceRound").mockImplementation(function(this: Q3ServerNetwork, ...args: Parameters<Q3ServerNetwork["restartSourceRound"]>) {
    networks.add(this); return networkRestart.apply(this, args);
  });
  const execute = CommandBuffer.prototype.executeAsync;
  const commands = spyOn(CommandBuffer.prototype, "executeAsync").mockImplementation(function(this: CommandBuffer, ...args: Parameters<CommandBuffer["executeAsync"]>) {
    if (armed && this !== prepared.at(-1)?.commands && this.context.origin.kind === "server-console") authority.add(this);
    return execute.apply(this, args);
  });
  try {
    app = await Application.open({ ...launch.options, network: parsed.options.network }, { print: () => undefined }, launch.recipe);
    expect(app.networkAddress).not.toBeNull();
    expect(app.networkAddress?.kind).toBe("ipv4");
    const application = app, simulation = app.simulation, session = app.session, scene = simulation.scene;
    const human = app.localPlayers[0], initialSource = simulation.q3Source(), persistent = prepared.at(-1);
    if (human === undefined || initialSource === null || persistent === undefined || !(human.seat.presentation instanceof WorldSeatPresentation))
      throw new Error("Missing native restart owners");
    const presentation = human.seat.presentation, input = presentation.local.input, client = presentation.q3Client;
    if (client === null) throw new Error("Missing native cgame");
    const assets = client.options.assets, audio = client.options.audio, engine = audio.engine, window = app.window;
    const initialActor = human.actor; watchedBuilder = presentation.local.builder;
    const key = (code: number, down: boolean): void => { application.input({ kind: "key", seat: human.seat.id, code, down, repeat: false, timeMilliseconds: performance.now() }); };
    const submit = (text: string): void => { presentation.local.console.field.setText(text); presentation.local.console.submit(); };
    armed = true;
    for (let step = 0; step < 450 && simulation.q3Source() === initialSource; step++) await app.step(200);
    expect(simulation.q3Source()).not.toBe(initialSource); expect(rounds.length).toBe(1);
    expect(simulation.players()).toHaveLength(6); expect(app.botClients).toHaveLength(5);
    expect(simulation.actors.isLive(initialActor)).toBe(false);
    const retainedBots = [...app.botClients], retainedClients = [...simulation.clientIdentities()];
    const checkRound = (index: number): void => {
      const round = rounds[index]; if (round === undefined) throw new Error("Missing round evidence");
      expect(round.times).toEqual([round.start, round.start + 100, round.start + 200, round.start + 300]);
      expect(round.clientCounts).toEqual([0, 0, 0, 6]); expect(round.end - round.start).toBe(400); expect(round.gameEnd).toBe(round.start + 300);
      const rings = botRounds[index]; if (rings === undefined) throw new Error("Missing bot ring evidence");
      expect(rings).toHaveLength(5);
      for (const entry of rings) {
        expect(entry.after - entry.before).toBeLessThanOrEqual(64);
        const commands = Array.from({ length: entry.after - entry.before }, (_, offset) => entry.ring.lookup(entry.before + offset + 1).trim());
        expect(commands.filter(command => command === "map_restart")).toHaveLength(1);
        const restart = commands.indexOf("map_restart");
        expect(commands.indexOf('print "round_prefix_' + (index + 1) + '"')).toBeLessThan(restart);
        expect(commands.indexOf('print "round_prefix_' + (index + 1) + '"')).toBeGreaterThanOrEqual(0);
        expect(commands.indexOf('print "round_suffix_' + (index + 1) + '"')).toBeGreaterThan(restart);
      }
      const local = localRounds[index]; if (local === undefined) throw new Error("Missing local restart ring");
      const snapshot = local.source.read(local.source.current().number); if (snapshot === null) throw new Error("Missing final local snapshot");
      expect(snapshot.flags & 4).toBe(local.bit);
      const commands = Array.from({ length: snapshot.serverCommandNumber - local.before }, (_, offset) => local.source.getServerCommand(local.before + offset + 1));
      expect(commands.filter(command => command?.[0] === "map_restart")).toHaveLength(1);
    };
    checkRound(0);
    const checkOwners = (): void => {
      expect(app?.simulation).toBe(simulation); expect(app?.session).toBe(session); expect(simulation.scene).toBe(scene);
      expect(human.seat.presentation).toBe(presentation); expect(presentation.local.input).toBe(input); expect(presentation.q3Client).toBe(client);
      expect(client.options.assets).toBe(assets); expect(client.options.audio).toBe(audio); expect(audio.engine).toBe(engine); expect(app?.window).toBe(window);
      expect(prepared.at(-1)).toBe(persistent); expect(created).toEqual([client]); expect(authority.size).toBe(1);
      expect(bots.size).toBe(1); expect(networks.size).toBe(1); expect(app?.botClients).toEqual(retainedBots);
      expect(simulation.clientIdentities()).toEqual(retainedClients); expect(session.isClosed).toBe(false);
    };
    checkOwners();
    const rejected = new Error("local round preflight rejected"), previous = simulation.q3Source();
    const captureMode = window?.relativeMouse, focus = input.focus;
    key(119, true);
    const preflight = spyOn(client, "assertCanRestartRound").mockImplementationOnce(() => { throw rejected; });
    submit("/map_restart 0");
    try { await expect(app.step(1)).rejects.toBe(rejected); } finally { preflight.mockRestore(); }
    expect(simulation.q3Source()).toBe(previous); expect(session.isClosed).toBe(false);
    expect(input.isDown({ kind: "key", code: 119 })).toBe(true); expect(window?.relativeMouse).toBe(captureMode); expect(input.focus).toBe(focus); checkOwners();
    key(119, false);
    application.input({ kind: "mouse-motion", seat: human.seat.id, position: { x: 0, y: 0 }, delta: { x: 137, y: 0 }, timeMilliseconds: performance.now() });
    await app.step(50);
    const rawAngles = presentation.local.builder.viewAngles;
    expect(Math.abs(rawAngles.y)).toBeGreaterThan(1);
    key(119, true);
    application.input({ kind: "mouse-button", seat: human.seat.id, button: 1, down: true, timeMilliseconds: performance.now() });
    application.input({ kind: "controller-axis", seat: human.seat.id, device: 0, axis: "left-x", value: 0.7, timeMilliseconds: performance.now() });
    await app.step(50);
    const warmActor = human.actor, before = app.timeMilliseconds, firstHeldCommand = built.length;
    submit("/map_restart 0; map_restart 0"); await app.step(1);
    expect(rounds.length).toBe(2); checkRound(1); checkOwners();
    expect(app.timeMilliseconds - before).toBe(401); expect(human.actor.equals(warmActor)).toBe(false);
    expect(simulation.actors.isLive(warmActor)).toBe(false);
    expect(input.isDown({ kind: "key", code: 119 })).toBe(true);
    expect(input.isDown({ kind: "mouse-button", button: 1 })).toBe(true);
    expect(window?.relativeMouse).toBe(captureMode); expect(input.focus).toBe(focus);
    expect(presentation.local.builder.viewAngles).toEqual(rawAngles);
    const position = { ...simulation.playerView(human.actor).origin };
    for (let frame = 0; frame < 6; frame++) await app.step(50);
    expect(simulation.playerView(human.actor).origin).not.toEqual(position);
    const heldCommands = built.slice(firstHeldCommand);
    expect(heldCommands.some(command => command.kind === "q3" && command.forwardMove > 0 && command.rightMove > 0 && (command.buttons & 1) !== 0)).toBe(true);
    const command = heldCommands.at(-1), sourceView = simulation.q3Source()?.pool.clientAt(human.seat.client.id.slot).ps;
    if (command?.kind !== "q3" || sourceView === undefined) throw new Error("Missing retained raw command/server view");
    const accepted = simulation.q3Source()?.host.serverState.getUserCommand(human.seat.client.id.slot);
    expect(accepted?.serverTime).toBe(command.serverTimeMilliseconds);
    expect(accepted?.angles).toEqual(command.angleWords);
    const expectedYaw = ((command.angleWords[1] + sourceView.deltaAngles.y) & 65535) * (360 / 65536);
    expect(Math.abs(((sourceView.viewangles.y - expectedYaw + 540) % 360) - 180)).toBeLessThan(0.02);
    expect(presentation.local.builder.viewAngles).toEqual(rawAngles);
    key(119, false);
    application.input({ kind: "mouse-button", seat: human.seat.id, button: 1, down: false, timeMilliseconds: performance.now() });
    application.input({ kind: "controller-axis", seat: human.seat.id, device: 0, axis: "left-x", value: 0, timeMilliseconds: performance.now() });
    await app.step(50);
    const combat = simulation.q3Source(); if (combat === null) throw new Error("Missing firing source");
    const fire = spyOn(combat.weapons, "fire");
    try {
      application.input({ kind: "mouse-button", seat: human.seat.id, button: 1, down: true, timeMilliseconds: performance.now() });
      for (let frame = 0; frame < 10; frame++) await app.step(50);
      application.input({ kind: "mouse-button", seat: human.seat.id, button: 1, down: false, timeMilliseconds: performance.now() });
      expect(fire.mock.calls.some(call => call[0]?.actor.id.equals(human.actor))).toBe(true);
    } finally { fire.mockRestore(); }
    const current = simulation.q3Source(); if (current === null) throw new Error("Missing current source");
    current.host.cvars.set("g_doWarmup", "0", true);
    submit("/map_restart 2; map_restart 7"); await app.step(1);
    const deadline = Number(current.host.configstrings.get(5));
    expect(deadline).toBe(current.host.now() + 2000); expect(rounds.length).toBe(2);
    while (current.host.now() < deadline) await app.step(100);
    await app.step(1); expect(rounds.length).toBe(3); checkRound(2); checkOwners();
    const prior = app.simulation;
    const source = prior.q3Source(); if (source === null) throw new Error("Missing fallback source");
    source.host.cvars.set("sv_maxclients", "8");
    expect(prior.sourceRestartPlan().kind).toBe("replace-world");
    submit("/map_restart 0"); await app.step(1);
    expect(app.simulation).not.toBe(prior); expect(app.session).toBe(session); expect(app.window).toBe(window);
    const replacedHuman = app.localPlayers[0];
    if (replacedHuman === undefined || !(replacedHuman.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing replacement local client");
    const replacementPresentation = replacedHuman.seat.presentation, replacement = app.simulation;
    expect(replacement.options.maxClients).toBe(8);
    expect(replacement.q3Source()?.host.cvars.variableValue("sv_pure")).toBe(0);
    const transport = wireTransport = await UdpTransport.bind({ host: "127.0.0.1", port: 0 });
    const address = app.networkAddress; if (address?.kind !== "ipv4") throw new Error("Missing private IPv4 host");
    const peer: { current: Q3ClientConnection | null } = { current: null };
    const connected = (): Q3ClientConnection => { if (peer.current === null) throw new Error("Wire peer not admitted"); return peer.current; };
    const identity = createIdentityOwner("mpteam1-round-wire"), admission = new Q3ClientAdmission(4917, () => undefined);
    const pendingSnapshots: Snapshot[] = [], wireSnapshots: Snapshot[] = [], wireOrder: string[] = [];
    let wireNow = performance.now(), expectedEpoch: number | null = null, wireRestarts = 0, gamestates = 0;
    let oldWireBit: number | null = null, systemSequence = -1, restartSequence = -1, lastSentTime = -1;
    const receivedRestart: { snapshot: Snapshot | null } = { snapshot: null };
    admission.begin(address);
    const readWire = async (): Promise<void> => {
      for (let event = transport.poll(); event !== null; event = transport.poll()) {
        if (event.kind !== "packet" || event.from.kind !== "ipv4") continue;
        const result = admission.receive(event.from, event.payload, wireNow);
        if (result.kind === "admitted") peer.current = new Q3ClientConnection({ client: identity.client(0, 0), seat: null }, "missionpack",
          { kind: "network", challenge: result.challenge, qport: result.qport }, {
            assertCurrent() {}, print() {}, clearActive() {}, async systemInfo() { wireOrder.push("system:" + connected().serverId);
              if (expectedEpoch !== null && connected().serverId === expectedEpoch) systemSequence = connected().lastExecutedServerCommand; },
            async gamestate() { gamestates++; }, snapshot(snapshot) { pendingSnapshots.push(snapshot);
              if (oldWireBit !== null && (snapshot.flags & 4) !== oldWireBit && receivedRestart.snapshot === null) receivedRestart.snapshot = snapshot; },
            downloadSize: size => size, async download() { throw new Error("Unexpected fixture download"); },
            mapRestart() { wireRestarts++; restartSequence = connected().lastExecutedServerCommand; wireOrder.push("map_restart"); if (expectedEpoch !== null) expect(connected().serverId).toBe(expectedEpoch); },
            levelShot() {}, localServerRunning: () => false,
          });
        else if (result.kind === "sequenced" && peer.current !== null) await peer.current.receiveDatagram(result.bytes, wireNow);
      }
      if (peer.current !== null) {
        for (let sequence = peer.current.lastExecutedServerCommand + 1; sequence <= peer.current.serverCommandSequence; sequence++)
          await peer.current.getServerCommand(sequence);
        for (const snapshot of pendingSnapshots.splice(0)) { wireOrder.push("snapshot:" + (snapshot.flags & 4)); wireSnapshots.push(snapshot); }
      }
    };
    const exchange = async (): Promise<void> => {
      wireNow += 50;
      const request = admission.resend(wireNow, "\\name\\Round Wire\\model\\sarge/default\\team\\red\\handicap\\100\\rate\\25000\\snaps\\20");
      if (request !== null && request.to.kind === "ipv4") transport.send(request.to, request.payload);
      if (peer.current !== null) {
        const time = replacement.q3Source()?.host.now(); if (time === undefined) throw new Error("Missing wire source clock");
        lastSentTime = time + 50;
        peer.current.commands.append({ serverTime: lastSentTime, angles: [0, 0, 0], buttons: 0, weapon: 2, forwardmove: 127, rightmove: 0, upmove: 0 });
        peer.current.transmit({ realTime: wireNow, packetDup: 1, noDelta: false }, q3ChannelDelivery<Ipv4Address>(transport, () => address, peer.current.sourceState, () => undefined));
      }
      await setImmediate(); await application.step(50); await setImmediate(); await readWire();
    };
    for (let attempt = 0; attempt < 100 && wireSnapshots.length === 0; attempt++) await exchange();
    const remote = app.networkClients[0]; if (remote === undefined || wireSnapshots.length === 0) throw new Error("Native wire did not become active");
    const connection = connected(), channel = connection.channel, reliable = connection.reliable, checksumFeed = connection.checksumFeed, oldWireActor = remote.actor;
    expect(gamestates).toBe(1);
    connection.reliable.add("team red");
    for (let step = 0; step < 24; step++) await exchange();
    expectedEpoch = connection.serverId + 1; wireOrder.length = 0;
    const oldBit = wireSnapshots.at(-1)?.flags;
    if (oldBit === undefined) throw new Error("Missing prior remote snapshot");
    oldWireBit = oldBit & 4;
    replacementPresentation.local.console.field.setText("/map_restart 0"); replacementPresentation.local.console.submit(); await app.step(1);
    for (let step = 0; step < 6; step++) await exchange();
    expect(connected()).toBe(connection); expect(connection.channel).toBe(channel); expect(connection.reliable).toBe(reliable);
    expect(connection.checksumFeed).toBe(checksumFeed); expect(connection.serverId).toBe(expectedEpoch); expect(wireRestarts).toBe(1); expect(gamestates).toBe(1);
    const systemAt = wireOrder.indexOf("system:" + expectedEpoch), restartAt = wireOrder.indexOf("map_restart");
    expect(systemAt).toBeGreaterThanOrEqual(0); expect(restartAt).toBeGreaterThan(systemAt);
    expect(systemSequence).toBeGreaterThanOrEqual(0); expect(restartSequence).toBeGreaterThan(systemSequence);
    const receivedSnapshot = receivedRestart.snapshot; if (receivedSnapshot === null) throw new Error("No new-bit snapshot arrived on the wire");
    expect(receivedSnapshot.serverCommandNumber).toBeGreaterThanOrEqual(restartSequence);
    const restartedRemote = app.networkClients[0]; if (restartedRemote === undefined) throw new Error("Restart dropped the remote client");
    expect(restartedRemote.client.equals(remote.client)).toBe(true); expect(restartedRemote.actor.equals(oldWireActor)).toBe(false);
    expect(replacement.actors.isLive(oldWireActor)).toBe(false);
    const remoteBody = replacement.bodies.read(restartedRemote.actor), activeSource = replacement.q3Source();
    if (remoteBody === null || activeSource === null) throw new Error("Remote restart has no live body/source");
    const remotePosition = { ...remoteBody.origin }, commandTime = activeSource.pool.clientAt(restartedRemote.client.slot).ps.commandTime;
    for (let step = 0; step < 8; step++) await exchange();
    const acceptedCommand = activeSource.host.serverState.getUserCommand(restartedRemote.client.slot);
    expect(acceptedCommand?.serverTime).toBe(lastSentTime); expect(acceptedCommand?.forwardmove).toBe(127);
    expect(activeSource.pool.clientAt(restartedRemote.client.slot).ps.commandTime).toBeGreaterThan(commandTime);
    expect(replacement.bodies.read(restartedRemote.actor)?.origin).not.toEqual(remotePosition);
    expect(app.networkClients[0]?.client.equals(remote.client)).toBe(true);
    expect(app.simulation).toBe(replacement); expect(replacedHuman.seat.presentation).toBe(replacementPresentation);
    expect(rounds.length).toBe(4); expect(created).toHaveLength(2);
    const capture = app.captureNextFrame(); await app.step(50);
    const output = process.env["FAST_RESTART_ARTIFACTS"];
    if (output !== undefined) { await mkdir(output, { recursive: true }); await Bun.write(join(output, "mpteam1-restarted.png"), encodePng(320, 240, await capture)); }
    else await capture;
    const fatal = new Error("injected after source reset");
    const fault = spyOn(replacement, "beginSourceRoundSettlement").mockImplementationOnce(() => { throw fatal; });
    replacementPresentation.local.console.field.setText("/map_restart 0"); replacementPresentation.local.console.submit();
    try { await expect(app.step(1)).rejects.toBe(fatal); } finally { fault.mockRestore(); }
    expect(session.isClosed).toBe(true); expect(replacedHuman.seat.isClosed).toBe(true); expect(replacedHuman.seat.client.isClosed).toBe(true);
    await expect(app.step(1)).rejects.toThrow("Application is closed");
  } finally {
    await app?.close(); wireTransport?.close();
    prepare.mockRestore(); creation.mockRestore(); begin.mockRestore(); end.mockRestore(); frame.mockRestore(); snapshots.mockRestore();
    botRestart.mockRestore(); network.mockRestore(); commands.mockRestore(); localRestart.mockRestore(); builder.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
}, 360000);

test("native Q3 initial and restored input uses accepted raw angles, including centerview", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-raw-angle-save-"));
  const parsed = parseApplicationCommand(["--content-root", "/home/buzzkill/Projects/qfiles", "--renderer", "cpu", "--hidden",
    "--width", "320", "--height", "240", "--user-content-root", root]);
  if (parsed.kind !== "menu" && parsed.kind !== "run") throw new Error("Missing angle fixture options");
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false });
  const selection = new StartupSelectionModel(catalog, parsed.options); await selection.prepareMaps();
  const launch = await selection.resolvePreset("q3-missionpack", 2);
  expect(launch.options.map).toBe("maps/mpteam1.bsp");
  const app = await Application.open(launch.options, { print: () => undefined }, launch.recipe);
  try {
    const local = app.localPlayers[0];
    if (local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing initial Q3 input");
    const initial = local.seat.presentation.local.builder;
    const raw = app.simulation.q3Source()?.host.serverState.getUserCommand(local.seat.client.id.slot);
    expect(initial.viewAngles).toEqual(raw === undefined ? { x: 0, y: 0, z: 0 } : {
      x: (raw.angles[0] << 16 >> 16) * (360 / 65536), y: (raw.angles[1] << 16 >> 16) * (360 / 65536), z: (raw.angles[2] << 16 >> 16) * (360 / 65536) });
    app.input({ kind: "mouse-motion", seat: local.seat.id, position: { x: 0, y: 0 }, delta: { x: 137, y: 83 }, timeMilliseconds: performance.now() });
    await app.step(50);
    const accepted = app.simulation.q3Source()?.host.serverState.getUserCommand(local.seat.client.id.slot);
    if (accepted === undefined) throw new Error("Missing accepted nonzero command");
    expect(accepted.angles[1]).not.toBe(0);
    for (let frame = 0; frame < 100 && (app.simulation.players().length !== 6
      || app.simulation.q3Source()?.pool.clients.filter(client => client.pers.connected === ConnectionState.CONNECTED).length !== 6); frame++) await app.step(100);
    expect(app.simulation.players()).toHaveLength(6);
    expect(app.simulation.q3Source()?.pool.clients.filter(client => client.pers.connected === ConnectionState.CONNECTED)).toHaveLength(6);
    const file = join(root, "raw-angles.sav"); await app.saveGame(file);
    app.input({ kind: "mouse-motion", seat: local.seat.id, position: { x: 0, y: 0 }, delta: { x: -81, y: 17 }, timeMilliseconds: performance.now() });
    await app.step(50); await app.loadGame(file);
    const restored = app.localPlayers[0];
    if (restored === undefined || !(restored.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing restored Q3 input");
    const source = app.simulation.q3Source(); if (source === null) throw new Error("Missing restored source");
    const builder = restored.seat.presentation.local.builder;
    expect(source.host.serverState.getUserCommand(restored.seat.client.id.slot)?.angles).toEqual(accepted.angles);
    expect(builder.viewAngles).toEqual({ x: (accepted.angles[0] << 16 >> 16) * (360 / 65536),
      y: (accepted.angles[1] << 16 >> 16) * (360 / 65536), z: (accepted.angles[2] << 16 >> 16) * (360 / 65536) });
    await app.step(50);
    const state = source.pool.clientAt(restored.seat.client.id.slot).ps;
    const expectedYaw = ((accepted.angles[1] + state.deltaAngles.y) & 65535) * (360 / 65536);
    expect(Math.abs(((state.viewangles.y - expectedYaw + 540) % 360) - 180)).toBeLessThan(0.02);
    const delta = state.deltaAngles.x;
    restored.seat.presentation.local.console.field.setText("/centerview"); restored.seat.presentation.local.console.submit();
    await app.step(50);
    expect(builder.viewAngles.x === -(delta << 16 >> 16) * (360 / 65536)).toBe(true);
    expect(Math.abs(state.viewangles.x)).toBeLessThan(0.02);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}, 120000);
