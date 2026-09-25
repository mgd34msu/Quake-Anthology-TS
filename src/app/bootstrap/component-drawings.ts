import type { ProviderId } from "../../contracts/identity.ts";
import type { PresentationOwner } from "../../contracts/presentation.ts";
import { WorldDebugLineStore } from "../../debug/world.ts";
import type { DebugLine } from "../../debug/shapes.ts";
import { WorldTextStore, type WorldText } from "../../text/world.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";

interface DrawingOwner {
  readonly owner: PresentationOwner;
  readonly lines: WorldDebugLineStore;
  readonly text: WorldTextStore;
  retired: boolean;
}

/** Each viewing seat consumes source drawing events with their activation and server clock. */
export class ComponentDrawings {
  private readonly owners = new Map<ProviderId, DrawingOwner>();
  receive(events: readonly SimulationPresentationEvent[]): void {
    for (const source of events) {
      const retired = source.kind === "presentation-owner" && source.event.kind === "retired";
      if (!retired && (source.kind !== "q2-rerelease" || source.event.kind !== "world-text" && source.event.kind !== "debug-shapes")) continue;
      const owner = source.kind === "presentation-owner" ? source.event.owner : source.owner;
      if (owner === undefined) continue;
      let state = this.owners.get(owner.provider);
      if (state !== undefined && state.owner.generation > owner.generation) continue;
      if (state === undefined || state.owner.generation < owner.generation) {
        state = { owner, lines: new WorldDebugLineStore(), text: new WorldTextStore(), retired: false };
        this.owners.set(owner.provider, state);
      }
      if (retired) { state.lines.clear(); state.text.clear(); state.retired = true; continue; }
      if (state.retired || source.kind !== "q2-rerelease") continue;
      if (source.event.kind === "world-text") state.text.submit({ ...source.event.text, content: source.content }, source.seconds, source.event.lifetime);
      else if (source.event.kind === "debug-shapes") state.lines.submit(source.event.lines, source.seconds * 1000, source.event.lifetimeMilliseconds);
    }
  }
  snapshot(seconds: number, frame: number): { readonly text: readonly WorldText[]; readonly lines: readonly DebugLine[] } {
    const text: WorldText[] = [], lines: DebugLine[] = [];
    for (const state of this.owners.values()) if (!state.retired) {
      text.push(...state.text.snapshot(seconds, frame)); lines.push(...state.lines.snapshot(seconds * 1000, frame));
    }
    return { text, lines };
  }
  clear(): void { this.owners.clear(); }
}
