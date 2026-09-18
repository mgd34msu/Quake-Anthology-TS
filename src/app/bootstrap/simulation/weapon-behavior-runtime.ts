import { QvmWeaponBehaviorSource, readQvmWeaponBehaviorCheckpoint, type QvmWeaponBehaviorCheckpoint } from "./qvm-weapon-behavior.ts";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { SceneQueries } from "../../../contracts/scene.ts";
import type { WeaponBehaviorDefinition, WeaponBehaviorLaunch, WeaponBehaviorProjectilePort, WeaponBehaviorAttachmentCheckpoint } from "../../../contracts/weapon-behavior.ts";
import type { PreparedWeaponBehavior } from "../weapon-behavior-selection.ts";
import { WeaponBehaviorAttachments, readWeaponBehaviorAttachmentCheckpoint } from "../../../world/gameplay/weapon-behaviors.ts";
import type { SessionActorRegistry } from "../../../world/actors/registry.ts";
import { QuakeCWeaponBehaviorSource, readQuakeCWeaponBehaviorCheckpoint } from "./quakec-weapon-behavior.ts";
import type { QcWeaponBehaviorTarget, QuakeCWeaponBehaviorCheckpoint } from "./quakec-weapon-behavior.ts";
import type { RereleaseWeaponBehaviorSource, RereleaseWeaponBehaviorCheckpoint } from "./rerelease-weapon-behavior.ts";
import { readRereleaseWeaponBehaviorCheckpoint } from "./rerelease-weapon-checkpoint.ts";
import { SourceRandom } from "./random.ts";
import type { SaveReader } from "../../../persistence/value.ts";

interface WeaponBehaviorRuntimeHost {
  readonly actors: SessionActorRegistry;
  readonly scene: Pick<SceneQueries, "trace" | "pointContents">;
  readonly mode: "singleplayer" | "coop" | "deathmatch";
  readonly seed: number;
  targets(): readonly QcWeaponBehaviorTarget[];
  aim(shooter: ActorId, speed: number): Vec3;
  print(recipient: ActorId | null, text: string): void;
  qvm(entry: Extract<PreparedWeaponBehavior, { readonly kind: "qvm" }>): Promise<QvmWeaponBehaviorSource>;
  native(entry: Extract<PreparedWeaponBehavior, { readonly kind: "rerelease-native" }>, nextFrame: () => Promise<void>): Promise<RereleaseWeaponBehaviorSource>;
}
type BehaviorSource = { readonly kind: "quakec"; readonly source: QuakeCWeaponBehaviorSource }
  | { readonly kind: "rerelease-native"; readonly source: RereleaseWeaponBehaviorSource }
  | { readonly kind: "qvm"; readonly source: QvmWeaponBehaviorSource };
export interface WeaponBehaviorRuntimeCheckpoint {
  readonly version: 1;
  readonly sources: readonly (QuakeCWeaponBehaviorCheckpoint | RereleaseWeaponBehaviorCheckpoint | QvmWeaponBehaviorCheckpoint)[];
  readonly attachments: WeaponBehaviorAttachmentCheckpoint;
}

export class SimulationWeaponBehaviors implements WeaponBehaviorProjectilePort {
  private readonly attachments: WeaponBehaviorAttachments;
  private readonly sources = new Map<string, BehaviorSource>();
  private readonly definitions = new Map<string, WeaponBehaviorDefinition>();
  private readonly deferredEntries: Extract<PreparedWeaponBehavior, { readonly kind: "rerelease-native" | "qvm" }>[] = [];
  private pendingRestore: SaveReader | null = null;
  private ready: boolean;
  constructor(prepared: readonly PreparedWeaponBehavior[], private readonly host: WeaponBehaviorRuntimeHost) {
    this.attachments = new WeaponBehaviorAttachments(host.actors);
    const roles = new Set<string>();
    for (const entry of prepared) {
      const definition = entry.selection.definition;
      if (roles.has(definition.role)) throw new Error(`Multiple selected trajectory behaviors for ${definition.role}`);
      roles.add(definition.role); this.definitions.set(definition.id, definition);
      if (entry.kind !== "quakec") { this.deferredEntries.push(entry); continue; }
      const models = [...entry.resources].filter(([, value]) => value.modelBounds !== null);
      const source = new QuakeCWeaponBehaviorSource({ definition, program: entry.program, random: new SourceRandom(host.seed), scene: host.scene,
        mode: host.mode, targets: () => host.targets(), aim: (actor, speed) => host.aim(actor, speed), print: (actor, text) => host.print(actor, text),
        model: path => {
          const index = models.findIndex(([name]) => name === path), model = models[index]?.[1];
          return model?.modelBounds === undefined || model.modelBounds === null ? null : { index: index + 1, bounds: model.modelBounds };
        } });
      this.sources.set(definition.id, { kind: "quakec", source }); this.attachments.register(source);
    }
    this.ready = this.deferredEntries.length === 0;
  }
  async initializeLoading(nextFrame: () => Promise<void>): Promise<void> {
    if (this.ready) return;
    for (const entry of this.deferredEntries) {
      if (entry.kind === "qvm") {
        const source = await this.host.qvm(entry);
        this.sources.set(source.definition.id, { kind: "qvm", source }); this.attachments.register(source);
      } else {
        const source = await this.host.native(entry, nextFrame);
        this.sources.set(source.definition.id, { kind: "rerelease-native", source }); this.attachments.register(source);
      }
    }
    this.ready = true;
    const reader = this.pendingRestore; this.pendingRestore = null;
    if (reader !== null) await this.restoreLoading(reader, nextFrame);
  }
  launch(input: WeaponBehaviorLaunch): ReturnType<WeaponBehaviorAttachments["launch"]> {
    if (!this.ready) throw new Error("Weapon components require completed asynchronous loading");
    for (const definition of this.definitions.values()) if (definition.role === input.role) return this.attachments.launch(definition.id, input);
    return null;
  }
  controlsTrajectory(projectile: ActorId): boolean { return this.attachments.controlsTrajectory(projectile); }
  step(...input: Parameters<WeaponBehaviorAttachments["step"]>): ReturnType<WeaponBehaviorAttachments["step"]> { return this.attachments.step(...input); }
  checkpoint(): WeaponBehaviorRuntimeCheckpoint {
    if (!this.ready || this.deferredEntries.some(entry => entry.kind === "rerelease-native")) throw new Error("Native weapon components require asynchronous checkpoint capture");
    const sources: (QuakeCWeaponBehaviorCheckpoint | QvmWeaponBehaviorCheckpoint)[] = [];
    for (const entry of this.sources.values()) if (entry.kind !== "rerelease-native") sources.push(entry.source.checkpoint());
    return { version: 1, sources, attachments: this.attachments.checkpoint() };
  }
  async checkpointLoading(nextFrame: () => Promise<void>): Promise<WeaponBehaviorRuntimeCheckpoint> {
    if (!this.ready) throw new Error("Weapon components have not finished loading");
    const sources: (QuakeCWeaponBehaviorCheckpoint | RereleaseWeaponBehaviorCheckpoint | QvmWeaponBehaviorCheckpoint)[] = [];
    for (const entry of this.sources.values()) sources.push(entry.kind === "rerelease-native" ? await entry.source.checkpoint(nextFrame) : entry.source.checkpoint());
    return { version: 1, sources, attachments: this.attachments.checkpoint() };
  }
  private readSources(reader: SaveReader) {
    reader.field("version").literal(1);
    const seen = new Set<string>();
    const checkpoints = reader.field("sources").list(value => {
      const id = value.field("definition").field("id").string(), entry = this.sources.get(id);
      if (entry === undefined || seen.has(id)) return value.fail("Saved weapon behavior differs from selection");
      seen.add(id);
      if (entry.kind === "quakec") return { kind: entry.kind, source: entry.source, checkpoint: readQuakeCWeaponBehaviorCheckpoint(value, entry.source.definition) };
      if (entry.kind === "qvm") return { kind: entry.kind, source: entry.source, checkpoint: readQvmWeaponBehaviorCheckpoint(value, entry.source.definition) };
      return { kind: entry.kind, source: entry.source, checkpoint: readRereleaseWeaponBehaviorCheckpoint(value, entry.source.definition, entry.source.declaration) };
    });
    if (seen.size !== this.sources.size) reader.fail("Saved weapon behavior source is missing");
    return checkpoints;
  }
  private restoreQuakeC(source: QuakeCWeaponBehaviorSource, checkpoint: QuakeCWeaponBehaviorCheckpoint, reader: SaveReader): void {
    if (checkpoint.random.kind !== "glibc-random") reader.fail("QuakeC trajectory requires its source random stream");
    const random = new SourceRandom(this.host.seed); random.restore(checkpoint.random);
    source.restore(checkpoint, saved => this.host.actors.referenceSaved(saved), random);
  }
  restore(reader: SaveReader): void {
    if (reader.value === undefined && this.definitions.size === 0) return;
    if (!this.ready) { if (this.pendingRestore !== null) throw new Error("Weapon component restore is already queued"); this.pendingRestore = reader; return; }
    for (const entry of this.readSources(reader)) {
      if (entry.kind === "rerelease-native") throw new Error("Native weapon components require asynchronous restoration");
      if (entry.kind === "quakec") this.restoreQuakeC(entry.source, entry.checkpoint, reader);
      else entry.source.restore(entry.checkpoint, saved => this.resolveActor(saved, reader).id);
    }
    this.attachments.restore(readWeaponBehaviorAttachmentCheckpoint(reader.field("attachments"), this.definitions));
  }
  private async restoreLoading(reader: SaveReader, nextFrame: () => Promise<void>): Promise<void> {
    for (const entry of this.readSources(reader)) {
      if (entry.kind === "quakec") this.restoreQuakeC(entry.source, entry.checkpoint, reader);
      else if (entry.kind === "qvm") entry.source.restore(entry.checkpoint, saved => this.resolveActor(saved, reader).id);
      else await entry.source.restore(entry.checkpoint, saved => this.resolveActor(saved, reader), nextFrame);
    }
    this.attachments.restore(readWeaponBehaviorAttachmentCheckpoint(reader.field("attachments"), this.definitions));
  }
  private resolveActor(saved: import("../../../contracts/session.ts").SavedActorId, reader: SaveReader): OwnedActor {
    const actor = this.host.actors.resolveSaved(saved);
    if (actor === null) return reader.fail("Weapon component references a retired actor");
    return actor;
  }
  close(): void {
    const errors: unknown[] = [];
    try { this.attachments.close(); } catch (error) { errors.push(error); }
    for (const entry of this.sources.values()) if (entry.kind !== "quakec") try { entry.source.close(); } catch (error) { errors.push(error); }
    this.sources.clear(); this.definitions.clear(); this.pendingRestore = null;
    if (errors.length !== 0) throw new AggregateError(errors, "Weapon component cleanup failed");
  }
}
