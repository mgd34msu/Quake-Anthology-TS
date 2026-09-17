import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { expect, test } from 'bun:test';
import { PitchDrift } from '../../src/input/pitch-drift.ts';
import { MouseInput, defaultMouseTuning } from '../../src/input/mouse.ts';
import { MouseSettings } from '../../src/input/mouse-settings.ts';
import { CvarRegistry } from '../../src/core/cvars/index.ts';

test('Q1 pitch drift follows source acceleration, grounded target and manual cancellation', () => {
 const drift = new PitchDrift(), ground = { grounded: true, idealPitch: 5, disabled: false };
 expect(drift.sample(50, 20, ground, false, true, 0, 200)).toBe(40);
 expect(drift.sample(40, 20, ground, false, false, 0, 200)).toBeCloseTo(29.8, 10);
 expect(drift.sample(29.8, 20, ground, true, false, 0, 200)).toBeCloseTo(29.8, 10);
 expect(drift.sample(29.8, 20, ground, false, false, 0, 200)).toBeCloseTo(29.8, 10);
 expect(drift.sample(10, 100, ground, false, true, 0, 200)).toBe(5);
 expect(drift.sample(40, 20, { ...ground, grounded: false }, false, true, 0, 200)).toBe(40);
 expect(drift.sample(40, 20, ground, false, false, 0, 200)).toBe(40);
 expect(drift.sample(40, 20, ground, false, false, 0, 200)).toBeCloseTo(39.8, 10);
 expect(drift.sample(20, 20, { ...ground, disabled: true }, false, true, 0, 200)).toBe(20);
 drift.clear(); expect(drift.sample(20, 200, ground, false, false, 250, 200)).toBe(20);
 expect(drift.sample(20, 20, ground, false, false, 250, 200)).toBe(10);
});

test('lookstrafe routes only horizontal mlook motion and settings retain both source switches', () => {
 const owner=createIdentityOwner("lookstrafe-settings");
 const settings = new MouseSettings(new CvarRegistry({ dialect: 'q1-netquake', context:{session:owner.session,origin:{kind:"local-console"}} }));
 settings.write({ ...defaultMouseTuning, freeLook: false, lookSpring: true, lookStrafe: true });
 const mouse = new MouseInput(settings);
 const held = mouse.sample({ x: 10, y: 10 }, 20, false, true);
 expect(held.yaw).toBe(0); expect(held.side).toBeCloseTo(24, 5); expect(held.pitch).toBeCloseTo(.66, 6); expect(held.forward).toBe(0);
 const released = mouse.sample({ x: 10, y: 10 }, 20, false, false);
 expect(released.yaw).toBeCloseTo(-.66, 6); expect(released.side).toBe(0); expect(released.pitch).toBe(0); expect(released.forward).toBe(-30);
 expect(settings.read()).toMatchObject({ lookSpring: true, lookStrafe: true });
});

test('real mlook binding release starts centering in the Q1 command builder', async () => {
 const { createIdentityOwner } = await import('../../src/contracts/identity.ts');
 const { CommandBuffer } = await import('../../src/core/commands/index.ts');
 const { SeatInput, registerInputCommands } = await import('../../src/input/seat.ts');
 const { InputCommandBuilder } = await import('../../src/input/user-command.ts');
 for (const dialect of ['q1-netquake', 'q1-quakeworld'] satisfies readonly ('q1-netquake' | 'q1-quakeworld')[]) {
  const identity = createIdentityOwner(`spring-${dialect}`), seat = identity.seat(0);
  const context = { session: identity.session, origin: { kind: 'local-seat', seat, client: identity.client(0, 0) } } satisfies import('../../src/contracts/common.ts').CommandContext;
  const commands = new CommandBuffer({ dialect, context }), input = new SeatInput({ seat, dialect, context, commands, uiEvent: () => false });
  registerInputCommands(commands, () => input); input.bind({ input: { kind: 'key', code: 120 }, target: { kind: 'command', text: '+mlook' } });
  const builder = new InputCommandBuilder(dialect); builder.mouse.tuning = { ...defaultMouseTuning, freeLook: false, lookSpring: true }; builder.setViewAngles({ x: 50, y: 0, z: 0 });
  const drift = { grounded: true, disabled: false, idealPitch: 0 };
  const frame = dialect === 'q1-netquake' ? { kind: dialect, acknowledgedServerTimeSeconds: 0, pitchDrift: drift } : { kind: dialect, pitchDrift: drift };
  input.input({ kind: 'key', seat, code: 120, down: true, repeat: false, timeMilliseconds: 1 }); commands.execute();
  builder.build(input.sample(20, 20), frame); expect(builder.viewAngles.x).toBe(50);
  input.input({ kind: 'key', seat, code: 120, down: false, repeat: false, timeMilliseconds: 21 }); commands.execute();
  builder.build(input.sample(40, 20), frame); expect(builder.viewAngles.x).toBe(40);
 }
});
