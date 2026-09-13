import { expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { loadApplicationContent } from '../../../src/app/bootstrap/content.ts';
import { createSimulation } from '../../../src/app/bootstrap/simulation/index.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import type { QwUserCommand } from '../../../src/contracts/protocol.ts';
import type { DamageOutcome } from '../../../src/contracts/gameplay.ts';

test('native QW artifact reserves, spawns and begins clients then groups recovered commands in shared authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qw-source-'));
  try {
  const launch = parseApplicationCommand(['--game', 'q1-quakeworld', '--map', 'e1m1', '--movement', 'q1', '--character', 'q1', '--dedicated', '--mode', 'deathmatch', '--user-content-root', root]);
  if (launch.kind !== 'run') throw new Error('Missing QW options');
  const content = await loadApplicationContent(launch.options), identity = createIdentityOwner('native-qw-source');
  try {
  if (content.preparedQuakeC === null) throw new Error('Missing prepared QW artifact');
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, preparedQuakeC: content.preparedQuakeC,
    dedicated: true, skill: 1, mode: 'deathmatch', seed: 1, maxClients: 8 });
  try {
    const source = simulation.quakecSource(); if (source === null) throw new Error('Missing native QW source');
    expect(source.prepared.program.digest).toBe('sha256:ff51cb5e77360d72b93487d89198dcf94629b92f8bae100fc6ea48a6c12a7830');
    expect(source.kind).toBe('quakeworld'); expect(simulation.q1Source()).toBeNull();
    expect(source.reservedClientSlots).toBe(32); expect(source.entities.capacity).toBe(768);
    const client = identity.client(3, 0), pending = identity.client(4, 0);
    const field = (name: string): number => { const definition = source.prepared.program.fieldsByName.get(name); if (definition === undefined) throw new Error(`Missing ${name}`); return definition.offset; };
    source.setClientInfo(client, new Map([['name', 'Before'], ['team', 'red']]));
    const reserved = source.reservedClient(client), words = source.entities.at(4);
    expect(source.isActiveClient(reserved.id)).toBe(false); expect(words.float(field('health'))).toBe(0); expect(simulation.players()).toHaveLength(0);
    source.prepareClientSpawn(client); words.setFloat(field('health'), 123); source.prepareClientSpawn(client); expect(words.float(field('health'))).toBe(0);
    source.setClientInfo(client, new Map([['name', 'After'], ['team', 'red']]));
    expect(source.machine.strings.get(words.int(field('netname')))).toBe('After');
    source.setClientInfo(pending, new Map([['name', 'Pending']])); source.disconnectClient(source.reservedClient(pending));
    source.setClientInfo(pending, new Map([['name', 'Replacement']])); source.prepareClientSpawn(pending);
    expect(source.machine.strings.get(source.entities.at(5).int(field('netname')))).toBe('Replacement');
    const admitted = simulation.admitPlayer(client); expect(admitted.actor.equals(reserved.id)).toBe(true);
    expect(words.float(field('health'))).toBe(100); expect(source.isActiveClient(admitted.actor)).toBe(true);
    const player = simulation.movementPlayer(admitted.actor); if (player === null) throw new Error('Missing shared QW movement');
    expect(player.profile.kind).toBe('q1-quakeworld');
    const pre = spyOn(source, 'clientPreThink'), post = spyOn(source, 'clientPostThink'), think = spyOn(source, 'runThink'), split = spyOn(source, 'quakeWorldPreThink');
    const worldTurn = spyOn(source, 'beforeActor');
    const command = (milliseconds: number, impulse: number): QwUserCommand => ({ kind: 'q1-quakeworld', milliseconds, angles: { x: 0, y: 90, z: 0 }, forwardMove: 200, sideMove: 0, upMove: 0, buttons: 0, impulse });
    try {
    const initialBody = simulation.bodies.read(admitted.actor); if (initialBody === null) throw new Error('Missing initial player body');
    const initial = { ...initialBody.origin };
    simulation.queueQuakeWorldCommands(client, [command(101, 2), command(20, 0)], 7);
    const groupOutput = simulation.step({ elapsedMilliseconds: 20, commands: [] });
    expect(pre).toHaveBeenCalledTimes(3); expect(post).toHaveBeenCalledTimes(1);
    const worldOrder = worldTurn.mock.invocationCallOrder[0], clientOrder = pre.mock.invocationCallOrder[0];
    if (worldOrder === undefined || clientOrder === undefined) throw new Error('Missing native frame callbacks');
    expect(worldOrder).toBeLessThan(clientOrder);
    expect(split.mock.calls.map(([, command]) => [command.milliseconds, command.impulse])).toEqual([[50, 2], [50, 0], [20, 0]]);
    expect(think.mock.calls.filter(([actor]) => actor.id.equals(admitted.actor))).toHaveLength(3);
    expect(player.lastSequence).toBe(7); expect(words.float(field('impulse'))).toBe(0);
    expect(simulation.bodies.read(admitted.actor)?.origin).not.toEqual(initial);
    expect(source.machine.globals.float(source.machine.globalOffset('newmis'))).toBe(0);
    words.setVector(field('angles'), { x: 0, y: 0, z: 0 }); words.setVector(field('velocity'), { x: 200, y: 0, z: 0 });
    source.quakeWorldPreThink(reserved, command(0, 0), groupOutput.snapshot.frame);
    expect(words.vector(field('angles')).z).toBeCloseTo(8);
    words.setFloat(field('fixangle'), 1); words.setVector(field('angles'), { x: 0, y: 0, z: 0 }); words.setVector(field('velocity'), { x: 0, y: -200, z: 0 });
    source.quakeWorldPreThink(reserved, command(0, 0), groupOutput.snapshot.frame);
    expect(words.vector(field('angles')).y).toBe(0); expect(words.vector(field('angles')).z).toBeCloseTo(8);
    words.setFloat(field('fixangle'), 0);
    } finally { pre.mockRestore(); post.mockRestore(); think.mockRestore(); split.mockRestore(); worldTurn.mockRestore(); }
    expect(source.precacheNames('model')).toContain('progs/player.mdl'); expect(source.precacheNames('sound')).toContain('weapons/guncock.wav');
    const target = simulation.admitPlayer(pending), targetWords = source.entities.at(5);
    targetWords.setVector(field('origin'), { x: 480, y: -240, z: 88 }); targetWords.setVector(field('velocity'), { x: 0, y: 0, z: 0 });
    targetWords.setFloat(field('health'), 250); targetWords.setFloat(field('armorvalue'), 0); targetWords.setFloat(field('armortype'), 0);
    const targetOwned = simulation.actors.resolveOwned(target.actor); if (targetOwned === null) throw new Error('Missing damage target'); simulation.bodies.link(targetOwned);
    words.setVector(field('origin'), { x: 480, y: -352, z: 88 }); words.setVector(field('velocity'), { x: 0, y: 0, z: 0 });
    words.setFloat(field('weapon'), 32); words.setFloat(field('ammo_rockets'), 10); words.setFloat(field('currentammo'), 10); words.setFloat(field('attack_finished'), 0);
    simulation.bodies.link(reserved);
    simulation.queueQuakeWorldCommands(client, [{ ...command(20, 0), buttons: 1 }], 8); simulation.step({ elapsedMilliseconds: 20, commands: [] });
    expect(words.float(field('ammo_rockets'))).toBe(9);
    const rocket = simulation.actors.observations().find(actor => source.classname(actor.id) === 'rocket');
    expect(rocket).toBeDefined();
    if (rocket === undefined) throw new Error('QC rocket did not survive native newmis flight');
    expect(simulation.bodies.read(rocket.id)?.origin.y).toBeGreaterThan(-344);
    expect(source.machine.globals.int(source.machine.globalOffset('newmis'))).toBe(0);
    const damage: DamageOutcome[] = [];
    for (let i = 0; i < 20 && source.sourceSlot(rocket.id) !== null; i++) {
      const output = simulation.step({ elapsedMilliseconds: 20, commands: [] });
      for (const event of output.events) if (event.payload.kind === 'damage') damage.push(event.payload.outcome);
    }
    expect(source.sourceSlot(rocket.id)).toBeNull(); expect(targetWords.float(field('health'))).toBeLessThan(250);
    expect(damage.some(outcome => outcome.kind === 'committed' && outcome.decision.request.attack.weapon === 'q1:weapon/rocketlauncher')).toBe(true);
  } finally { simulation.close(); }
  } finally { await content.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);
