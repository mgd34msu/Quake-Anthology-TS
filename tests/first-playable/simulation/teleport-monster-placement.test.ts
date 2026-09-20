import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { discoverInstalledContent, presetChoice, resolveLaunch } from '../../../src/content/catalog/index.ts';
import { applicationPreset } from '../../../src/app/bootstrap/content.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { defaultMonsterRoster } from '../../../src/content/catalog/monsters.ts';
import type { ProviderReference } from '../../../src/contracts/content.ts';
import { simulationProviderCheckpoint } from '../../../src/app/bootstrap/simulation/save.ts';
import { readSelectedMonstersCheckpoint } from '../../../src/app/bootstrap/simulation/monster-checkpoint.ts';
import { decodeCheckpointValue, SaveReader } from '../../../src/persistence/value.ts';
import { providerTiming } from '../../../src/app/bootstrap/simulation/players.ts';
const corpus = resolve(import.meta.dir, '../../../../qfiles');
for (const edition of ['classic', 'rerelease'])
    test.skipIf(!existsSync(join(corpus, 'q1/rerelease/id1/pak0.pak')) || !existsSync(join(corpus, edition === 'classic' ? 'q2/baseq2/pak0.pak' : 'q2/rerelease/baseq2/pak0.pak')))(`Q1 rerelease transition preserves staged Q2 ${edition} monsters across save then authored teleport activation`, async () => {
        const temp = await mkdtemp(join(tmpdir(), 'teleport-stage-'));
        let app: Application | null = null;
        try {
            const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
            const command = parseApplicationCommand(['--content-root', corpus, '--user-content-root', join(temp, 'content'), '--game', 'q1-rerelease-id1', '--map', 'e1m1', '--movement', 'q2', '--character', 'q2', '--skill', '2', '--renderer', 'cpu', '--render-worker', '0', '--hidden', '--width', '320', '--height', '240', '--mode', 'singleplayer']);
            if (command.kind !== 'run')
                throw Error('Expected game launch');
            const preset = applicationPreset(catalog, command.options);
            const reference: ProviderReference = edition === 'classic' ? { provider: 'q2:monsters/classic/baseq2', content: catalog.require('q2-classic-baseq2').id } : { provider: 'q2:monsters/rerelease/baseq2', content: catalog.require('q2-rerelease-baseq2').id };
            const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: 'selected', value: defaultMonsterRoster('q1', reference) } } });
            app = await Application.open(command.options, { saveDirectory: temp, print: text => { process.stdout.write(text); return undefined; } }, recipe);
            await app.step(100);
            await app.changeLevel('e1m2');
            for (let frame = 0; frame < 10; frame++)
                await app.step(100);
            const selected = () => { if (app === null)
                throw Error('Application closed'); return readSelectedMonstersCheckpoint(new SaveReader(decodeCheckpointValue(simulationProviderCheckpoint(app.simulation.checkpoint(), 'world:simulation').bytes)).field('selectedMonsters')); };
            const staged = selected().authored.filter(e => e.placement.kind === 'teleport');
            console.log('STAGED', staged.map(e => ({ ordinal: e.sourceOrdinal, placement: e.placement })));
            expect(staged.map(e => e.sourceOrdinal)).toEqual([507, 508]);
            const path = join(temp, 'staged.sav');
            await app.saveGame(path);
            await app.loadGame(path);
            expect(selected().authored.filter(e => e.placement.kind === 'teleport').map(e => e.sourceOrdinal)).toEqual([507, 508]);
            const sim = app.simulation;
            const start = selected().authored.find(e => e.sourceOrdinal === 474);
            if (!start)
                throw Error('Missing preceding encounter monster');
            const actor = sim.actors.referenceSaved(start.actor, 'current');
            const body = sim.bodies.read(actor);
            if (!body)
                throw Error('Missing preceding monster body');
            sim.combat.apply({ target: actor, amount: 10000, knockback: 0, direction: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, point: body.origin, delivery: 'direct', attack: { sequence: 9001, time: { kind: 'seconds', value: sim.timeSeconds }, attacker: null, inflictor: null, weapon: null, weaponProvider: 'q1:official', combatProvider: recipe.combat.provider, inventoryProvider: recipe.inventory.provider, movementProvider: recipe.movement.provider, cause: { kind: 'q1', deathType: '' } } });
            for (let frame = 0; frame < 3; frame++)
                await app.step(100);
            for (const ordinal of [507, 508]) {
                const entry = selected().authored.find(e => e.sourceOrdinal === ordinal);
                if (!entry)
                    throw Error('Lost staged monster');
                const actor = sim.actors.referenceSaved(entry.actor, 'current'), body = sim.bodies.read(actor);
                if (!body)
                    throw Error('Missing staged monster body');
                console.log('ACTIVATED', ordinal, entry.placement, body.origin, sim.combat.read(actor)?.health);
                expect(entry.placement.kind).toBe('ready');
                expect(body.origin.y).toBeLessThan(300);
                expect(sim.combat.read(actor)?.health).toBeGreaterThan(0);
                const fit = sim.scene.geometryTrace({ start: body.origin, end: body.origin, shape: { kind: 'box', bounds: body.bounds }, target: { kind: 'world' }, passActor: actor, numeric: providerTiming(recipe, reference.provider).numeric, policy: { kind: 'q2', contentsMask: 1, leafContents: 'merged' } });
                expect(fit.startSolid).toBe(false);
                expect(fit.allSolid).toBe(false);
            }
        }
        finally {
            await app?.close();
            await rm(temp, { recursive: true, force: true });
        }
    }, 120000);
