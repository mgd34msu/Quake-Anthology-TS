import { createHash } from "node:crypto";
import { InputRouter } from "../../../src/input/router.ts";
import { ControllerSettings } from "../../../src/app/bootstrap/controller-settings.ts";
import { ConfigStore } from "../../../src/settings/config.ts";
import { expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { ApplicationInput } from '../../../src/app/bootstrap/input.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';

test('application restores seat controls and remaps transient controller instance bindings', async () => {
  const root=await mkdtemp(join(tmpdir(),'input-persistence-'));
  const selected=parseApplicationCommand(['--game','q1-classic-id1','--map','e1m1','--movement','q1','--character','q1','--seats','2','--renderer','cpu','--width','160','--height','120','--hidden']);
  if(selected.kind!=='run')throw Error('Missing options');
  const opened=spyOn(ApplicationInput,'open');let app:Application|null=null;
  const controls=async():Promise<ApplicationInput>=>{const last=opened.mock.results.at(-1);if(last?.type!=='return')throw Error('Input not opened');return await last.value;};
  try {
    app=await Application.open({...selected.options,userContentRoot:root},{print:()=>undefined});
    const input=await controls(),one=input.locals[0],two=input.locals[1];if(one===undefined||two===undefined)throw Error('Missing seats');
    const selection={kind:'serial',guid:'0123456789abcdef0123456789abcdef',serial:'controller-a'} satisfies import('../../../src/platform/controller.ts').ControllerSelection;
    input.router.setControllerSelection(one.player.seat.id,selection);input.router.setControllerSelection(two.player.seat.id,{kind:'none'});input.router.setKeyboardSeat(two.player.seat.id);
    one.input.gamepad.tuning={...one.input.gamepad.tuning,yawDegreesPerSecond:321,invertPitch:true};one.builder.mouse.tuning={...one.builder.mouse.tuning,sensitivity:7};one.haptics.setEnabled(false);one.haptics.setStrength(0.4);one.console.history.replace(['echo persisted']);
    input.router.handleController({kind:'assignment',timestamp:input.window.ticks,slot:0,previous:null,instance:42});
    expect(one.input.bindings.some(binding => binding.input.kind === 'controller-button' && binding.input.device === 42)).toBe(true);
    one.input.bind({input:{kind:'controller-button',device:42,button:0},target:{kind:'action',action:'jump'}});
    input.router.handleController({kind:'assignment',timestamp:input.window.ticks,slot:0,previous:null,instance:42});
    input.router.handleController({kind:'assignment',timestamp:input.window.ticks,slot:0,previous:42,instance:77});
    expect(one.input.binding({kind:'controller-button',device:77,button:0})).toEqual({kind:'action',action:'jump'});
    await app.close();app=null;
    app=await Application.open({...selected.options,userContentRoot:root},{print:()=>undefined});
    const restored=await controls(),first=restored.locals[0],second=restored.locals[1];if(first===undefined||second===undefined)throw Error('Missing restored seats');
    expect(restored.router.controllerSelection(first.player.seat.id)).toEqual(selection);expect(restored.router.controllerSelection(second.player.seat.id)).toEqual({kind:'none'});expect(restored.router.keyboardSeat()?.equals(second.player.seat.id)).toBe(true);
    expect(first.input.gamepad.tuning.yawDegreesPerSecond).toBe(321);expect(first.input.gamepad.tuning.invertPitch).toBe(true);expect(first.builder.mouse.tuning.sensitivity).toBe(7);expect(first.haptics.enabled).toBe(false);expect(first.haptics.strength).toBe(0.4);expect(first.console.history.lines).toContain('echo persisted');
    expect(restored.router.controllerFor(first.player.seat.id)).toBeNull();
    restored.router.handleController({kind:'assignment',timestamp:restored.window.ticks,slot:0,previous:null,instance:88});
    expect(first.input.binding({kind:'controller-button',device:88,button:0})).toEqual({kind:'action',action:'jump'});
    expect(first.input.bindings.some(binding=>(binding.input.kind==='controller-button'||binding.input.kind==='controller-axis')&&binding.input.device===77)).toBe(false);
    const gyroStore = new ConfigStore(join(root, 'gyro-proof'));
    const device = { instance: 90, name: 'Injected gyro', guid: selection.guid, serial: selection.serial, ordinal: 0, virtual: true,
      capabilities: { axes: [], buttons: [], rumble: false, triggerRumble: false, led: false, touchpads: 0, sensors: [] } };
    const gyroRouter = new InputRouter({ seats: [{ input: first.input, controller: selection }], keyboardSeat: null,
      controllers: { assignments: [90], setAssignments() {}, setSensorEnabled: () => ({ kind: 'accepted' }), pollEvents: () => [], snapshot: () => null },
      now: () => 0, ticks: () => 0, subframe: false, unhandled() {} });
    gyroRouter.restart();
    first.input.gamepad.tuning = { ...first.input.gamepad.tuning, gyro: { ...first.input.gamepad.tuning.gyro, enabled: false, yawSensitivity: 4 } };
    const gyro = new ControllerSettings(gyroRouter, [first.player.seat.id], () => [device], gyroStore);
    try {
      gyro.update(); await gyro.settle(); expect(first.input.gamepad.tuning.gyro.yawSensitivity).toBe(4);
      await gyroStore.saveGyro(`controllers/seat-1/${selection.guid}-${createHash('sha256').update(selection.serial).digest('hex')}.json`,
        { version: 1, identity: { kind: 'device', guid: selection.guid, serial: selection.serial }, tuning: { ...first.input.gamepad.tuning.gyro, yawSensitivity: 9 } });
      gyroRouter.handleController({kind:'assignment',timestamp:0,slot:0,previous:90,instance:null}); gyro.update();
      gyroRouter.handleController({kind:'assignment',timestamp:0,slot:0,previous:null,instance:90}); gyro.update(); await gyro.settle();
      expect(first.input.gamepad.tuning.gyro.yawSensitivity).toBe(9);
    } finally { gyro.close(); gyroRouter.close(); }
    await app.close(); app = null;
    const single = parseApplicationCommand(["--game","q1-classic-id1","--map","e1m1","--movement","q1","--character","q1","--seats","1","--renderer","cpu","--width","160","--height","120","--hidden"]);
    if (single.kind !== "run") throw Error("Missing single-seat options");
    app = await Application.open({ ...single.options, userContentRoot: root }, { print: () => undefined });
    const sole = await controls(), player = sole.locals[0]; if (player === undefined) throw Error("Missing sole seat");
    expect(sole.router.keyboardSeat()?.equals(player.player.seat.id)).toBe(true);
    sole.router.handlePlatform({ kind: "key", timestamp: sole.window.ticks, down: true, repeat: false, scancode: 26, keycode: 119, modifiers: 0 });
    expect(player.input.isDown({ kind: "key", code: 119 })).toBe(true);
    sole.router.handlePlatform({ kind: "key", timestamp: sole.window.ticks, down: false, repeat: false, scancode: 26, keycode: 119, modifiers: 0 });
    sole.router.setKeyboardSeat(null);
    expect(sole.router.keyboardSeat()).toBeNull();
    const explicit = new ConfigStore(join(root, "explicit-routing"));
    await explicit.saveInputRouting("routing.json", null);
    expect(await explicit.loadInputRouting("routing.json")).toEqual({ keyboardSeat: null });
  } finally {await app?.close();opened.mockRestore();await rm(root,{recursive:true,force:true});}
},30000);
