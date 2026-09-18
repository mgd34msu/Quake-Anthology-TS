import { SaveReader, namespaced } from '../../persistence/value.ts';
import { readModule, readNativeCallAbi } from '../../persistence/execution.ts';
import { readSavedActor } from '../../persistence/save-image.ts';
import type { ModuleIdentity } from '../../contracts/execution.ts';
import type { ActorId, OwnedActor } from '../../contracts/identity.ts';
import type { BodyState } from '../../contracts/world.ts';
import { sameWeaponBehavior } from '../../contracts/weapon-behavior.ts';
import type { WeaponBehaviorCallback, WeaponBehaviorDefinition, WeaponBehaviorAttachmentCheckpoint, WeaponBehaviorInstance, WeaponBehaviorLaunch, WeaponBehaviorSource, WeaponTrajectoryUpdate } from '../../contracts/weapon-behavior.ts';
import type { SessionActorRegistry } from '../actors/registry.ts';

/** One separately owned trajectory contribution; no replacement of launcher damage, visuals or sound. */
export class WeaponBehaviorAttachments {
  private readonly sources = new Map<string, WeaponBehaviorSource>();
  private readonly actors = new Map<ActorId, { readonly owner: OwnedActor; readonly instance: WeaponBehaviorInstance }>();
  constructor(private readonly registry: SessionActorRegistry) {
    registry.onRelease(actor => { this.detach(actor.id); return undefined; });
  }
  register(source: WeaponBehaviorSource): void {
    if (this.sources.has(source.definition.id)) throw new Error(`Weapon behavior already registered: ${source.definition.id}`);
    this.sources.set(source.definition.id, source);
  }
  attach(selection: string, launch: WeaponBehaviorLaunch): boolean {
    this.registry.assertOwned(launch.projectile);
    if (!this.registry.isLive(launch.shooter)) throw new Error('Weapon behavior shooter is retired');
    const source = this.sources.get(selection);
    if (source === undefined) throw new Error(`Weapon behavior is unavailable: ${selection}`);
    if (source.definition.role !== launch.role) throw new Error('Weapon behavior does not match the fired projectile role');
    if (this.actors.has(launch.projectile.id)) throw new Error('Projectile already has a selected trajectory behavior');
    const instance = source.attach(launch);
    if (instance === null) return false;
    this.actors.set(launch.projectile.id, { owner: launch.projectile, instance }); return true;
  }
  launch(selection: string, input: WeaponBehaviorLaunch): WeaponTrajectoryUpdate | null {
    if (!this.attach(selection, input)) return null;
    const entry = this.actors.get(input.projectile.id);
    if (entry === undefined) throw new Error('Attached projectile has no behavior instance');
    return entry.instance.initial;
  }
  controlsTrajectory(projectile: ActorId): boolean { return this.actors.has(projectile); }
  step(projectile: OwnedActor, body: BodyState, timeSeconds: number): WeaponTrajectoryUpdate | null {
    const entry = this.actors.get(projectile.id); if (entry === undefined) return null;
    this.registry.assertOwned(projectile);
    if (entry.owner !== projectile) throw new Error('Weapon behavior actor ownership changed');
    return entry.instance.step(body, timeSeconds);
  }
  detach(actor: ActorId): void {
    const entry = this.actors.get(actor); if (entry === undefined) return;
    this.actors.delete(actor); entry.instance.close();
  }
  checkpoint(): WeaponBehaviorAttachmentCheckpoint {
    return { version: 1, attachments: [...this.actors.values()].map(({ owner, instance }) => ({
      projectile: { slot: owner.id.slot, generation: owner.id.generation }, owner: owner.owner, definition: instance.definition })) };
  }
  restore(checkpoint: WeaponBehaviorAttachmentCheckpoint): void {
    if (checkpoint.version !== 1 || this.actors.size !== 0) throw new Error('Weapon behavior attachments require an empty matching checkpoint owner');
    const seen = new Set<ActorId>();
    const pending = checkpoint.attachments.map(entry => {
      const owner = this.registry.resolveSaved(entry.projectile), source = this.sources.get(entry.definition.id);
      if (owner === null || owner.owner !== entry.owner || source === undefined || !sameWeaponBehavior(source.definition, entry.definition) || seen.has(owner.id)) throw new Error('Saved weapon behavior owner or source differs');
      seen.add(owner.id); return { owner, source };
    });
    try {
      for (const { owner, source } of pending) this.actors.set(owner.id, { owner, instance: source.resume(owner.id) });
    } catch (error: unknown) { for (const actor of [...this.actors.keys()]) this.detach(actor); throw error; }
  }
  close(): void { for (const actor of [...this.actors.keys()]) this.detach(actor); this.sources.clear(); }
}

/** Reuses loaded callback identities; saved data cannot introduce an executable entrypoint. */
export function readWeaponBehaviorDefinition(reader: SaveReader, expected: WeaponBehaviorDefinition): WeaponBehaviorDefinition {
  reader.field('id').literal(expected.id); reader.field('title').string();
  reader.field('role').literal(expected.role); reader.field('aspect').literal(expected.aspect);
  const module = (source: SaveReader, wanted: ModuleIdentity): void => {
    const found = readModule(source);
    if (found.id !== wanted.id || found.artifactPath !== wanted.artifactPath || found.digest !== wanted.digest || found.revision !== wanted.revision) source.fail('weapon behavior module differs from the loaded artifact');
  };
  module(reader.field('module'), expected.module);
  const callback = (source: SaveReader, wanted: WeaponBehaviorCallback | null): void => {
    if (wanted === null) { if (source.value !== null) source.fail('unexpected activation callback'); return; }
    source.field('kind').literal(wanted.kind); module(source.field('module'), wanted.module);
    switch (wanted.kind) {
      case 'quakec': source.field('functionIndex').literal(wanted.functionIndex); break;
      case 'qvm': source.field('instructionIndex').literal(wanted.instructionIndex); break;
      case 'native-artifact': {
        if (source.field('imageOffset').bigint() !== wanted.imageOffset) source.fail('native weapon entry differs from the loaded artifact');
        const abi = readNativeCallAbi(source.field('abi'));
        if (abi.kind !== wanted.abi.kind || abi.call !== wanted.abi.call || abi.image !== wanted.abi.image || abi.pointerBytes !== wanted.abi.pointerBytes)
          source.fail('native weapon callback ABI differs from the loaded artifact');
        break;
      }
    }
  };
  callback(reader.field('fire'), expected.fire); callback(reader.field('activate'), expected.activate);
  return expected;
}
export function readWeaponBehaviorAttachmentCheckpoint(reader: SaveReader, definitions: ReadonlyMap<string, WeaponBehaviorDefinition>): WeaponBehaviorAttachmentCheckpoint {
  return { version: reader.field('version').literal(1), attachments: reader.field('attachments').list(entry => {
    const definitionReader = entry.field('definition'), expected = definitions.get(definitionReader.field('id').string());
    if (expected === undefined) return definitionReader.fail('saved weapon behavior is not selected');
    return { projectile: readSavedActor(entry.field('projectile')), owner: namespaced(entry.field('owner')), definition: readWeaponBehaviorDefinition(definitionReader, expected) };
  }) };
}
