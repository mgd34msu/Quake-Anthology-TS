import type { CommandBuffer } from "../core/commands/index.ts";
import type { CvarRegistry } from "../core/cvars/index.ts";

export type RestartKind = "video" | "input" | "audio";
export interface RestartService { restart(): void | Promise<void>; }
/** Resource owners perform their own restart, retaining session state outside their lease. */
export class RestartControls {
  private readonly pending: RestartKind[] = [];
  private running = false;
  constructor(private readonly services: Readonly<Record<RestartKind, RestartService>>, private readonly cvars: CvarRegistry,
    private readonly latched: Readonly<Record<RestartKind, readonly string[]>>) {}
  request(kind: RestartKind): void { if (!this.pending.includes(kind)) this.pending.push(kind); }
  async drain(): Promise<void> {
    if (this.running) throw new Error("Restart controls already have an active operation");
    this.running = true;
    try {
      let kind = this.pending.shift();
      while (kind !== undefined) {
        for (const name of this.latched[kind]) this.cvars.applyLatched(name);
        await this.services[kind].restart(); kind = this.pending.shift();
      }
    } finally { this.running = false; }
  }
  register(commands: CommandBuffer): () => void {
    const registered: string[] = [];
    for (const [name, kind] of [["vid_restart", "video"], ["in_restart", "input"], ["snd_restart", "audio"]] satisfies readonly (readonly [string, RestartKind])[]) {
      if (commands.register(name, () => { this.request(kind); })) registered.push(name);
    }
    return () => { for (const name of registered) commands.unregister(name); };
  }
}
