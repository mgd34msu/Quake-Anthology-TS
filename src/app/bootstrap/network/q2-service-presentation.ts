import type { ContentId } from '../../../contracts/content.ts';
import type { ActorId } from '../../../contracts/identity.ts';
import type { Vec3 } from '../../../contracts/math.ts';
import { muzzleOffset } from '../../../content/q2/foundation/monsters/muzzle.ts';
import { anglesVectors } from '../../../content/q2/foundation/monsters/ai.ts';
import type { Q2ServerRecord } from '../../../network/q2/index.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';
import { q2EffectFromWire } from './q2-effects.ts';

export interface Q2ServicePresentationHost {
  content(): ContentId;
  readonly seconds: number;
  nextSequence(): number;
  player(): { readonly actor: ActorId; readonly sourceEntity: number } | null;
  actor(sourceEntity: number): ActorId | null;
  entity(sourceEntity: number): { readonly origin: Vec3; readonly angles: Vec3 } | null;
  readonly soundConfigOffset: number;
  readonly playerSkinConfigOffset: number;
  configString(index: number): string | undefined;
  setConfigString(index: number, value: string): void;
  setInventory(counts: readonly number[]): void;
  setLayout(text: string): void;
  emit(event: SimulationPresentationEvent): void;
}

export function q2ServicePlayerInfo(host: Q2ServicePresentationHost, index: number, value: string): boolean {
  if (index < host.playerSkinConfigOffset || index >= host.playerSkinConfigOffset + 256) return false;
  const slot = index - host.playerSkinConfigOffset, split = value.indexOf('\\'), actor = host.actor(slot + 1);
  if (actor === null) return false;
  host.emit({ kind: 'q2-player', sequence: host.nextSequence(), content: host.content(), seconds: host.seconds, sourceEntity: slot + 1,
    event: { kind: 'userinfo', actor, slot, name: split < 0 ? value : value.slice(0, split), skin: split < 0 ? '' : value.slice(split + 1) } });
  return true;
}

/** Presentation effects from already decoded svc records; command/control handling stays with the receiver. */
export function translateQ2ServiceRecords(records: readonly Q2ServerRecord[], host: Q2ServicePresentationHost): readonly Q2ServerRecord[] {
  const remaining: Q2ServerRecord[] = [];
  for (const record of records) {
    const { event } = record;
    if (event.kind === 'config-string') {
      host.setConfigString(event.index, event.value);
      if (host.player() !== null) q2ServicePlayerInfo(host, event.index, event.value);
    } else if (event.kind === 'print' && event.level === 3) {
      const player = host.player();
      if (player !== null) host.emit({ kind: 'q2-player', sequence: host.nextSequence(), content: host.content(), seconds: host.seconds,
        sourceEntity: player.sourceEntity, event: { kind: 'print', target: player.actor, level: 'chat', text: event.text } });
      else remaining.push(record);
    } else if (event.kind === 'inventory') host.setInventory(event.counts);
    else if (event.kind === 'layout') host.setLayout(event.text);
    else if (event.kind === 'temporary-entity') {
      const decoded = q2EffectFromWire(event.value);
      if (decoded !== null) host.emit({ kind: 'q2', sequence: host.nextSequence(), content: host.content(), seconds: host.seconds, sourceEntity: null, event: decoded });
      else remaining.push(record);
    } else if (event.kind === 'sound') {
      const path = host.configString(host.soundConfigOffset + event.sound.index);
      if (path === undefined) throw new Error(`Q2 sound ${event.sound.index} has no configstring`);
      const entity = host.entity(event.sound.entity);
      host.emit({ kind: 'q2', sequence: host.nextSequence(), content: host.content(), seconds: host.seconds, sourceEntity: event.sound.entity,
        event: { kind: 'sound', actor: event.sound.entity === 0 ? null : host.actor(event.sound.entity),
          origin: event.sound.position ?? entity?.origin ?? { x: 0, y: 0, z: 0 }, path, volume: event.sound.volume,
          attenuation: event.sound.attenuation, channel: event.sound.channel, reliable: false, loop: 'once' } });
    } else if (event.kind === 'muzzle-flash') {
      if (event.monster) {
        const entity = host.entity(event.entity);
        if (entity === null) { remaining.push(record); continue; }
        const actor = host.actor(event.entity);
        if (actor === null) { remaining.push(record); continue; }
        const axes = anglesVectors(entity.angles), offset = muzzleOffset('classic', event.flash), origin = entity.origin;
        host.emit({ kind: 'q2', sequence: host.nextSequence(), content: host.content(), seconds: host.seconds, sourceEntity: event.entity,
          event: { kind: 'monster-muzzleflash', actor, flash: event.flash,
            origin: { x: origin.x + axes.forward.x * offset.x + axes.right.x * offset.y,
              y: origin.y + axes.forward.y * offset.x + axes.right.y * offset.y,
              z: origin.z + axes.forward.z * offset.x + axes.right.z * offset.y + offset.z }, direction: axes.forward } });
      } else {
        const actor = host.actor(event.entity);
        if (actor === null) { remaining.push(record); continue; }
        host.emit({ kind: 'q2-weapon', sequence: host.nextSequence(), content: host.content(), seconds: host.seconds,
        sourceEntity: event.entity, event: { kind: 'muzzleflash', actor, flash: event.flash, silenced: event.silenced } });
      }
    } else if (event.kind === 'center-print') {
      const player = host.player();
      if (player !== null) host.emit({ kind: 'q2', sequence: host.nextSequence(), content: host.content(), seconds: host.seconds,
        sourceEntity: player.sourceEntity, event: { kind: 'centerprint', actor: player.actor, text: event.text } });
      else remaining.push(record);
    } else remaining.push(record);
  }
  return remaining;
}
