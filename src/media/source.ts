import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { BinaryError } from "../core/binary/index.ts";

export interface MediaInput {
  readonly source: string;
  readonly byteLength: number;
  readAt(offset: number, destination: Uint8Array): number;
  close(): void;
}

function range(offset: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError("Media offset must be a nonnegative integer");
}

export function mediaBytes(bytes: Uint8Array, source = "<media>"): MediaInput {
  let closed = false;
  return {
    source, byteLength: bytes.byteLength,
    readAt(offset, destination) {
      if (closed) throw new Error("Media input is closed");
      range(offset);
      const part = bytes.subarray(offset, offset + destination.length);
      destination.set(part);
      return part.length;
    },
    close() { closed = true; },
  };
}

/** Retains one descriptor; decoding reads only the current chunk or frame. */
export function openMediaFile(path: string): MediaInput {
  const descriptor = openSync(path, "r");
  let byteLength: number;
  try { byteLength = fstatSync(descriptor).size; }
  catch (error: unknown) { closeSync(descriptor); throw error; }
  let closed = false;
  return {
    source: path, byteLength,
    readAt(offset, destination) {
      if (closed) throw new Error("Media input is closed");
      range(offset);
      return readSync(descriptor, destination, 0, destination.length, offset);
    },
    close() { if (!closed) { closed = true; closeSync(descriptor); } },
  };
}

export function readMedia(input: MediaInput, offset: number, length: number): Uint8Array {
  range(offset);
  if (!Number.isSafeInteger(length) || length < 0 || offset > input.byteLength - length) {
    throw new BinaryError(input.source, offset, `truncated media read of ${length} bytes`);
  }
  const bytes = new Uint8Array(length);
  let count = 0;
  while (count < length) {
    const read = input.readAt(offset + count, bytes.subarray(count));
    if (read <= 0 || read > length - count) throw new BinaryError(input.source, offset + count, "short media read");
    count += read;
  }
  return bytes;
}
