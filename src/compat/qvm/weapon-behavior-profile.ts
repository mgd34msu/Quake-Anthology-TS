import { sameWeaponBehavior } from '../../contracts/weapon-behavior.ts';
import type { QvmAbiProfile } from '../../contracts/execution.ts';
import type { WeaponBehaviorDefinition, QvmWeaponBehaviorLayout } from '../../contracts/weapon-behavior.ts';
import { SaveReader } from '../../persistence/value.ts';
import type { QvmModuleOptions } from './module.ts';
import { QvmOpcode } from './image.ts';
import { qvmSharedEntityBytes } from './shared-entity-record.ts';

/** Private offsets are declarations for exact source bytes, never inferred from a product name. */
export interface QvmWeaponProfile extends QvmWeaponBehaviorLayout { readonly definition: WeaponBehaviorDefinition; }
export function qvmWeaponProfileDeclaration(profile: QvmWeaponProfile, abiProfile: QvmAbiProfile): unknown {
  const definition = profile.definition;
  if (definition.fire.kind !== 'qvm' || definition.activate !== null && definition.activate.kind !== 'qvm' || !definition.id.startsWith('qvm:')) throw new Error('Invalid QVM weapon callback identity');
  return { version: 1, artifactDigest: definition.module.digest, artifactPath: definition.module.artifactPath, abiProfile,
    id: definition.id.slice(4), title: definition.title, role: definition.role, aspect: definition.aspect,
    fireFunction: definition.fire.instructionIndex, activationFunction: definition.activate?.instructionIndex ?? null,
    entityStride: profile.entityStride, levelTime: profile.levelTime, allocateFunction: profile.allocate, freeFunction: profile.free,
    fields: profile.fields, fireAbi: profile.fireAbi };
}
export function validateQvmWeaponProfile(profile: QvmWeaponProfile, artifact: QvmModuleOptions['artifact']): QvmWeaponProfile {
  const validated = readQvmWeaponProfile(qvmWeaponProfileDeclaration(profile, artifact.abiProfile ?? 'q3-modern'), artifact);
  if (!sameWeaponBehavior(profile.definition, validated.definition)) throw new Error('QVM weapon callback identity differs from the loaded artifact');
  return validated;
}
export function readQvmWeaponProfile(value: unknown, artifact: QvmModuleOptions['artifact']): QvmWeaponProfile {
  const reader = new SaveReader(value, 'qvm-weapon-profile');
  reader.field('version').literal(1);
  reader.field('artifactDigest').literal(artifact.module.digest);
  reader.field('artifactPath').literal(artifact.module.artifactPath);
  reader.field('abiProfile').literal(artifact.abiProfile ?? 'q3-modern');
  if (artifact.role !== 'qagame') throw reader.fail('weapon behavior requires a qagame artifact');
  const entry = (field: SaveReader): number => {
    const index = field.integer(1);
    if (artifact.image.instructions[index]?.opcode !== QvmOpcode.OP_ENTER) throw field.fail('callback is not a QVM function entry');
    return index;
  };
  const id = reader.field('id').string();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw reader.field('id').fail('expected a stable behavior identifier');
  const module = artifact.module;
  const activation = reader.field('activationFunction');
  const definition: WeaponBehaviorDefinition = {
    id: `qvm:${id}`, title: reader.field('title').string(), module,
    role: reader.field('role').choice('rocket', 'grenade', 'nail', 'bolt', 'plasma', 'energy', 'grapple'), aspect: reader.field('aspect').literal('trajectory'),
    fire: { kind: 'qvm', module, instructionIndex: entry(reader.field('fireFunction')) },
    activate: activation.value === null || activation.value === undefined ? null : { kind: 'qvm', module, instructionIndex: entry(activation) },
  };
  const minimum = qvmSharedEntityBytes(artifact.abiProfile ?? 'q3-modern');
  const entityStride = reader.field('entityStride').integer(minimum);
  if (entityStride % 4 !== 0 || entityStride > artifact.image.allocatedDataLength) throw reader.field('entityStride').fail('invalid entity stride');
  const occupied = new Set<number>();
  const field = (name: string): number => {
    const source = reader.field('fields').field(name), offset = source.integer(minimum);
    if (offset % 4 !== 0 || offset > entityStride - 4 || occupied.has(offset)) throw source.fail('private field is overlapping, unaligned or outside the entity');
    occupied.add(offset); return offset;
  };
  const levelTime = reader.field('levelTime').integer(4);
  if (levelTime % 4 !== 0 || levelTime > artifact.image.dataLength + artifact.image.literalLength + artifact.image.bssLength - 4)
    throw reader.field('levelTime').fail('level clock is outside declared guest data');
  return { definition, entityStride, levelTime, allocate: entry(reader.field('allocateFunction')), free: entry(reader.field('freeFunction')),
    fields: { inuse: field('inuse'), nextthink: field('nextthink'), think: field('think'), health: field('health') },
    fireAbi: reader.field('fireAbi').literal('entity-pointer-start-direction') };
}
