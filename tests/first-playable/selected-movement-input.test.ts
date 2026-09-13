import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverInstalledContent } from '../../src/content/catalog/index.ts';
import { StartupSelectionModel } from '../../src/app/bootstrap/startup-selection.ts';
import { parseApplicationCommand } from '../../src/app/bootstrap/options.ts';
import { Application } from '../../src/app/bootstrap/application.ts';

test('startup-selected QuakeWorld movement drives the normal mixed-game application', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quake-selected-input-'));
    const parsed = parseApplicationCommand(['--menu', '--hidden', '--renderer', 'gl', '--user-content-root', root]);
    if (parsed.kind !== 'menu') throw new Error('No startup options');
    const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false });
    const model = new StartupSelectionModel(catalog, parsed.options);
    let app: Application | null = null;
    try {
        await model.prepareMaps();
        model.select('product', 'q2-classic-baseq2'); model.select('map', 'maps/base1.bsp');
        model.select('movement', 'q1-quakeworld'); model.select('character', 'q3-baseq3'); model.select('model', 'visor');
        model.select('weapons', 'q2-rerelease-baseq2'); model.select('grapple', 'q2-classic-lmctf/offhand'); model.select('grenades', 'q2-classic-baseq2');
        await model.prepareMonsterRoster(); model.select('enemies', 'custom');
        const q1Monster = model.monsterRosterRows()[0]?.choices.find(choice => choice.id.startsWith('q1:') && choice.id.endsWith('/monster_army') && choice.unavailable === null);
        if (q1Monster === undefined) throw new Error('No installed Q1 roster choice');
        model.selectMonster(null, q1Monster.id);
        const launch = await model.resolve();
        const prints: string[] = [];
        app = await Application.open(launch.options, { print: text => { prints.push(text); } }, launch.recipe);
        const player = app.localPlayers[0], window = app.window;
        if (player === undefined || window === null) throw new Error('No normal graphical player');
        expect(app.simulation.movementPlayer(player.actor)?.state.kind).toBe('q1-quakeworld');
        window.pushEvent({ kind: 'window', timestamp: 0, event: 12, data1: 0, data2: 0 });
        window.pushEvent({ kind: 'key', timestamp: 0, down: true, repeat: false, scancode: 26, keycode: 119, modifiers: 0 });
        const origin = app.simulation.playerView(player.actor).origin;
        for (let frame = 0; frame < 8; frame++) await app.step(25);
        const moved = app.simulation.playerView(player.actor).origin;
        expect(Math.hypot(moved.x - origin.x, moved.y - origin.y)).toBeGreaterThan(0);
        expect(prints.some(text => text.includes('does not match movement'))).toBe(false);
        window.pushEvent({ kind: 'key', timestamp: 0, down: false, repeat: false, scancode: 26, keycode: 119, modifiers: 0 });
        await app.step(25);
    } finally { try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } }
}, 60000);
