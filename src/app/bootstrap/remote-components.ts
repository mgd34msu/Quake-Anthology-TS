import { ApplicationModPresentations, type ApplicationModPresentationsOptions, type ComponentClientCommandRequest } from "./mod-presentations.ts";
import { componentMediaControl, preparePresentationAudio, preparePresentationShaders } from "./component-media.ts";
import type { WorldSeatPresentation } from "./presentation.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";
import type { UnifiedRemotePresentation } from "./network/remote-unified.ts";

/** A remote seat uses the same original cgame collection and retained media as a local seat. */
export class RemoteComponentView {
  private readonly clients: ApplicationModPresentations;
  private commands: ComponentClientCommandRequest[] = [];
  private closed = false;
  constructor(private readonly remote: UnifiedRemotePresentation, private readonly options: ApplicationModPresentationsOptions) {
    this.clients = new ApplicationModPresentations({ ...options, presentationMedia: componentMediaControl(remote.media, options.audio, options.assets),
      queueCommand: request => { if (this.closed) throw new Error("Remote component view is retired"); this.commands.push(request); } });
  }
  get pendingCommands(): boolean { return this.commands.length !== 0 || this.clients.pendingCommands; }
  async prepareMedia(events: readonly SimulationPresentationEvent[], music: boolean): Promise<void> {
    if (this.closed) throw new Error("Remote component view is retired");
    const commands = this.commands; this.commands = [];
    for (const command of commands) await this.clients.dispatchCommand(command);
    await preparePresentationAudio(this.remote.media, this.options.audio,
      music ? events : events.filter(event => event.kind === "presentation-owner"));
    await preparePresentationShaders(this.remote.media, this.options.assets);
  }
  async prepare(presentation: WorldSeatPresentation, events: readonly SimulationPresentationEvent[], frame: number): Promise<void> {
    if (this.closed) throw new Error("Remote component view is retired");
    await this.clients.prepare([presentation], this.remote.modPresentationSources(), events, frame);
  }
  close(): void { if (this.closed) return; this.closed = true; this.commands = []; this.clients.close(); }
}
