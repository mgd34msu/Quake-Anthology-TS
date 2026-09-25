import type { ActorId, ProviderId } from "../../../contracts/identity.ts";
import { modInstanceProvider, sameModIdentity } from "../../../contracts/mods.ts";
import { samePresentationOwner, type PresentationOwner } from "../../../contracts/presentation.ts";
import type { ActiveModClientPresentation, ModClientPresentationFrame } from "../../../world/session/mod-client-presentation.ts";
import type { LoadedApplicationContent } from "../content.ts";
import type { PresentationState } from "../presentation-state.ts";
import type { UnifiedComponentFrames, UnifiedComponentUpdate } from "./unified-components.ts";
import type { UnifiedNativeCamera } from "./unified-types.ts";
import type { UnifiedNativeFrame, UnifiedNativeState } from "./unified-native-components.ts";

type NativeFrame = Extract<ModClientPresentationFrame, { kind: "native" }>;
interface Entry {
  readonly active: ActiveModClientPresentation;
  readonly edition: "classic" | "rerelease";
  readonly view: boolean;
  metadata: UnifiedNativeState;
  configs: ReadonlyMap<number, string> | null;
  frame: { readonly viewer: ActorId; readonly value: NativeFrame } | null;
}
export interface UnifiedNativeConsumerOptions {
  readonly content: Pick<LoadedApplicationContent, "catalog"> & { readonly preparedMods: readonly Pick<LoadedApplicationContent["preparedMods"][number], "identity" | "clientPresentation">[] };
  readonly events: PresentationState;
  assertCurrent(): void;
  viewer(): ActorId | null;
}

/** Native client imports are authored by the server module; clients consume only its public readout. */
export class UnifiedNativeConsumers {
  private entries = new Map<ProviderId, Entry>();
  private revision = 0;
  private legacy = false;
  private closed = false;
  constructor(private readonly options: UnifiedNativeConsumerOptions) {}
  private current(): void { this.options.assertCurrent(); if (this.closed) throw new Error("Remote native component collection is retired"); }
  private create(metadata: UnifiedNativeState, cameraOnly = false): Entry {
    const prepared = this.options.content.preparedMods.find(candidate => sameModIdentity(candidate.identity, metadata.identity));
    if (prepared?.clientPresentation === undefined || modInstanceProvider(metadata.identity.selection) !== metadata.owner.provider)
      throw new Error("Remote native presentation differs from its locally qualified component");
    const admission = prepared.clientPresentation;
    const mode = admission.hud === "none" ? null : admission.hud === "replace" ? "replace-status" : "layout-overlay";
    if (!cameraOnly && (metadata.hud?.mode ?? null) !== mode) throw new Error("Remote native HUD differs from its admitted mode");
    const product = this.options.content.catalog.product(metadata.identity.source.content);
    if (product.expectation.family !== "q2" || product.expectation.edition !== "classic" && product.expectation.edition !== "rerelease") throw new Error("Remote native presentation has no Q2 source edition");
    const edition = product.expectation.edition;
    const entry: Entry = { metadata, configs: null, frame: null, edition, view: admission.view,
      active: { owner: metadata.owner, identity: metadata.identity, source: { generation: metadata.generation,
        assertCurrent: () => { this.current(); if (this.entries.get(metadata.owner.provider) !== entry) throw new Error("Remote native component is retired"); },
        frame: actor => {
          entry.active.source.assertCurrent();
          return this.options.viewer()?.equals(actor) === true && entry.frame?.viewer.equals(actor) === true ? entry.frame.value : null;
        },
      } } };
    return entry;
  }
  prepareUpdate(update: UnifiedComponentUpdate): () => void {
    this.current();
    if (update.revision !== this.revision + 1) throw new Error("Remote native reliable revision is not consecutive");
    const next = new Map<ProviderId, Entry>();
    const pending: { readonly entry: Entry; readonly metadata: UnifiedNativeState; readonly configs: ReadonlyMap<number, string> | null }[] = [];
    for (const metadata of update.native ?? []) {
      const previous = this.entries.get(metadata.owner.provider);
      const same = previous !== undefined && samePresentationOwner(previous.active.owner, metadata.owner) && previous.active.source.generation === metadata.generation;
      const entry = same ? previous : this.create(metadata);
      if (!sameModIdentity(entry.active.identity, metadata.identity) || (entry.metadata.hud?.mode ?? null) !== (metadata.hud?.mode ?? null))
        throw new Error("Remote native activation changed its admitted identity or HUD");
      const hud = metadata.hud, configs = hud === null ? null : hud.frame.configstrings ?? entry.configs;
      if (hud !== null && (configs === null || hud.frame.protocol.kind !== (entry.edition === "classic" ? "q2-classic" : "q2-rerelease")))
        throw new Error("Remote native HUD has no source configstrings or differs from its source edition");
      next.set(metadata.owner.provider, entry); pending.push({ entry, metadata, configs });
    }
    return () => {
      this.current();
      for (const [provider, entry] of this.entries) if (next.get(provider) !== entry && !samePresentationOwner(next.get(provider)?.active.owner, entry.active.owner))
        this.options.events.retireReplicatedOwner(entry.active.owner);
      this.entries = next; this.revision = update.revision; this.legacy = false;
      for (const { entry, metadata, configs } of pending) {
        entry.metadata = metadata; entry.configs = configs;
        this.options.events.admitReplicatedOwner(metadata.owner, metadata.identity.source.content);
      }
    };
  }
  prepare(frames: UnifiedComponentFrames, viewer: ActorId, legacy?: UnifiedNativeCamera): (() => void) | null {
    this.current();
    if (frames.revision < this.revision) return null;
    if (frames.revision !== this.revision) throw new Error("Remote native frame lacks reliable admission");
    // Version 7 carried one source camera directly. Keep it in the same owner collection.
    if (legacy !== undefined && frames.native === undefined) {
      const metadata: UnifiedNativeState = { owner: legacy.owner, identity: legacy.identity, generation: legacy.generation, hud: null };
      const previous = this.entries.get(metadata.owner.provider);
      const entry = previous !== undefined && samePresentationOwner(previous.active.owner, metadata.owner) && previous.active.source.generation === metadata.generation ? previous : this.create(metadata, true);
      if (!sameModIdentity(entry.active.identity, metadata.identity)) throw new Error("Remote native activation changed identity");
      const frame: UnifiedNativeFrame = { owner: legacy.owner, generation: legacy.generation, viewer, view: legacy.view, hud: null };
      const value = this.readFrame(entry, frame, viewer);
      return () => { this.entries = new Map([[entry.active.owner.provider, entry]]); this.legacy = true; entry.frame = { viewer, value }; };
    }
    if (this.legacy && frames.native === undefined) return () => { this.entries.clear(); this.legacy = false; };
    const native = frames.native ?? [];
    if (native.length !== this.entries.size) throw new Error("Remote native frame differs from admitted owners");
    const pending = native.map(frame => {
      const entry = this.entries.get(frame.owner.provider);
      if (entry === undefined) throw new Error("Remote native frame has an unadmitted owner");
      return { entry, frame, value: this.readFrame(entry, frame, viewer) };
    });
    if (pending.filter(value => value.value.view !== null).length > 1 || pending.filter(value => value.value.hud?.mode === "replace-status").length > 1)
      throw new Error("Remote native presentation has conflicting exclusive owners");
    return () => { for (const { entry, frame, value } of pending) entry.frame = { viewer: frame.viewer, value }; };
  }
  private readFrame(entry: Entry, frame: UnifiedNativeFrame, viewer: ActorId): NativeFrame {
    if (!samePresentationOwner(entry.active.owner, frame.owner) || entry.active.source.generation !== frame.generation || !frame.viewer.equals(viewer))
      throw new Error("Remote native frame differs from its source or recipient admission");
    if ((frame.view !== null) !== entry.view || frame.view !== null && frame.view.native.edition !== entry.edition)
      throw new Error("Remote native camera differs from its admitted source");
    const hud = entry.metadata.hud;
    if ((hud === null) !== (frame.hud === null)) throw new Error("Remote native frame differs from its admitted HUD");
    if (hud === null || frame.hud === null) return { kind: "native", hud: null, view: frame.view };
    if (entry.configs === null || frame.hud.stats.length !== (entry.edition === "classic" ? 32 : 64)) throw new Error("Remote native HUD differs from its source ABI");
    return { kind: "native", view: frame.view, hud: { mode: hud.mode, frame: { ...hud.frame, ...frame.hud, configstrings: entry.configs } } };
  }
  retire(owner: PresentationOwner): void {
    const entry = this.entries.get(owner.provider);
    if (entry !== undefined && samePresentationOwner(entry.active.owner, owner)) this.entries.delete(owner.provider);
  }
  sources(): readonly ActiveModClientPresentation[] { this.current(); return [...this.entries.values()].flatMap(entry => entry.frame === null ? [] : [entry.active]); }
  close(): void { this.closed = true; this.entries.clear(); }
}
