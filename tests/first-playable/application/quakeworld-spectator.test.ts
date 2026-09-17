import { BinaryReader } from "../../../src/core/binary/index.ts";
import { expect, spyOn, test } from 'bun:test';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { loadApplicationContent } from '../../../src/app/bootstrap/content.ts';
import { createSimulation } from '../../../src/app/bootstrap/simulation/index.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { decodeCheckpointValue, SaveReader } from '../../../src/persistence/value.ts';

test('actual QW source dispatches spectator callbacks without player begin or think', async () => {
  const launch = parseApplicationCommand(['--game', 'q1-quakeworld', '--map', 'e1m1', '--movement', 'q1', '--character', 'q1', '--dedicated', '--mode', 'deathmatch']);
  if (launch.kind !== 'run') throw new Error('Missing QW launch');
  const content = await loadApplicationContent(launch.options), identity = createIdentityOwner('qw-spectator-source');
  try {
    if (content.preparedQuakeC === null) throw new Error('Missing actual QW program');
    const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
      preparedQuakeC: content.preparedQuakeC, dedicated: true, skill: 1, mode: 'deathmatch', seed: 1, maxClients: 8 });
    try {
      const source = simulation.quakecSource(); if (source === null) throw new Error('Missing QW source');
      const client = identity.client(2, 0);
      source.setClientRole(client, 'spectator'); source.setClientInfo(client, new Map([['name', 'Observer']]));
      source.prepareClientSpawn(client);
      const execute = spyOn(source.machine, 'execute');
      try {
        const actor = source.admitClient(client);
        const callbacks = () => execute.mock.calls.map(call => call[0]);
        expect(source.isSpectatorClient(actor.id)).toBe(true);
        expect(callbacks()).not.toContain(source.prepared.program.functionNamed('ClientConnect').index);
        expect(callbacks()).not.toContain(source.prepared.program.functionNamed('PutClientInServer').index);
        const spectatorConnect = source.prepared.program.functionsByName.get('SpectatorConnect');
        if (spectatorConnect !== undefined) expect(callbacks()).toContain(spectatorConnect.index);
        expect(() => source.setClientRole(client, 'player')).toThrow('before begin');
        const before = execute.mock.calls.length;
        source.clientPreThink(actor); source.clientPostThink(actor);
        expect(callbacks().slice(before)).not.toContain(source.prepared.program.functionNamed('PlayerPreThink').index);
        expect(callbacks().slice(before)).not.toContain(source.prepared.program.functionNamed('PlayerPostThink').index);
        const think = source.prepared.program.functionsByName.get('SpectatorThink');
        if (think !== undefined) expect(callbacks().slice(before)).toContain(think.index);
        expect(source.clientKill(actor.id)).toBe(false);
        const travel = source.captureTravel(); expect(travel.clients[0]?.role).toBe('spectator');
        const envelope = new BinaryReader(source.checkpoint().hostState.bytes);
        expect(envelope.u32()).toBe(0x31484351); envelope.u32(); envelope.bytes(envelope.u32() * 4);
        envelope.bytes(envelope.u32());
        const host = new SaveReader(decodeCheckpointValue(envelope.bytes(envelope.u32())));
        expect(host.field('spectatorSlots').value).toEqual([3]);
        const disconnect = execute.mock.calls.length;
        source.disconnectClient(actor);
        expect(callbacks().slice(disconnect)).not.toContain(source.prepared.program.functionNamed('ClientDisconnect').index);
        const spectatorDisconnect = source.prepared.program.functionsByName.get('SpectatorDisconnect');
        if (spectatorDisconnect !== undefined) expect(callbacks().slice(disconnect)).toContain(spectatorDisconnect.index);
        expect(source.isSpectatorClient(actor.id)).toBe(false);
      } finally { execute.mockRestore(); }
    } finally { simulation.close(); }
  } finally { await content.close(); }
});
