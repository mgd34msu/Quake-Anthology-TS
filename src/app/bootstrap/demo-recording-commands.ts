import type { CommandContext } from "../../contracts/common.ts";
import type { CommandBuffer, CommandHandler } from "../../core/commands/index.ts";
import { DemoRecording, type DemoRecordingSeed, type DemoRecordingSink } from "./demo-recording.ts";

export interface DemoRecordingHost {
  root(): string;
  seed(source: CommandContext): Promise<DemoRecordingSeed>;
  /** Returns an identity-checked disposer for this sink alone. */
  attach(sink: DemoRecordingSink): () => void;
  reconnectRecording(source: CommandContext, sink: DemoRecordingSink): Promise<() => void>;
  print(text: string): void;
  stage(intent: DemoRecordingIntent): void;
}
export type DemoRecordingIntent = { readonly kind: 'record'; readonly name: string | undefined; readonly source: CommandContext }
  | { readonly kind: 'rerecord'; readonly name: string; readonly source: CommandContext }
  | { readonly kind: 'stop'; readonly source: CommandContext };

/** Lives on the retained client; its feed is detached before source retirement. */
export class ClientDemoRecording {
  private current: { readonly recording: DemoRecording; readonly detach: () => void } | null = null;
  private busy = false;
  constructor(private readonly host: DemoRecordingHost) {}
  get path(): string | null { return this.current?.recording.path ?? null; }
  attach(commands: CommandBuffer): () => void {
    const handlers = new Map<string, CommandHandler>();
    for (const name of ["record", "rerecord", "stop", "stoprecord"]) {
      const handler: CommandHandler = command => {
        let origin = command.source.origin;
        while (origin.kind === "script") origin = origin.caller;
        if (origin.kind === "remote-client") { this.host.print(`${name} is a local recording command.\n`); return; }
        if (name === 'record') {
          if (command.args.length > 1) { this.host.print('Usage: record [name]\n'); return; }
          this.host.stage({ kind: 'record', name: command.args[0], source: command.source });
        } else if (name === "rerecord") {
          const filename = command.args[0];
          if (filename === undefined || command.args.length !== 1) { this.host.print(`Usage: ${name} <name>\n`); return; }
          this.host.stage({ kind: name, name: filename, source: command.source });
        } else if (command.args.length !== 0) this.host.print(`Usage: ${name}\n`);
        else this.host.stage({ kind: 'stop', source: command.source });
      };
      const starts = name === 'record' || name === 'rerecord';
      if (commands.register(name, handler, { summary: name === 'rerecord' ? 'Reconnect to the QuakeWorld server and record its signon.' : name === "record" ? "Record the current session to a demo." : "Finish the current demo recording.",
        usage: name === 'record' ? 'record [name]' : starts ? `${name} <name>` : name, examples: [starts ? `${name} session1` : name] })) handlers.set(name, handler);
      else this.host.print(`Recording command ${name} is already owned by another command.\n`);
    }
    return () => { for (const [name, handler] of handlers) commands.unregister(name, handler); handlers.clear(); };
  }
  async start(name: string | undefined, source: CommandContext): Promise<void> {
    if (this.busy) throw new Error("Recording operation is already in progress");
    this.busy = true;
    try {
      const seed = await this.host.seed(source);
      if (name === undefined && seed.identity.kind !== 'q3') throw new Error('Usage: record <name>');
      await this.finish();
      const recording = await this.open(name, seed);
      try { this.current = { recording, detach: this.host.attach(this.sink(recording)) }; }
      catch (error) { await recording.abort(); throw error; }
      this.host.print(`Recording ${recording.path}\n`);
    } finally { this.busy = false; }
  }
  private async open(name: string | undefined, seed: DemoRecordingSeed): Promise<DemoRecording> {
    if (name !== undefined) return DemoRecording.open(this.host.root(), name, seed);
    for (let index = 0; index < 10000; index++) {
      try { return await DemoRecording.open(this.host.root(), `demo${String(index).padStart(4, '0')}`, seed); }
      catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error; }
    }
    throw new Error('No unused demo0000–demo9999 recording name remains');
  }
  async rerecord(name: string, source: CommandContext): Promise<void> {
    if (this.busy) throw new Error('Recording operation is already in progress');
    this.busy = true;
    try {
      const seed = await this.host.seed(source);
      if (seed.identity.kind !== 'qw') throw new Error('rerecord requires a QuakeWorld server');
      const root = this.host.root();
      await this.finish();
      const recording = await DemoRecording.open(root, name, { identity: seed.identity,
        packets: [{ kind: 'qw', record: { kind: 'sequences', seconds: 0, outgoing: 0, incoming: 0 } }] });
      try { this.current = { recording, detach: await this.host.reconnectRecording(source, this.sink(recording)) }; }
      catch (error) { await recording.abort(); throw error; }
      this.host.print(`Recording ${recording.path}\n`);
    } finally { this.busy = false; }
  }
  private sink(recording: DemoRecording): DemoRecordingSink {
    return { append: async packet => {
        try { await recording.append(packet); }
        catch (error) {
          const current = this.current;
          if (current?.recording !== recording) return;
          this.current = null; current.detach();
          try { await recording.abort(); }
          finally { this.host.print(`Demo recording failed: ${error instanceof Error ? error.message : String(error)}\n`); }
        }
    } };
  }
  private async finish(): Promise<void> {
    const current = this.current;
    if (current === null) return;
    this.current = null;
    current.detach();
    await current.recording.stop();
    this.host.print(`Completed demo ${current.recording.path}\n`);
  }
  async stop(): Promise<void> {
    if (this.busy) throw new Error("Recording operation is already in progress");
    this.busy = true;
    try { await this.finish(); } finally { this.busy = false; }
  }
}
