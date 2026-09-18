import { parseQ1Entities, q1EntityValue } from '../../../formats/q1-map/entities.ts';
import type { Q1Entity } from '../../../formats/q1-map/types.ts';

interface NativeQ2MapGeometry {
 readonly kind: 'q1-bsp' | 'q2-bsp' | 'q3-bsp';
 readonly entities: string;
 readonly models: { readonly length: number };
}
/** Geometry stays in SharedSceneQueries; only equivalent authored source entity roles change. */
export function prepareNativeQ2Map(world: NativeQ2MapGeometry, edition: 'classic' | 'rerelease', mode: 'singleplayer' | 'coop' | 'deathmatch'): string {
 const maximum = edition === 'classic' ? 255 : 8190;
 if (world.models.length > maximum) throw new RangeError('Native Quake II map exceeds source inline-model capacity');
 if (world.kind === 'q2-bsp') return world.entities;
 const aliases: ReadonlyMap<string, string> = new Map([
  ['team_CTF_redflag', 'item_flag_team1'], ['team_CTF_blueflag', 'item_flag_team2'],
  ['team_CTF_redplayer', 'info_player_team1'], ['team_CTF_redspawn', 'info_player_team1'],
  ['team_CTF_blueplayer', 'info_player_team2'], ['team_CTF_bluespawn', 'info_player_team2'],
 ]);
 const parsed = parseQ1Entities(world.entities);
 const replace = (entity: Q1Entity, classname: string): Q1Entity => ({ properties: entity.properties.map(field => field.key === 'classname' ? { key: field.key, value: classname } : field) });
 const entities = parsed.map(entity => {
  const classname = q1EntityValue(entity, 'classname') ?? '', replacement = world.kind === 'q3-bsp' ? aliases.get(classname) : undefined;
  return replacement === undefined ? entity : replace(entity, replacement);
 });
 const wanted = mode === 'deathmatch' ? 'info_player_deathmatch' : 'info_player_start';
 if (!entities.some(entity => q1EntityValue(entity, 'classname') === wanted)) {
  const equivalents = mode === 'deathmatch' ? ['info_player_start', 'info_player_coop', 'info_player_team1', 'info_player_team2'] : ['info_player_deathmatch'];
  for (const entity of [...entities]) if (equivalents.includes(q1EntityValue(entity, 'classname') ?? '')) entities.push(replace(entity, wanted));
 }
 const quote = (value: string): string => { if (value.includes('"') || value.includes('\0')) throw new Error('Native Quake II entity field cannot be quoted'); return '"' + value + '"'; };
 return entities.map(entity => '{\n' + entity.properties.map(field => quote(field.key) + ' ' + quote(field.value)).join('\n') + '\n}\n').join('');
}
