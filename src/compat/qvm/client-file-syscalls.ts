/* Q3 cl_cgame.c/cl_ui.c filesystem traps over the selected mounted content. GPL-2.0-or-later. */
import { CommonError } from "../../core/common-error.ts";
import type { MountedContent, OpenedResource } from "../../content/mounts/index.ts";
import { QvmCgameImport, QvmUiImport } from "./abi.ts";
import type { QvmHostCall, QvmHostResult } from "./syscalls.ts";

interface ReadHandle { readonly resource: OpenedResource; position: number; }
export interface QvmClientFileServices {
  readonly mounts: MountedContent;
  readonly writable: null;
  assertCurrent(): void;
}

/** Guest slots belong to this module lifetime; resource bytes retain their actual mount provenance. */
export class QvmClientFiles {
  private readonly handles = new Map<number, ReadHandle>();
  private closed = false;
  constructor(readonly services: QvmClientFileServices) {}

  assertCurrent(): void {
    if (this.closed) throw new Error("QVM client files have been closed");
    this.services.assertCurrent();
  }
  closeAll(): void { this.closed = true; this.handles.clear(); }

  async open(path: string, publish: ((slot: number) => void) | null): Promise<number> {
    this.assertCurrent();
    // FS_FOpenFileRead strips one leading separator and rejects these source paths.
    if (path.startsWith("/") || path.startsWith("\\")) path = path.slice(1);
    if (path.includes("..") || path.includes("::") || path.includes("q3key")) { publish?.(0); return publish === null ? 0 : -1; }
    const resource = await this.services.mounts.open(path);
    this.assertCurrent();
    if (publish === null) return resource === null ? 0 : 1;
    if (resource === null) { publish(0); return -1; }
    let slot = 1;
    while (this.handles.has(slot) && slot < 64) slot++;
    if (slot === 64) throw new CommonError("drop", "FS_HandleForFile: none free");
    this.handles.set(slot, { resource, position: 0 });
    try { publish(slot); }
    catch (error) { this.handles.delete(slot); throw error; }
    return resource.bytes.length;
  }

  private handle(slot: number): ReadHandle {
    this.assertCurrent();
    if (!Number.isInteger(slot) || slot < 1 || slot > 63) throw new CommonError("drop", "FS_FileForHandle: out of range");
    const handle = this.handles.get(slot);
    if (handle === undefined) throw new CommonError("drop", "FS_FileForHandle: NULL");
    return handle;
  }
  read(slot: number, destination: Uint8Array): void {
    this.assertCurrent();
    if (slot === 0) return;
    const handle = this.handle(slot), bytes = handle.resource.bytes;
    const count = Math.max(0, Math.min(destination.length, bytes.length - handle.position));
    destination.set(bytes.subarray(handle.position, handle.position + count));
    handle.position += count;
  }
  close(slot: number): void {
    this.assertCurrent();
    if (slot === 0) return;
    if (!Number.isInteger(slot) || slot < 1 || slot > 63) throw new CommonError("drop", "FS_FileForHandle: out of range");
    this.handles.delete(slot);
  }
  seek(slot: number, offset: number, origin: number): number {
    const handle = this.handle(slot), provenance = handle.resource.reference.provenance;
    if (provenance.kind === "archive" && provenance.mount.format === "pk3") {
      if (offset >= 65536) throw new CommonError("fatal", "ZIP FILE FSEEK NOT YET IMPLEMENTED\n");
      if (offset < 0) throw new RangeError("Negative ZIP seek exceeds the source scratch buffer");
      handle.position = Math.min(offset, handle.resource.bytes.length);
      return offset === 0 && origin === 2 ? 0 : handle.position;
    }
    // Read-mode handles are streamed: Unix Sys_StreamSeek performs the first FS_Seek,
    // then the outer source FS_Seek repeats it. Only SEEK_CUR accumulates twice.
    const seek = (): number => {
      let position: number;
      switch (origin) {
        case 0: position = handle.position + offset; break;
        case 1: position = handle.resource.bytes.length + offset; break;
        case 2: position = offset; break;
        default: throw new CommonError("fatal", "Bad origin in FS_Seek\n");
      }
      if (position < 0) return -1;
      handle.position = position;
      return 0;
    };
    seek();
    return seek();
  }
  async list(path: string, extension: string): Promise<readonly string[]> {
    this.assertCurrent();
    if (path.toLowerCase() === "$modlist") throw new Error("QVM $modlist requires an installed-mod catalog owner");
    const names = await this.services.mounts.listFiles(path, extension);
    this.assertCurrent();
    return names;
  }
}

/** Null is unhandled; FS_READ and FS_WRITE return zero rather than their byte count. */
export function qvmClientFileSyscall(call: QvmHostCall, files: QvmClientFiles): QvmHostResult | null {
  if (call.kind !== "engine" || call.role === "qagame") return null;
  const ui = call.role === "ui", trap = call.code, { words, guest } = call;
  const open = ui ? QvmUiImport.UI_FS_FOPENFILE : QvmCgameImport.CG_FS_FOPENFILE;
  const seek = ui ? QvmUiImport.UI_FS_SEEK : QvmCgameImport.CG_FS_SEEK;
  if (trap !== open && trap !== open + 1 && trap !== open + 2 && trap !== open + 3 && trap !== seek
    && !(ui && trap === QvmUiImport.UI_FS_GETFILELIST)) return null;
  files.assertCurrent();
  if (trap === open) {
    const pathWord = words.getInt32(4, true), destination = words.getInt32(8, true), mode = words.getInt32(12, true);
    if (mode < 0 || mode > 3) throw new CommonError("fatal", "FSH_FOpenFile: bad mode");
    if (mode !== 0) throw new Error("QVM client filesystem has no writable owner");
    if (pathWord === 0) throw new CommonError("fatal", "FS_FOpenFileRead: NULL 'filename' parameter passed\n");
    if (destination !== 0) guest.view(destination, 4);
    return files.open(guest.readString(pathWord), destination === 0 ? null : slot => {
      files.assertCurrent(); guest.view(destination, 4).setInt32(0, slot, true);
    });
  }
  if (trap === open + 1 || trap === open + 2) {
    const pointer = words.getInt32(4, true), length = words.getInt32(8, true), slot = words.getInt32(12, true);
    if (slot === 0) return 0;
    if (trap === open + 2) throw new Error("QVM client filesystem has no writable owner");
    files.read(slot, pointer === 0 && length === 0 ? new Uint8Array(0) : guest.span(pointer, length));
    return 0;
  }
  if (trap === open + 3) { files.close(words.getInt32(4, true)); return 0; }
  if (trap === seek) return files.seek(words.getInt32(4, true), words.getInt32(8, true), words.getInt32(12, true));
  const path = guest.readString(words.getInt32(4, true)), extension = guest.readString(words.getInt32(8, true));
  const pointer = words.getInt32(12, true), length = words.getInt32(16, true);
  if (length === 0) throw new RangeError("File listing requires a nonempty destination");
  guest.span(pointer, length);
  return files.list(path, extension).then(names => {
    files.assertCurrent();
    const destination = guest.span(pointer, length);
    destination[0] = 0;
    let offset = 0, count = 0;
    for (const name of names) {
      if (offset + name.length + 2 >= destination.length) break;
      for (let index = 0; index < name.length; index++) destination[offset++] = name.charCodeAt(index);
      destination[offset++] = 0;
      count++;
    }
    return count;
  });
}
