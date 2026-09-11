// SPDX-License-Identifier: GPL-2.0-or-later
import { SdlWindow, type SdlWindowOptions } from "./sdl.ts";

export type PlatformOptions =
  | { readonly kind: "dedicated" }
  | { readonly kind: "graphical"; readonly window: SdlWindowOptions };

export class DedicatedPlatform {
  readonly kind = "dedicated";
  private stopped = false;

  get closed(): boolean { return this.stopped; }
  close(): void { this.stopped = true; }
  [Symbol.dispose](): void { this.close(); }
}

export class GraphicalPlatform {
  readonly kind = "graphical";
  constructor(readonly window: SdlWindow) {}

  get closed(): boolean { return this.window.closed; }
  close(): void { this.window.close(); }
  [Symbol.dispose](): void { this.close(); }
}

/** Importing the platform opens no library. Dedicated startup never initializes SDL. */
export function openPlatform(options: PlatformOptions): DedicatedPlatform | GraphicalPlatform {
  switch (options.kind) {
    case "dedicated": return new DedicatedPlatform();
    case "graphical": return new GraphicalPlatform(SdlWindow.open(options.window));
  }
}
