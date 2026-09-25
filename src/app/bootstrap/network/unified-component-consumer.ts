import type { ActorId, ProviderId } from "../../../contracts/identity.ts";
import type { PresentationOwner } from "../../../contracts/presentation.ts";
import { samePresentationOwner } from "../../../contracts/presentation.ts";
import { sameModIdentity } from "../../../contracts/mods.ts";
import type { QvmSceneContext } from "../../../compat/qvm/mod-presentation.ts";
import type { SourceGameStateRecord } from "../../../network/q3/game-state.ts";
import type { ActiveModPresentation } from "../../../world/session/mod-presentations.ts";
import type { ActiveModClientPresentation } from "../../../world/session/mod-client-presentation.ts";
import { borrowModFileMounts, type ModUserFiles } from "../../../world/session/mod-files.ts";
import type { MountedContent } from "../../../content/mounts/index.ts";
import type { LoadedApplicationContent } from "../content.ts";
import type { PresentationState } from "../presentation-state.ts";
import type { UnifiedComponentFrame, UnifiedComponentFrames, UnifiedComponentState, UnifiedComponentUpdate } from "./unified-components.ts";

interface Entry {
  readonly active: ActiveModPresentation;
  readonly mounts: MountedContent;
  readonly borrowed: boolean;
  client: ActiveModClientPresentation | null;
  metadata: UnifiedComponentState;
  gameState: SourceGameStateRecord;
  commands: QvmSceneContext["commands"];
  commandSequence: number;
  frame: UnifiedComponentFrame | null;
  frameGameState: SourceGameStateRecord;
  baseline: QvmSceneContext | undefined;
  scene: QvmSceneContext | undefined;
}
export interface UnifiedComponentConsumerOptions {
  readonly content: LoadedApplicationContent;
  readonly events: PresentationState;
  readonly files: ModUserFiles;
  assertCurrent(): void;
  viewer(): ActorId | null;
  command(owner: PresentationOwner, generation: number, args: readonly string[]): void;
}

/** The replica owns only original client presentation and its exact server activation lease. */
export class UnifiedComponentConsumers {
  private entries = new Map<ProviderId, Entry>();
  private revision = 0;
  private closed = false;
  constructor(private readonly options: UnifiedComponentConsumerOptions) {}
  private current(): void { this.options.assertCurrent(); if (this.closed) throw new Error("Remote component collection is retired"); }
  private retire(entry: Entry, activation = true): void {
    if (activation) this.options.events.retireReplicatedOwner(entry.active.owner);
    if (entry.borrowed) entry.mounts.close();
  }
  async update(update: UnifiedComponentUpdate): Promise<void> {
    this.current();
    if (update.revision !== this.revision + 1) throw new Error("Remote component reliable revision is not consecutive");
    const next = new Map<ProviderId, Entry>(), created: Entry[] = [];
    try {
      for (const metadata of update.sources) {
        let entry = this.entries.get(metadata.owner.provider);
        const same = entry !== undefined && samePresentationOwner(entry.active.owner, metadata.owner) && entry.metadata.generation === metadata.generation;
        if (same && entry !== undefined) {
          if (!sameModIdentity(entry.active.identity, metadata.identity) || entry.metadata.abi !== metadata.abi || entry.metadata.runtime !== metadata.runtime)
            throw new Error("Remote component activation changed its admitted identity");
        } else {
          const prepared = this.options.content.preparedMods.find(candidate => sameModIdentity(candidate.identity, metadata.identity));
          if (prepared?.presentation === undefined || prepared.presentation.declaration.runtime !== metadata.runtime
            || prepared.presentation.declaration.gameplay.abiProfile !== metadata.abi || prepared.presentation.source.id !== metadata.owner.provider)
            throw new Error("Remote component differs from its locally qualified presentation");
          if (metadata.gameState === null) throw new Error("Remote component activation has no original gamestate");
          const installed = await this.options.content.forContent(metadata.identity.source.content); this.current();
          const writable = this.options.files.for(metadata.identity.selection), mounts = borrowModFileMounts(metadata.identity.selection, metadata.identity.source.content, installed, writable);
          const liveEntry: Entry = { active: { owner: metadata.owner, identity: metadata.identity, prepared: prepared.presentation, source: {
            module: prepared.presentation.source, abiProfile: metadata.abi, generation: metadata.generation,
            assertCurrent: () => {
              this.current(); if (this.entries.get(metadata.owner.provider) !== liveEntry) throw new Error("Remote component activation is retired");
            },
            context: viewer => {
              liveEntry.active.source.assertCurrent();
              if (this.options.viewer()?.equals(viewer) !== true || liveEntry.frame?.viewer.equals(viewer) !== true) return null;
              return { clientNumber: liveEntry.frame.clientNumber, gameState: liveEntry.frameGameState, gameStateRevision: liveEntry.frame.gameStateRevision,
                snapshot: liveEntry.frame.snapshot, weaponPresented: liveEntry.frame.weaponPresented,
                ...(liveEntry.scene === undefined ? {} : { scene: liveEntry.scene }) };
            },
            files: () => { liveEntry.active.source.assertCurrent(); return { mounts, writable }; },
            clientCommand: (viewer, args) => {
              if (liveEntry.active.source.context(viewer) === null) throw new Error("Remote component command viewer is retired");
              this.options.command(metadata.owner, metadata.generation, args);
            },
            bindings: () => { liveEntry.active.source.assertCurrent(); return liveEntry.frame?.bindings ?? []; },
            actor: slot => { liveEntry.active.source.assertCurrent(); return liveEntry.frame?.bindings.find(binding => binding.slot === slot)?.actor ?? null; },
            live: actor => !this.closed && this.entries.get(metadata.owner.provider) === liveEntry
              && this.options.viewer()?.equals(liveEntry.frame?.viewer ?? actor) === true && liveEntry.frame?.bindings.some(binding => binding.actor.equals(actor)) === true,
          } }, mounts, client: null, borrowed: mounts !== installed, metadata, gameState: metadata.gameState, commands: [], commandSequence: metadata.commandBase,
            frame: null, frameGameState: metadata.gameState, baseline: undefined, scene: undefined };
          const hud = liveEntry.active.prepared.declaration.hud;
          if (hud !== undefined) liveEntry.client = { owner: metadata.owner, identity: metadata.identity,
            source: { generation: metadata.generation, assertCurrent: () => liveEntry.active.source.assertCurrent(),
              frame: actor => liveEntry.active.source.context(actor) === null ? null : { kind: "qvm", hud: { mode: hud.mode }, view: null } } };
          entry = liveEntry; created.push(entry);
        }
        if (entry === undefined) throw new Error("Remote component admission lost its source");
        if (metadata.commandBase !== entry.commandSequence || metadata.commands.some((command, index) => command.sequence !== metadata.commandBase + index + 1))
          throw new Error("Remote component reliable command history has a gap");
        if (metadata.gameStateRevision < entry.metadata.gameStateRevision || metadata.gameState === null && metadata.gameStateRevision !== entry.metadata.gameStateRevision)
          throw new Error("Remote component configstring history has a gap");
        next.set(metadata.owner.provider, entry);
      }
      this.current();
    } catch (error) { for (const entry of created) if (entry.borrowed) entry.mounts.close(); throw error; }
    for (const [id, entry] of this.entries) if (next.get(id) !== entry) this.retire(entry, next.has(id) && !samePresentationOwner(next.get(id)?.active.owner, entry.active.owner));
    this.entries = next; this.revision = update.revision;
    for (const metadata of update.sources) {
      const entry = this.entries.get(metadata.owner.provider); if (entry === undefined) throw new Error("Remote component admission disappeared");
      this.options.events.admitReplicatedOwner(metadata.owner, metadata.identity.source.content);
      entry.metadata = metadata; entry.gameState = metadata.gameState ?? entry.gameState;
      entry.commands = [...entry.commands, ...metadata.commands].slice(-64);
      entry.commandSequence = metadata.commands.at(-1)?.sequence ?? metadata.commandBase;
    }
  }
  accept(frames: UnifiedComponentFrames, viewer: ActorId): boolean {
    this.current();
    if (frames.revision < this.revision) return false;
    if (frames.revision !== this.revision || frames.sources.length !== this.entries.size) throw new Error("Remote component frame lacks reliable admission");
    for (const frame of frames.sources) {
      const entry = this.entries.get(frame.owner.provider);
      if (entry === undefined || !samePresentationOwner(entry.active.owner, frame.owner) || entry.metadata.generation !== frame.generation
        || entry.metadata.abi !== frame.abi || entry.metadata.gameStateRevision !== frame.gameStateRevision || !frame.viewer.equals(viewer)
        || !frame.bindings.some(binding => binding.actor.equals(viewer) && binding.slot === frame.clientNumber && !binding.owned)
        || (entry.metadata.runtime === "qvm-scene") !== (frame.scene !== null)) throw new Error("Remote component frame differs from its source or recipient admission");
      if (frame.scene !== null && (frame.scene.snapshot.serverCommandSequence !== entry.commandSequence || frame.scene.snapshot.serverTime !== frame.snapshot.serverTime))
        throw new Error("Remote component snapshot lost its reliable source history");
    }
    for (const frame of frames.sources) {
      const entry = this.entries.get(frame.owner.provider); if (entry === undefined) throw new Error("Remote component frame owner disappeared");
      entry.frame = frame; entry.frameGameState = entry.gameState;
      if (frame.scene !== null) {
        const scene: QvmSceneContext = { ...frame.scene, gameState: entry.gameState, gameStateRevision: frame.gameStateRevision, actors: frame.bindings, commands: entry.commands };
        entry.baseline ??= scene;
        entry.scene = { ...scene, baseline: entry.baseline };
      }
    }
    return true;
  }
  sources(): readonly ActiveModPresentation[] { this.current(); return [...this.entries.values()].flatMap(entry => entry.frame === null ? [] : [entry.active]); }
  clientSources(): readonly ActiveModClientPresentation[] {
    this.current(); return [...this.entries.values()].flatMap(entry => entry.frame === null || entry.client === null ? [] : [entry.client]);
  }
  close(): void {
    if (this.closed) return; this.closed = true;
    const entries = [...this.entries.values()]; this.entries.clear();
    const failures: unknown[] = [];
    for (const entry of entries) try { this.retire(entry, false); } catch (error) { failures.push(error); }
    if (failures.length !== 0) throw new AggregateError(failures, "Remote component retirement failed");
  }
}
