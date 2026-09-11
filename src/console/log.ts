import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export class ConsoleLog {
  private fd: number | null;
  constructor(readonly path: string, append = true) {
    mkdirSync(dirname(path), { recursive: true }); this.fd = openSync(path, append ? "a" : "w", 0o600);
  }
  write(text: string): void {
    if (this.fd === null) throw new Error("Console log is closed");
    const bytes = Buffer.from(text, "utf8");
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(this.fd, bytes, offset, bytes.length - offset);
      if (written === 0) throw new Error("Console log write made no progress");
      offset += written;
    }
  }
  close(): void { const fd = this.fd; if (fd !== null) { this.fd = null; closeSync(fd); } }
}
