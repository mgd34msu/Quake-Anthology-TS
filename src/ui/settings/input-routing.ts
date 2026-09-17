import type { InputRouter } from '../../input/router.ts';
import type { ControllerDevice, ControllerSelection } from '../../platform/controller.ts';
import type { SettingBinding } from './index.ts';
function selectionKey(selection: ControllerSelection): string {
 switch (selection.kind) {
  case 'automatic': case 'none': return selection.kind;
  case 'serial': return `serial:${selection.guid}:${selection.serial}`;
  case 'device': return `device:${selection.guid}:${selection.ordinal}`;
 }
}
function selection(device: ControllerDevice): ControllerSelection | null {
 if (device.guid === null) return null;
 return device.serial !== null && device.serial.length > 0 ? { kind: 'serial', guid: device.guid, serial: device.serial }
  : { kind: 'device', guid: device.guid, ordinal: device.ordinal };
}
/** Read the currently published router each time: Main survives seat replacement. */
export function bindInputRoutingSettings(router: () => InputRouter, devices: () => readonly ControllerDevice[]): readonly SettingBinding[] {
 let selectedSeat = 0;
 const selected = () => router().inputs.find(input => input.seat.index === selectedSeat) ?? router().inputs[0];
 const seats = () => router().inputs.map(input => ({ id: String(input.seat.index), label: `Player ${input.seat.index + 1}` }));
 return [
  { id: 'ui:input:keyboard-player', label: 'Keyboard and mouse player', category: 'input', kind: 'choice', enabled: () => true,
   read: () => String(router().keyboardSeat()?.index ?? 'none'), choices: () => [...seats(), { id: 'none', label: 'None' }],
   write: value => { const current = router(), input = current.inputs.find(input => String(input.seat.index) === value);
    if (value !== 'none' && input === undefined) throw new Error('Unknown keyboard player'); current.setKeyboardSeat(input?.seat ?? null); current.updateCapture(); } },
  { id: 'ui:input:controller-player', label: 'Assign controller to', category: 'input', kind: 'choice', enabled: () => router().inputs.length > 1,
   read: () => String(selected()?.seat.index ?? 0), choices: seats,
   write: value => { const input = router().inputs.find(input => String(input.seat.index) === value); if (input === undefined) throw new Error('Unknown controller player'); selectedSeat = input.seat.index; } },
  { id: 'ui:input:controller-device', label: 'Controller device', category: 'input', kind: 'choice', enabled: () => selected() !== undefined,
   read: () => { const input = selected(); return input === undefined ? 'none' : selectionKey(router().controllerSelection(input.seat)); },
   choices: () => {
    const choices = [{ id: 'automatic', label: 'Automatic' }, { id: 'none', label: 'None' }];
    for (const device of devices()) { const target = selection(device); if (target !== null) choices.push({ id: selectionKey(target), label: `${device.name} (${device.ordinal + 1})` }); }
    const input = selected(), current = input === undefined ? 'none' : selectionKey(router().controllerSelection(input.seat));
    if (!choices.some(choice => choice.id === current)) choices.push({ id: current, label: 'Saved controller (disconnected)' });
    return choices;
   },
   write: value => {
    const current = router(), input = selected(); if (input === undefined) throw new Error('No local player');
    const device = devices().find(device => { const target = selection(device); return target !== null && selectionKey(target) === value; });
    const target: ControllerSelection | null = value === 'automatic' ? { kind: 'automatic' } : value === 'none' ? { kind: 'none' } : device === undefined ? null : selection(device);
    if (target === null) { if (selectionKey(current.controllerSelection(input.seat)) === value) return; throw new Error('Controller is no longer available'); }
    if (target.kind !== 'automatic' && target.kind !== 'none') for (const previous of current.inputs) {
     if (!previous.seat.equals(input.seat) && (selectionKey(current.controllerSelection(previous.seat)) === value || device !== undefined && current.controllerFor(previous.seat) === device.instance)) current.setControllerSelection(previous.seat, { kind: 'none' });
    }
    current.setControllerSelection(input.seat, target);
   } },
 ];
}
