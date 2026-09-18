import type { Q2ServerRecord } from '../../../network/q2/index.ts';
import type { Q2ServicePresentationHost } from './q2-service-presentation.ts';
import { readElement } from '../../../network/q2/state.ts';

export function translateQ2RereleaseHudRecord(record: Q2ServerRecord, host: Q2ServicePresentationHost & { readonly imageConfigOffset: number }): boolean {
 const event = record.event;
 if (event.kind !== 'poi' && event.kind !== 'damage') return false;
 const player = host.player();
 if (player === null) return false;
 const stamp = { kind: 'q2-rerelease', sequence: host.nextSequence(), content: host.content(), seconds: host.seconds } satisfies Pick<Parameters<typeof host.emit>[0], 'kind' | 'sequence' | 'content' | 'seconds'>;
 if (event.kind === 'poi') {
  const value = event.value;
  if (value.time === 65535) host.emit({ ...stamp, event: { kind: 'remove-poi', actor: player.actor, key: value.key } });
  else {
   const image = host.configString(host.imageConfigOffset + value.image);
   if (image === undefined) throw new Error("Q2 POI image " + value.image + " has no configstring");
   host.emit({ ...stamp, event: { kind: 'keyed-poi', actor: player.actor, key: value.key, duration: value.time, position: { x: readElement(value.pos, 0), y: readElement(value.pos, 1), z: readElement(value.pos, 2) }, image, color: value.color, flags: value.flags } });
  }
 } else for (const value of event.indicators) host.emit({ ...stamp, sequence: host.nextSequence(), event: { kind: 'directional-damage', actor: player.actor, damage: value.damage, health: value.health, armor: value.armor, shield: value.shield, direction: { x: readElement(value.direction, 0), y: readElement(value.direction, 1), z: readElement(value.direction, 2) } } });
 return true;
}
