import { qcWeaponBehaviorCapabilityError } from "../../compat/qc/weapon-behavior-profile.ts";
import type { ModuleIdentity, GuestCallbackReference } from '../../contracts/execution.ts';
import type { ProjectileRole, WeaponBehaviorCompatibility, WeaponBehaviorDefinition } from '../../contracts/weapon-behavior.ts';
import { QcOpcode, type QcProgram } from '../../compat/qc/program.ts';
import type { MountedContent } from '../mounts/index.ts';
import { isContentDigest, createContentDigest } from '../../contracts/content.ts';

export interface SourceWeaponBehaviorMetadata {
  readonly id: `${string}:${string}`;
  readonly title: string;
  readonly artifactDigest: ModuleIdentity['digest'];
  readonly role: ProjectileRole;
  readonly aspect: 'trajectory';
  readonly fireFunction: string;
  readonly activationFunction?: string;
}
/** Metadata comes from the mounted source provider's declaration or observed source weapon binding. */
export function resolveQcWeaponBehavior(module: ModuleIdentity, program: QcProgram, metadata: SourceWeaponBehaviorMetadata): WeaponBehaviorCompatibility {
  if (module.digest !== program.digest || metadata.artifactDigest !== program.digest) return { kind: 'unsupported', reason: 'Behavior metadata belongs to a different source artifact' };
  const capability = qcWeaponBehaviorCapabilityError(program);
  if (capability !== null) return { kind: "unsupported", reason: capability };
  const callback = (name: string): Extract<GuestCallbackReference, { readonly kind: "quakec" }> | null => {
    const fn = program.functionsByName.get(name);
    return fn === undefined || fn.index === 0 || fn.firstStatement < 0 || fn.parameterSizes.length !== 0 ? null : { kind: 'quakec', module, functionIndex: fn.index };
  };
  const fire = callback(metadata.fireFunction), activate = metadata.activationFunction === undefined ? null : callback(metadata.activationFunction);
  if (fire === null || metadata.activationFunction !== undefined && activate === null) return { kind: 'unsupported', reason: 'Declared behavior entrypoint is absent from the source program' };
  return { kind: 'supported', definition: { id: metadata.id, title: metadata.title, module, role: metadata.role, aspect: metadata.aspect, fire, activate } };
}
export class WeaponBehaviorCatalog {
  private readonly entries = new Map<string, WeaponBehaviorDefinition>();
  add(definition: WeaponBehaviorDefinition): void {
    if (this.entries.has(definition.id)) throw new Error(`Duplicate weapon behavior ${definition.id}`);
    this.entries.set(definition.id, definition);
  }
  forRole(role: ProjectileRole): readonly WeaponBehaviorDefinition[] { return [...this.entries.values()].filter(entry => entry.role === role); }
  require(id: string): WeaponBehaviorDefinition {
    const result = this.entries.get(id); if (result === undefined) throw new Error(`Unknown weapon behavior ${id}`); return result;
  }
}

export interface QcTrajectoryBindingInspection {
  readonly producerFunction: number;
  readonly thinkFunction: number;
  readonly statement: number;
}
/** Reports explicit bytecode stores to the source ABI think field; it does not infer a weapon role. */
export function inspectQcTrajectoryBindings(program: QcProgram): readonly QcTrajectoryBindingInspection[] {
  const think = program.fieldsByName.get('think'); if (think === undefined) return [];
  const globals = new DataView(program.initialGlobals.buffer, program.initialGlobals.byteOffset, program.initialGlobals.byteLength);
  const word = (offset: number): number | null => offset >= 0 && offset * 4 + 4 <= globals.byteLength ? globals.getInt32(offset * 4, true) : null;
  const functions = program.functions.filter(fn => fn.index !== 0 && fn.firstStatement >= 0).sort((a, b) => a.firstStatement - b.firstStatement);
  const result: QcTrajectoryBindingInspection[] = [];
  for (let index = 0; index < functions.length; index++) {
    const fn = functions[index]; if (fn === undefined) continue;
    const end = functions[index + 1]?.firstStatement ?? program.statements.length;
    for (let cursor = fn.firstStatement; cursor + 1 < end; cursor++) {
      const address = program.statements[cursor], store = program.statements[cursor + 1];
      if (address?.opcode !== QcOpcode.Address || store?.opcode !== QcOpcode.StorePFn || address.c !== store.b || word(address.b) !== think.offset) continue;
      const target = word(store.a), callback = target === null ? undefined : program.functions[target];
      if (callback === undefined || callback.index === 0 || callback.firstStatement < 0) continue;
      // Only the literal function global is an artifact identity; mutable function variables require runtime observation.
      if (![...program.globalsByName.values()].some(global => global.type === 'function' && global.offset === store.a && global.name === callback.name)) continue;
      if (program.statements.some(statement => statement.opcode === QcOpcode.StoreFn && statement.b === store.a)) continue;
      result.push({ producerFunction: fn.index, thinkFunction: callback.index, statement: cursor + 1 });
    }
  }
  return result;
}

export type MountedWeaponBehaviorDiscovery =
  | { readonly kind: 'declared'; readonly declarations: readonly WeaponBehaviorCompatibility[] }
  | { readonly kind: 'undeclared'; readonly bindings: readonly QcTrajectoryBindingInspection[]; readonly reason: string };

/** Reads a mounted provider declaration; artifact identity is checked before any source callback is exposed. */
export async function discoverQcWeaponBehaviors(content: Pick<MountedContent, 'open'>, module: ModuleIdentity, program: QcProgram): Promise<MountedWeaponBehaviorDiscovery> {
  const resource = await content.open('weapon-behaviors.json');
  if (resource === null) return { kind: 'undeclared', bindings: inspectQcTrajectoryBindings(program), reason: 'No authored weapon behavior declaration; bytecode callback stores do not establish projectile role, activation gate or selected aspect' };
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(resource.bytes));
  if (!isRecord(value) || value['version'] !== 1 || !isUnknownArray(value['behaviors'])) throw new Error('Invalid weapon behavior declaration');
  const declarations: WeaponBehaviorCompatibility[] = [];
  const seen = new Set<string>();
  const entries: readonly unknown[] = value['behaviors'];
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry['id'] !== 'string' || !behaviorId(entry['id']) || typeof entry['title'] !== 'string'
      || typeof entry['artifactDigest'] !== 'string' || typeof entry['fireFunction'] !== 'string'
      || entry['activationFunction'] !== undefined && typeof entry['activationFunction'] !== 'string'
      || !projectileRole(entry['role']) || entry['aspect'] !== 'trajectory') throw new Error('Invalid weapon behavior entry');
    const artifactDigest = declarationDigest(entry['artifactDigest']);
    if (artifactDigest === null) throw new Error('Invalid weapon behavior artifact digest');
    if (seen.has(entry['id'])) throw new Error(`Duplicate declared weapon behavior ${entry['id']}`); seen.add(entry['id']);
    declarations.push(resolveQcWeaponBehavior(module, program, { id: entry['id'], title: entry['title'],
      artifactDigest, role: entry['role'], aspect: entry['aspect'], fireFunction: entry['fireFunction'],
      ...(entry['activationFunction'] === undefined ? {} : { activationFunction: entry['activationFunction'] }) }));
  }
  return { kind: 'declared', declarations };
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function behaviorId(value: string): value is `${string}:${string}` { return /^[^:\s]+:[^\s]+$/.test(value); }
function projectileRole(value: unknown): value is ProjectileRole { return value === 'rocket' || value === 'grenade' || value === 'nail' || value === 'bolt' || value === 'plasma' || value === 'energy' || value === 'grapple'; }

function isUnknownArray(value: unknown): value is readonly unknown[] { return Array.isArray(value); }

function declarationDigest(value: string): ModuleIdentity['digest'] | null {
  if (isContentDigest(value)) return value;
  return /^[a-f0-9]{64}$/.test(value) ? createContentDigest(value) : null;
}
