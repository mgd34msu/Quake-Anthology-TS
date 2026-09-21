// Q3 1.16n/1.17 botlib.h and g_syscalls.c boundary adaptations.
import { QvmGameImport } from './abi.ts';
import type { QvmHostCall, QvmHostResult } from './syscalls.ts';
import type { QvmBotLibraryServices } from './bot-library-syscalls.ts';
import { BotActionFlag } from '../../bots/behavior/library/actions.ts';

/** Legacy jump/up and crouch/down intentionally share source bits. */
export function legacyBotActionFlags(flags: number): number {
  let result = flags & 3;
  const fields: readonly (readonly [number, number])[] = [
    [BotActionFlag.RESPAWN, 4], [BotActionFlag.JUMP | BotActionFlag.MOVE_UP, 8],
    [BotActionFlag.CROUCH | BotActionFlag.MOVE_DOWN, 16], [BotActionFlag.MOVE_FORWARD, 32],
    [BotActionFlag.MOVE_BACK, 64], [BotActionFlag.MOVE_LEFT, 128], [BotActionFlag.MOVE_RIGHT, 256],
    [BotActionFlag.DELAYED_JUMP, 512], [BotActionFlag.TALK, 1024], [BotActionFlag.GESTURE, 2048], [BotActionFlag.WALK, 4096],
  ];
  for (const [modern, legacy] of fields) if ((flags & modern) !== 0) result |= legacy;
  return result;
}

export function qvmLegacyBotLibrarySyscall(call: QvmHostCall, services: QvmBotLibraryServices): QvmHostResult | null {
  if (call.role !== 'qagame' || call.abiProfile !== 'q3-1.16n-base') return null;
  const integer = (index: number): number => call.words.getInt32(index * 4, true);
  const text = (index: number): string => call.guest.readString(integer(index));
  const library = services.library;
  if (call.kind === 'extension') {
    switch (call.code) {
      case 402: library.actions.useItem(integer(1), text(2)); return 0;
      case 403: library.actions.dropItem(integer(1), text(2)); return 0;
      case 404: library.actions.useInventory(integer(1), text(2)); return 0;
      case 405: library.actions.dropInventory(integer(1), text(2)); return 0;
      default: return null;
    }
  }
  switch (call.code) {
    case QvmGameImport.BOTLIB_AI_LOAD_CHARACTER: return library.characters.load(text(1), integer(2));
    case QvmGameImport.BOTLIB_AI_SET_CHAT_NAME: library.chat.setName(integer(1), text(2)); return 0;
    case QvmGameImport.BOTLIB_AI_ENTER_CHAT:
      library.chat.enterChat(integer(1), integer(2), integer(3) === 1 ? 1 : 0, integer(2)); return 0;
    case QvmGameImport.BOTLIB_EA_GET_INPUT: {
      const bytes = library.actions.getInputBytes(integer(1), call.words.getFloat32(8, true));
      const target = call.guest.span(integer(3), 40);
      call.guest.writeBytes(target.byteOffset - call.guest.bytes.byteOffset, bytes);
      const view = call.guest.dataView(target.byteOffset - call.guest.bytes.byteOffset, target.byteLength);
      view.setInt32(32, legacyBotActionFlags(view.getInt32(32, true)), true); return 0;
    }
    case QvmGameImport.BOTLIB_USER_COMMAND: {
      const view = call.guest.view(integer(2), 24), buttons = view.getUint8(4);
      const result = services.userCommand(integer(1), { serverTime: view.getInt32(0, true),
        angles: [view.getInt32(8, true), view.getInt32(12, true), view.getInt32(16, true)],
        buttons: (buttons & 31) | ((buttons & 128) === 0 ? 0 : 2048), weapon: view.getUint8(5),
        forwardmove: view.getInt8(20), rightmove: view.getInt8(21), upmove: view.getInt8(22) });
      return result === undefined ? 0 : result.then(() => 0);
    }
    default: return null;
  }
}
