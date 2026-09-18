import type { NativeWeaponBehaviorDeclaration, NativeWeaponEntry, NativeWeaponRegistrationLayout, NativeWeaponCommand, NativeWeaponCvar } from '../../../contracts/native-weapon-behavior.ts';
import type { ModuleIdentity } from '../../../contracts/execution.ts';
import { createContentDigest } from '../../../contracts/content.ts';
import { normalizeResourcePath } from '../../../content/mounts/paths.ts';
import { edictLayout, fieldOffset } from './layouts.ts';
import { SaveReader, namespaced } from '../../../persistence/value.ts';

function keys(reader: SaveReader, allowed: readonly string[]): void {
  const value = reader.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) reader.fail('expected a declaration record');
  for (const name of Object.keys(value)) if (!allowed.includes(name)) reader.field(name).fail('unsupported declaration field');
}
function uint(reader: SaveReader, minimum = 0): number {
  const value = reader.integer(minimum);
  if (value > 0xffffffff) reader.fail('expected a uint32 byte offset or value');
  return value;
}
function text(reader: SaveReader, allowEmpty = false): string {
  const value = reader.string();
  if ((!allowEmpty && value.length === 0) || value.includes('\0')) reader.fail('expected non-NUL text');
  return value;
}
function fields(reader: SaveReader): { readonly byteLength: number; field(name: string, width: number): number } {
  const byteLength = uint(reader.field('byteLength'), 1), used: { start: number; end: number }[] = [];
  return { byteLength, field(name, width) {
    const field = reader.field(name), start = uint(field), end = start + width;
    if (end > byteLength || start % (width === 12 ? 4 : Math.min(width, 8)) !== 0) field.fail('field exceeds record or violates its storage alignment');
    if (used.some(other => start < other.end && other.start < end)) field.fail('overlapping declared fields');
    used.push({ start, end }); return start;
  } };
}
function registration(reader: SaveReader): NativeWeaponRegistrationLayout {
  keys(reader, ['byteLength', 'name', 'tag', 'callback']);
  const record = fields(reader);
  return { byteLength: record.byteLength, name: record.field('name', 8), tag: record.field('tag', 4), callback: record.field('callback', 8) };
}
function entry(reader: SaveReader): NativeWeaponEntry {
  keys(reader, ['rva', 'registration']);
  const registered = reader.field('registration');
  if (registered.value !== null) keys(registered, ['rva', 'name', 'tag', 'layout']);
  return { rva: uint(reader.field('rva'), 1), registration: reader.field('registration').nullable(value => ({
    rva: uint(value.field('rva'), 1), name: text(value.field('name')), tag: uint(value.field('tag')),
    layout: registration(value.field('layout')),
  })) };
}
function command(reader: SaveReader): NativeWeaponCommand {
  keys(reader, ['arguments', 'tail']);
  const arguments_ = reader.field('arguments').list(value => text(value, true));
  if (arguments_.length === 0 || arguments_[0] === '') reader.fail('command requires a name');
  return { arguments: arguments_, tail: text(reader.field('tail'), true) };
}
function cvars(reader: SaveReader): readonly NativeWeaponCvar[] {
  const seen = new Set<string>();
  return reader.list(value => {
    keys(value, ['name', 'value']);
    const name = text(value.field('name'));
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || seen.has(name.toLowerCase())) value.fail('invalid or duplicate cvar name');
    seen.add(name.toLowerCase()); return { name, value: text(value.field('value'), true) };
  });
}
function calls(reader: SaveReader): NativeWeaponBehaviorDeclaration['equip'] {
  keys(reader, ['signature', 'calls']);
  const signature = reader.field('signature').literal('entity-void'), values = reader.field('calls').list(entry);
  if (values.length === 0 || values.length > 64) reader.fail('expected 1–64 source calls');
  return { signature, calls: values };
}

/** Parse explicit evidence-backed capabilities; this never discovers private layouts or executable offsets. */
export function readNativeWeaponDeclaration(value: unknown, module?: ModuleIdentity): NativeWeaponBehaviorDeclaration {
  const reader = new SaveReader(value, 'native-weapon-profile');
  keys(reader, ['version', 'kind', 'abi', 'artifactPath', 'artifactDigest', 'id', 'title', 'role', 'aspect', 'entity', 'client', 'equippedWeapon', 'time',
    'think', 'allocate', 'free', 'projectileTouch', 'equip', 'launch', 'activateRva', 'fireRva', 'initializationClasses', 'equipment', 'ammunition', 'initialCvars', 'provisioningCvars']);
  keys(reader.field('entity'), ['byteLength', 'origin', 'angles', 'velocity', 'client', 'owner', 'viewHeight', 'generation', 'nextThink', 'thinkCallback', 'thinkRegistration', 'touchCallback']);
  keys(reader.field('client'), ['byteLength', 'weapon', 'viewAngles', 'forward']);
  keys(reader.field('equippedWeapon'), ['byteLength', 'callback', 'expected']);
  keys(reader.field('time'), ['storage', 'rva']); keys(reader.field('think'), ['signature', 'tag', 'registration']);
  keys(reader.field('allocate'), ['signature', 'entry']); keys(reader.field('free'), ['signature', 'entry']);
  const artifactPath = normalizeResourcePath(text(reader.field('artifactPath'))), digest = reader.field('artifactDigest').string();
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) reader.field('artifactDigest').fail('expected canonical SHA256 identity');
  const artifactDigest = createContentDigest(digest.slice(7));
  if (module !== undefined && (module.digest !== artifactDigest || module.artifactPath !== artifactPath)) reader.fail('native profile artifact identity differs');
  const entity = fields(reader.field('entity')), client = fields(reader.field('client')), weapon = fields(reader.field('equippedWeapon'));
  const equip = calls(reader.field('equip')), launch = calls(reader.field('launch'));
  const activateRva = reader.field('activateRva').nullable(value => uint(value, 1)), fireRva = uint(reader.field('fireRva'), 1);
  if (activateRva !== null && !equip.calls.some(call => call.rva === activateRva)) reader.fail('activation must identify a declared equip call');
  if (!launch.calls.some(call => call.rva === fireRva)) reader.fail('fire must identify a declared launch call');
  const initializationClasses = reader.field('initializationClasses').list(value => text(value));
  if (initializationClasses.filter(name => name === 'worldspawn').length !== 1 || new Set(initializationClasses).size !== initializationClasses.length)
    reader.fail('initialization classes require one worldspawn and unique classes');
  const profile: NativeWeaponBehaviorDeclaration = {
    version: reader.field('version').literal(1), kind: reader.field('kind').literal('q2-api2023-trajectory'),
    abi: reader.field('abi').literal('windows-x86-64'), artifactPath, artifactDigest,
    id: namespaced(reader.field('id')), title: text(reader.field('title')),
    role: reader.field('role').choice('rocket', 'grenade', 'nail', 'bolt', 'plasma', 'energy', 'grapple'), aspect: reader.field('aspect').literal('trajectory'),
    entity: { byteLength: entity.byteLength, origin: entity.field('origin', 12), angles: entity.field('angles', 12), velocity: entity.field('velocity', 12),
      client: entity.field('client', 8), owner: entity.field('owner', 8), viewHeight: entity.field('viewHeight', 4), generation: entity.field('generation', 4),
      nextThink: entity.field('nextThink', 8), thinkCallback: entity.field('thinkCallback', 8), thinkRegistration: entity.field('thinkRegistration', 8), touchCallback: entity.field('touchCallback', 8) },
    client: { byteLength: client.byteLength, weapon: client.field('weapon', 8), viewAngles: client.field('viewAngles', 12), forward: client.field('forward', 12) },
    equippedWeapon: { byteLength: weapon.byteLength, callback: weapon.field('callback', 8), expected: entry(reader.field('equippedWeapon').field('expected')) },
    time: { storage: reader.field('time').field('storage').literal('int64-milliseconds'), rva: uint(reader.field('time').field('rva'), 1) },
    think: { signature: reader.field('think').field('signature').literal('entity-void'), tag: uint(reader.field('think').field('tag')),
      registration: registration(reader.field('think').field('registration')) },
    allocate: { signature: reader.field('allocate').field('signature').literal('void-pointer'), entry: entry(reader.field('allocate').field('entry')) },
    free: { signature: reader.field('free').field('signature').literal('entity-void'), entry: entry(reader.field('free').field('entry')) },
    projectileTouch: entry(reader.field('projectileTouch')), equip, launch, activateRva, fireRva, initializationClasses,
    equipment: reader.field('equipment').list(command), ammunition: command(reader.field('ammunition')),
    initialCvars: cvars(reader.field('initialCvars')), provisioningCvars: cvars(reader.field('provisioningCvars')),
  };
  if (profile.entity.byteLength < edictLayout.byteLength || profile.entity.origin !== fieldOffset(edictLayout, 's.origin')
    || profile.entity.angles !== fieldOffset(edictLayout, 's.angles') || profile.entity.client !== fieldOffset(edictLayout, 'client')
    || profile.entity.owner !== fieldOffset(edictLayout, 'owner')) reader.field('entity').fail('declared fields differ from the public API2023 edict prefix');
  return profile;
}
export function serializeNativeWeaponDeclaration(value: NativeWeaponBehaviorDeclaration): string {
  return JSON.stringify(readNativeWeaponDeclaration(value));
}
export function sameNativeWeaponDeclaration(left: NativeWeaponBehaviorDeclaration, right: NativeWeaponBehaviorDeclaration): boolean {
  return serializeNativeWeaponDeclaration(left) === serializeNativeWeaponDeclaration(right);
}

/** Catalog admission checks declarations against the actual selected image, before native execution. */
export function validateNativeWeaponImage(profile: NativeWeaponBehaviorDeclaration, image: import('../../../guest/pe/index.ts').PeFile): void {
  if (image.abi.kind !== profile.abi) throw new Error('Native weapon declaration ABI differs from its PE image');
  const range = (rva: number, size: number, access: 'read' | 'write' | 'execute'): void => {
    if (rva + size > image.imageSize || !image.sections.some(section => rva >= section.rva && rva + size <= section.rva + section.mappedSize
      && section.permissions.includes(access))) throw new Error(`Native weapon ${access} range is outside its PE section: ${rva}+${size}`);
  };
  const check = (entry: NativeWeaponEntry): void => {
    range(entry.rva, 1, 'execute');
    if (entry.registration !== null) range(entry.registration.rva, entry.registration.layout.byteLength, 'read');
  };
  for (const entry of [...profile.equip.calls, ...profile.launch.calls, profile.allocate.entry, profile.free.entry, profile.projectileTouch, profile.equippedWeapon.expected]) check(entry);
  range(profile.time.rva, 8, 'write');
}
