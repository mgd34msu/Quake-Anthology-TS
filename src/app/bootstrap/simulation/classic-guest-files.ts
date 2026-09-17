// SPDX-License-Identifier: GPL-2.0-or-later
import { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, openSync, readSync, writeSync } from "node:fs";
import type { WindowsCapabilities, WindowsFile } from "../../../guest/runtime/windows/index.ts";
import { containedFileParts, openContainedParent } from "../../../platform/files/contained.ts";

/** DLL CRT files are relative to the selected writable game directory, never the installation. */
export function classicGuestFiles(root: string, resources: ReadonlyMap<string, Uint8Array> = new Map<string, Uint8Array>()): NonNullable<WindowsCapabilities["openFile"]> {
  return (path, options) => {
    const name = path.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
    containedFileParts(name);
    if (!Number.isInteger(options.creation) || options.creation < 1 || options.creation > 5) throw new RangeError("Invalid native file creation disposition");
    if (!options.write && options.creation !== 3) return null;
    let parent: ReturnType<typeof openContainedParent> | null = null;
    let descriptor: number | null = null;
    try {
      parent = openContainedParent(root, name, options.write && options.creation !== 3 && options.creation !== 5);
      let flags = options.write ? options.read ? constants.O_RDWR : constants.O_WRONLY : constants.O_RDONLY;
      if (options.creation === 1) flags |= constants.O_CREAT | constants.O_EXCL;
      if (options.creation === 2) flags |= constants.O_CREAT | constants.O_TRUNC;
      if (options.creation === 4) flags |= constants.O_CREAT;
      if (options.creation === 5) flags |= constants.O_TRUNC;
      descriptor = openSync(`/proc/self/fd/${parent.descriptor}/${parent.leaf}`, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      if (!fstatSync(descriptor).isFile()) { closeSync(descriptor); descriptor = null; return null; }
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor);
      if (!(error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "EEXIST" || error.code === "EACCES" || error.code === "ELOOP" || error.code === "ENOTDIR"))) throw error;
      const bytes = !options.write && options.creation === 3 ? resources.get(name) : undefined;
      if (bytes === undefined) return null;
      let closed = false;
      const check = () => { if (closed) throw new Error("Native file is closed"); };
      return { read(offset, length) { check(); position(offset, length); return bytes.slice(offset, offset + length); },
        write() { throw new Error("Native mounted file is read-only"); }, size() { check(); return bytes.length; },
        truncate() { throw new Error("Native mounted file is read-only"); }, flush() { check(); }, close() { closed = true; } };
    } finally { if (parent !== null) closeSync(parent.descriptor); }
    if (descriptor === null) throw new Error("Native file descriptor was not opened");
    let owned: number | null = descriptor;
    const fd = () => { if (owned === null) throw new Error("Native file is closed"); return owned; };
    const result: WindowsFile = {
      read(offset, length) { if (!options.read) throw new Error("Native file is not readable"); position(offset, length); const bytes = new Uint8Array(length); return bytes.subarray(0, readSync(fd(), bytes, 0, length, offset)); },
      write(offset, bytes) { if (!options.write) throw new Error("Native file is not writable"); position(offset, bytes.length); return writeSync(fd(), bytes, 0, bytes.length, offset); },
      size() { return fstatSync(fd()).size; },
      truncate(length) { if (!options.write) throw new Error("Native file is not writable"); position(length, 0); ftruncateSync(fd(), length); },
      flush() { fsyncSync(fd()); },
      close() { if (owned !== null) { const current = owned; owned = null; closeSync(current); } },
    };
    return result;
  };
}
function position(offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(offset + length)) throw new RangeError("Invalid native file range");
}
