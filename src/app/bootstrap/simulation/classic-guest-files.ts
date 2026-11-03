// SPDX-License-Identifier: GPL-2.0-or-later
import { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, openSync, readSync, writeSync } from "node:fs";
import type { WindowsCapabilities, WindowsFile } from "../../../guest/runtime/windows/index.ts";
import { containedFileParts, openContainedParent } from "../../../core/files/contained.ts";

/** Files a DLL could use to run code or console commands in a later session, or to replace other content. */
const PROTECTED_WRITE = /\.(?:cfg|rc|dll|so|dylib|exe|bat|sh|pak|pk3|qvm|bsp)$/i;
const MAXIMUM_FILE_BYTES = 64 * 1024 * 1024;
const MAXIMUM_GROWTH_BYTES = 512 * 1024 * 1024;
const MAXIMUM_WRITTEN_FILES = 256;

/** DLL CRT files are relative to the selected writable game directory, never the installation. */
export function classicGuestFiles(root: string, resources: ReadonlyMap<string, Uint8Array> = new Map<string, Uint8Array>()): NonNullable<WindowsCapabilities["openFile"]> {
  let grown = 0, writtenFiles = 0;
  return (path, options) => {
    const name = path.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
    containedFileParts(name);
    if (!Number.isInteger(options.creation) || options.creation < 1 || options.creation > 5) throw new RangeError("Invalid native file creation disposition");
    if (!options.write && options.creation !== 3) return null;
    // A refused open reads as a missing file to the guest.
    if (options.write && (PROTECTED_WRITE.test(name) || writtenFiles >= MAXIMUM_WRITTEN_FILES)) return null;
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
    if (options.write) writtenFiles++;
    let highWater = fstatSync(descriptor).size;
    const fd = () => { if (owned === null) throw new Error("Native file is closed"); return owned; };
    const result: WindowsFile = {
      read(offset, length) { if (!options.read) throw new Error("Native file is not readable"); position(offset, length); const bytes = new Uint8Array(length); return bytes.subarray(0, readSync(fd(), bytes, 0, length, offset)); },
      write(offset, bytes) {
        if (!options.write) throw new Error("Native file is not writable");
        position(offset, bytes.length);
        const end = offset + bytes.length, growth = Math.max(0, end - highWater);
        // Past a quota the guest sees a short write, as on a full disk.
        if (end > MAXIMUM_FILE_BYTES || grown + growth > MAXIMUM_GROWTH_BYTES) return 0;
        const written = writeSync(fd(), bytes, 0, bytes.length, offset);
        grown += growth; highWater = Math.max(highWater, offset + written);
        return written;
      },
      size() { return fstatSync(fd()).size; },
      truncate(length) { if (!options.write) throw new Error("Native file is not writable"); position(length, 0); if (length > MAXIMUM_FILE_BYTES) return; ftruncateSync(fd(), length); highWater = length; },
      flush() { fsyncSync(fd()); },
      close() { if (owned !== null) { const current = owned; owned = null; closeSync(current); } },
    };
    return result;
  };
}
function position(offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(offset + length)) throw new RangeError("Invalid native file range");
}
