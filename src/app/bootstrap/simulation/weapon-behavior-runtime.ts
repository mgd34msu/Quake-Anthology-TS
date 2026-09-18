import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { SceneQueries } from "../../../contracts/scene.ts";
import type { WeaponBehaviorDefinition, WeaponBehaviorLaunch, WeaponBehaviorProjectilePort } from "../../../contracts/weapon-behavior.ts";
import type { PreparedWeaponBehavior } from "../weapon-behavior-selection.ts";
import { WeaponBehaviorAttachments, readWeaponBehaviorAttachmentCheckpoint } from "../../../world/gameplay/weapon-behaviors.ts";
import type { SessionActorRegistry } from "../../../world/actors/registry.ts";
import { QuakeCWeaponBehaviorSource, readQuakeCWeaponBehaviorCheckpoint } from "./quakec-weapon-behavior.ts";
import type { QcWeaponBehaviorTarget } from "./quakec-weapon-behavior.ts";
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
}

export class SimulationWeaponBehaviors implements WeaponBehaviorProjectilePort {
  private readonly attachments: WeaponBehaviorAttachments;
  private readonly sources = new Map<string, QuakeCWeaponBehaviorSource>();
  private readonly definitions = new Map<string, WeaponBehaviorDefinition>();
  constructor(prepared: readonly PreparedWeaponBehavior[], private readonly host: WeaponBehaviorRuntimeHost) {
    this.attachments = new WeaponBehaviorAttachments(host.actors);
    const roles = new Set<string>();
    for (const entry of prepared) {
      const definition = entry.selection.definition;
      if (roles.has(definition.role)) throw new Error(`Multiple selected trajectory behaviors for ${definition.role}`);
      roles.add(definition.role);
      const models = [...entry.resources].filter(([, value]) => value.modelBounds !== null);
      const source = new QuakeCWeaponBehaviorSource({ definition, program: entry.program, random: new SourceRandom(host.seed), scene: host.scene,
        mode: host.mode, targets: () => host.targets(), aim: (actor, speed) => host.aim(actor, speed), print: (actor, text) => host.print(actor, text),
        model: path => {
          const index = models.findIndex(([name]) => name === path), model = models[index]?.[1];
          return model?.modelBounds === undefined || model.modelBounds === null ? null : { index: index + 1, bounds: model.modelBounds };
        } });
      this.sources.set(definition.id, source); this.definitions.set(definition.id, definition); this.attachments.register(source);
    }
  }
  launch(input: WeaponBehaviorLaunch): ReturnType<WeaponBehaviorAttachments["launch"]> {
    for (const definition of this.definitions.values()) if (definition.role === input.role) return this.attachments.launch(definition.id, input);
    return null;
  }
  controlsTrajectory(projectile: ActorId): boolean { return this.attachments.controlsTrajectory(projectile); }
  step(...input: Parameters<WeaponBehaviorAttachments["step"]>): ReturnType<WeaponBehaviorAttachments["step"]> { return this.attachments.step(...input); }
  checkpoint() { return { version: 1, sources: [...this.sources.values()].map(source => source.checkpoint()), attachments: this.attachments.checkpoint() }; }
  restore(reader: SaveReader): void {
    if (reader.value === undefined && this.sources.size === 0) return;
    reader.field("version").literal(1);
    const seen = new Set<string>();
    const checkpoints = reader.field("sources").list(value => {
      const id = value.field("definition").field("id").string(), source = this.sources.get(id);
      if (source === undefined || seen.has(id)) return value.fail("Saved weapon behavior differs from selection");
      seen.add(id); return { source, checkpoint: readQuakeCWeaponBehaviorCheckpoint(value, source.definition) };
    });
    if (seen.size !== this.sources.size) reader.fail("Saved weapon behavior source is missing");
    for (const { source, checkpoint } of checkpoints) {
      if (checkpoint.random.kind !== "glibc-random") reader.fail("QuakeC trajectory requires its source random stream");
      const random = new SourceRandom(this.host.seed); random.restore(checkpoint.random);
      source.restore(checkpoint, saved => this.host.actors.referenceSaved(saved), random);
    }
    this.attachments.restore(readWeaponBehaviorAttachmentCheckpoint(reader.field("attachments"), this.definitions));
  }
  close(): void { this.attachments.close(); this.sources.clear(); this.definitions.clear(); }
}
