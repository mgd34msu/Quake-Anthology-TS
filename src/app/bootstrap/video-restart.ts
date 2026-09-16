import type { CommandContext } from "../../contracts/common.ts";
import type { CommandBuffer } from "../../core/commands/index.ts";
import type { SdlWindow } from "../../platform/sdl.ts";
import type { ApplicationCapture } from "./capture.ts";
import type { ApplicationInput } from "./input.ts";
import type { ApplicationQ3Client } from "./q3-client.ts";
import type { NativeRenderer } from "./renderer.ts";

export interface PreparedVideoPresentation {
  validatePublication(): void;
  restart(): Promise<void>;
}

export interface VideoRestartHost {
  capture(): ApplicationCapture | null;
  prepare(): Promise<PreparedVideoPresentation | null>;
  publishWindow(window: SdlWindow): void;
  published(kind: "cpu" | "gl"): void | Promise<void>;
  settled(): void;
  print(text: string, source?: CommandContext): void;
  failed(error: unknown): Promise<never>;
}

/** Video requests run between source frames on the retained client. */
export class ApplicationVideoRestart {
  private requested: { readonly kind: "cpu" | "gl"; readonly source?: CommandContext } | null = null;
  private running = false;
  private closed = false;
  private unregister: (() => void) | null = null;
  private completed = 0;

  constructor(private readonly renderer: NativeRenderer, private readonly host: VideoRestartHost) {}

  get pending(): boolean { return this.requested !== null || this.running; }
  get generation(): number { return this.completed; }

  request(kind = this.renderer.window.backend, source?: CommandContext): void {
    if (this.closed) throw new Error("Video restart owner has retired");
    this.requested = { kind, ...(source === undefined ? {} : { source }) };
  }

  register(commands: CommandBuffer): void {
    if (this.unregister !== null) throw new Error("Video restart command already registered");
    const handler: Parameters<CommandBuffer["register"]>[1] = command => {
      let origin = command.source.origin;
      while (origin.kind === "script") origin = origin.caller;
      if (origin.kind === "remote-client") { this.host.print("vid_restart is a local client command.\n", command.source); return undefined; }
      const kind = command.args[0];
      if (command.args.length > 1 || kind !== undefined && kind !== "cpu" && kind !== "gl") {
        this.host.print("vid_restart [cpu|gl]\n", command.source); return undefined;
      }
      this.request(kind, command.source); return undefined;
    };
    if (!commands.register("vid_restart", handler, { summary: "Restart the client renderer while retaining the current game.",
      usage: "vid_restart [cpu|gl]", examples: ["vid_restart", "vid_restart cpu", "vid_restart gl"] }))
      throw new Error("Video restart command belongs to another owner");
    this.unregister = () => { commands.unregister("vid_restart", handler); };
  }

  async drain(): Promise<boolean> {
    if (this.running) throw new Error("Video restart is already preparing");
    const request = this.requested;
    if (this.closed || request === null || this.host.capture()?.pendingReadback) return false;
    const { kind, source } = request;
    this.requested = null; this.running = true;
    let surface: ReturnType<NativeRenderer["prepareRestart"]> | null = null;
    let presentation: PreparedVideoPresentation | null = null;
    let retire: (() => void) | null = null;
    const previousWindow = this.renderer.window;
    let inputPublished = false;
    try {
      await this.host.capture()?.drain();
      surface = this.renderer.prepareRestart(kind);
      presentation = await this.host.prepare();
      if (this.closed) throw new Error("Video restart was cancelled during preparation");
      presentation?.validatePublication();
      this.host.publishWindow(surface.window); inputPublished = true;
      retire = surface.publish();
      await presentation?.restart();
      if (this.closed) throw new Error("Video restart was cancelled after publication");
      await this.host.published(kind);
      retire(); retire = null;
      this.host.print(`Renderer restarted (${kind}).\n`, source);
      return true;
    } catch (error) {
      const failures: unknown[] = [error];
      const published = surface?.published === true;
      if (!published) {
        if (inputPublished) { try { this.host.publishWindow(previousWindow); } catch (cleanup) { failures.push(cleanup); } }
        try { surface?.discard(); } catch (cleanup) { failures.push(cleanup); }
      } else {
        try { retire?.(); } catch (cleanup) { failures.push(cleanup); }
      }
      if (published || failures.length > 1 || error instanceof AggregateError)
        return this.host.failed(new AggregateError(failures, "Video restart publication failed"));
      this.host.print(`Video restart rejected: ${error instanceof Error ? error.message : String(error)}\n`, source);
      return false;
    } finally { this.completed++; this.running = false; this.host.settled(); }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true; this.requested = null;
    this.unregister?.(); this.unregister = null;
  }
}

export interface VideoGuestSeat {
  readonly client: ApplicationQ3Client;
  viewport(window: SdlWindow): ReturnType<ApplicationQ3Client["options"]["viewport"]>;
  publish(client: ApplicationQ3Client): void;
}

export function prepareVideoGuests(input: ApplicationInput, renderer: NativeRenderer,
  seats: readonly VideoGuestSeat[], assertCurrent: () => void): PreparedVideoPresentation | null {
  if (seats.length === 0) return null;
  const guests = seats.map(seat => ({ seat, reopen: seat.client.captureVideoReopen() }));
  return {
    validatePublication: assertCurrent,
    restart: async () => {
      const errors: unknown[] = [];
      for (const { seat } of guests) {
        try { await seat.client.shutdown(); } catch (error) { errors.push(error); }
        finally { try { seat.client.close(); } catch (error) { errors.push(error); } }
      }
      if (errors.length !== 0) throw new AggregateError(errors, "Previous guest video shutdown failed");
      for (const { seat, reopen } of guests) {
        const registration = input.clientCommandRegistration(seat.client.options.local.player.seat.id);
        let replacement: ApplicationQ3Client | null = null;
        try {
          replacement = await reopen({ renderer, viewport: () => seat.viewport(renderer.window), commandRegistration: registration });
          seat.publish(replacement);
        } catch (error) {
          const failures: unknown[] = [error];
          try { replacement?.close(); } catch (cleanup) { failures.push(cleanup); }
          try { registration.close(); } catch (cleanup) { failures.push(cleanup); }
          if (failures.length > 1) throw new AggregateError(failures, "Guest video reopen and cleanup failed");
          throw error;
        }
      }
    },
  };
}
