import type { ActorId, ProviderId } from "../../contracts/identity.ts";
import type { ModCallbackInput, ModRuntimeValue } from "../../contracts/mod-callbacks.ts";
import type { SourceMatchServices, SourceObjectiveDeclaration, SourceObjectiveState } from "../../contracts/source-match.ts";

interface Storage<Scalar, Reference, Call> {
  current(): boolean;
  readScalar(storage: Scalar): number;
  writeScalar(storage: Scalar, value: number): void;
  readActor(storage: Reference): ActorId | null;
  writeActor(storage: Reference, value: ActorId | null): void;
  invoke(call: Call, inputs: ReadonlyMap<ModCallbackInput, ModRuntimeValue>): void;
  seconds(): number;
}
function equal(left: SourceObjectiveState, right: SourceObjectiveState): boolean {
  return left.stage === right.stage && left.carrier === right.carrier && left.target === right.target;
}

/** Borrowed words project the original owner; only that owner's callback changes an objective. */
export class ModSourceObjectives<Scalar, Reference, Call> {
  private readonly removals: (() => void)[] = [];
  private readonly projected = new Map<string, SourceObjectiveState>();
  private busy = false;
  private active = false;
  private closed = false;
  constructor(private readonly owner: ProviderId, private readonly declarations: readonly SourceObjectiveDeclaration<Scalar, Reference, Call>[],
    private readonly match: SourceMatchServices | undefined, private readonly storage: Storage<Scalar, Reference, Call>) {
    if (declarations.length !== 0 && match === undefined) throw new Error("Declared objectives require destination match services");
    if (new Set(declarations.map(value => value.id)).size !== declarations.length) throw new Error("Duplicate source objective channel");
    for (const declaration of declarations) if (declaration.state.values.length === 0
      || new Set(declaration.state.values.map(value => value.value)).size !== declaration.state.values.length
      || new Set(declaration.state.values.map(value => value.stage)).size !== declaration.state.values.length
      || declaration.state.values.some(value => !Number.isFinite(value.value) || value.stage.length === 0))
      throw new Error("Source objective requires distinct original values and shared stages");
  }
  private read(declaration: SourceObjectiveDeclaration<Scalar, Reference, Call>): SourceObjectiveState {
    if (this.closed || !this.storage.current()) throw new Error("Original objective source was retired");
    const raw = this.storage.readScalar(declaration.state.storage), value = declaration.state.values.find(value => value.value === raw);
    if (value === undefined) throw new Error(`Objective ${declaration.id} has undeclared original state ${raw}`);
    return { stage: value.stage, complete: value.complete, carrier: declaration.carrier === null ? null : this.storage.readActor(declaration.carrier),
      target: declaration.target === null ? null : this.storage.readActor(declaration.target) };
  }
  private write(declaration: SourceObjectiveDeclaration<Scalar, Reference, Call>, value: SourceObjectiveState): void {
    const original = declaration.state.values.find(entry => entry.stage === value.stage);
    if (original === undefined) throw new Error(`Objective ${declaration.id} cannot represent source stage ${value.stage}`);
    if (declaration.carrier === null && value.carrier !== null || declaration.target === null && value.target !== null)
      throw new Error(`Objective ${declaration.id} requires its declared source actor reference storage`);
    this.storage.writeScalar(declaration.state.storage, original.value);
    if (declaration.carrier !== null) this.storage.writeActor(declaration.carrier, value.carrier);
    if (declaration.target !== null) this.storage.writeActor(declaration.target, value.target);
    this.projected.set(declaration.id, value);
  }
  activate(): void {
    if (this.active) return;
    if (this.closed || !this.storage.current()) throw new Error("Original objective source is unavailable");
    try {
      for (const declaration of this.declarations) if (declaration.role === "owned") {
        if (this.match === undefined) throw new Error("Original objective match service is unavailable");
        this.read(declaration);
        this.removals.push(this.match.bindObjective({ owner: this.owner, id: declaration.id, campaignGate: declaration.campaignGate, botGoal: declaration.botGoal,
          read: () => this.read(declaration), change: request => {
            if (this.closed || !this.storage.current()) throw new Error("Original objective source was retired");
            const original = declaration.state.values.find(value => value.stage === request.stage);
            if (original === undefined || declaration.change === null) throw new Error(`Objective ${declaration.id} has no original change for ${request.stage}`);
            this.storage.invoke(declaration.change, new Map<ModCallbackInput, ModRuntimeValue>([
              ["self", { kind: "actor", value: request.target }], ["other", { kind: "actor", value: request.carrier }], ["activator", { kind: "actor", value: request.target }],
              ["amount", { kind: "float", value: original.value }], ["time", { kind: "float", value: this.storage.seconds() }],
            ]));
          } }));
      }
      this.active = true; this.refresh();
    } catch (error) { for (const remove of this.removals.splice(0).reverse()) remove(); this.active = false; throw error; }
  }
  refresh(): void {
    if (this.closed || this.busy || !this.storage.current()) return;
    this.busy = true;
    try {
      for (const declaration of this.declarations) if (declaration.role === "borrowed") {
        const value = this.match?.objective(declaration.id);
        if (value == null) throw new Error(`Borrowed objective ${declaration.id} requires its enabled source owner`);
        this.write(declaration, value);
      }
    } finally { this.busy = false; }
  }
  flush(): void {
    if (this.closed || this.busy || !this.storage.current()) return;
    this.busy = true;
    try {
      for (const declaration of this.declarations) if (declaration.role === "borrowed") {
        const before = this.projected.get(declaration.id); if (before === undefined) continue;
        const value = this.read(declaration); if (equal(before, value)) continue;
        if (!declaration.writable) throw new Error(`Original source wrote read-only objective ${declaration.id}`);
        const accepted = this.match?.changeObjective(declaration.id, value);
        if (this.closed || !this.storage.current()) return;
        if (accepted == null) throw new Error(`Objective ${declaration.id} owner retired during its original change`);
        this.write(declaration, accepted);
      }
    } finally { this.busy = false; }
  }
  restored(): void { this.projected.clear(); if (this.active) this.refresh(); }
  close(): void { if (this.closed) return; this.closed = true; for (const remove of this.removals.splice(0).reverse()) remove(); this.projected.clear(); }
}
