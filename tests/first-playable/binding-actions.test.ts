import { expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Application } from '../../src/app/bootstrap/application.ts';
import { ApplicationInput } from '../../src/app/bootstrap/input.ts';
import { ApplicationSeatUi } from '../../src/app/bootstrap/ui.ts';
import { parseApplicationCommand } from '../../src/app/bootstrap/options.ts';
import { StartupSelectionModel } from '../../src/app/bootstrap/startup-selection.ts';
import { discoverInstalledContent } from '../../src/content/catalog/index.ts';
import { sharedBindingActions } from '../../src/ui/settings/action-catalog.ts';
import { Q2Ballistics } from "../../src/content/q2/foundation/weapons/ballistics.ts";
import type { PhysicalInput, SeatInputEvent } from '../../src/contracts/ui.ts';

test('binding editor captures shared offhand and primary actions and restores the seat bindings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quake-binding-actions-'));
  const attached: { input: ApplicationInput; ui: ApplicationSeatUi }[] = [];
  const attach = ApplicationInput.prototype.attachUi;
  const observer = spyOn(ApplicationInput.prototype, 'attachUi').mockImplementation(function(this: ApplicationInput, seat, ui) {
    if (ui instanceof ApplicationSeatUi) attached.push({ input: this, ui });
    return attach.call(this, seat, ui);
  });
  const blaster = spyOn(Q2Ballistics.prototype, "fireBlaster"), thrown = spyOn(Q2Ballistics.prototype, "fireHandGrenade");
  let application: Application | null = null;
  try {
    const parsed = parseApplicationCommand(['--menu', '--hidden', '--renderer', 'cpu', '--width', '320', '--height', '240', '--seats', '2', '--user-content-root', root]);
    if (parsed.kind !== 'menu') throw new Error('Missing startup');
    const model = new StartupSelectionModel(await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false }), parsed.options);
    await model.prepareMaps(); model.select('product', 'q2-classic-baseq2'); model.select('map', 'maps/base1.bsp');
    model.select('movement', 'q1-quakeworld'); model.select('character', 'q2-classic-baseq2'); model.select('weapons', 'q2-rerelease-baseq2');
    model.select('grapple', 'q2-classic-lmctf/offhand'); model.select('grenades', 'q2-classic-baseq2');
    const launch = await model.resolve();
    const prints: string[] = [];
    application = await Application.open(launch.options, { print: text => { prints.push(text); } }, launch.recipe);
    const opened = attached[0]; if (opened === undefined) throw new Error('Missing binding UI');
    const { input, ui } = opened, local = ui.local, seat = local.player.seat.id;
    const other = input.locals[1]; if (other === undefined) throw new Error('Missing second seat');
    const event = (value: SeatInputEvent): void => { application?.input(value); };
    const key = (code: number, down: boolean): void => event({ kind: 'key', seat, timeMilliseconds: input.now(), code, down, repeat: false });
    const click = (x: number, y: number): void => {
      event({ kind: 'mouse-motion', seat, timeMilliseconds: input.now(), position: { x, y }, delta: { x: 0, y: 0 } });
      event({ kind: 'mouse-button', seat, timeMilliseconds: input.now(), button: 1, down: true });
      event({ kind: 'mouse-button', seat, timeMilliseconds: input.now(), button: 1, down: false });
    };
    const actions = () => sharedBindingActions(local.builder.dialect, application?.simulation.playerUi(local.player.actor).items ?? [], input.bindingCapabilities);
    const row = (id: string): number => {
      const index = actions().findIndex(action => action.id === id); if (index < 0) throw new Error(`Unavailable action ${id}`);
      ui.controller.closeAll(); ui.controller.openMenu('menu:bindings:0');
      for (let page = 0; page < Math.floor(index / 9); page++) click(400, 386);
      return index % 9;
    };
    const capture = (id: string, physical: PhysicalInput): void => {
      click(200, 106 + row(id) * 28); expect(ui.controller.bindingCapture).toBe(true);
      if (physical.kind === 'key') { key(physical.code, true); key(physical.code, false); }
      else if (physical.kind === 'mouse-button') {
        event({ kind: 'mouse-button', seat, timeMilliseconds: input.now(), button: physical.button, down: true });
        event({ kind: 'mouse-button', seat, timeMilliseconds: input.now(), button: physical.button, down: false });
      } else if (physical.kind === 'controller-button') {
        event({ kind: 'controller-button', seat, timeMilliseconds: input.now(), device: physical.device, button: physical.button, down: true });
        event({ kind: 'controller-button', seat, timeMilliseconds: input.now(), device: physical.device, button: physical.button, down: false });
      }
      expect(ui.controller.bindingCapture).toBe(false);
    };
    capture('attack', { kind: 'mouse-button', button: 1 });
    capture('grenade', { kind: 'key', code: 103 });
    capture('grapple', { kind: 'controller-button', device: 0, button: 3 });
    expect(local.input.binding({ kind: 'key', code: 103 })).toEqual({ kind: 'command', text: '+grenade' });
    expect(local.input.binding({ kind: 'controller-button', device: 0, button: 3 })).toEqual({ kind: 'command', text: '+grapple' });
    capture('forward', { kind: 'key', code: 122 });
    click(550, 106 + row('forward') * 28);
    expect(local.input.binding({ kind: 'key', code: 122 })).toBeNull();
    capture('forward', { kind: 'key', code: 119 });
    ui.controller.closeAll();
    event({ kind: 'focus', seat, timeMilliseconds: input.now(), focused: true });
    const grenadeInput = spyOn(application.simulation, "setHandGrenadeInput");
    const primary = application.simulation.playerUi(local.player.actor).activeWeapon;
    local.builder.setViewAngles({ x: -30, y: 90, z: 0 });
    event({ kind: 'controller-button', seat, timeMilliseconds: input.now(), device: 0, button: 3, down: true });
    await application.step(100); await application.step(100);
    expect(application.simulation.grappleState(local.player.actor)?.hook).not.toBeNull();
    expect(application.simulation.playerUi(local.player.actor).activeWeapon).toBe(primary);
    ui.controller.openMenu('menu:bindings:0'); await application.step(100); await application.step(100);
    expect(application.simulation.grappleState(local.player.actor)?.hook).toBeNull();
    ui.controller.closeAll();
    key(103, true);
    event({ kind: 'mouse-button', seat, timeMilliseconds: input.now(), button: 1, down: true });
    for (let frame = 0; frame < 14; frame++) await application.step(100);
    expect(application.simulation.handGrenadeState(local.player.actor)?.action.kind).toBe('cooking');
    expect(application.simulation.handGrenadeState(other.player.actor)?.action.kind).toBe('idle');
    expect(application.simulation.playerUi(local.player.actor).activeWeapon).toBe(primary);
    expect(local.input.button('attack').active).toBe(true);
    expect(blaster.mock.calls.some(call => call[0].actor.id.equals(local.player.actor))).toBe(true);
    key(103, false); await application.step(100); await application.step(100); await application.step(100);
    expect(grenadeInput.mock.calls.map(call => call[1])).toEqual([true, false]);
    expect(application.simulation.handGrenadeState(local.player.actor)?.action.kind).not.toBe('cooking');
    expect(thrown.mock.calls.some(call => call[0].equals(local.player.actor) && !call[2].held)).toBe(true);
    event({ kind: 'mouse-button', seat, timeMilliseconds: input.now(), button: 1, down: false });
    expect(prints.some(text => text.includes('does not match movement'))).toBe(false);
    await application.close(); application = null;
    attached.length = 0;
    application = await Application.open(launch.options, { print: () => undefined }, launch.recipe);
    const restored = attached[0]?.ui.local; if (restored === undefined) throw new Error('Missing restored bindings');
    expect(restored.input.binding({ kind: 'key', code: 103 })).toEqual({ kind: 'command', text: '+grenade' });
    expect(restored.input.bindings.some(binding => binding.input.kind === 'controller-button' && binding.input.button === 3 && binding.target.kind === 'command' && binding.target.text === '+grapple')).toBe(true);
  } finally { try { await application?.close(); } finally { observer.mockRestore(); blaster.mockRestore(); thrown.mockRestore(); await rm(root, { recursive: true, force: true }); } }
}, 120000);
