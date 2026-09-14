import { closeSync, constants, fstatSync, ftruncateSync, mkdirSync, openSync, writeSync } from "node:fs";
import { containedFileParts, openContainedParent } from "./contained.ts";

export type WritableFileMode = "write" | "append" | "append-sync";
export type WritableSeekOrigin = "current" | "end" | "set";
export interface WritableFileCheckpoint { readonly path: string; readonly mode: WritableFileMode; readonly position: number; }

function platformFailure(error: unknown): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    && "syscall" in error && typeof error.syscall === "string";
}

/** Unbuffered descriptors already satisfy the source append-sync fflush guarantee. */
export class WritableBinaryFile {
  private ended = false;
  private position: number;
  constructor(private readonly descriptor: number, readonly mode: WritableFileMode, private readonly print: (text: string) => void,
    private readonly path: string, position = mode === "write" ? 0 : fstatSync(descriptor).size) {
    this.position = position;
  }
  captureCheckpoint(): WritableFileCheckpoint { this.live(); return { path: this.path, mode: this.mode, position: this.position }; }
  private live(): void { if (this.ended) throw new Error("Writable file is closed"); }
  write(bytes: Uint8Array): number {
    this.live();
    let offset = 0, retried = false;
    while (offset < bytes.length) {
      let written: number;
      try { written = writeSync(this.descriptor, bytes, offset, bytes.length - offset, this.mode === "write" ? this.position : null); }
      catch (error) { if (!platformFailure(error)) throw error; written = 0; }
      if (written === 0) {
        if (retried) { this.print("FS_Write: 0 bytes written\n"); this.live(); return 0; }
        retried = true; continue;
      }
      offset += written;
      this.position = this.mode === "write" ? this.position + written : fstatSync(this.descriptor).size;
    }
    return bytes.length;
  }
  seek(offset: number, origin: WritableSeekOrigin): number {
    this.live();
    if (!Number.isSafeInteger(offset)) return -1;
    let length: number;
    try { length = fstatSync(this.descriptor).size; }
    catch (error) { if (!platformFailure(error)) throw error; return -1; }
    const position = offset + (origin === "current" ? this.position : origin === "end" ? length : 0);
    if (!Number.isSafeInteger(position) || position < 0) return -1;
    this.position = position;
    return 0;
  }
  close(): void { if (!this.ended) { this.ended = true; closeSync(this.descriptor); } }
}

/** One explicitly scoped user-data directory; no package or installed-content root is inferred. */
export class UserFileStore {
  constructor(readonly root: string) {}
  /** Preserve external contents; append streams may create their destination on a fresh install. */
  resume(state: WritableFileCheckpoint, print: (text: string) => void = () => {}): WritableBinaryFile {
    containedFileParts(state.path);
    if (!Number.isSafeInteger(state.position) || state.position < 0) throw new RangeError("Invalid writable checkpoint cursor");
    if (state.mode !== "write" && state.mode !== "append" && state.mode !== "append-sync") throw new RangeError("Invalid writable checkpoint mode");
    const append = state.mode !== "write";
    if (append) mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const parent = openContainedParent(this.root, state.path, append);
    try {
      const descriptor = openSync(`/proc/self/fd/${parent.descriptor}/${parent.leaf}`,
        constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (append ? constants.O_APPEND | constants.O_CREAT : 0), 0o600);
      try {
        if (!fstatSync(descriptor).isFile()) throw new Error("Writable source file is not a regular file");
        return new WritableBinaryFile(descriptor, state.mode, print, state.path, state.position);
      } catch (error) { closeSync(descriptor); throw error; }
    } finally { closeSync(parent.descriptor); }
  }
  open(name: string, mode: WritableFileMode, print: (text: string) => void = () => {}): WritableBinaryFile | null {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const parent = openContainedParent(this.root, name, true);
    try {
      let descriptor: number;
      try {
        descriptor = openSync(`/proc/self/fd/${parent.descriptor}/${parent.leaf}`,
          constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK
          | (mode === "write" ? 0 : constants.O_APPEND), 0o600);
      } catch (error) { if (!platformFailure(error)) throw error; return null; }
      try {
        if (!fstatSync(descriptor).isFile()) throw new Error("Writable source file is not a regular file");
        if (mode === "write") ftruncateSync(descriptor, 0);
        return new WritableBinaryFile(descriptor, mode, print, name);
      } catch (error) { closeSync(descriptor); throw error; }
    } finally { closeSync(parent.descriptor); }
  }
}
