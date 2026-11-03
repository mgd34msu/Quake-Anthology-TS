// SPDX-License-Identifier: GPL-2.0-or-later
/* World replacement transaction. GPL-2.0-or-later. */
import type { SeatId } from "../../contracts/identity.ts";
import type { NativeUiArt } from "../../ui/common/index.ts";
import type { GraphicalApplication, LocalQ3GuestBrowser, LocalQ3GuestWorld, NativeQ2SeatClient, SavedApplicationClients } from "./application.ts";
import type { ApplicationAssets } from "./assets.ts";
import type { ApplicationAudio } from "./audio.ts";
import type { ApplicationCapture } from "./capture.ts";
import type { ApplicationQ3Client } from "./q3-client.ts";
import type { ConsoleScriptFiles } from "./config-scripts.ts";
import type { ApplicationEffects } from "./effects.ts";
import type { ApplicationInput } from "./input.ts";
import type { WorldSeatPresentation } from "./presentation.ts";
import type { ApplicationBotService } from "./simulation/bots.ts";
import type { SharedSimulation } from "./simulation/index.ts";
import type { Q3GuestMapTransition } from "./simulation/q3/guest-runtime.ts";

/**
 * Everything one world replacement acquires before the session publishes it. Each field is owned by the
 * transaction until commit hands it to the application; `rollback` releases whatever is still held, in
 * reverse order of acquisition, and collects every close failure instead of stopping at the first.
 */
export class WorldReplacement {
  simulation: SharedSimulation | null = null;
  assets: ApplicationAssets | null = null;
  art: NativeUiArt | null = null;
  bots: ApplicationBotService | null = null;
  localGuest: LocalQ3GuestWorld | null = null;
  guestBrowser: LocalQ3GuestBrowser | null;
  savedClients: SavedApplicationClients | null = null;
  audio: ApplicationAudio | null = null;
  effects: ApplicationEffects | null = null;
  input: ApplicationInput | null = null;
  /** Configuration scripts staged for publication; null once the application has taken them. */
  scripts: ConsoleScriptFiles | null = null;
  guestTransition: Q3GuestMapTransition | null = null;
  graphical: GraphicalApplication | null = null;
  capture: ApplicationCapture | null = null;
  readonly presentations: WorldSeatPresentation[] = [];
  readonly nativeQ2 = new Map<SeatId, NativeQ2SeatClient>();
  readonly clients: ApplicationQ3Client[] = [];
  /** The session published the new world; rollback is no longer possible. */
  committed = false;
  /** The previous native or guest source was already torn down, so a failure leaves no world to return to. */
  nativeCommitted = false;

  constructor(
    private readonly content: { close(): unknown },
    private readonly previousGuestBrowser: LocalQ3GuestBrowser | null,
  ) {
    this.guestBrowser = previousGuestBrowser;
  }

  /** Release the staged scripts to the caller, which then owns closing them. */
  takeScripts(): ConsoleScriptFiles | null {
    const scripts = this.scripts;
    this.scripts = null;
    return scripts;
  }

  /** Close every resource still owned by the transaction, then throw the original failure with any close failures attached. */
  async rollback(error: unknown, retainedRenderer: { flush(): unknown } | null): Promise<never> {
    const errors: unknown[] = [error];
    const discard = async (close: () => unknown): Promise<void> => {
      try {
        await close();
      } catch (failure) {
        errors.push(failure);
      }
    };
    await discard(() => this.capture?.close());
    for (const client of this.clients) await discard(() => client.close());
    for (const { state } of this.localGuest?.seats.values() ?? []) state.retire();
    this.localGuest?.seats.clear();
    if (this.guestBrowser !== null && this.guestBrowser !== this.previousGuestBrowser) {
      const browser = this.guestBrowser;
      await discard(() => browser.view.close());
      await discard(() => browser.host.close());
    }
    await discard(() => this.graphical?.modPresentations.close());
    for (const presentation of this.presentations) await discard(() => presentation.close());
    for (const seat of this.nativeQ2.values()) await discard(() => seat.effects.close());
    await discard(() => this.audio?.close());
    await discard(() => this.effects?.close());
    await discard(() => this.input?.close());
    await discard(() => this.scripts?.close());
    await discard(() => this.bots?.close());
    if (this.guestTransition !== null) await discard(() => this.simulation?.shutdownQ3Guest());
    await discard(() => this.simulation?.q3Guest()?.discard());
    await discard(() => this.simulation?.close());
    for (const client of this.savedClients?.added ?? []) await discard(() => client.close());
    await discard(() => this.art?.close());
    await discard(() => this.assets?.close());
    if (retainedRenderer !== null) await discard(() => retainedRenderer.flush());
    await discard(() => this.content.close());
    if (errors.length > 1) throw new AggregateError(errors, "World preparation failed");
    throw error;
  }
}
