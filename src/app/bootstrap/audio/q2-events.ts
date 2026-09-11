// Quake II cl_fx.c CL_EntityEvent and CL_ParseMuzzleFlash sound calls.
// Copyright id Software. SPDX-License-Identifier: GPL-2.0-or-later
export interface Q2EventSound {
  readonly path: string;
  readonly channel: number;
  readonly attenuation: number;
  readonly volume: number;
  readonly delaySeconds: number;
}

export function q2EntitySound(event: number, random: () => number): Q2EventSound | null {
  const sound = (path: string, channel: number, attenuation = 1): Q2EventSound => ({ path, channel, attenuation, volume: 1, delaySeconds: 0 });
  switch (event) {
    case 1: return sound("items/respawn1.wav", 1, 2);
    case 2: return sound(`player/step${(random() & 3) + 1}.wav`, 4);
    case 3: return sound("player/land1.wav", 0);
    case 4: return sound("*fall2.wav", 0);
    case 5: return sound("*fall1.wav", 0);
    case 6: return sound("misc/tele1.wav", 1, 2);
    default: return null;
  }
}

export function q2MuzzleSounds(flash: number, silenced: boolean, random: () => number, rerelease = false): readonly Q2EventSound[] {
  const volume = silenced ? 0.2 : 1;
  const sound = (path: string, channel = 1, delaySeconds = 0, gain = volume): Q2EventSound => ({ path, channel, delaySeconds, volume: gain, attenuation: 1 });
  const machinegun = (delay = 0): Q2EventSound => sound(`weapons/machgf${random() % 5 + 1}b.wav`, 1, delay);
  switch (flash & ~128) {
    case 0: case 34: return [sound("weapons/blastf1a.wav")];
    case 1: case 3: return [machinegun()];
    case 2: return [sound("weapons/shotgf1b.wav"), sound("weapons/shotgr1b.wav", 0, 0.1)];
    case 4: return [machinegun(), machinegun(0.05)];
    case 5: return [machinegun(), machinegun(0.033), machinegun(0.066)];
    case 6: return rerelease ? [sound("weapons/railgf1a.wav"), sound("weapons/railgr1b.wav", 7, 0.4)] : [sound("weapons/railgf1a.wav")];
    case 7: return [sound("weapons/rocklf1a.wav"), sound("weapons/rocklr1b.wav", 0, 0.1)];
    case 8: return [sound("weapons/grenlf1a.wav"), sound("weapons/grenlr1b.wav", 0, 0.1)];
    case 9: case 10: case 11: return [sound("weapons/grenlf1a.wav", 1, 0, 1)];
    case 12: return [sound("weapons/bfg__f1y.wav")];
    case 13: return [sound("weapons/sshotf1b.wav")];
    case 14: case 17: return [sound("weapons/hyprbf1a.wav")];
    case 16: return [sound("weapons/rippfire.wav")];
    case 18: return [sound("weapons/plasshot.wav")];
    case 30: return [sound("weapons/nail1.wav")];
    case 32: return [sound("weapons/shotg2.wav")];
    case 35: return [sound("weapons/disint2.wav")];
    default: return [];
  }
}
