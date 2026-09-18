/* Q3 cl_cgame.c/cl_ui.c sound traps, adapted from quake-3-ts. GPL-2.0-or-later. */
import { CommonError } from '../../core/common-error.ts';
import type { Axis, Vec3 } from '../../contracts/math.ts';
import type { Q3ClientSound } from '../../content/q3/presentation/client.ts';
import { QvmCgameImport, QvmUiImport } from './abi.ts';
import type { QvmHostCall, QvmHostResult } from './syscalls.ts';

export interface QvmClientAudioServices {
  readonly role: 'cgame' | 'ui';
  readonly sound: Q3ClientSound;
  print(text: string): void;
}

function vector(view: DataView, offset = 0): Vec3 {
  return { x: view.getFloat32(offset, true), y: view.getFloat32(offset + 4, true), z: view.getFloat32(offset + 8, true) };
}

/** Guest handles belong to the same sound bank used by the source presentation. */
export function qvmClientAudioSyscall(call: QvmHostCall, services: QvmClientAudioServices): QvmHostResult | null {
  if (call.kind !== 'engine' || call.role !== services.role) return null;
  const { words, guest } = call, sound = services.sound, ui = services.role === 'ui';
  const pcm = (index: number) => {
    const result = sound.bank.soundForIndex(index);
    // snd_dma.c supplies only S_COLOR_YELLOW as the printf format on invalid handles.
    if (result === undefined) services.print('^3');
    return result;
  };
  if (call.code === (ui ? QvmUiImport.UI_S_REGISTERSOUND : QvmCgameImport.CG_S_REGISTERSOUND)) {
    const name = words.getInt32(4, true), compressed = (call.abiProfile ?? "q3-modern") === "q3-modern" && words.getInt32(8, true) !== 0;
    return sound.bank.registerSound(name === 0 ? null : guest.readString(name), compressed).then(value => sound.bank.indexForSound(value));
  }
  if (call.code === (ui ? QvmUiImport.UI_S_STARTLOCALSOUND : QvmCgameImport.CG_S_STARTLOCALSOUND)) {
    const value = pcm(words.getInt32(4, true));
    if (value !== undefined) sound.startLocalSound(value, words.getInt32(8, true));
    return 0;
  }
  if (call.code === (ui ? QvmUiImport.UI_S_STARTBACKGROUNDTRACK : QvmCgameImport.CG_S_STARTBACKGROUNDTRACK)) {
    const intro = words.getInt32(4, true), loop = words.getInt32(8, true);
    return sound.startBackgroundTrack(intro === 0 ? '' : guest.readString(intro), loop === 0 ? '' : guest.readString(loop)).then(() => 0);
  }
  if (call.code === (ui ? QvmUiImport.UI_S_STOPBACKGROUNDTRACK : QvmCgameImport.CG_S_STOPBACKGROUNDTRACK))
    return sound.startBackgroundTrack('', '').then(() => 0);
  if (call.role !== 'cgame') return null;
  switch (call.code) {
    case QvmCgameImport.CG_S_STARTSOUND: {
      const origin = words.getInt32(4, true), entity = words.getInt32(8, true), channel = words.getInt32(12, true);
      if (origin === 0 && (entity < 0 || entity > 1024)) throw new CommonError('drop', `S_StartSound: bad entitynum ${entity}`);
      const value = pcm(words.getInt32(16, true));
      if (value !== undefined) sound.startSound(origin === 0 ? null : vector(guest.view(origin, 12)), entity, channel, value);
      return 0;
    }
    case QvmCgameImport.CG_S_CLEARLOOPINGSOUNDS:
      sound.clearLoopingSounds((call.abiProfile ?? "q3-modern") !== "q3-modern" || words.getInt32(4, true) !== 0); return 0;
    case QvmCgameImport.CG_S_ADDLOOPINGSOUND:
    case QvmCgameImport.CG_S_ADDREALLOOPINGSOUND: {
      const value = pcm(words.getInt32(16, true));
      if (value !== undefined) sound.addLoopSound(words.getInt32(4, true), vector(guest.view(words.getInt32(8, true), 12)),
        vector(guest.view(words.getInt32(12, true), 12)), value, call.code === QvmCgameImport.CG_S_ADDREALLOOPINGSOUND);
      return 0;
    }
    case QvmCgameImport.CG_S_UPDATEENTITYPOSITION:
      sound.updateSoundPosition(words.getInt32(4, true), vector(guest.view(words.getInt32(8, true), 12))); return 0;
    case QvmCgameImport.CG_S_STOPLOOPINGSOUND:
      sound.stopLoopingSound(words.getInt32(4, true)); return 0;
    case QvmCgameImport.CG_S_RESPATIALIZE: {
      const entity = words.getInt32(4, true), origin = vector(guest.view(words.getInt32(8, true), 12));
      const axes = guest.view(words.getInt32(12, true), 36), axis: Axis = [vector(axes), vector(axes, 12), vector(axes, 24)];
      // Native S_Respatialize accepts inwater without using it.
      words.getInt32(16, true);
      sound.setListener(entity, origin, axis); return 0;
    }
    default: return null;
  }
}
