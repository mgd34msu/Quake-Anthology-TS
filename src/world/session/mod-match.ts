import type { ActorId, ProviderId } from "../../contracts/identity.ts";
import type { ObjectiveId } from "../../contracts/gameplay.ts";
import type { SourceMatchPlayer, SourceMatchServices, SourceObjectiveBinding, SourceObjectiveState } from "../../contracts/source-match.ts";
import type { SessionActorRegistry } from "../actors/registry.ts";

/** Bindings borrow original source storage. The session retains no second score or objective state. */
export class ModMatchState implements SourceMatchServices {
  private readonly sources = new Map<ProviderId, (actor: ActorId) => SourceMatchPlayer | null>();
  private readonly channels = new Map<ObjectiveId, SourceObjectiveBinding>();
  private closed = false;
  constructor(private readonly actors: SessionActorRegistry, private readonly primary: (actor: ActorId) => SourceMatchPlayer | null) {}
  player(actor: ActorId): SourceMatchPlayer | null {
    if (this.closed || !this.actors.isLive(actor)) return null;
    const owned = this.actors.resolveOwned(actor);
    const player = (owned === null ? null : this.sources.get(owned.owner)?.(actor)) ?? this.primary(actor);
    if (player !== null && player.owner !== owned?.owner) throw new Error("Match player belongs to another original actor owner");
    return player;
  }
  bindSource(owner: ProviderId, resolve: (actor: ActorId) => SourceMatchPlayer | null): () => void {
    if (this.closed || this.sources.has(owner)) throw new Error(`Match source ${owner} is already bound or closed`);
    this.sources.set(owner, resolve);
    return () => { if (this.sources.get(owner) === resolve) this.sources.delete(owner); };
  }
  bindObjective(binding: SourceObjectiveBinding): () => void {
    if (this.closed) throw new Error("Match objective owner is closed");
    const previous = this.channels.get(binding.id);
    if (previous !== undefined) throw new Error(`Objective ${binding.id} is owned by ${previous.owner}; ${binding.owner} cannot claim it`);
    this.channels.set(binding.id, binding);
    return () => { if (this.channels.get(binding.id) === binding) this.channels.delete(binding.id); };
  }
  private read(binding: SourceObjectiveBinding): SourceObjectiveState | null {
    const value = binding.read();
    if (this.closed || this.channels.get(binding.id) !== binding) return null;
    return Object.freeze({ ...value,
      carrier: value.carrier !== null && this.actors.isLive(value.carrier) ? value.carrier : null,
      target: value.target !== null && this.actors.isLive(value.target) ? value.target : null });
  }
  objective(id: ObjectiveId): SourceObjectiveState | null {
    const binding = this.channels.get(id); return binding === undefined ? null : this.read(binding);
  }
  changeObjective(id: ObjectiveId, request: Omit<SourceObjectiveState, "complete">): SourceObjectiveState | null {
    const binding = this.channels.get(id); if (binding === undefined) throw new Error(`Objective ${id} has no admitted source owner`);
    for (const actor of [request.carrier, request.target]) if (actor !== null && !this.actors.isLive(actor)) throw new Error("Objective change references a retired actor");
    binding.change(request);
    return this.channels.get(id) === binding ? this.read(binding) : null;
  }
  objectives(): readonly { readonly id: ObjectiveId; readonly state: SourceObjectiveState; readonly botGoal: boolean }[] {
    return [...this.channels.values()].flatMap(binding => { const state = this.read(binding); return state === null ? [] : [{ id: binding.id, state, botGoal: binding.botGoal }]; });
  }
  gates() {
    return [...this.channels.values()].flatMap(binding => {
      if (!binding.campaignGate) return [];
      const state = this.read(binding); return state === null ? [] : [{ objective: binding.id, satisfied: state.complete }];
    });
  }
  close(): void { if (this.closed) return; this.closed = true; this.sources.clear(); this.channels.clear(); }
}
