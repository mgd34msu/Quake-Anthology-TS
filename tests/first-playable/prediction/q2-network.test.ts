import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRemoteContent } from "../../../src/app/bootstrap/content.ts";
import type { RemoteContentMounts } from "../../../src/app/bootstrap/content.ts";
import { remoteContentSelection } from "../../../src/content/catalog/index.ts";
import { expect, test } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { Q2ClientNetwork, Q2RemotePresentation } from "../../../src/app/bootstrap/network/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { UdpTransport } from "../../../src/network/common/transport.ts";
import { EngineSession } from "../../../src/world/session/session.ts";

test("native Q2 predicts sent moves before server execution and reconciles using channel acknowledgements", async () => {
  const userRoot = await mkdtemp(join(tmpdir(), "q2-prediction-content-"));
  const launch = parseApplicationCommand(["--user-content-root", userRoot, "--game", "q2-classic-baseq2", "--movement", "q2", "--character", "q2",
    "--dedicated", "--mode", "coop", "--listen-q2", "0", "--bind", "127.0.0.1"]);
  if (launch.kind !== "run") throw new Error("Expected launch");
  const server = await Application.open(launch.options, { print: () => undefined }), content = await loadApplicationContent(launch.options);
  const identity = createIdentityOwner("native-q2-prediction"), session = new EngineSession(identity, { kind: "headless" });
  const transport = await UdpTransport.bind({ host: "127.0.0.1", port: 0 }), address = server.networkAddress;
  if (address === null) throw new Error("No UDP server");
  let client: Q2ClientNetwork<typeof address> | null = null;
  const downloadOwners: RemoteContentMounts[] = [];
  const prepareServerData = async (data: { readonly gamedir: string }, assertCurrent: () => void): Promise<RemoteContentMounts> => {
      const owner = await openRemoteContent(launch.options, remoteContentSelection('q2-classic-baseq2', data.gamedir), assertCurrent);
      downloadOwners.push(owner); return owner;
  };
  const remote = new Q2RemotePresentation({ identity, session, content, prepareServerData, protocol: { kind: "q2-classic", version: 34 },
    userinfo: () => "\\name\\Prediction Player\\skin\\male/grunt", print: () => undefined,
    sendCommand: text => { if (client === null) throw new Error("No client"); client.command(text); } });
  client = new Q2ClientNetwork({ transport, remote: address, host: remote, qport: 4319 });
  const sent: number[] = [], acknowledged: number[] = [];
  const sentMove = remote.prediction.sent, acknowledge = remote.prediction.acknowledged;
  remote.prediction.sent = (sequence, command, now) => { sent.push(sequence); sentMove(sequence, command, now); };
  remote.prediction.acknowledged = (sequence, now) => { acknowledged.push(sequence); acknowledge(sequence, now); };
  let now = 0;
  const exchange = async (): Promise<void> => {
    now += 100; await client?.poll(now); await Bun.sleep(1); await server.step(100); await Bun.sleep(1); await client?.poll(now);
  };
  try {
    for (let attempt = 0; attempt < 80 && remote.output === null; attempt++) await exchange();
    // Advance keepalive packets without advancing authoritative server frames.
    for (let packet = 0; packet < 5; packet++) { now += 1100; await client.poll(now); }
    const player = remote.player, admitted = server.networkClients[0];
    if (player === null || admitted === undefined) throw new Error("No admitted native player");
    const before = server.simulation.bodies.read(admitted.actor), ui = remote.playerUi(player.actor);
    if (before === null) throw new Error("No authoritative body");
    expect(session.world).toBeNull();
    for (let sequence = 0; sequence < 2; sequence++) {
      now += 50;
      client.submit([{ actor: player.actor, source: { kind: "remote-client", client: player.client }, sequence,
        command: { kind: "q2-classic", milliseconds: 50, angleShorts: [0, 0, 0], forwardMove: 200, sideMove: 0,
          upMove: 0, buttons: 1, impulse: 0, lightLevel: 128 } }], now);
      await client.poll(now);
    }
    const predicted = remote.playerView(player.actor);
    expect(predicted.origin).not.toEqual(before.origin);
    expect(server.simulation.bodies.read(admitted.actor)).toEqual(before);
    expect(remote.playerUi(player.actor)).toEqual(ui);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe((sent[0] ?? 0) + 1);
    await Bun.sleep(1); await server.step(100); await Bun.sleep(1); await client.poll(now);
    const after = server.simulation.bodies.read(admitted.actor);
    if (after === null) throw new Error("No authoritative result");
    expect(acknowledged.at(-1)).toBe(sent.at(-1));
    expect(acknowledged.at(-1)).not.toBe(client.acknowledgedFrame);
    expect(after.origin).toEqual(predicted.origin);
    expect(remote.playerView(player.actor).origin).toEqual(after.origin);
  } finally { for (const owner of downloadOwners) owner.mounts.close(); client.close(); await server.close(); session.close(); await content.close(); await rm(userRoot, { recursive: true, force: true }); }
}, 30000);
