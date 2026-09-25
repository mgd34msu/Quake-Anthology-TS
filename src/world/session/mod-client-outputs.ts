import type { ActorId, ProviderId } from "../../contracts/identity.ts";
import type { ModClientOutput, ModClientOutputChannel, ModClientMovementOutputs, ModClientOutputDeclaration } from "../../contracts/mod-client-outputs.ts";
import type { Vec3 } from "../../contracts/math.ts";

export interface ModClientOutputLease {
  /** Publish detached values after an original invocation commits its source fields. */
  publish(actor: ActorId, outputs: readonly ModClientOutput[]): void;
  release(actor: ActorId): void;
  close(): void;
}
interface Entry { readonly owner: ProviderId; readonly values: Map<ActorId, ModClientOutput>; }

/** Original component checkpoints own the fields; leases retain only their live publication. */
export class ModClientOutputs {
  private readonly owners = new Map<ModClientOutputChannel, Entry>();
  constructor(private readonly live: (actor: ActorId) => boolean) {}
  claim(owner: ProviderId, channels: readonly ModClientOutputChannel[]): ModClientOutputLease {
    if (new Set(channels).size !== channels.length) throw new Error("Duplicate component client output channel");
    for (const channel of channels) {
      const previous = this.owners.get(channel);
      if (previous !== undefined) throw new Error(`Client ${channel} is already owned by ${previous.owner}; ${owner} cannot also claim it`);
    }
    const entries = channels.map(channel => { const entry = { owner, values: new Map<ActorId, ModClientOutput>() }; this.owners.set(channel, entry); return { channel, entry }; });
    let active = true;
    const current = (): void => { if (!active || entries.some(({ channel, entry }) => this.owners.get(channel) !== entry)) throw new Error("Component client output owner is retired"); };
    return {
      publish: (actor, outputs) => {
        current(); if (!this.live(actor)) throw new Error("Component client output requires the current client actor");
        if (outputs.length !== channels.length || new Set(outputs.map(output => output.kind)).size !== outputs.length)
          throw new Error("Client output publication differs from its declared channels");
        const validated = outputs.map(output => {
          const entry = entries.find(entry => entry.channel === output.kind)?.entry;
          if (entry === undefined) throw new Error("Undeclared component client output");
          return { entry, value: detached(output) };
        });
        for (const { entry, value } of validated) entry.values.set(actor, value);
      },
      release: actor => { for (const { entry } of entries) entry.values.delete(actor); },
      close: () => { if (!active) return; active = false; for (const { channel, entry } of entries) { entry.values.clear(); if (this.owners.get(channel) === entry) this.owners.delete(channel); } },
    };
  }
  read(actor: ActorId): ModClientMovementOutputs | null {
    if (this.owners.size === 0) return null;
    const view = this.owners.get("view-offset")?.values.get(actor), mode = this.owners.get("movement-mode")?.values.get(actor), stance = this.owners.get("stance")?.values.get(actor), body = this.owners.get("body-shape")?.values.get(actor);
    if (view === undefined && mode === undefined && stance === undefined && body === undefined || !this.live(actor)) return null;
    return { ...(view?.kind === "view-offset" ? { viewOffset: view.value } : {}),
      ...(mode?.kind === "movement-mode" ? { mode: mode.value } : {}), ...(stance?.kind === "stance" ? { stance: stance.value } : {}),
      ...(body?.kind === "body-shape" ? { bodyBounds: body.value } : {}) };
  }
  release(actor: ActorId): void { for (const entry of this.owners.values()) entry.values.delete(actor); }
  close(): void { for (const entry of this.owners.values()) entry.values.clear(); this.owners.clear(); }
}
function vector(value: Vec3): Vec3 {
  if (![value.x, value.y, value.z].every(Number.isFinite)) throw new RangeError("Client output vector must be finite");
  return Object.freeze({ ...value });
}
function detached(output: ModClientOutput): ModClientOutput {
  switch (output.kind) {
    case "body-shape": {
      const min = vector(output.value.min), max = vector(output.value.max);
      if (min.x > max.x || min.y > max.y || min.z > max.z) throw new RangeError("Client body output has backwards bounds");
      return { kind: output.kind, value: Object.freeze({ min, max }) };
    }
    case "view-offset": return { kind: output.kind, value: vector(output.value) };
    case "movement-mode": return output;
    case "stance": return output;
  }
}
export function readModClientOutputs<Scalar, Vector>(declarations: readonly ModClientOutputDeclaration<Scalar, Vector>[], read: {
  scalar(field: Scalar): number; vector(field: Vector): Vec3;
}): readonly ModClientOutput[] {
  return declarations.map(declaration => {
    if (declaration.kind === "body-shape") return { kind: declaration.kind, value: { min: read.vector(declaration.min), max: read.vector(declaration.max) } };
    if (declaration.kind === "view-offset") return { kind: declaration.kind, value: "height" in declaration ? { x: 0, y: 0, z: read.scalar(declaration.height) } : read.vector(declaration.field) };
    const raw = read.scalar(declaration.field);
    if (!Number.isFinite(raw) || declaration.mask !== undefined && (!Number.isInteger(raw) || raw < -0x80000000 || raw > 0xffffffff)) throw new Error("Client output requires a finite source value, integral when masked");
    const value = declaration.mask === undefined ? raw : (raw & declaration.mask) >>> 0;
    if (declaration.kind === "movement-mode") {
      const selected = declaration.values.find(entry => entry.value === value);
      if (selected === undefined) throw new Error(`Undeclared source movement mode ${value}`);
      return { kind: declaration.kind, value: selected.mode };
    }
    const selected = declaration.values.find(entry => entry.value === value);
    if (selected === undefined) throw new Error(`Undeclared source client stance ${value}`);
    return { kind: declaration.kind, value: selected.crouched };
  });
}
export function validateModClientOutputs<S, V>(declarations: readonly ModClientOutputDeclaration<S, V>[], check: { scalar(field: S): void; vector(field: V): void }): void {
  if (new Set(declarations.map(value => value.kind)).size !== declarations.length) throw new Error("Duplicate source client output channel");
  for (const declaration of declarations) {
    if (declaration.kind === "body-shape") { check.vector(declaration.min); check.vector(declaration.max); continue; }
    if (declaration.kind === "view-offset") { if ("height" in declaration) check.scalar(declaration.height); else check.vector(declaration.field); continue; }
    check.scalar(declaration.field);
    if (declaration.mask !== undefined && (!Number.isInteger(declaration.mask) || declaration.mask <= 0 || declaration.mask > 0xffffffff)) throw new Error("Invalid source client output mask");
    const mask = declaration.mask;
    if (mask !== undefined && declaration.values.some(entry => !Number.isInteger(entry.value) || entry.value < 0 || entry.value > 0xffffffff || ((entry.value & mask) >>> 0) !== entry.value)) throw new Error("Source output values escape their declared mask");
    if (declaration.values.length === 0 || declaration.values.some(entry => !Number.isFinite(entry.value))
      || new Set(declaration.values.map(entry => entry.value)).size !== declaration.values.length) throw new Error("Ambiguous source client output values");
  }
}

export class SourceModClientOutputs<S, V> {
  private lease: ModClientOutputLease | null = null;
  private readonly actors = new Set<ActorId>();
  constructor(private readonly owner: ProviderId, private readonly declarations: readonly ModClientOutputDeclaration<S, V>[],
    private readonly claim: ((owner: ProviderId, channels: readonly ModClientOutputChannel[]) => ModClientOutputLease) | undefined,
    private readonly read: { scalar(actor: ActorId, field: S): number; vector(actor: ActorId, field: V): Vec3 }) {
    if (declarations.length !== 0 && claim === undefined) throw new Error("Declared client outputs require a destination output owner");
  }
  get enabled(): boolean { return this.declarations.length !== 0; }
  has(actor: ActorId): boolean { return this.actors.has(actor); }
  publish(actor: ActorId): void {
    if (this.declarations.length === 0) return;
    const values = readModClientOutputs(this.declarations, { scalar: field => this.read.scalar(actor, field), vector: field => this.read.vector(actor, field) });
    if (this.lease === null) {
      if (this.claim === undefined) throw new Error("Client output admission is unavailable");
      this.lease = this.claim(this.owner, this.declarations.map(value => value.kind));
    }
    this.lease.publish(actor, values); this.actors.add(actor);
  }
  release(actor: ActorId): void { this.lease?.release(actor); this.actors.delete(actor); }
  clear(): void { for (const actor of this.actors) this.lease?.release(actor); this.actors.clear(); }
  close(): void { this.lease?.close(); this.lease = null; this.actors.clear(); }
}
