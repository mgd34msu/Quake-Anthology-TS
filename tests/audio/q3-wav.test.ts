import { expect, test } from "bun:test";
import { decodeQ3Wav, decodeWav } from "../../src/audio/wav.ts";

test("Q3 ignores authored cue loop metadata while decoding every PCM frame", () => {
  const bytes = new Uint8Array(82), view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
  text(0, "RIFF"); view.setUint32(4, 74, true); text(8, "WAVEfmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 22050, true); view.setUint32(28, 44100, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, 2, true); view.setInt16(44, 1234, true);
  text(46, "cue "); view.setUint32(50, 28, true); view.setUint32(54, 1, true);
  text(66, "data"); view.setUint32(78, 59404, true);
  expect(() => decodeWav(bytes)).toThrow("loop start");
  const decoded = decodeQ3Wav(bytes);
  expect(decoded.samples).toEqual(new Int16Array([1234]));
  expect(decoded.frameCount).toBe(1); expect(decoded.loopStart).toBeNull();
});
