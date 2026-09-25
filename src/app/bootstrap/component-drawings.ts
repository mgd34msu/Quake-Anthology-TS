import type { ProviderId } from "../../contracts/identity.ts";
import type { PresentationOwner } from "../../contracts/presentation.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { Palette, Rect } from "../../contracts/render.ts";
import { SourceDebugGraph, debugGraphColor, type DebugGraphSettings } from "../../render/debug-graph.ts";
import type { Draw2D, PictureAsset } from "../../text/draw2d.ts";
import { WorldDebugLineStore } from "../../debug/world.ts";
import type { DebugLine } from "../../debug/shapes.ts";
import { WorldTextStore, type WorldText } from "../../text/world.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";

interface DrawingOwner {
  readonly owner: PresentationOwner;
  readonly lines: WorldDebugLineStore;
  readonly text: WorldTextStore;
  graph: { readonly content: ContentId; readonly samples: SourceDebugGraph; palette: Palette | null } | null;
  sequence: number;
  retired: boolean;
}

/** Each viewing seat consumes source drawing events with their activation and server clock. */
export class ComponentDrawings {
  private readonly owners = new Map<ProviderId, DrawingOwner>();
  receive(events: readonly SimulationPresentationEvent[]): void {
    for (const source of events) {
      const lifecycle = source.kind === "presentation-owner";
      if (!lifecycle && source.kind !== "debug-graph" && (source.kind !== "q2-rerelease" || source.event.kind !== "world-text" && source.event.kind !== "debug-shapes")) continue;
      const owner = source.kind === "presentation-owner" ? source.event.owner : source.owner;
      if (owner === undefined) continue;
      let state = this.owners.get(owner.provider);
      if (state !== undefined && state.owner.generation > owner.generation) continue;
      if (state === undefined || state.owner.generation < owner.generation) {
        state = { owner, lines: new WorldDebugLineStore(), text: new WorldTextStore(), graph: null, sequence: -1, retired: false };
        this.owners.set(owner.provider, state);
      }
      if (source.sequence <= state.sequence) continue;
      state.sequence = source.sequence;
      if (source.kind === "presentation-owner") {
        state.lines.clear(); state.text.clear(); state.graph = null;
        if (source.event.kind === "retired") state.retired = true;
        continue;
      }
      if (!state.retired && source.kind === "debug-graph") {
        state.graph ??= { content: source.content, samples: new SourceDebugGraph(), palette: null };
        if (state.graph.content !== source.content) throw new Error("Component debug graph changed source content");
        state.graph.samples.add(source.event.value, source.event.color);
        continue;
      }
      if (state.retired || source.kind !== "q2-rerelease") continue;
      if (source.event.kind === "world-text") state.text.submit({ ...source.event.text, content: source.content }, source.seconds, source.event.lifetime);
      else if (source.event.kind === "debug-shapes") state.lines.submit(source.event.lines, source.seconds * 1000, source.event.lifetimeMilliseconds);
    }
  }
  async prepareGraphs(loadPalette: (content: ContentId) => Promise<Palette>): Promise<void> {
    for (const state of this.owners.values()) {
      const graph = state.graph;
      if (state.retired || graph === null || graph.palette !== null) continue;
      const palette = await loadPalette(graph.content);
      if (!state.retired && state.graph === graph && this.owners.get(state.owner.provider) === state) graph.palette = palette;
    }
  }
  drawGraphs(draw: Draw2D, view: Rect, settings: DebugGraphSettings, white: PictureAsset): number {
    if (settings.debuggraph === 0 && settings.timegraph === 0 && settings.netgraph === 0 || !Number.isFinite(settings.height) || Math.trunc(settings.height) <= 0) return 0;
    let bottom = view.y + view.height;
    for (const state of this.owners.values()) {
      const graph = state.graph, palette = graph?.palette;
      if (state.retired || graph === null || palette == null) continue;
      graph.samples.draw(draw, { ...view, height: bottom - view.y }, settings, index => debugGraphColor(palette, index), white);
      bottom -= settings.height;
      if (bottom <= view.y) break;
    }
    return Math.min(view.height, view.y + view.height - bottom);
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
