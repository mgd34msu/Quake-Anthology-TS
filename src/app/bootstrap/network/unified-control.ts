import type { ContentDigest } from '../../../contracts/content.ts';
import type { ArsenalIntent } from '../../../contracts/gameplay.ts';
import type { IntegerTriple, UserCommand } from '../../../contracts/protocol.ts';
import type { CompositionIdentity } from '../../../network/common/session.ts';
import { decodeCheckpointValue, encodeCheckpointValue, namespaced, SaveReader } from '../../../persistence/value.ts';
import { readContentId } from '../../../persistence/recipe.ts';
import { readDigest } from '../../../persistence/shared.ts';
import { readUnifiedComposition } from './unified-content.ts';
import type { UnifiedResourceKey } from './unified-frame-codec.ts';

export interface UnifiedActorReference { readonly slot: number; readonly generation: number; }
export type UnifiedControl =
  | { readonly kind: 'offer'; readonly epoch: number; readonly composition: CompositionIdentity; readonly mode: 'singleplayer' | 'coop' | 'deathmatch'; readonly maxClients: number }
  | { readonly kind: 'ready'; readonly epoch: number; readonly composition: ContentDigest; readonly userinfo: string }
  | { readonly kind: 'admitted'; readonly epoch: number; readonly client: UnifiedActorReference; readonly actor: UnifiedActorReference; readonly sourceEntity: number }
  | { readonly kind: 'resources'; readonly epoch: number; readonly resources: readonly UnifiedResourceKey[] }
  | { readonly kind: 'events'; readonly epoch: number; readonly frame: number; readonly payload: Uint8Array; readonly simulation: Uint8Array }
  | { readonly kind: 'command'; readonly epoch: number; readonly name: string; readonly args: readonly string[] }
  | { readonly kind: 'userinfo'; readonly epoch: number; readonly value: string }
  | { readonly kind: 'disconnect'; readonly reason: string };

export interface UnifiedInput {
  readonly sequence: number;
  readonly command: UserCommand;
  readonly arsenal?: ArsenalIntent;
}
export interface UnifiedInputBatch { readonly epoch: number; readonly commands: readonly UnifiedInput[]; }
export type UnifiedHandshake =
  | { readonly kind: 'hello'; readonly nonce: string }
  | { readonly kind: 'challenge'; readonly nonce: string; readonly token: string }
  | { readonly kind: 'connect'; readonly nonce: string; readonly token: string };

function bounded(r: SaveReader, minimum: number, maximum: number): number {
  const value = r.integer(minimum);
  return value <= maximum ? value : r.fail('number exceeds protocol limit');
}
function string(r: SaveReader, maximum = 8192): string {
  const value = r.string();
  return value.length <= maximum && !value.includes('\0') ? value : r.fail('invalid protocol string');
}
function actor(r: SaveReader): UnifiedActorReference {
  return { slot: bounded(r.field('slot'), 0, 1048575), generation: r.field('generation').integer(0) };
}
function token(r: SaveReader): string {
  const value = string(r, 32);
  return /^[a-f0-9]{32}$/.test(value) ? value : r.fail('invalid connection token');
}
function vector(r: SaveReader) { return { x: r.field('x').finite(), y: r.field('y').finite(), z: r.field('z').finite() }; }
function angles(r: SaveReader): IntegerTriple {
  const values = r.list(v => bounded(v, -2147483648, 2147483647));
  const [a, b, c] = values;
  if (values.length !== 3 || a === undefined || b === undefined || c === undefined) return r.fail('expected three command angles');
  return [a, b, c];
}
function readCommand(r: SaveReader): UserCommand {
  const kind = r.field('kind').choice('q1-netquake', 'q1-quakeworld', 'q2-classic', 'q2-rerelease', 'q3');
  const buttons = bounded(r.field('buttons'), 0, 4294967295);
  const movement = (name: string): number => bounded(r.field(name), -32768, 32767);
  if (kind === 'q3') return { kind, buttons, serverTimeMilliseconds: bounded(r.field('serverTimeMilliseconds'), 0, 2147483647),
    angleWords: angles(r.field('angleWords')), weapon: bounded(r.field('weapon'), 0, 255), forwardMove: movement('forwardMove'), rightMove: movement('rightMove'), upMove: movement('upMove') };
  if (kind === 'q2-rerelease') return { kind, buttons, milliseconds: bounded(r.field('milliseconds'), 0, 1000), angles: vector(r.field('angles')),
    forwardMove: r.field('forwardMove').finite(), sideMove: r.field('sideMove').finite(), serverFrame: bounded(r.field('serverFrame'), -1, 2147483647) };
  const common = { buttons, forwardMove: movement('forwardMove'), sideMove: movement('sideMove'), upMove: movement('upMove'), impulse: bounded(r.field('impulse'), 0, 255) };
  if (kind === 'q1-netquake') return { ...common, kind, acknowledgedServerTimeSeconds: r.field('acknowledgedServerTimeSeconds').finite(), viewAngles: vector(r.field('viewAngles')) };
  const milliseconds = bounded(r.field('milliseconds'), 0, 255);
  if (kind === 'q1-quakeworld') return { ...common, kind, milliseconds, angles: vector(r.field('angles')) };
  return { ...common, kind, milliseconds, angleShorts: angles(r.field('angleShorts')), lightLevel: bounded(r.field('lightLevel'), 0, 255) };
}
function readArsenal(r: SaveReader): ArsenalIntent {
  return { provider: namespaced(r.field('provider')), weapon: r.field('weapon').nullable(namespaced), useHoldable: r.field('useHoldable').boolean(),
    ...(r.field('impulse').value === undefined ? {} : { impulse: bounded(r.field('impulse'), 0, 255) }) };
}
function key(r: SaveReader): UnifiedResourceKey {
  const path = string(r.field('path'), 1024);
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path) || path.split('/').some(part => part === '' || part === '.' || part === '..')) return r.fail('invalid resource member');
  return { content: readContentId(r.field('content')), path, digest: readDigest(r.field('digest')), byteLength: bounded(r.field('byteLength'), 0, 2147483647) };
}
function reader(bytes: Uint8Array, schema: string, maximum: number): SaveReader {
  if (bytes.length > maximum) throw new RangeError(`${schema} exceeds protocol limit`);
  const r = new SaveReader(decodeCheckpointValue(bytes), schema);
  r.field('schema').literal(schema); r.field('version').literal(1);
  return r.field('value');
}

export function encodeUnifiedControl(value: UnifiedControl): Uint8Array {
  return encodeCheckpointValue({ schema: 'qts-control', version: 1, value });
}
export function decodeUnifiedControl(bytes: Uint8Array): UnifiedControl {
  const r = reader(bytes, 'qts-control', 4 * 1024 * 1024);
  const kind = r.field('kind').choice('offer', 'ready', 'admitted', 'resources', 'events', 'command', 'userinfo', 'disconnect');
  if (kind === 'disconnect') return { kind, reason: string(r.field('reason'), 1024) };
  const epoch = bounded(r.field('epoch'), 1, 4294967295);
  switch (kind) {
    case 'offer': return { kind, epoch, composition: readUnifiedComposition(r.field('composition').value), mode: r.field('mode').choice('singleplayer', 'coop', 'deathmatch'), maxClients: bounded(r.field('maxClients'), 1, 256) };
    case 'ready': return { kind, epoch, composition: readDigest(r.field('composition')), userinfo: string(r.field('userinfo')) };
    case 'admitted': return { kind, epoch, client: actor(r.field('client')), actor: actor(r.field('actor')), sourceEntity: r.field('sourceEntity').integer(0) };
    case 'resources': { const resources = r.field('resources').list(key); if (resources.length > 32768) return r.fail('too many resource declarations'); return { kind, epoch, resources }; }
    case 'events': return { kind, epoch, frame: r.field('frame').integer(0), payload: r.field('payload').bytes(), simulation: r.field('simulation').bytes() };
    case 'command': {
      const name = string(r.field('name'), 128), args = r.field('args').list(v => string(v));
      if (!/^[a-zA-Z_+][a-zA-Z0-9_+-]*$/.test(name) || args.length > 128) return r.fail('invalid command');
      return { kind, epoch, name, args };
    }
    case 'userinfo': return { kind, epoch, value: string(r.field('value')) };
  }
}

export function encodeUnifiedInputs(value: UnifiedInputBatch): Uint8Array {
  return encodeCheckpointValue({ schema: 'qts-input', version: 1, value });
}
export function decodeUnifiedInputs(bytes: Uint8Array): UnifiedInputBatch {
  const r = reader(bytes, 'qts-input', 65536), commands = r.field('commands').list(c => ({ sequence: c.field('sequence').integer(0), command: readCommand(c.field('command')),
    ...(c.field('arsenal').value === undefined ? {} : { arsenal: readArsenal(c.field('arsenal')) }) }));
  if (commands.length > 64) return r.fail('too many input commands');
  return { epoch: bounded(r.field('epoch'), 1, 4294967295), commands };
}
export function encodeUnifiedHandshake(value: UnifiedHandshake): Uint8Array {
  return encodeCheckpointValue({ schema: 'qts-connect', version: 1, value });
}
export function decodeUnifiedHandshake(bytes: Uint8Array): UnifiedHandshake | null {
  if (bytes.length > 512) return null;
  try {
    const r = reader(bytes, 'qts-connect', 512), kind = r.field('kind').choice('hello', 'challenge', 'connect'), nonce = token(r.field('nonce'));
    return kind === 'hello' ? { kind, nonce } : { kind, nonce, token: token(r.field('token')) };
  } catch { return null; }
}
