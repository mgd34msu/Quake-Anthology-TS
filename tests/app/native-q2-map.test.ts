import { expect, test } from 'bun:test';
import { prepareNativeQ2Map } from '../../src/app/bootstrap/simulation/native-q2-map.ts';
import { parseEntities } from '../../src/core/common-parse.ts';

test('native Q2 map boundary preserves native bytes and projects foreign authored spawn roles', () => {
 const entities = '// authored formatting\n{ "classname" "worldspawn" }\n{ "classname" "info_player_start" "origin" "10 20 30" "angle" "90" }\n{ "classname" "custom_mod_entity" "custom" "retain" }';
 expect(prepareNativeQ2Map({ kind: 'q2-bsp', entities, models: [] }, 'classic', 'deathmatch')).toBe(entities);
 const q1 = parseEntities(prepareNativeQ2Map({ kind: 'q1-bsp', entities, models: [] }, 'classic', 'deathmatch'));
 expect(q1.find(entity => entity.get('classname') === 'info_player_deathmatch')?.get('origin')).toBe('10 20 30');
 expect(q1.find(entity => entity.get('classname') === 'info_player_deathmatch')?.get('angle')).toBe('90');
 expect(q1.find(entity => entity.get('classname') === 'custom_mod_entity')?.get('custom')).toBe('retain');
 const q3 = parseEntities(prepareNativeQ2Map({ kind: 'q3-bsp', entities: '{ "classname" "team_CTF_redplayer" "origin" "1 2 3" } { "classname" "team_CTF_redflag" "targetname" "authored" }', models: [] }, 'rerelease', 'deathmatch'));
 expect(q3.map(entity => entity.get('classname'))).toEqual(['info_player_team1', 'item_flag_team1', 'info_player_deathmatch']);
 expect(q3[1]?.get('targetname')).toBe('authored');
 expect(() => prepareNativeQ2Map({ kind: 'q1-bsp', entities, models: { length: 256 } }, 'classic', 'deathmatch')).toThrow('capacity');
});
