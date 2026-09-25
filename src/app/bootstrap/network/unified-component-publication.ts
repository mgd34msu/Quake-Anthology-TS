import { samePresentationOwner } from "../../../contracts/presentation.ts";
import { sameModIdentity } from "../../../contracts/mods.ts";
import type { ProviderId } from "../../../contracts/identity.ts";
import type { UnifiedComponentFrames, UnifiedComponentPublication, UnifiedComponentState, UnifiedComponentUpdate } from "./unified-components.ts";

/** One authenticated recipient's reliable cursor, independent from volatile frame delivery. */
export class UnifiedComponentPublisher {
  private revision = 0;
  private sources: readonly UnifiedComponentPublication[] = [];
  private readonly sequences = new Map<ProviderId, number>();
  project(sources: readonly UnifiedComponentPublication[]): { readonly update: UnifiedComponentUpdate | null; readonly frame: UnifiedComponentFrames } {
    const previous = new Map(this.sources.map(source => [source.owner.provider, source]));
    let changed = sources.length !== this.sources.length || sources.some((source, index) => !samePresentationOwner(this.sources[index]?.owner, source.owner));
    const states: UnifiedComponentState[] = sources.map(source => {
      const old = previous.get(source.owner.provider);
      const same = old !== undefined && samePresentationOwner(source.owner, old.owner) && source.generation === old.generation;
      if (same && (!sameModIdentity(source.identity, old.identity) || source.abi !== old.abi || source.runtime !== old.runtime || !source.viewer.equals(old.viewer)))
        throw new Error("Component activation changed identity or recipient");
      const scene = source.context.scene, sequence = scene?.snapshot.serverCommandSequence ?? 0;
      const base = same ? this.sequences.get(source.owner.provider) ?? 0 : sequence;
      if (sequence < base) throw new Error("Original component command sequence moved backward");
      const commands = (scene?.commands ?? []).filter(command => command.sequence > base);
      if (sequence !== base && (commands[0]?.sequence !== base + 1 || commands.at(-1)?.sequence !== sequence))
        throw new Error("Original component reliable commands exceeded their retained window");
      const gameChanged = !same || old.context.gameStateRevision !== source.context.gameStateRevision;
      if (same && source.context.gameStateRevision < old.context.gameStateRevision) throw new Error("Original component configstring revision moved backward");
      changed ||= !same || gameChanged || commands.length > 0;
      this.sequences.set(source.owner.provider, sequence);
      return { owner: source.owner, identity: source.identity, generation: source.generation, abi: source.abi, runtime: source.runtime,
        gameStateRevision: source.context.gameStateRevision, gameState: gameChanged ? source.context.gameState : null, commandBase: base, commands };
    });
    for (const id of this.sequences.keys()) if (!sources.some(source => source.owner.provider === id)) this.sequences.delete(id);
    this.sources = sources;
    const update = changed ? { revision: ++this.revision, sources: states } : null;
    return { update, frame: { revision: this.revision, sources: sources.map(source => ({ owner: source.owner, generation: source.generation, abi: source.abi,
      viewer: source.viewer, clientNumber: source.context.clientNumber ?? source.context.snapshot.playerState.clientNumber, gameStateRevision: source.context.gameStateRevision, snapshot: source.context.snapshot, weaponPresented: source.context.weaponPresented === true,
      bindings: source.bindings, scene: source.context.scene === undefined ? null : { revision: source.context.scene.revision, snapshot: source.context.scene.snapshot } })) } };
  }
}
