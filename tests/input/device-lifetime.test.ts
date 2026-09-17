import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIdentityOwner } from '../../src/contracts/identity.ts';
import { CommandBuffer } from '../../src/core/commands/index.ts';
import { CvarRegistry } from '../../src/core/cvars/index.ts';
import { SeatInput } from '../../src/input/seat.ts';
import { InputRouter } from '../../src/input/router.ts';
import { KeyCode } from '../../src/input/key-codes.ts';
import type { MidiInputBoundary } from '../../src/input/midi.ts';
import { InputDevices, loadInputDeviceSettings } from '../../src/app/bootstrap/input-devices.ts';
import { ConfigStore } from '../../src/settings/config.ts';

test('retained device owner routes MIDI by seat and releases on reassign, disconnect, focus and router transfer', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'quake-input-devices-'));
 const owner = createIdentityOwner('device-lifetime');
 const inputs = [0, 1].map(index => {
  const seat = owner.seat(index), context = { session: owner.session, origin: { kind: 'local-seat', seat, client: owner.client(0, index) } } satisfies import('../../src/contracts/common.ts').CommandContext;
  const input = new SeatInput({ seat, dialect: 'q3', context, commands: new CommandBuffer({ dialect: 'q3', context }), uiEvent: () => false });
  input.bind({ input: { kind: 'key', code: KeyCode.Aux1 }, target: { kind: 'action', action: 'attack' } });
  return input;
 });
 const first = inputs[0], second = inputs[1];
 if (first === undefined || second === undefined) throw new Error('Missing test seats');
 const router = () => new InputRouter({ seats: inputs.map(input => ({ input, controller: { kind: 'none' } })), controllers: null,
  keyboardSeat: first.seat, deferPlatform: true, now: () => 10, ticks: () => 10, subframe: false, unhandled: () => {} });
 const warnings: string[] = [];
 const cvars = new CvarRegistry({ dialect: 'q1-netquake', context: {session:owner.session,origin:{kind:"local-console"}}, print: text => { warnings.push(text); } }), store = new ConfigStore(directory);
 let opens = 0, closes = 0, disconnected = false;
 const packets: Uint8Array[] = [];
 const boundary: MidiInputBoundary = { list: () => [{ name: 'Fixture MIDI', path: '/fixture' }], open: () => {
  opens++;
  return { read: bytes => { if (disconnected) throw new Error('unplugged'); const packet = packets.shift(); if (packet === undefined) return 0; bytes.set(packet); return packet.length; }, close: () => { closes++; } };
 } };
 const devices = new InputDevices(cvars, store, () => {}, boundary), old = router(), next = router();
 try {
  expect(opens).toBe(0); devices.activate(old); expect(opens).toBe(0);
  cvars.set('in_midi', '1'); packets.push(new Uint8Array([0x90, 60, 127])); devices.frame(10);
  expect(opens).toBe(1); expect(first.button('attack').active).toBe(true); expect(second.button('attack').active).toBe(false);
  cvars.set('in_midiseat', '2'); packets.push(new Uint8Array([0x90, 60, 127])); devices.frame(20);
  expect(first.button('attack').active).toBe(false); expect(second.button('attack').active).toBe(true);
  devices.activate(next); expect(second.button('attack').active).toBe(false); expect(opens).toBe(2);
  packets.push(new Uint8Array([0x90, 60, 127])); devices.frame(30); expect(second.button('attack').active).toBe(true);
  disconnected = true; devices.frame(40); expect(second.button('attack').active).toBe(false);
  disconnected = false; packets.push(new Uint8Array([0x90, 60, 127])); devices.frame(1100); expect(second.button('attack').active).toBe(true);
  second.input({ kind: 'focus', seat: second.seat, focused: false, timeMilliseconds: 1200 });
  packets.push(new Uint8Array([0x90, 60, 127])); devices.frame(1200); expect(second.button('attack').active).toBe(false);
  await devices.save(); const saved = await loadInputDeviceSettings(store);
  expect(saved.find(entry => entry.name === 'in_midiseat')?.value).toBe('2');
  devices.close(); expect(closes).toBe(opens); expect(warnings).toEqual([]);
 } finally { devices.close(); old.close(); next.close(); await rm(directory, { recursive: true, force: true }); }
});

test('hardware declarations retain archive and latch semantics without turning Q2 controls into cheats', async () => {
 const { registerInputDeviceCvars } = await import('../../src/input/device-settings.ts');
 for (const dialect of ['q1-netquake','q1-quakeworld','q2-classic','q2-rerelease','q3'] satisfies readonly import('../../src/contracts/common.ts').CommandDialect[]) {
  const owner=createIdentityOwner(`hardware-${dialect}`);
  const warnings:string[]=[]; const cvars=new CvarRegistry({dialect,context:{session:owner.session,origin:{kind:"local-console"}},cheatsAllowed:()=>false,print:text=>{warnings.push(text);}});
  registerInputDeviceCvars(cvars);registerInputDeviceCvars(cvars);
  expect(warnings).toEqual([]);cvars.set('in_joystick','1');cvars.applyLatched('in_joystick');
  expect(cvars.variableString('in_joystick')).toBe('1');
  expect(cvars.archiveEntries().some(entry=>entry.name==='in_joystick')).toBe(true);
 }
});
