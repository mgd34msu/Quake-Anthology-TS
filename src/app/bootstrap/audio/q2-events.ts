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

/** CL_ParseMuzzleFlash2 in the classic and rerelease client sources. Null is an uncovered flash. */
export function q2MonsterMuzzleSounds(flash: number, random: () => number, rerelease: boolean): readonly Q2EventSound[] | null {
  const sound = (path: string, attenuation = 1): readonly Q2EventSound[] => [{ path, channel: 1, volume: 1, attenuation, delaySeconds: 0 }];
  if (rerelease) {
    // q2repro effects.c includes rerelease muzzle IDs beyond the classic byte table.
    switch (flash) {
      case 232: case 233: case 234: case 235: case 236: case 237: case 238: case 239: case 260: return sound("infantry/infatck1.wav");
      case 251: return sound("soldier/solatck2.wav");
      case 252: return sound("soldier/solatck1.wav");
      case 253: return sound("soldier/solatck3.wav");
      case 256: case 257: case 258: case 259: return sound("gunner/gunatck3.wav");
      case 263: return sound("hover/hovatck1.wav");
    }
  }
  switch (flash) {
    case 26: case 27: case 28: case 29: case 30: case 31: case 32: case 33: case 34: case 35: case 36: case 37: case 38: return sound("infantry/infatck1.wav");
    case 43: case 44: case 85: case 88: case 91: case 94: case 97: case 100: return sound("soldier/solatck3.wav");
    case 45: case 46: case 47: case 48: case 49: case 50: case 51: case 52: return sound("gunner/gunatck2.wav");
    case 63: case 64: case 65: case 66: case 67: case 68: case 69: case 141: return sound("infantry/infatck1.wav");
    case 73: case 74: case 75: case 76: case 77: case 138: case 152: return sound(rerelease && flash === 74 ? "flyer/flyatck3.wav" : "infantry/infatck1.wav", 0);
    case 39: case 40: case 83: case 86: case 89: case 92: case 95: case 98: case 143: return sound("soldier/solatck2.wav");
    case 58: case 59: return sound("flyer/flyatck3.wav");
    case 60: return sound("medic/medatck1.wav");
    case 62: return sound("hover/hovatck1.wav");
    case 82: return sound("floater/fltatck1.wav");
    case 41: case 42: case 84: case 87: case 90: case 93: case 96: case 99: return sound("soldier/solatck1.wav");
    case 1: case 2: case 3: return sound("tank/tnkatck3.wav");
    case 4: case 5: case 6: case 7: case 8: case 9: case 10: case 11: case 12: case 13: case 14: case 15: case 16: case 17: case 18: case 19: case 20: case 21: case 22: return sound(`tank/tnkatk2${String.fromCharCode(97 + random() % 5)}.wav`);
    case 57: case 142: return sound("chick/chkatck2.wav");
    case 23: case 24: case 25: return sound("tank/tnkatck1.wav");
    case 70: case 71: case 72: case 78: case 79: case 80: case 81: case 191: return sound("tank/rocket.wav");
    case 53: case 54: case 55: case 56: return sound("gunner/gunatck3.wav");
    case 61: case 147: case 150: return [];
    case 101: return [];
    case 102: case 103: case 104: case 105: case 106: case 107: case 108: case 109: case 110: case 111: case 112: case 113: case 114: case 115: case 116: case 117: case 118: return sound("makron/blaster.wav");
    case 120: case 121: case 122: case 123: case 124: case 125: return sound("boss3/xfire.wav");
    case 126: case 127: case 128: case 129: case 130: case 131: return [];
    case 132: return [];
    case 133: case 134: case 135: case 136: case 137: case 139: case 153: return rerelease && flash === 134 ? sound("flyer/flyatck3.wav", 0) : [];
    case 144: case 145: case 146: case 149: case 156: case 157: case 158: case 159: case 160: case 161: case 162: case 163: case 164: case 165: case 166: case 167: case 168: case 169: case 170: case 171: case 172: case 173: case 174: case 175: case 176: case 177: case 178: case 179: case 180: case 181: case 182: case 183: case 184: case 185: case 186: case 187: case 188: case 189: case 190: return sound("tank/tnkatck3.wav");
    case 148: return sound("weapons/disint2.wav");
    case 151: case 195: case 196: case 197: case 198: case 199: case 200: case 201: case 202: case 203: case 204: case 205: case 206: case 207: case 208: case 209: case 210: return [];
    default: return null;
  }
}
