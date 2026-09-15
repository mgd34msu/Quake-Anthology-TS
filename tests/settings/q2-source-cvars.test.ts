import { expect, test } from 'bun:test';
import { createIdentityOwner } from '../../src/contracts/identity.ts';
import { CvarRegistry, Q2CvarFlag } from '../../src/core/cvars/index.ts';
import { bindQ2PlayerCvars, registerQ2ServerCvars, restoreQ2ServerCvars } from '../../src/settings/server/q2-owner.ts';
import { createQ2PlayerRules } from '../../src/content/q2/base/player/types.ts';
import { createQ2RereleaseOptions, q2UsesInstancedItems } from '../../src/content/q2/rerelease/types.ts';

function source(dialect: 'q2-classic' | 'q2-rerelease') {
  const identity = createIdentityOwner('q2-source-cvars');
  const cvars = new CvarRegistry({ dialect, context: { session: identity.session, origin: { kind: 'server-console' } } });
  registerQ2ServerCvars(cvars, 'q2:official');
  const rules = createQ2PlayerRules(), options = dialect === 'q2-rerelease' ? createQ2RereleaseOptions() : null;
  bindQ2PlayerCvars(cvars, rules, options); cvars.setServerActive(true);
  return { cvars, rules, options };
}

test('Q2 rerelease server options retain source defaults and latch cooperative changes until the next game', () => {
  const { cvars, options } = source('q2-rerelease');
  if (options === null) throw new Error('missing rerelease options');
  expect(options.coopPlayerCollision).toBe(false); expect(options.deathmatchSpawnFarthest).toBe(true);
  expect(cvars.find('g_coop_player_collision')?.flags).toBe(Q2CvarFlag.Latch);
  cvars.set('g_coop_player_collision', '1'); expect(options.coopPlayerCollision).toBe(false);
  expect(cvars.find('g_coop_player_collision')?.latchedValue).toBe('1');
  cvars.set('g_dm_spawn_farthest', '0'); expect(options.deathmatchSpawnFarthest).toBe(false);
  cvars.set('g_coop_instanced_items', '0'); cvars.set('g_coop_squad_respawn', '0');
  expect(q2UsesInstancedItems(options)).toBe(true);
  cvars.applyLatched(); expect(options.coopPlayerCollision).toBe(true); expect(q2UsesInstancedItems(options)).toBe(false);
  cvars.set('g_dm_force_respawn_time', '3.5'); expect(options.deathmatchForceRespawnTime).toBe(3.5);
  options.coopNumLives = 7; expect(cvars.variableValue('g_coop_num_lives')).toBe(7);
  const checkpoint = cvars.captureSaveState(); cvars.set('g_dm_force_respawn_time', '8'); cvars.restoreSaveState(checkpoint);
  expect(options.deathmatchForceRespawnTime).toBe(3.5);
});

test('Q2 base player cvars drive actual rule objects without installing rerelease defaults in classic or mod sessions', () => {
  const { cvars, rules } = source('q2-classic');
  expect(cvars.find('g_coop_player_collision')).toBeUndefined(); expect(cvars.find('g_dm_spawn_farthest')).toBeUndefined();
  expect(cvars.variableValue('dmflags')).toBe(0);
  cvars.set('password', 'test-game'); expect(rules.password).toBe('test-game');
  expect(cvars.variableValue('needpass')).toBe(1); cvars.set('spectator_password', 'test-view'); expect(cvars.variableValue('needpass')).toBe(3);
  cvars.set('password', 'none'); expect(cvars.variableValue('needpass')).toBe(2);
  cvars.set('flood_msgs', '2'); expect(rules.floodMessages).toBe(2);
  cvars.set('gun_x', '3'); cvars.set('gun_y', '-2'); expect(rules.gunOffset).toEqual({ x: 3, y: -2, z: 0 });
  cvars.set('sv_maplist', 'base1,base2 base3'); expect(rules.mapList).toEqual(['base1', 'base2', 'base3']);
  cvars.set('cheats', '1'); expect(rules.cheats).toBe(false); cvars.applyLatched(); expect(rules.cheats).toBe(true);
  rules.gunOffset = { x: 0, y: 1, z: 2 }; expect(cvars.variableValue('gun_z')).toBe(2);
});

test('older Q2 source saves hydrate newly bound cvars and retain saved rule values and pending changes', () => {
  const identity = createIdentityOwner('q2-old-save');
  const old = new CvarRegistry({ dialect: 'q2-rerelease', context: { session: identity.session, origin: { kind: 'server-console' } } });
  old.register('dmflags', '0', Q2CvarFlag.ServerInfo); old.register('timelimit', '0', Q2CvarFlag.ServerInfo);
  old.set('timelimit', '12'); old.stage('dmflags', '16'); old.takeEffects();
  const bytes = JSON.stringify(old.captureSaveState());
  const payload: unknown = JSON.parse(bytes);
  const current = new CvarRegistry({ dialect: 'q2-rerelease', context: old.context });
  registerQ2ServerCvars(current, 'q2:official'); restoreQ2ServerCvars(current, payload);
  const rules = createQ2PlayerRules(), options = createQ2RereleaseOptions(); bindQ2PlayerCvars(current, rules, options);
  restoreQ2ServerCvars(current, payload);
  Object.assign(rules, createQ2PlayerRules({ password: 'old-session', floodMessages: 9 }));
  Object.assign(options, createQ2RereleaseOptions({ coopPlayerCollision: true, deathmatchSpawnFarthest: false, coopNumLives: 6 }));
  restoreQ2ServerCvars(current, payload);
  expect(rules.password).toBe('old-session'); expect(rules.floodMessages).toBe(9);
  expect(options.coopPlayerCollision).toBe(true); expect(options.deathmatchSpawnFarthest).toBe(false); expect(options.coopNumLives).toBe(6);
  expect(current.variableValue('timelimit')).toBe(12); expect(current.find('dmflags')?.latchedValue).toBe('16');
  expect(current.find('g_coop_num_lives')?.resetValue).toBe('2');
  current.setServerActive(true); current.set('g_coop_num_lives', '8'); current.takeEffects();
  const modern = current.captureSaveState(); options.coopNumLives = 6;
  restoreQ2ServerCvars(current, modern);
  expect(options.coopNumLives).toBe(6); expect(current.find('g_coop_num_lives')?.latchedValue).toBe('8');
});

test("map shuffle is a live rerelease-only cvar with a disabled source default", () => {
  const classic = source("q2-classic"), rerelease = source("q2-rerelease");
  expect(classic.cvars.find("g_map_list_shuffle")).toBeUndefined(); expect(classic.rules.mapListShuffle).toBe(false);
  expect(rerelease.cvars.find("g_map_list_shuffle")?.flags).toBe(0); expect(rerelease.rules.mapListShuffle).toBe(false);
  rerelease.cvars.set("g_map_list_shuffle", "1"); expect(rerelease.rules.mapListShuffle).toBe(true);
  rerelease.rules.mapListShuffle = false; expect(rerelease.cvars.variableString("g_map_list_shuffle")).toBe("0");
});
