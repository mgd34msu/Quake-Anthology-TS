import { mkdir, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Vec3 } from "../../contracts/math.ts";
import type { Q2ProtocolIdentity } from "../../contracts/protocol.ts";
import { normalizeResourcePath } from "../../content/mounts/paths.ts";
import { writeNetQuakeDemoHeader, writeNetQuakeDemoRecord, writeQuakeWorldDemoRecord } from "../../network/q1/demos.ts";
import type { QuakeWorldDemoRecord } from "../../network/q1/demos.ts";
import { finishQ2Demo, writeQ2DemoRecord } from "../../network/q2/demo.ts";
import { mvdMagic, frameMvdMessage } from "../../network/q2/mvd-recording.ts";
import { encodeDemoMessage, finishDemo } from "../../network/q3/demo.ts";

export type DemoRecordingPacket =
  | { readonly kind: "q2-server"; readonly message: Uint8Array }
  | { readonly kind: "mvd"; readonly message: Uint8Array }
  | { readonly kind: "q1"; readonly message: Uint8Array; readonly viewAngles: Vec3 }
  | { readonly kind: "qw"; readonly record: QuakeWorldDemoRecord }
  | { readonly kind: "q2"; readonly message: Uint8Array }
  | { readonly kind: "q3"; readonly sequence: number; readonly message: Uint8Array };

export type DemoRecordingIdentity =
  | { readonly kind: "q2-server"; readonly protocol: 34 }
  | { readonly kind: "mvd"; readonly revision: 2009 | 2010 | 2011 | 2012 | 2013 | 3038 }
  | { readonly kind: "q1"; readonly protocol: 15 | 666 | 999; readonly track: number }
  | { readonly kind: "qw"; readonly protocol: 28 }
  | { readonly kind: "q2"; readonly protocol: Q2ProtocolIdentity }
  | { readonly kind: "q3"; readonly protocol: 68 };

export interface DemoRecordingSink { append(packet: DemoRecordingPacket): Promise<void>; }
export interface DemoRecordingSeed {
  readonly identity: DemoRecordingIdentity;
  /** Complete signon/gamestate and baselines; the producer then admits a non-delta first frame. */
  readonly packets: readonly DemoRecordingPacket[];
}

export function recordingPath(root: string, name: string, identity: DemoRecordingIdentity): string {
  const normalized = normalizeResourcePath(name);
  const extension = identity.kind === "mvd" ? ".mvd" : identity.kind === "q1" ? ".dem" : identity.kind === "qw" ? ".qwd" : identity.kind === "q2" || identity.kind === "q2-server" ? ".dm2" : ".dm_68";
  const filename = normalized.toLowerCase().endsWith(extension) ? normalized : `${normalized}${extension}`;
  const prefix = (identity.kind === "mvd" || identity.kind === "q2-server" || identity.kind === "q2" || identity.kind === "q3") && !filename.toLowerCase().startsWith("demos/") ? "demos" : "";
  return join(root, prefix, filename);
}

/** Ordered disk writes over accepted protocol messages, with no retained recording-sized buffer. */
export class DemoRecording implements DemoRecordingSink {
  private writes: Promise<void> = Promise.resolve();
  private failure: { readonly error: unknown } | null = null;
  private finishing: Promise<void> | null = null;
  private accepting = true;
  private angles: Vec3 = { x: 0, y: 0, z: 0 };
  private seconds = 0;
  private constructor(readonly path: string, readonly identity: DemoRecordingIdentity, private readonly file: FileHandle) {}

  static async open(root: string, name: string, seed: DemoRecordingSeed): Promise<DemoRecording> {
    if (seed.packets.length === 0 || seed.packets.some(packet => packet.kind !== seed.identity.kind)) throw new Error("Recording requires matching initial source state");
    const path = recordingPath(root, name, seed.identity);
    await mkdir(dirname(path), { recursive: true });
    const recording = new DemoRecording(path, seed.identity, await open(path, "wx"));
    try {
      if (seed.identity.kind === "mvd") await recording.write(mvdMagic());
      if (seed.identity.kind === "q1") await recording.write(writeNetQuakeDemoHeader(seed.identity.track));
      for (const packet of seed.packets) await recording.append(packet);
      return recording;
    } catch (error) { await recording.abort(); throw error; }
  }

  append(packet: DemoRecordingPacket): Promise<void> {
    if (!this.accepting) return Promise.reject(new Error("Recording is stopped"));
    if (packet.kind !== this.identity.kind) return Promise.reject(new Error("Recording source protocol changed"));
    let bytes: Uint8Array;
    switch (packet.kind) {
      case "mvd": bytes = frameMvdMessage(packet.message); break;
      case "q1": this.angles = { ...packet.viewAngles }; bytes = writeNetQuakeDemoRecord(packet); break;
      case "qw": this.seconds = packet.record.seconds; bytes = writeQuakeWorldDemoRecord(packet.record); break;
      case "q2-server":
      case "q2": bytes = writeQ2DemoRecord(packet.message); break;
      case "q3": bytes = encodeDemoMessage({ kind: "message", sequence: packet.sequence, payload: packet.message }); break;
    }
    return this.write(bytes);
  }

  private write(bytes: Uint8Array): Promise<void> {
    const operation = this.writes.then(async () => {
      if (this.failure !== null) throw this.failure.error;
      for (let offset = 0; offset < bytes.length;) {
        const result = await this.file.write(bytes, offset, bytes.length - offset);
        if (result.bytesWritten === 0) throw new Error("Recording write made no progress");
        offset += result.bytesWritten;
      }
    });
    this.writes = operation.catch((error: unknown) => { this.failure ??= { error }; });
    return operation;
  }

  stop(): Promise<void> {
    if (this.finishing !== null) return this.finishing;
    this.accepting = false;
    const footer = this.identity.kind === "q2-server" ? new Uint8Array(0) : this.identity.kind === "mvd" ? new Uint8Array(2) : this.identity.kind === "q1" ? writeNetQuakeDemoRecord({ viewAngles: this.angles, message: new Uint8Array([2]) })
      : this.identity.kind === "qw" ? writeQuakeWorldDemoRecord({ kind: "packet", seconds: this.seconds,
        message: new Uint8Array([255, 255, 255, 255, 2, ...new TextEncoder().encode("EndOfDemo"), 0]) })
      : this.identity.kind === "q2" ? finishQ2Demo() : finishDemo();
    this.finishing = (async () => {
      try { await this.write(footer); await this.file.sync(); }
      finally { await this.file.close(); }
    })();
    return this.finishing;
  }

  abort(): Promise<void> {
    if (this.finishing !== null) return this.finishing;
    this.accepting = false;
    this.finishing = (async () => { await this.writes; await this.file.close(); })();
    return this.finishing;
  }
}
