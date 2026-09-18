import { expect, test } from 'bun:test';
import { BotAssetFiles } from '../../../src/bots/behavior/assets.ts';
import { BotLibrary } from '../../../src/bots/behavior/q3/library.ts';
import { QvmMemory } from '../../../src/compat/qvm/memory.ts';
import { createQvmSystemCall, rejectQvmSyscall } from '../../../src/compat/qvm/syscalls.ts';
import { qvmBotLibrarySyscall, type QvmBotLibraryServices } from '../../../src/compat/qvm/bot-library-syscalls.ts';
import { decodeLegacyQvmGameImport } from '../../../src/compat/qvm/legacy-bot-abi.ts';
import { QvmGameImport } from '../../../src/compat/qvm/abi.ts';
import type { WireUserCommand } from '../../../src/network/q3/message.ts';

function unavailable(): never { throw new Error('Unrequested test service'); }

test('legacy bot wrappers preserve action ordinals, bits, source chat ownership and usercmd layout', () => {
  const files = new BotAssetFiles(), commands: { client: number; command: string }[] = [], userCommands: WireUserCommand[] = [];
  for (const [name, text] of Object.entries({ 'syn.c': '', 'rnd.c': '', 'match.c': '', 'rchat.c': '',
    'test_t.c': 'chat "test" { type "hello" { "hello"; } }', 'skill.c': 'skill 1 { 0 1.0 } skill 4 { 0 4.0 } skill 5 { 0 5.0 }' }))
    files.add('botfiles/' + name, new TextEncoder().encode(text));
  const library = new BotLibrary({ files, random: { nextInt: () => 0 }, debug: false, milliseconds: () => 0,
    print: () => undefined, clientCommand: (client, command) => { commands.push({ client, command }); return undefined; }, openLog: unavailable });
  const guest = new QvmMemory(new Uint8Array(4096));
  const services: QvmBotLibraryServices = { library, setup: unavailable, shutdown: unavailable, loadMap: unavailable,
    updateEntity: unavailable, snapshotEntity: unavailable, consoleMessage: unavailable,
    userCommand: (_client, command) => { userCommands.push(command); }, allocateClient: unavailable, freeClient: unavailable };
  const syscall = createQvmSystemCall('qagame', call => qvmBotLibrarySyscall(call, services) ?? rejectQvmSyscall(call), () => null, 'q3-1.16n-base');
  const call = (code: number, ...args: readonly number[]) => {
    const words = new DataView(new ArrayBuffer(64)); words.setInt32(0, code, true);
    args.forEach((value, index) => words.setInt32(4 + index * 4, value, true));
    return syscall({ words, memory: guest.bytes, invoke: unavailable, invokeAsync: unavailable });
  };
  try {
    library.actions.setup(4);
    guest.writeString(128, 'Medkit', 64);
    expect(call(402, 2, 128)).toBe(0); expect(commands.pop()).toEqual({ client: 2, command: 'use Medkit' });
    call(412, 2); call(413, 2); call(415, 2); call(409, 2); call(406, 2);
    call(425, 2, 0, 256);
    expect(guest.view(256, 40).getInt32(32, true)).toBe(4 | 8 | 16 | 1024 | 2048);
    expect(decodeLegacyQvmGameImport(408)).toBe(QvmGameImport.BOTLIB_EA_SELECT_WEAPON);
    expect(decodeLegacyQvmGameImport(300)).toBeNull();
    expect(() => call(300)).toThrow('Legacy QVM ABI service');
    const input = guest.view(512, 24); input.setInt32(0, 250, true); input.setUint8(4, 129); input.setUint8(5, 7);
    input.setInt32(8, 11, true); input.setInt32(12, 22, true); input.setInt32(16, 33, true);
    input.setInt8(20, -3); input.setInt8(21, 4); input.setInt8(22, 5);
    call(211, 2, 512);
    expect(userCommands).toEqual([{ serverTime: 250, buttons: 2049, weapon: 7, angles: [11, 22, 33], forwardmove: -3, rightmove: 4, upmove: 5 }]);
    guest.writeString(128, 'skill.c', 64);
    const character = call(500, 128, 3); if (typeof character !== 'number') throw new Error('Character call must be synchronous');
    expect(character).toBeGreaterThan(0); expect(library.characters.float(character, 0)).toBe(3);
    library.chat.setup(); const chat = library.chat.allocate();
    expect(library.chat.loadChatFile(chat, 'test_t.c', 'test')).toBe(true);
    guest.writeString(128, 'Legacy', 64); call(524, chat, 128);
    library.chat.initialChat(chat, 'hello', 0); call(516, chat, 2, 1);
    expect(commands.pop()).toEqual({ client: 2, command: 'say_team hello' });
  } finally { library.shutdown(); }
});
