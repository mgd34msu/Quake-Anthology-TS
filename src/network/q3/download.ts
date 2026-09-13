// SV_WriteDownloadToClient, SV_NextDownload_f and CL_ParseDownload source windows.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import { CommonError } from "../../core/common-error.ts";
import type { MessageWriter } from "./message.ts";
import { ServerOpcode } from "./server-message.ts";
import type { Download } from "./server-message.ts";
import { checkQ3DownloadName, q3StockPackage } from "./pure.ts";

export interface Q3DownloadReadFile { readonly size: number; read(target: Uint8Array): number; close(): void; }
export interface Q3DownloadServerBindings {
  open(name: string): Q3DownloadReadFile | null;
  readonly enabled: () => boolean;
  readonly pure: () => boolean;
  drop(reason: string): void;
  print(text: string): void;
}
export interface Q3DownloadRate { readonly rate: number; readonly maxRate: number; readonly snapshotMsec: number; }
export class Q3ServerDownload {
  name = "";
  private file: Q3DownloadReadFile | null = null;
  private readonly blocks = Array.from({ length: 8 }, () => new Uint8Array(2048));
  private readonly blockSizes = new Int32Array(8);
  private size = 0;
  private count = 0;
  private currentBlock = 0;
  private clientBlock = 0;
  private xmitBlock = 0;
  private eof = false;
  private sendTime = 0;
  constructor(readonly bindings: Q3DownloadServerBindings) {}
  begin(name: string): void {
    this.close();
    const nul = name.indexOf("\0");
    this.name = name.slice(0, Math.min(63, nul < 0 ? name.length : nul));
  }
  close(): void { const file = this.file; this.file = null; this.name = ""; file?.close(); }
  acknowledge(block: number, time: number): void {
    if (block !== this.clientBlock) { this.bindings.drop("broken download"); return; }
    if (this.blockSizes[this.clientBlock % 8] === 0) { this.close(); return; }
    this.sendTime = time; this.clientBlock = (this.clientBlock + 1) | 0;
  }
  private open(writer: MessageWriter): boolean {
    const stock = q3StockPackage(this.name), enabled = this.bindings.enabled();
    if (enabled && stock === null) {
      checkQ3DownloadName(this.name);
      this.file = this.bindings.open(this.name);
      this.size = this.file?.size ?? -1;
      if (this.size > 0 && this.size <= 0x7fffffff) {
        this.currentBlock = 0; this.clientBlock = 0; this.xmitBlock = 0; this.count = 0; this.eof = false; return true;
      }
    }
    const error = stock !== null ? (stock === "missionpack"
      ? `Cannot autodownload Team Arena file "${this.name}"\nThe Team Arena mission pack can be found in your local game store.`
      : `Cannot autodownload id pk3 file "${this.name}"`)
      : !enabled ? `Could not download "${this.name}" because autodownloading is disabled on the server.\n\n${this.bindings.pure()
        ? "You will need to get this file elsewhere before you can connect to this pure server.\n"
        : "The server you are connecting to is not a pure server, set autodownload to No in your settings and you might be able to join the game anyway.\n"}`
      : `File "${this.name}" not found on server for autodownloading.\n`;
    writer.writeByte(ServerOpcode.Download); writer.writeShort(0); writer.writeLong(-1); writer.writeString(error.slice(0, 1023));
    this.close(); return false;
  }
  write(writer: MessageWriter, time: number, settings: Q3DownloadRate): void {
    if (this.name === "" || (this.file === null && !this.open(writer))) return;
    const file = this.file;
    if (file === null) throw new Error("Opened Q3 download has no file");
    while (this.currentBlock - this.clientBlock < 8 && this.size !== this.count) {
      const index = this.currentBlock % 8, buffer = this.blocks[index];
      if (buffer === undefined) throw new RangeError("Missing download block storage");
      const bytes = file.read(buffer);
      if (!Number.isInteger(bytes) || bytes <= 0 || bytes > buffer.length || this.count + bytes > this.size) {
        this.close(); throw new Error("Source download file changed or returned an invalid read");
      }
      this.blockSizes[index] = bytes; this.count = (this.count + bytes) | 0; this.currentBlock = (this.currentBlock + 1) | 0;
    }
    if (this.count === this.size && !this.eof && this.currentBlock - this.clientBlock < 8) {
      this.blockSizes[this.currentBlock % 8] = 0; this.currentBlock = (this.currentBlock + 1) | 0; this.eof = true;
    }
    let rate = settings.rate;
    if (settings.maxRate !== 0) rate = Math.min(rate, Math.max(1000, settings.maxRate));
    let blocks = rate === 0 ? 1 : Math.trunc(((Math.trunc(Math.imul(rate, settings.snapshotMsec) / 1000) + 2048) | 0) / 2048);
    if (blocks < 0) blocks = 1;
    while (blocks-- > 0) {
      if (this.clientBlock === this.currentBlock) return;
      if (this.xmitBlock === this.currentBlock) { if (((time - this.sendTime) | 0) > 1000) this.xmitBlock = this.clientBlock; else return; }
      const index = this.xmitBlock % 8, size = this.blockSizes[index], buffer = this.blocks[index];
      if (size === undefined || buffer === undefined) throw new RangeError("Missing download window slot");
      writer.writeByte(ServerOpcode.Download); writer.writeShort(this.xmitBlock);
      if (this.xmitBlock === 0) writer.writeLong(this.size);
      writer.writeShort(size); if (size !== 0) writer.writeData(buffer.subarray(0, size));
      this.xmitBlock = (this.xmitBlock + 1) | 0; this.sendTime = time;
    }
  }
}
export interface Q3DownloadWriteFile { writeBytes(bytes: Uint8Array): void; close(): void; }
export interface Q3DownloadClientBindings {
  assertCurrent(): void;
  /** Mount/filesystem owner enforces exclusive creation, containment and no replacement. */
  openTemporary(path: string): Q3DownloadWriteFile | null;
  publishTemporary(temporary: string, destination: string): void | Promise<void>;
  reliable(text: string): void;
  sendPacket(): void;
  progress(name: string, count: number, size: number): void;
  completed(): Promise<void>;
}
export class Q3ClientDownload {
  private file: Q3DownloadWriteFile | null = null;
  private name = "";
  private temporary = "";
  private block = 0;
  private count = 0;
  private size = 0;
  constructor(readonly bindings: Q3DownloadClientBindings) {}
  begin(remote: string, local: string): void {
    this.bindings.assertCurrent(); checkQ3DownloadName(remote); checkQ3DownloadName(local); this.close();
    this.name = local; this.temporary = `${local}.tmp`; this.block = 0; this.count = 0; this.size = 0;
    this.bindings.progress(remote, 0, 0); this.bindings.reliable(`download ${remote}`);
  }
  publishSize(size: number): number { this.size = size; this.bindings.progress(this.name, this.count, size); return this.size; }
  async receive(download: Download): Promise<void> {
    this.bindings.assertCurrent();
    if (download.kind === "error") throw new CommonError("drop", download.message);
    const block = download.kind === "start" ? 0 : download.number;
    if (block !== this.block) return;
    if (this.file === null) {
      if (this.temporary === "") { this.bindings.reliable("stopdl"); return; }
      this.file = this.bindings.openTemporary(this.temporary); this.bindings.assertCurrent();
      if (this.file === null) { this.bindings.reliable("stopdl"); await this.bindings.completed(); return; }
    }
    if (download.data.length !== 0) { this.file.writeBytes(download.data); this.bindings.assertCurrent(); }
    this.bindings.reliable(`nextdl ${this.block}`); this.block = (this.block + 1) | 0;
    this.count = (this.count + download.data.length) | 0; this.bindings.progress(this.name, this.count, this.size);
    if (download.data.length === 0) {
      this.file.close(); this.file = null; this.bindings.assertCurrent();
      await this.bindings.publishTemporary(this.temporary, this.name); this.bindings.assertCurrent();
      this.name = ""; this.temporary = ""; this.bindings.progress("", this.count, this.size);
      this.bindings.sendPacket(); this.bindings.assertCurrent(); this.bindings.sendPacket(); this.bindings.assertCurrent();
      await this.bindings.completed();
    }
  }
  close(): void { const file = this.file; this.file = null; this.name = ""; this.temporary = ""; file?.close(); }
}
