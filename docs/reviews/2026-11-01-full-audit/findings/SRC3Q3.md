# SRC3Q3 — Quake 3 port compared to id's 1.32 source: everything SRC2Q3 listed as not compared

Source: `upstream/Quake-III-Arena/code/` (id 1.32, read only, nothing executed). Port: `clean/src` at HEAD fcdc8af5. Original paths are relative to `code/`.
Retail data, read only: `qfiles/q3a/baseq3/pak*.pk3`, `missionpack/pak0.pk3`. Scripts and reproductions: `scratchpad/src3q3/`.

The translated functions are again very close to the C. The significant defects are at the seams, where the application replaced source behavior: the map loader's strict spawn check, the missing settle frames, and the "selected player" spawn path. All four top findings were reproduced on retail data.

## Coverage

### Compared, both sides read in full
**Game**
- `game/g_active.c` (all) against `team-arena/client-think.ts`, `client-effects.ts`, `client-events.ts`, `client-policy.ts`.
- `game/g_client.c` (all) against `team-arena/client-spawn.ts`, `client-admission.ts`, and the production spawn callback `simulation/runtime.ts:4176-4221`.
- `game/g_main.c` (all) against `team-arena/match.ts`, `simulation/q3/runtime.ts` (all), `base/settings.ts`, `base/map-spawns.ts` (`G_FindTeams`). The cvar table was compared entry by entry. The `qsort` in `match.ts` was compared against my recollection of `bg_lib.c`, without opening that file.
- `game/g_session.c` (all) against `team-arena/session.ts`.
- `game/g_arenas.c` (all) against `team-arena/arenas.ts`.
- `game/g_svcmds.c` (all) against `team-arena/server-commands.ts`.
- `game/g_bot.c` (all) against `bots/behavior/q3/catalog.ts`.
- `game/g_utils.c` (all) against `base/game/entities.ts`, `utilities.ts`, `shader-remaps.ts`, `misc.ts:killBox`.
- `game/g_mem.c` (all) against `base/game/memory.ts`.
- `game/g_misc.c:340-482` (personal portals) against `base/game/personal-portal.ts`.
- `game/g_missile.c:521-807` (all `fire_*` setup) against `missile.ts:417-487`, `projectile.ts:65-68`, `ballistics-math.ts` (all, including the bullet and shotgun endpoint helpers SRC2Q3 left open; the C for those helpers was recalled, not reopened in `g_weapon.c`).
- `RespawnItem` and `Pickup_Armor` in `game/g_items.c` against `item-lifecycle.ts:229-277`, `item-pickup.ts:158-171`.

**Rankings**
- `game/g_rankings.c:24-490` and `:990-1135` read. `:490-990` was compared by script only (`src3q3/ranks.py`), not by reading: every `QGR_KEY_*` sequence in 13 functions matches `rankings.ts` in value and order. `G_RankRunFrame`, `G_RankGameOver` against `app/bootstrap/q3-rankings.ts`.

**Collision**
- `qcommon/cm_polylib.c` (all) against `world/collision/q3/polylib.ts` (all).
- `AngleVectors`, `CreateRotationMatrix` against `core/math.ts:325-345, 387-390`. `BoxOnPlaneSide`: the general path against `core/math.ts:739`, and the axial fast path against `mark-projector.ts:57-65`. Only the first 20 lines of the C function were printed; the fast path is cited from memory of `q_math.c`.

**Renderer**
- `renderer/tr_sky.c` (all) against `materials/sky.ts` (all), `render/scene/world.ts:716-731`.
- `renderer/tr_shadows.c` (all) against `materials/deform.ts:27-41`, `render/gl/renderer.ts:463-490` (dispatch only), and the search for producers described under SRC3Q3-005.
- `renderer/tr_shade.c:160-650, 950-1361` (iterators, `DrawMultitextured`, `ProjectDlightTexture`, `RB_FogPass`) against `materials/dlight.ts`, `fog.ts`, `evaluate.ts:1-156`, `render/scene/world.ts:340-839`.
- `renderer/tr_light.c:120-395` against `materials/q3-lighting.ts` (all).
- `renderer/tr_noise.c` (all) against `materials/deform.ts:64-93`.
- `ScanAndLoadShaderFiles`, `FindShaderInShaderText`, `R_RemapShader`, `CreateInternalShaders`, `CreateExternalShaders` in `renderer/tr_shader.c` against `app/bootstrap/assets.ts:70-146`, `render/scene/shaders.ts:82-117`, `material-registrations.ts:99-136`.

**QVM**
- All import enums (`gameImport_t`, `cgameImport_t`, `uiImport_t`) by script against `compat/qvm/abi.ts`: 183, 102 and 97 entries, same names and values. Export enums compared by eye: same.
- `VM_Create`, `VM_Restart` in `qcommon/vm.c` against `compat/qvm/image.ts:60-110`.

### Not compared, or only in part
- `R_FogFactor`, `R_InitFogTable`, `R_CreateFogImage`, `R_LoadFogs` (`tr_image.c`, `tr_bsp.c`) were compared with `fog.ts` from my knowledge of the C. I did not open those functions this round. Treat that comparison as unverified.
- `FS_ListFilteredFiles` read in full. `paksort` was not opened.
- `qcommon/vm.c`: `VM_LoadSymbols`, `VM_ValueToSymbol`, `VM_Call`, `VM_VmProfile`, `VM_VmInfo`, `VM_ExplicitArgPtr` not compared. Symbol maps are debug only.
- Syscall argument shapes per trap were not compared, only the numbers.
- `RB_DrawSun`: read on the C side; the port registers a `sun` material and I found no draw, but `r_drawSun` defaults to 0 from memory of `tr_init.c`, so I did not report it.
- `render/gl/renderer.ts` and `render/cpu/rasterizer.ts` shadow backends: dispatch read, not the pixel behavior.
- `tr_mesh.c` read at `:368-395` only, for shadow submission. `R_ComputeFogNum` was not compared.
- The `kind: "unavailable"` bot path in `client-admission.ts:331` and `server-commands.ts:226`: read, but I did not trace whether `botServices.source` can be unavailable in production, so nothing is reported.
- **Not rendered or played.** Reproductions are at simulation level through `createSimulation`, without a window and without network.

### Checked with no finding
- `G_RunFrame`'s `if ( level.restarted ) return;` (`game/g_main.c:1720`) has no equivalent in `beginFrame`, `runActor` or `endFrame`; `.restarted` is only read in `match.ts:310`. The queued `map_restart` is consumed by the step's command dispatch before the next simulation frame, so I found no observable gap. This was traced by reading only.
- `level.warmupModificationCount` is cleared by the `memset` after `G_RegisterCvars` in id and is not in the port. No observable difference, because the first pass always has `warmupTime` of -1.

## Strengths
- `match.ts` translates `qsort` with its insertion-sort fallback, and keeps `CheckTeamLeader`'s second loop that can create two leaders. It deliberately does not reproduce the `numteamVotingClients` overrun.
- `session.ts` reproduces `bg_lib` `sscanf` cursor behavior. `server-commands.ts` keeps the `G_ProcessIPBans` quirks: the ignored final token and the NUL written into the vmCvar string.
- `catalog.ts` keeps the empty `addbot` from trailing spaces in `G_SpawnBots`, `PlayerIntroSound`'s skin logic, and `G_CountBotPlayers` counting due queue entries for every team.
- `sky.ts` matches all six `vec_to_st` and `st_to_vec` rows, and the `sky_texorder` permutation. Noise and light-grid sampling match, including the float order of the cloud discriminant.
- `polylib.ts` matches `cm_polylib.c` line for line.
- Rankings key tables and QVM import numbering are exact.
- `spawn.ts:238-240` already does what `G_CallSpawn` does for an unknown classname. The defect in SRC3Q3-001 is one level up.

## Findings

### SRC3Q3-001 — Six retail Quake 3 maps refuse to load, because an entity with no spawn function is fatal
- **Verification (VERIFY-W): confirmed. Final severity: High.** Reproduced: q3dm1 loads, and q3dm3 and q3dm7 throw "Unimplemented authored Q3 spawns" in deathmatch and singleplayer. The throw is at `app/bootstrap/simulation/q3/runtime.ts:566-567`; `content/q3/base/game/spawn.ts:238-241` already warns and frees, and g_spawn.c:304-305 and :475-476 continue. q3dm4, q3dm5, q3dm10 and q3dm18 were not re-run.
- Severity: High
- Category: bug
- Location: src/app/bootstrap/simulation/q3/runtime.ts:566-567; src/content/q3/base/game/spawn.ts:238-241
- Confidence: reproduced (`src3q3/load.ts`, `src3q3/classes.py`)
- Evidence: Port: `const unknown = this.mapReport.outcomes.filter(outcome => outcome.kind === "unknown"); if (unknown.length !== 0 && this.options.foreignWorld !== true) throw new Error("Unimplemented authored Q3 spawns: " + ...)`. Original: `G_Printf ("%s doesn't have a spawn function\n", ent->classname); return qfalse;` (`game/g_spawn.c:280-305`), then the caller frees the entity and continues (`game/g_spawn.c:475`). `spawn.ts:238-240` already prints that warning and frees the entity, so the throw is the only difference. Run through `createSimulation` with `--game q3-baseq3`, in both `deathmatch` and `singleplayer`:
  `q3dm3 THROW ... info_spectator_start` (4 entities), `q3dm5 THROW ... info_spectator_start` (3), `q3dm4`, `q3dm7`, `q3dm10`, `q3dm18 THROW ... info_firstplace, info_secondplace, info_thirdplace`. `q3dm1` loads. No missionpack map has such a classname.
- Impact: `--map q3dm7` fails at startup with the native game. All six are listed in retail `scripts/arenas.txt` (pak0, order `q3dm1 q3dm2 q3dm3 q3tourney1 q3dm4 ...`), so by that order the single-player ladder would stop at its third arena. I did not run the ladder itself. Any custom map with an editor-only or mod entity fails the same way. For a console `map` or passed vote, `application.ts:3524-3530` appears to catch and print the error, leaving the old map running; I read that but did not run it.
- Remediation: Remove the throw for Q3 worlds, and keep the warning from `spawn.ts`. If the check is meant to catch foreign-world gaps, restrict it to that path.

### SRC3Q3-002 — The first local client on a retail map whose spawn point targets a `target_give` ends the process
- **Verification (VERIFY-V): confirmed-with-changes. Final severity: High.** Reproduced: q3tourney3, q3tourney5 and q3ctf4 throw 8/8 at item-lifecycle.ts:175 on admit without settle frames. First load (application.ts:1924) ends the process, but two impact claims are wrong by reading. A map change does not end it: :2839 runs before `committed = true` (:3099), so :3526 prints the error and the old map stays. "Dedicated servers are not affected" is false for travel: the admissions at :2828 cover every carried non-bot client, including network clients, so a `map` to these maps with a player connected fails the same way.
- Severity: High
- Category: bug
- Location: src/app/bootstrap/application.ts:1924, :2839; src/content/q3/base/game/item-lifecycle.ts:172-176, :315, :489; src/content/q3/base/game/targets.ts:110
- Confidence: reproduced at simulation level (`src3q3/firstadmit.ts`); the application order is traced, because I did not open a window
- Evidence: Id runs game frames before any client enters: `// run a few frames to allow everything to settle`, three `GAME_RUN_FRAME` calls (`server/sv_init.c:440-445`), then one more after connects (`:497-500`). So `FinishSpawningItem`, scheduled at `level.time + FRAMETIME * 2` (`game/g_items.c:891`), has already set `ent->s.modelindex` (`:658`). The port's round restart does this too (`application.ts:3410`, `for (let frame = 0; frame < 3; frame++) await settle();`). The first-load path `openGraphical` and the map-change path call `admitPlayer` with no prior step: `session.stepAsync` appears only at `application.ts:3403` and `:4629`. `clientSpawn` then calls `useTargets`, `useTargetGive` calls `touchItem`, and `requirePublishedItem` throws `Item entity model index does not match its item definition`, because modelindex is still 0. Stack from the run: `requirePublishedItem < touchItem < useTargetGive < useTargets < clientSpawn < begin < admitPlayer`. Admitting straight after `createSimulation`: `q3tourney3` 8/8 seeds thrown, `q3tourney5` 8/8, `q3ctf4` 12/12 in deathmatch and 8/8 in singleplayer, `q3dm2` 0/12. After three 100 ms steps, `q3ctf4` admits normally.
- Impact: Starting or changing to `q3tourney3`, `q3tourney5` or `q3ctf4` as a local listen player ends the process. By entity scan the same applies to `mpq3ctf4` and `mpterra2` (not run) and to `q3dm10` once SRC3Q3-001 is fixed. Dedicated servers are not affected, since network clients and queued bots arrive after frames have run. Other effects of skipping the settle frames were not investigated.
- Remediation: Run the three settle frames in the first-load and map-change paths before admitting local clients, as the round restart path already does. Do not only relax `requirePublishedItem`, because the settle frames also position items and movers.

### SRC3Q3-003 — A weapon given at spawn is not selected, because the highest-weapon pass is skipped in production
- **Verification (VERIFY-V): confirmed. Final severity: Medium.** Reproduced: on q3ctf4 `ps.weapon` 2 with weapon bits 1110, unchanged after 600 ms; g_client.c:1230-1240 would select 3. The loop at client-spawn.ts:367 is behind `selectedPlayer === undefined`, and production always supplies it (q3/runtime.ts:201). In that command-free run `ps.eventSequence` stayed 0, so no pickup event was observed in `ps`; whether cgame autoswitch would correct it remains unverified.
- Severity: Medium
- Category: bug
- Location: src/content/q3/team-arena/client-spawn.ts:366-372; src/app/bootstrap/simulation/q3/runtime.ts:201; src/app/bootstrap/simulation/runtime.ts:4218
- Confidence: reproduced (`src3q3/spawnweapon.ts`)
- Evidence: Original, after the spawn point's targets fire: `// select the highest weapon number available, after any spawn given items have fired`, `client->ps.weapon = 1; for ( i = WP_NUM_WEAPONS - 1 ; i > 0 ; i-- ) { if ( client->ps.stats[STAT_WEAPONS] & ( 1 << i ) ) ...` (`game/g_client.c:1230-1240`). Port: `useTargets(...); if (this.host.selectedPlayer === undefined) { ps.weapon = Weapon.WP_GAUNTLET; for (...) }`. Production always supplies `selectedPlayer` (`q3/runtime.ts:201`), so this loop never runs, and `spawnQ3Player` has already set `client.ps.weapon` to the machinegun before targets fire. On `q3ctf4` after settling: `ps.weapon 2 weaponState 0 stats.weapons 1110`, meaning the shotgun bit is set while the machinegun is held. Id would give weapon 3.
- Impact: On `q3ctf4`, `mpq3ctf4` and `mpterra2` (spawn-given `weapon_shotgun`), and any custom map that gives weapons at spawn, players start holding the machinegun. I did not confirm how the client's autoswitch then behaves, so the player may switch shortly after spawning rather than never.
- Remediation: Run the highest-weapon selection for the selected path too, through the arsenal owner, when the selected arsenal is the Q3 one.

### SRC3Q3-004 — Handicap is ignored for spawn health, so low-skill bots and handicapped players start at 125
- **Verification (VERIFY-V): confirmed. Final severity: Medium.** Reproduced: handicap 50 gives health 125, stats max 50; id gives 75 (g_client.c:1191). The literal `"100"` is at simulation/runtime.ts:4196, and the correct line at client-spawn.ts:343 is in the unused branch. Bot handicaps at catalog.ts:236-238 match g_bot.c:600-608. Health stayed 125 for 74 s in a command-free run, so decay is by reading only (client-effects.ts:167).
- Severity: Medium
- Category: bug
- Location: src/app/bootstrap/simulation/runtime.ts:4196, :4165; src/content/q3/team-arena/client-spawn.ts:318-321, :340-344
- Confidence: reproduced (`src3q3/handicap.ts`); bot effect traced
- Evidence: Original: `client->pers.maxHealth = atoi( Info_ValueForKey( userinfo, "handicap" ) );` then `ent->health = client->ps.stats[STAT_HEALTH] = client->ps.stats[STAT_MAX_HEALTH] + 25;` (`game/g_client.c:1154-1159`, `:1191`). The port computes `pers.maxHealth` correctly, but the health line is in the branch production never takes (`client-spawn.ts:343`). The selected path calls `character.spawn({ body, combat: q3InitialCombat("100", null), ... })` with a literal `"100"`. With userinfo `handicap 50`: `pers.maxHealth 50 stats.max 50 entity.health 125 ps.health 125 stats.health 125`. Id gives 75.
- Impact: A player with a handicap gets up to 50 extra health at each spawn. `G_AddBot` assigns handicap 50, 70 and 90 at skill 1, 2 and 3 (`game/g_bot.c:600-608`, ported at `catalog.ts:236-238`), so low-skill bots spawn at 125 where id has 75, 95 and 115, which makes them harder than intended. Health still decays toward the handicap maximum through `clientTimerActions` by reading; my run sent no commands, so decay was not exercised.
- Remediation: Pass the client's handicap into `q3InitialCombat` in `spawnQ3Player`, or set health from `pers.maxHealth + 25` after the selected player callback.

### SRC3Q3-005 — `cg_shadows 2` and `3` draw no shadow, and a custom `deformVertexes projectionShadow` shader throws
- **Verification (VERIFY-V): confirmed. Final severity: Medium.** The only `shadow-volume`/`shadow-finish` constructors are in tests and the worker-protocol decoder, and nothing sets `materialContext.projectionShadow` (world.ts:361). players.ts:214 drops the blob for modes other than 1, as cg_players.c:2022 does, and nothing replaces it. The finding's unrun scan is done: 0 retail BSP surfaces or MD3 surfaces use the projection deform, so the deform.ts:189 throw needs custom content. ui_main.c sets only 0 or 1, so modes 2 and 3 come from the console.
- Severity: Medium
- Category: bug
- Location: src/render/scene/shaders.ts:92-98; src/render/scene/world.ts:361; src/contracts/render.ts:253-254; src/materials/deform.ts:188-189; src/content/q3/presentation/players.ts:422
- Confidence: traced by search across `src` and `tests`
- Evidence: Id submits every opaque model surface again with `tr.shadowShader` when `r_shadows` is 2, or `tr.projectionShadowShader` when it is 3 and `RF_SHADOW_PLANE` is set (`renderer/tr_mesh.c:371-386`). `r_shadows` is the cvar `cg_shadows` (`renderer/tr_init.c:991`). `RB_ShadowTessEnd`, `RB_ShadowFinish` and `RB_ProjectionShadowDeform` do the drawing (`renderer/tr_shadows.c:154-341`, `tr_backend.c:663`). In the port, `shadow-volume` and `shadow-finish` operations are accepted by both backends and the worker protocol, but the only constructors found are tests (`tests/render/gl/smoke.test.ts:188`, `tests/render/worker-protocol.test.ts:84-85`). `sourceMaterials.stencilShadow` and `.projectionShadow` have no reader outside `shaders.ts`. Nothing supplies `materialContext.projectionShadow`, so it is always null at `world.ts:361`. `players.ts:422` still sets `RF_SHADOW_PLANE` for `cg_shadows 3`. The app's own `r_shadows` cvar (`render-settings.ts:5`) is a different feature. The `cg_shadows` 1 blob is unaffected, and 1 is the default.
- Impact: Selecting mode 2 or 3 removes the blob, because cgame returns early when `cg_shadows != 1` (`cgame/cg_players.c:2022`), and draws nothing in its place. Separately, a custom shader on a map or model with `deformVertexes projectionShadow` reaches `throw new Error("projectionshadow deformation requires retained entity orientation and lighting")` during drawing. I found no retail surface using it, but I did not run a scan for it.
- Remediation: Implement the stencil and projection submission, or remove the unused operations and document modes 2 and 3 as unsupported. Make the deform a no-op when there is no context.

### SRC3Q3-006 — `G_LogPrintf` output is discarded, so no `games.log` is written and dedicated consoles miss game lines
- **Verification (VERIFY-V): confirmed. Final severity: Low.** `kind: "log"` is emitted at q3/host.ts:49 and otherwise appears only in unified-event-codec.ts; the handler at application.ts:1572-1578 has no case for it. `g_log` is registered at settings.ts:29 and has no reader in the native game. g_main.c:1095-1103 prints when dedicated and writes the file; `InitGame:` and `ShutdownGame:` are absent from `src`.
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/simulation/q3/host.ts:8, :49; src/app/bootstrap/application.ts:1572-1578; src/content/q3/base/settings.ts:29
- Confidence: traced
- Evidence: `log: text => operations.emit({ kind: "log", text })`. The handler in `application.ts` branches on `print`, `console-command` and `drop-client`, and has no `log` case. A search of `src` found `"log"` for this event only in its emitter and the network codec. `g_log` is still registered with the default `games.log`, and nothing reads it. Original: `G_LogPrintf` writes a timestamped line to the open log, and prints to the console when dedicated (`game/g_main.c:1095-1103`); the file is opened by default (`:430-445`). The port also never emits the `InitGame:` and `ShutdownGame:` records (`:444`, `:522`): a search finds neither string in `src`.
- Impact: Server operators get no `Kill:`, `ClientConnect:`, `Item:` or `Exit:` records from the native game, and log-based stat tools have nothing to read.
- Remediation: Handle the event in the application: print when dedicated, and append with id's `%3i:%i%i ` prefix to `g_log` when it is set.

### SRC3Q3-007 — Shader override order is alphabetical by file name, where id uses search-path order
- **Verification (VERIFY-V): confirmed-with-changes. Final severity: Low.** The port's order (assets.ts:84, shaders.ts:111) does differ from id, but id's order is not search-path order, and "None on retail" is wrong. tr_shader.c:2885 concatenates in reverse and the check at :2952 stops every file but the last-listed after its first shader, so the winner is the first shader of the earliest-listed file, otherwise the last-listed file. By `vv/order.py` (modelled from the C, not rendered): baseq3 has no difference, but Team Arena `console` (id gfx2.shader, port gfx.shader) and `models/flags/pole` (id models2.shader, port models.shader) get different bodies, and a custom pak does not generally win by pak priority.
- Severity: Low
- Category: bug
- Location: src/app/bootstrap/assets.ts:82, :84; src/render/scene/shaders.ts:111
- Confidence: reproduced for retail (`src3q3/shaderorder.py`); the custom-content effect is traced
- Evidence: Port: `return [...paths].sort();` and first definition wins (`if (!this.programs.has(name))`). Original: `FS_ListFilteredFiles` walks `fs_searchpaths` from the highest-priority pak, in zip order (`qcommon/files.c:1841-1950`), and `FindShaderInShaderText` returns the first hash entry, in that order (`renderer/tr_shader.c:2303-2308`). Retail: baseq3 has 0 shader names defined in two or more files. Missionpack has 4 (`textures/base_floor/concfloor_rain`, `console`, `levelshotdetail`, `models/flags/pole`), and for all of them the winning body is the same under both orders. Separately, the loose directory check `entry.name.endsWith(".shader")` is case sensitive, where id uses `Q_stricmp`.
- Impact: None on retail. A custom pak that overrides a stock shader from a differently named script wins in id by pak priority, but here wins or loses by file name, so the override may be ignored.
- Remediation: Build the list in mount priority order, then zip order, removing duplicates by name.

### SRC3Q3-008 — A shader remap name of 64 or more bytes raises `RangeError` from map or cvar data
- **Verification (VERIFY-V): confirmed-with-changes. Final severity: Low.** Reproduced: a 64-byte new name throws `RangeError` at shader-remaps.ts:29-30 and 63 is accepted. Reach is as stated: `targetShaderName` at spawn.ts:167 through utilities.ts:170-172, and `remapTeams` from settings.ts:99, in frame through q3/runtime.ts:583, :684. The "not a drop" point has the same flaw as SRC2Q3-006: no reader of the drop code exists, so a `CommonError` would still end the process in a frame. Only the truncation remediation helps.
- Severity: Low
- Category: robustness
- Location: src/content/q3/base/game/shader-remaps.ts:29-31; src/app/bootstrap/simulation/q3/runtime.ts:493-494; src/content/q3/base/game/utilities.ts:170-172
- Confidence: traced (not run)
- Evidence: `if (path.length >= MAX_QPATH) throw new RangeError("shader remap paths must fit MAX_QPATH including the terminator");`. Original: `strcpy(remappedShaders[i].newShader,newShader);` with no check (`game/g_utils.c:44`, `:50-51`), an overrun inside a static array. Reach: `targetShaderName` and `targetShaderNewName` from a map's entity string, at `G_UseTargets`; and `g_redteam` or `g_blueteam` of about 50 or more characters, through `remapTeams`, which runs at load and from `settings.update()`.
- Impact: A custom map's trigger, or an admin's long team name on Team Arena, ends the process, where id's behavior is an undefined overrun that in practice usually continues. Failing is defensible, as in SRC2Q3-006, but the error type is not a drop.
- Remediation: Raise `CommonError("drop", ...)`, or truncate to 63 bytes with a warning.

### SRC3Q3-009 — `g_gametype` out of range is not reset to 0
- **Verification (VERIFY-V): confirmed-with-changes. Final severity: Low.** The missing check is real (g_main.c:360-363 has no port equivalent), but the impact is wrong. Reproduced with `g_gametype 9` on q3dm1: `createSimulation` throws `Selected Q3 objectives are unavailable: {"kind":"unsupported-mode",...}` at simulation/runtime.ts:3613-3614, so the map does not load, and the team-game branches the finding describes are never reached. Id resets to 0 and plays free-for-all.
- Severity: Info
- Category: bug
- Location: src/content/q3/base/settings.ts:77-84; src/app/bootstrap/simulation/q3/runtime.ts:292
- Confidence: traced
- Evidence: Original: `if ( g_gametype.integer < 0 || g_gametype.integer >= GT_MAX_GAME_TYPE ) { G_Printf( "g_gametype %i is out of range, defaulting to 0\n", ...); trap_Cvar_Set( "g_gametype", "0" ); }` (`game/g_main.c:360-363`). A search of `src` finds no such check or string. `callvote g_gametype` validates its argument (compared by SRC2Q3), so only the console can set this.
- Impact: `g_gametype 9` stays at 9, which every `>= GT_TEAM` and `>= GT_CTF` test treats as a team game. In id the cached value also stays out of range until the next `G_UpdateCvars`, so the difference begins from the first frame.
- Remediation: Add the check to `Q3GameSettings.register`.

### SRC3Q3-010 — Rankings use the base game's `MOD_GRAPPLE` on Team Arena and omit the match rating
- **Verification (VERIFY-V): confirmed. Final severity: Info.** rankings.ts has no product selection and uses `case 23` at :385, :462, :607, :655. bg_public.h:597-603 gives `MOD_NAIL` 23 and `MOD_GRAPPLE` 28 under MISSIONPACK, and missile.ts:472 uses 28. `QGR_KEY_MATCH_RATING` (1112000001, g_rankings.h:70) appears nowhere in `src`, `teamName` has no caller, and no game file outside g_rankings.c calls `G_Rank*`.
- Severity: Info
- Category: bug
- Location: src/content/q3/base/game/rankings.ts:385, :462, :607, :655; src/content/q3/base/game/missile.ts:472; src/app/bootstrap/q3-rankings.ts:111-119
- Confidence: traced
- Evidence: `case 23:` selects the grapple keys in `damage` and `playerDie`. `MOD_GRAPPLE` is 23 only without `MISSIONPACK`; there, `MOD_NAIL` takes 23 (`game/bg_public.h:597-603`), and `missile.ts:472` uses 28 for the grapple on that product. So Team Arena reports nail hits as grapple, and grapple hits as unknown. `G_RankGameOver` calls `G_RankClientDisconnect` for active users, which reports `QGR_KEY_MATCH_RATING` (`game/g_rankings.c:1036-1060`, `:1079-1085`); `gameOver` does not, and `PERS_MATCH_TIME` from `G_RankRunFrame` (`:161-162`) is absent. `teamName` has no caller. Id's 1.32 game source never calls any `G_Rank*` function outside `g_rankings.c`, so the port's call sites have no source to compare with.
- Impact: Wrong or missing statistics, only for a configured provider. CONTENT1-021 already records that the service is defunct.
- Remediation: Select the key by product, or leave as is with the rest of the rankings decision.
