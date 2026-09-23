import type { ProviderId } from "../../contracts/identity.ts";
import type { Q3SceneContent } from "../../content/q3/presentation/scene.ts";
import { reserveSourceEntityRange } from "../../render/scene/submissions.ts";
import { createWorldSurfaceAdmission } from "../../render/scene/world.ts";
import type { WorldViewInput } from "../../render/scene/world.ts";
import type { ActiveModPresentation } from "../../world/session/mod-presentations.ts";
import type { ApplicationEffectFrame } from "./effects.ts";
import { ApplicationModPresentation } from "./mod-presentation.ts";
import type { ApplicationModPresentationOptions } from "./mod-presentation.ts";
import type { WorldSeatPresentation } from "./presentation.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";

export type ApplicationModPresentationsOptions = Pick<ApplicationModPresentationOptions,
  "assets" | "audio" | "queries" | "print" | "nextFrame" | "clock">;
interface Entry {
  readonly consumer: ApplicationModPresentation;
  readonly unbind: () => void;
  scene: Q3SceneContent | null;
  time: number;
}
const empty: ApplicationEffectFrame = { q3Admissions: [], operations: [], lights: [], q3Lights: [] };

/** The local seats share source events; each cgame keeps its own viewer, media and transient state. */
export class ApplicationModPresentations {
  private readonly entries = new Map<WorldSeatPresentation, Map<ProviderId, Entry>>();
  private closed = false;
  private busy = false;
  constructor(private readonly options: ApplicationModPresentationsOptions) {}
  private assertOpen(): void { if (this.closed) throw new Error("Component presentation collection is closed"); }
  private remove(entries: Map<ProviderId, Entry>, id: ProviderId, entry: Entry): void {
    entries.delete(id);
    const failures: unknown[] = [];
    try { entry.unbind(); } catch (error) { failures.push(error); }
    try { entry.consumer.close(); } catch (error) { failures.push(error); }
    if (failures.length !== 0) throw new AggregateError(failures, "Component presentation removal failed");
  }
  private async create(presentation: WorldSeatPresentation, source: ActiveModPresentation): Promise<Entry> {
    const reject = (): never => { throw new Error("Component cgame requires an unsupported destination view or overlay takeover"); };
    const consumer = await ApplicationModPresentation.create({ ...this.options, source, viewer: presentation.local.player.actor,
      seat: presentation.local.player.seat.id, viewport: presentation.viewport, viewOrigin: () => presentation.camera().origin, viewAxis: () => presentation.camera().axis,
      output: { scene: reject, command: reject, text: reject, listener: reject } });
    try {
      this.assertOpen();
      const entry: Entry = { consumer, scene: null, time: 0, unbind: presentation.bindComponentEffects((camera, order, q1Fog) => {
        if (entry.scene === null || !consumer.owns(source, presentation.local.player.actor)) return empty;
        const scene = entry.scene, firstEntity = reserveSourceEntityRange(order, scene.admission.entities.length);
        const lights = scene.lights.map(light => ({ origin: light.origin, radius: light.radius, color: light.color, minimum: 0 }));
        const q3Lights = scene.lights.map(light => ({ origin: light.origin, radius: light.radius, color: light.color, additive: light.additive })).slice(0, 32);
        const input: WorldViewInput = { source: createWorldSurfaceAdmission(order), camera, time: { kind: "milliseconds", value: entry.time },
          target: { kind: "seat", seat: presentation.local.player.seat.id }, lights, q3Lights, ...(q1Fog === undefined ? {} : { q1Fog }) };
        return { q3Admissions: [scene.admission], operations: consumer.renderer.operations(scene, input, firstEntity,
          { noWorldModel: false, splitScreen: presentation.splitScreen, supplementalViewWeapon: false }), lights, q3Lights };
      }) };
      return entry;
    } catch (error) {
      try { consumer.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Component presentation creation and cleanup failed"); }
      throw error;
    }
  }
  async prepare(presentations: readonly WorldSeatPresentation[], sources: readonly ActiveModPresentation[],
    events: readonly SimulationPresentationEvent[], frameSequence: number): Promise<void> {
    this.assertOpen(); if (this.busy) throw new Error("Component presentation preparation is already running");
    this.busy = true;
    try {
      const available = new Map(sources.map(source => [source.prepared.source.id, source]));
      if (available.size !== sources.length) throw new Error("Duplicate component presentation source identity");
      for (const [presentation, entries] of this.entries) {
        for (const [id, entry] of entries) {
          const source = available.get(id);
          if (!presentations.includes(presentation) || source === undefined || !entry.consumer.owns(source, presentation.local.player.actor))
            this.remove(entries, id, entry);
        }
        if (entries.size === 0) this.entries.delete(presentation);
      }
      for (const presentation of presentations) for (const source of sources) {
        this.assertOpen();
        const viewer = presentation.local.player.actor, context = source.source.context(viewer);
        const id = source.prepared.source.id;
        let entries = this.entries.get(presentation), entry = entries?.get(id);
        if (context === null) {
          if (entries !== undefined && entry !== undefined) this.remove(entries, id, entry);
          continue;
        }
        if (entry === undefined) {
          entry = await this.create(presentation, source);
          if (entries === undefined) { entries = new Map<ProviderId, Entry>(); this.entries.set(presentation, entries); }
          entries.set(id, entry);
        }
        try {
          if (source.prepared.declaration.runtime === "qvm-player-events") for (const event of events) {
            if (event.kind !== "q3-source" || event.event.kind !== "player-event" || event.recipient !== undefined && !event.recipient.equals(viewer)) continue;
            const actual = event.event.source, expected = source.prepared.source;
            if (actual.module.id !== expected.id || actual.module.artifactPath !== expected.artifactPath || actual.module.digest !== expected.digest
              || actual.module.revision !== expected.revision || actual.abiProfile !== source.source.abiProfile) continue;
            await entry.consumer.consume(event.event, event.sequence); this.assertOpen();
          }
          entry.scene = await entry.consumer.frame(frameSequence); this.assertOpen(); entry.time = entry.consumer.time;
        } catch (error) {
          try { if (entries !== undefined) this.remove(entries, id, entry); }
          catch (cleanup) { throw new AggregateError([error, cleanup], "Component presentation preparation and cleanup failed"); }
          throw error;
        }
      }
    } finally { this.busy = false; }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const failures: unknown[] = [];
    for (const entries of this.entries.values()) for (const [id, entry] of entries) {
      try { this.remove(entries, id, entry); } catch (error) { failures.push(error); }
    }
    this.entries.clear();
    if (failures.length !== 0) throw new AggregateError(failures, "Component presentation collection cleanup failed");
  }
}
