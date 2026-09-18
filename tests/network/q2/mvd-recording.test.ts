import { test, expect } from 'bun:test';
import { MvdRecording, MvdMessageFramer, readMvdRecording, frameMvdMessage } from '../../../src/network/q2/mvd-recording.ts';
test('MVD2 records survive one-byte boundaries and require a terminator', () => {
    const chunks: Uint8Array[] = [], recording = new MvdRecording(bytes => { chunks.push(bytes); });
    recording.append(Uint8Array.of(4, 37, 0, 0, 0)); recording.append(Uint8Array.of(6, 0, 255, 0, 0)); recording.close(); recording.close();
    const bytes = Uint8Array.from(chunks.flatMap(chunk => [...chunk]));
    expect([...bytes.subarray(0, 6)]).toEqual([77, 86, 68, 50, 5, 0]);
    const framer = new MvdMessageFramer(), messages: Uint8Array[] = [];
    for (const byte of bytes) framer.push(Uint8Array.of(byte), message => { messages.push(message); });
    framer.finish(); expect(messages).toEqual([...readMvdRecording(bytes)]);
    expect(messages.length).toBe(2);
    expect(() => [...readMvdRecording(bytes.slice(0, -1))]).toThrow('Truncated');
    expect(() => frameMvdMessage(new Uint8Array(32769))).toThrow('length');
    expect(() => recording.append(Uint8Array.of(1))).toThrow('closed');
    expect(() => framer.push(Uint8Array.of(1), () => {})).toThrow('after');
});
