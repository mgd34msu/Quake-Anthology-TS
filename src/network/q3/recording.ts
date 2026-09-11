// CL_Record_f and CL_WriteDemoMessage, cl_main.c. GPL-2.0-or-later.
import type { Q3ClientConnection } from "./client.ts";
import { encodeServerMessage } from "./server-message.ts";

export interface Q3DemoSink { writeBytes(bytes: Uint8Array): void; close(): void; }
/** The filesystem owner chooses and opens the .dm_68 path. */
export class Q3DemoRecording {
  private ended = false;
  constructor(readonly client: Q3ClientConnection, private readonly file: Q3DemoSink) {
    const state = client.copyGamestate();
    client.demoWaiting = true;
    const bytes = encodeServerMessage(client.reliable.sequence, [state], { product: client.product, messageNumber: client.serverMessageSequence - 1,
      reliableSequence: client.reliable.sequence, serverCommandSequence: client.serverCommandSequence, parseEntitiesNumber: 0,
      baseline: number => client.baselines[number] ?? null, history: () => null }, client.sourceState);
    this.write((client.serverMessageSequence - 1) | 0, bytes);
  }
  private write(sequence: number, bytes: Uint8Array): void {
    const header = new Uint8Array(8), view = new DataView(header.buffer);
    view.setInt32(0, sequence, true); view.setInt32(4, bytes.length, true);
    this.file.writeBytes(header); this.file.writeBytes(bytes);
  }
  /** Called after parsing each decrypted server payload, with the channel header removed. */
  append(bytes: Uint8Array): void {
    if (this.ended) throw new Error("Q3 demo recording is closed");
    if (!this.client.demoWaiting) this.write(this.client.serverMessageSequence, bytes);
  }
  stop(): void {
    if (this.ended) return;
    this.ended = true;
    const terminator = new Uint8Array(8); terminator.fill(255);
    try { this.file.writeBytes(terminator); } finally { this.file.close(); }
  }
  close(): void { if (!this.ended) { this.ended = true; this.file.close(); } }
}
