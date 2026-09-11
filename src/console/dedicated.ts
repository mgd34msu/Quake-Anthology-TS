import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { CommandBuffer } from "../core/commands/index.ts";

/** Dedicated stdin is independent of SDL and retains partial UTF-8/lines between polls. */
export class DedicatedConsole {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";
  private readonly lines: string[] = [];
  private ended = false;
  private closed = false;
  private error: Error | null = null;
  private readonly onData = (data: Buffer | string): void => {
    this.pending += typeof data === "string" ? data : this.decoder.write(data);
    this.split();
  };
  private readonly onEnd = (): void => {
    this.pending += this.decoder.end(); this.split();
    if (this.pending !== "") this.lines.push(this.pending);
    this.pending = ""; this.ended = true;
  };
  private readonly onError = (error: Error): void => { this.error = error; };
  constructor(private readonly input: Readable = process.stdin) {
    input.on("data", this.onData); input.on("end", this.onEnd); input.on("error", this.onError);
  }
  private split(): void {
    let index = this.pending.indexOf("\n");
    while (index >= 0) {
      this.lines.push(this.pending.slice(0, index).replace(/\r$/, "")); this.pending = this.pending.slice(index + 1);
      index = this.pending.indexOf("\n");
    }
  }
  get eof(): boolean { return this.ended && this.lines.length === 0; }
  drain(commands: CommandBuffer): number {
    if (this.closed) throw new Error("Dedicated console is closed");
    if (this.error !== null) throw this.error;
    const lines = this.lines.splice(0);
    for (const line of lines) commands.append(`${line}\n`);
    return lines.length;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; this.input.off("data", this.onData); this.input.off("end", this.onEnd); this.input.off("error", this.onError);
  }
}
