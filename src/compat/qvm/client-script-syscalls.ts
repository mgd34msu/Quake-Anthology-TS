/* Q3 client PC traps over the shared botlib source parser. GPL-2.0-or-later. */
import type { MountedContent } from "../../content/mounts/index.ts";
import { BotMemory } from "../../bots/behavior/library/memory.ts";
import { allocateScriptSource } from "../../ui/common/legacy/script/lexer.ts";
import type { SourceScriptStorage } from "../../ui/common/legacy/script/memory.ts";
import { ScriptSourceReader } from "../../ui/common/legacy/script/preprocessor.ts";
import type { IncludeRequest, ScriptGlobalDefines, ScriptSource } from "../../ui/common/legacy/script/preprocessor.ts";
import { QvmCgameImport, QvmUiImport } from "./abi.ts";
import { QVM_SCRIPT_TOKEN_BYTES, writeQvmScriptToken } from "./script-record.ts";
import type { QvmHostCall, QvmHostResult } from "./syscalls.ts";

export interface QvmClientScriptServices {
  readonly mounts: MountedContent;
  readonly globals: ScriptGlobalDefines;
  assertCurrent(): void;
  print(text: string): void;
}

/** Module-owned source handles share the existing global defines and mounted resource owner. */
export class QvmClientScripts {
  private readonly readers = new Map<number, ScriptSourceReader>();
  private readonly pending = new Set<number>();
  private readonly memory = new BotMemory();
  private closed = false;
  private operations = 0;
  constructor(readonly services: QvmClientScriptServices) {}

  assertCurrent(): void {
    if (this.closed) throw new Error("QVM client scripts have been closed");
    this.services.assertCurrent();
  }
  closeAll(): void {
    if (this.closed) return;
    this.closed = true;
    for (const reader of this.readers.values()) reader.dispose();
    this.readers.clear();
    this.pending.clear();
    if (this.operations === 0) this.memory.dispose();
  }
  private completed(): void {
    this.operations--;
    if (this.closed && this.operations === 0) this.memory.dispose();
  }
  addDefine(text: string): number { this.assertCurrent(); return Number(this.services.globals.add(text)); }

  private async source(filename: string): Promise<SourceScriptStorage | undefined> {
    this.assertCurrent();
    if (filename.length >= 32000) throw new RangeError("Com_sprintf formatted bot path exceeds its 32000-byte source buffer");
    if (filename.length >= 64) { this.services.print(`Com_sprintf: overflow of ${filename.length} in 64\n`); this.assertCurrent(); }
    const resource = await this.services.mounts.open(filename.slice(0, 63));
    this.assertCurrent();
    if (resource === null) return undefined;
    const source = allocateScriptSource(resource.bytes.length, filename, this.memory);
    source.buffer.set(resource.bytes);
    source.compress();
    return source;
  }
  private async include(request: IncludeRequest): Promise<ScriptSource | undefined> {
    if (request.kind === "system" && request.requestedPath.length >= 64) throw new RangeError("PC include system filename exceeds 64 source bytes");
    const filename = request.requestedPath.replace(/[\\/]+/g, "/");
    const source = await this.source(filename);
    if (source !== undefined || request.kind === "system") return source;
    const retry = (request.includePath ?? "") + filename;
    if (retry.length >= 64) throw new RangeError("PC quoted include retry exceeds 64 source bytes");
    return this.source(retry);
  }
  async load(filename: string): Promise<number> {
    this.assertCurrent();
    let handle = 1;
    while (handle < 64 && (this.readers.has(handle) || this.pending.has(handle))) handle++;
    if (handle === 64) return 0;
    this.pending.add(handle);
    this.operations++;
    try {
      const root = await this.source(filename);
      if (root === undefined) return 0;
      try { this.assertCurrent(); }
      catch (error) { root.dispose(); throw error; }
      const reader = ScriptSourceReader.open(root, { resolve: request => this.include(request) }, {
        memory: this.memory, globals: this.services.globals,
        report: diagnostic => { this.assertCurrent(); this.services.print(`file ${diagnostic.location.path}, line ${diagnostic.location.line}: ${diagnostic.message}\n`); this.assertCurrent(); },
      });
      this.readers.set(handle, reader);
      return handle;
    } finally { this.pending.delete(handle); this.completed(); }
  }
  free(handle: number): number {
    this.assertCurrent();
    const reader = this.readers.get(handle);
    if (reader === undefined) return 0;
    reader.dispose(); this.readers.delete(handle); return 1;
  }
  async read(handle: number, publish: (reader: ScriptSourceReader) => void): Promise<number> {
    this.assertCurrent();
    const reader = this.readers.get(handle);
    if (reader === undefined) return 0;
    this.operations++;
    try {
      let read: boolean;
      try { read = await reader.nextAsync(() => this.assertCurrent()) !== undefined; }
      catch (error) { if (!reader.isSourceFailure(error)) throw error; read = false; }
      this.assertCurrent();
      if (this.readers.get(handle) !== reader) throw new Error("QVM source handle was freed during token read");
      publish(reader);
      return Number(read);
    } finally { this.completed(); }
  }

  position(handle: number) { this.assertCurrent(); return this.readers.get(handle)?.position; }
}

export function qvmClientScriptSyscall(call: QvmHostCall, scripts: QvmClientScripts): QvmHostResult | null {
  if (call.kind !== "engine" || call.role === "qagame") return null;
  const define = call.role === "ui" ? QvmUiImport.UI_PC_ADD_GLOBAL_DEFINE : QvmCgameImport.CG_PC_ADD_GLOBAL_DEFINE;
  const load = call.role === "ui" ? QvmUiImport.UI_PC_LOAD_SOURCE : QvmCgameImport.CG_PC_LOAD_SOURCE;
  const { guest, words } = call;
  if (call.code === define) return scripts.addDefine(guest.readString(words.getInt32(4, true)));
  switch (call.code - load) {
    case 0: return scripts.load(guest.readString(words.getInt32(4, true)));
    case 1: return scripts.free(words.getInt32(4, true));
    case 2: {
      const handle = words.getInt32(4, true), pointer = words.getInt32(8, true);
      return scripts.read(handle, reader => writeQvmScriptToken(guest.view(pointer, QVM_SCRIPT_TOKEN_BYTES), reader.rawToken));
    }
    case 3: {
      const position = scripts.position(words.getInt32(4, true));
      if (position === undefined) return 0;
      const filename = position.filename.slice(0, 64);
      guest.writeBoundedString(words.getInt32(8, true), filename, filename.length + 1);
      guest.view(words.getInt32(12, true), 4).setInt32(0, position.line, true);
      return 1;
    }
    default: return null;
  }
}
