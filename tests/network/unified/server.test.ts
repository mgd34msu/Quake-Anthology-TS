import { expect, test } from 'bun:test';
import type { ExecutableRecipe, ProviderReference, ResolvedResourceReference } from '../../../src/contracts/content.ts';
import { createContentDigest, createResourceId } from '../../../src/contracts/content.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { LoopbackHub } from '../../../src/network/common/loopback.ts';
import { UnifiedChannel } from '../../../src/network/unified/channel.ts';
import { decodeUnifiedPacket } from '../../../src/network/unified/packet.ts';
import { createUnifiedComposition } from '../../../src/app/bootstrap/network/unified-content.ts';
import { UnifiedServerNetwork } from '../../../src/app/bootstrap/network/unified-server.ts';
import { encodeUnifiedHandshake, decodeUnifiedHandshake, encodeUnifiedControl, encodeUnifiedInputs } from '../../../src/app/bootstrap/network/unified-control.ts';
import type { UnifiedApplicationServerHost } from '../../../src/app/bootstrap/simulation/network-unified.ts';
function recipe(): ExecutableRecipe {
  const content = "q1:classic:id1:fixture";
  const provider = (role: string): ProviderReference => ({ provider: `q1:${role}`, content });
  const raw: Omit<ResolvedResourceReference, "id"> = { requestedPath: "maps/start.bsp", provenance: { kind: "loose", memberPath: "maps/start.bsp", mount: { kind: "loose", identity: { id: "mount:q1:fixture", content, generation: 2 }, rootPath: "/fixture" } },
    digest: createContentDigest("0".repeat(64)), byteLength: 123, resolution: { kind: "default-order", plan: "mount-plan:fixture:1", rank: 0 } };
  const geometry = { ...raw, id: createResourceId(raw) };
  return { schemaVersion: 3, id: "recipe:fixture:1", preset: "recipe:fixture:1", map: { geometryContent: content, geometry, entities: provider("game") }, campaign: { kind: "campaign", mission: provider("mission"), gamecode: provider("game") },
    movement: provider("movement"), character: { definition: provider("character"), appearance: provider("appearance") }, weapons: [provider("weapons")], equipment: { grapple: { kind: "disabled" }, handGrenades: { kind: "disabled" } }, enemies: { kind: "map-defined" },
    presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: content, hud: provider("hud"), effects: provider("effects"), audio: provider("audio") }, engineBehavior: provider("engine"), combat: provider("combat"), inventory: provider("inventory"), match: provider("match"), transition: provider("transition"),
    execution: [{ kind: "typescript", owner: provider("game"), implementation: "q1:official", role: "server-game", api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } }],
    mounts: { id: "mount-plan:fixture:1", mounts: [raw.provenance.mount], defaultOrder: [raw.provenance.mount.identity.id], prefixOrders: [] }, resources: [geometry], timing: [],
    ordering: { kind: "native", traversal: "source-slot-order", clock: { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: null } } };
}

async function fixture(command: () => void = () => {}) {
  const hub = new LoopbackHub(), transport = hub.bind('server'), socket = hub.bind('client');
  const identity = createIdentityOwner('unified-server'), player = { client: identity.client(0, 0), actor: identity.actor(1, 0), sourceEntity: 1 };
  const selected = recipe(), composition = createUnifiedComposition(selected);
  let disconnected = 0;
  const host: UnifiedApplicationServerHost = { recipe: selected, maxClients: 2, mode: 'deathmatch',
    admit: () => ({ kind: 'accepted', player }), carriedPlayer: () => player, disconnect: () => { disconnected++; }, userinfo: () => {}, command,
    input: (_player, sequence, command, arsenal) => ({ actor: player.actor, source: { kind: 'remote-client', client: player.client }, sequence, command, ...(arsenal === undefined ? {} : { arsenal }) }),
    frame: () => { throw new Error('No frame requested in input boundary test'); }, resources: () => [], presentationEvents: (_player, events) => events, initialPresentation: () => [] };
  const server = new UnifiedServerNetwork({ transport, host, composition, print: () => {} });
  socket.send(transport.address, encodeUnifiedHandshake({ kind: 'hello', nonce: '1'.repeat(32) })); await server.poll(0);
  const response = socket.poll(); if (response?.kind !== 'packet') throw new Error('Missing challenge');
  const challenge = decodeUnifiedHandshake(response.payload); if (challenge?.kind !== 'challenge') throw new Error('Wrong challenge');
  socket.send(transport.address, encodeUnifiedHandshake({ kind: 'connect', nonce: challenge.nonce, token: challenge.token })); await server.poll(1);
  const channel = new UnifiedChannel(challenge.token);
  const receive = (now: number): void => { for (;;) { const packet = socket.poll(); if (packet === null) break; if (packet.kind === 'packet') channel.receive(packet.payload, now); } };
  receive(1); channel.queueReliable(encodeUnifiedControl({ kind: 'ready', epoch: 1, composition: composition.digest, userinfo: '\\name\\Fixture' }));
  for (let now = 2; now < 6; now++) { for (const bytes of channel.flush(now)) socket.send(transport.address, bytes); await server.poll(now); receive(now); }
  expect(server.clients.length).toBe(1);
  return { hub, socket, transport, server, channel, disconnected: () => disconnected };
}

test('later same-poll disconnect removes inputs already queued for the authoritative actor', async () => {
  const f = await fixture();
  try {
    f.channel.queueFrame(encodeUnifiedInputs({ epoch: 1, commands: [{ sequence: 7, command: { kind: 'q1-netquake', acknowledgedServerTimeSeconds: 0, viewAngles: { x: 0, y: 0, z: 0 }, forwardMove: 200, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 } }] }), 1);
    f.channel.queueReliable(encodeUnifiedControl({ kind: 'disconnect', reason: 'fixture done' }));
    const packets = f.channel.flush(10);
    for (const bytes of packets.filter(bytes => decodeUnifiedPacket(bytes)?.kind === 'frame')) f.socket.send(f.transport.address, bytes);
    for (const bytes of packets.filter(bytes => decodeUnifiedPacket(bytes)?.kind !== 'frame')) f.socket.send(f.transport.address, bytes);
    expect(await f.server.poll(10)).toEqual([]);
    expect(f.disconnected()).toBe(1); expect(f.server.clients).toEqual([]); expect(f.server.phase).toBe('active');
  } finally { f.server.close(); f.hub.close(); }
});

test('authoritative command failures retain their original cause instead of becoming packet rejection', async () => {
  const failure = new Error('source command failed'), f = await fixture(() => { throw failure; });
  try {
    f.channel.queueReliable(encodeUnifiedControl({ kind: 'command', epoch: 1, name: 'source_command', args: [] }));
    for (const bytes of f.channel.flush(10)) f.socket.send(f.transport.address, bytes);
    await expect(f.server.poll(10)).rejects.toBe(failure);
  } finally { f.server.close(); f.hub.close(); }
});

test('malformed authenticated input drops only that peer and leaves the authority running', async () => {
  const f = await fixture();
  try {
    f.channel.queueFrame(Uint8Array.of(255, 0, 17), 1);
    for (const bytes of f.channel.flush(10)) f.socket.send(f.transport.address, bytes);
    expect(await f.server.poll(10)).toEqual([]);
    expect(f.disconnected()).toBe(1); expect(f.server.phase).toBe('active');
  } finally { f.server.close(); f.hub.close(); }
});

test('NetQuake input bursts apply only the newest command for one server frame', async () => {
  const f = await fixture();
  try {
    f.channel.queueFrame(encodeUnifiedInputs({ epoch: 1, commands: [7, 8, 9].map(sequence => ({ sequence,
      command: { kind: 'q1-netquake', acknowledgedServerTimeSeconds: 0, viewAngles: { x: 0, y: sequence, z: 0 }, forwardMove: 200, sideMove: 0, upMove: 0, buttons: 0, impulse: sequence === 7 ? 9 : 0 } })) }), 1);
    for (const bytes of f.channel.flush(10)) f.socket.send(f.transport.address, bytes);
    const commands = await f.server.poll(10);
    expect(commands.map(command => command.sequence)).toEqual([9]);
    const command = commands[0]?.command;
    if (command?.kind !== 'q1-netquake') throw new Error('Expected NetQuake command');
    expect(command.impulse).toBe(9); expect(command.viewAngles.y).toBe(9);
  } finally { f.server.close(); f.hub.close(); }
});
