import { expect, test } from 'bun:test';
import { qvmUiKeySyscall } from '../../../src/compat/qvm/ui-key-syscalls.ts';
import { QvmUiExport, QvmUiImport } from '../../../src/compat/qvm/abi.ts';
import { QvmMemory } from '../../../src/compat/qvm/memory.ts';
import type { QvmHostCall } from '../../../src/compat/qvm/syscalls.ts';
import { Q3CdKeyState } from '../../../src/core/q3-cd-key.ts';

test('UI key traps use scoped nested unique-key export and retain original pointer across suspension', async () => {
  const keys = new Q3CdKeyState({ markModifiedFlags() {} });
  keys.writeUi(0, '', new TextEncoder().encode('2'.repeat(16)));
  keys.writeUi(1, 'missionpack', new TextEncoder().encode('3'.repeat(16)));
  const guest = new QvmMemory(new Uint8Array(256)), words = new DataView(new ArrayBuffer(16));
  words.setInt32(4, 32, true); words.setInt32(8, 1, true);
  const gate = Promise.withResolvers<number>();
  const call: QvmHostCall = { kind: 'engine', role: 'ui', code: QvmUiImport.UI_GET_CDKEY, words, memory: guest.bytes, guest, commandArguments: null,
    cancelFunction() { throw new Error('Unexpected source cancellation'); },
    invoke() { throw new Error('Unexpected synchronous export'); },
    async invokeAsync(args) { expect(args[0]).toBe(QvmUiExport.UI_HASUNIQUECDKEY); return gate.promise; } };
  const services = { keys, gameDirectory: () => 'missionpack', assertCurrent() {} };
  const stores: { offset: number; length: number }[] = [];
  const close = guest.observeWrites([{ byteOffset: 32, byteLength: 17 }], event => {
    for (const range of event.ranges) stores.push({ offset: range.byteOffset, length: range.after.length });
  });
  const pending = qvmUiKeySyscall(call, services);
  expect(stores).toEqual([]);
  words.setInt32(4, 96, true); gate.resolve(1); expect(await pending).toBe(0);
  expect(stores).toEqual([{ offset: 32, length: 16 }, { offset: 48, length: 1 }]);
  close();
  expect(guest.span(32, 16).every(byte => byte === 51)).toBe(true); expect(guest.span(48, 1)[0]).toBe(0); expect(guest.span(96, 17).every(byte => byte === 0)).toBe(true);
  guest.writeString(128, '2'.repeat(16), 17); guest.writeString(160, '20', 3);
  words.setInt32(4, 128, true); words.setInt32(8, 160, true);
  expect(qvmUiKeySyscall({ ...call, code: QvmUiImport.UI_VERIFY_CDKEY }, services)).toBe(1);
  guest.writeString(160, '21', 3); expect(qvmUiKeySyscall({ ...call, code: QvmUiImport.UI_VERIFY_CDKEY }, services)).toBe(0);
});

test('UI key write refuses a retired module after nested export resolves', async () => {
  const keys = new Q3CdKeyState({ markModifiedFlags() { throw new Error('Retired owner must not mutate key state'); } });
  const guest = new QvmMemory(new Uint8Array(256)), words = new DataView(new ArrayBuffer(12)), gate = Promise.withResolvers<number>();
  words.setInt32(4, 32, true); guest.writeString(32, '2'.repeat(16), 17);
  let current = true;
  const call: QvmHostCall = { kind: 'engine', role: 'ui', code: QvmUiImport.UI_SET_CDKEY, words, memory: guest.bytes, guest, commandArguments: null,
    cancelFunction() { throw new Error('Unexpected source cancellation'); },
    invoke() { throw new Error('Unexpected synchronous export'); }, invokeAsync: () => gate.promise };
  const pending = qvmUiKeySyscall(call, { keys, gameDirectory: () => '', assertCurrent() { if (!current) throw new Error('Retired UI'); } });
  current = false; gate.resolve(0);
  await expect(Promise.resolve(pending)).rejects.toThrow('Retired UI');
});


test('UI key SET waits for the selected profile write before completing the trap', async () => {
  const gate = Promise.withResolvers<void>(), guest = new QvmMemory(new Uint8Array(128));
  const words = new DataView(new ArrayBuffer(8)); words.setInt32(4, 32, true);
  guest.writeString(32, '2'.repeat(16), 17);
  let written = false, finished = false;
  const call: QvmHostCall = { kind: 'engine', role: 'ui', code: QvmUiImport.UI_SET_CDKEY, words, memory: guest.bytes, guest, commandArguments: null,
    cancelFunction() { throw new Error('Unexpected source cancellation'); },
    invoke() { throw new Error('Unexpected synchronous export'); }, invokeAsync: async () => 1 };
  const pending = Promise.resolve(qvmUiKeySyscall(call, { keys: {
    readUi() {}, async writeUi(unique, directory, bytes) {
      expect(unique).toBe(1); expect(directory).toBe('missionpack'); expect(bytes.length).toBe(16);
      await gate.promise; written = true;
    } }, gameDirectory: () => 'missionpack', assertCurrent() {} })).then(result => { finished = true; return result; });
  await Promise.resolve(); await Promise.resolve(); expect(finished).toBe(false);
  gate.resolve(); expect(await pending).toBe(0); expect(written).toBe(true);
});
