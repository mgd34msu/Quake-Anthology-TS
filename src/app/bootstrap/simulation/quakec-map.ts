import type { DecodedWorld } from '../../../contracts/scene.ts';
import { parseQ1Entities, q1EntityValue } from '../../../formats/q1-map/entities.ts';
import type { Q1Entity } from '../../../formats/q1-map/types.ts';

/** Keep authored module fields; only add an equivalent missing player-start role. */
export function quakeCMapEntities(world: DecodedWorld, mode: 'singleplayer' | 'coop' | 'deathmatch'): string {
  if (world.kind === 'q1-bsp') return world.entities;
  const entities = [...parseQ1Entities(world.entities)];
  const wanted = mode === 'deathmatch' ? 'info_player_deathmatch' : 'info_player_start';
  if (!entities.some(entity => q1EntityValue(entity, 'classname') === wanted)) {
    const candidates = mode === 'deathmatch'
      ? ['info_player_start', 'info_player_coop', 'team_CTF_redplayer', 'team_CTF_blueplayer', 'team_CTF_redspawn', 'team_CTF_bluespawn']
      : ['info_player_deathmatch', 'team_CTF_redplayer', 'team_CTF_blueplayer'];
    for (const entity of [...entities]) {
      if (!candidates.includes(q1EntityValue(entity, 'classname') ?? '')) continue;
      const replacement: Q1Entity = { properties: entity.properties.map(property => property.key === 'classname'
        ? { key: property.key, value: wanted } : property) };
      entities.push(replacement);
    }
  }
  const quote = (value: string): string => {
    if (value.includes('"') || value.includes('\0')) throw new Error('QuakeC entity field cannot be quoted');
    return '"' + value + '"';
  };
  return entities.map(entity => '{\n' + entity.properties.map(field => quote(field.key) + ' ' + quote(field.value)).join('\n') + '\n}\n').join('');
}
