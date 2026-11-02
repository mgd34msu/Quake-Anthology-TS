# SRC2Q3 — Quake 3 port compared to id's 1.32 source: the areas SRCQ3 left uncompared

Source: `upstream/Quake-III-Arena/code/` (id 1.32, read only, nothing executed). Port: `clean/src` at HEAD fcdc8af5. Original paths are relative to `code/`.
Retail data, read only: shader scripts and BSP lumps from `qfiles/q3a/baseq3/pak*.pk3` and `missionpack/pak0.pk3`. Scripts: `scratchpad/src2q3/`.

The main result is that the port is a very close translation. Most of what I compared has no behavioral difference, so the finding count is small. Coverage below separates what I read on both sides from what I did not.

## Coverage

### Compared, both sides read
**Collision**
- `world/collision/q3/topology.ts` against all of `qcommon/cm_test.c`.
- `world.ts`, `model.ts` against `qcommon/cm_trace.c:85-1471`: position tests, capsule-in-capsule, box-in-capsule, sphere and cylinder sweeps, capsule through capsule, box through capsule, tree walk, `CM_Trace`, `CM_TransformedBoxTrace`.
- `patch.ts` generation (lines 239-426) against `qcommon/cm_patch.c:85-1214`.
- `map-resource.ts`, `map-loader.ts`, `checksum.ts`, `clip-models.ts` against `qcommon/cm_load.c:60-839`.

**Game**
- `triggers.ts` against all of `game/g_trigger.c`.
- `targets.ts` against all of `game/g_target.c`.
- `mover.ts`, `mover-spawn.ts` against all of `game/g_mover.c`.
- `misc.ts`, `misc-spawn.ts` against `game/g_misc.c` except the personal-portal functions at its end.
- `spawn.ts:60-304` against `game/g_spawn.c` (field table, `G_ParseField`, `G_SpawnGEntityFromSpawnVars`, `G_ParseSpawnVars`, `SP_worldspawn`, `G_SpawnEntitiesFromString`).
- `item-pickup.ts`, `item-lifecycle.ts:60-506`, `item-motion.ts:30-213` against `game/g_items.c`. I did not open the first part of `RespawnItem` or the tail of `Pickup_Armor`.
- `hitscan.ts`, `weapon.ts` against all of `game/g_weapon.c`.
- `missile.ts`, `projectile.ts` against `game/g_missile.c` control flow and `fire_prox`.
- `base/game/ballistics-math.ts` was not re-read. SRCQ3 covered its numbers, and the shotgun and bullet endpoint helpers remain unchecked.

**Team Arena, against MISSIONPACK branches**
- `team-arena/team.ts` against `game/g_team.c:50-1479` and the bonus constants in `g_team.h`.
- `team-arena/commands.ts` against `game/g_cmds.c:30-1699`.
- `team-arena/client-think.ts` against `ClientThink_real`, `G_TouchTriggers`, `ClientImpacts` in `game/g_active.c`. This was the pmove setup SRCQ3 listed as open.

**Materials and shading**
- `materials/material.ts` (all) and `material-finish.ts` (all) against `renderer/tr_shader.c:180-2714`: `ParseWaveForm`, `ParseTexMod`, `ParseStage`, `ParseDeform`, `ParseSkyParms`, `ParseSort`, `ParseSurfaceParm`, `ParseShader`, `FinishShader`, `VertexLightingCollapse`, `R_FindShader`'s implicit stages.
- `material-iterator.ts` against `ComputeStageIteratorFunc` and `CollapseMultitexture`, including the collapse table.
- `materials/deform.ts`, `color.ts`, `evaluate.ts:60-174`, `evaluateWaveform`, `evaluateTexCoords` against `renderer/tr_shade_calc.c` (all except the Altivec branches), and `ComputeColors`, `ComputeTexCoords`, `R_BindAnimatedImage` in `renderer/tr_shade.c`, plus the function tables in `tr_init.c:1035-1057`.
- `materials/fog.ts` against `RB_CalcFogTexCoords` and the color and scale lines of `R_LoadFogs` (`tr_bsp.c:1613-1618`).

**QVM**
- `interpreter.ts:858-1042` against the `VM_CallInterpreted` entry frame and the `OP_CALL`, `OP_ENTER` cases.
- All six float branches in `operations.ts` against `vm_interpreted.c` and `vm_x86.c:805-875`.
- `memory.ts` pointer handling against `VM_ArgPtr`; `memory-syscalls.ts` by reading.

### Literal scan
A script listed every string literal in `game/g_*.c`, `bg_misc.c` and `tr_shader.c` that does not appear in the port. Every hit I followed up was absent for a harmless reason, such as a debug print, a `\n"` escaping artifact in my matcher, or a console listing. No gameplay string, cvar, command or sound is missing. This is a candidate filter and not a comparison.

### NOT compared
- **Collision:** `cm_polylib.c` against `polylib.ts`. I read `polylib.ts` in full, but opened only the axis choice and cross product of `BaseWindingForPlane` on the C side. `core/math.ts` `anglesToAxis` was not checked against `AngleVectors`/`CreateRotationMatrix`, and the rotated traces rely on it. `BoxOnPlaneSide` was opened only in part.
- **Game, not opened against C:** `g_active.c` other than the three functions above (`ClientTimerActions`, `ClientEvents`, `SpectatorThink`, `SendPendingPredictableEvents`, inactivity), vs `client-effects.ts`, `client-events.ts`, `client-policy.ts`. `g_client.c` vs `client-spawn.ts`, `client-admission.ts`. `g_main.c` vs `match.ts`. `g_session.c` vs `session.ts`. `g_arenas.c` vs `arenas.ts`. `g_svcmds.c` vs `server-commands.ts`. `g_bot.c`. `g_rankings.c` vs `rankings.ts`. `g_utils.c` vs `utilities.ts`, `entities.ts`. `g_mem.c` vs `memory.ts`. The personal-portal part of `g_misc.c` vs `personal-portal.ts`. The other `fire_*` setup in `g_missile.c`.
- **Materials:** `ScanAndLoadShaderFiles`, `R_RemapShader`, `CreateInternalShaders`; `RB_StageIteratorGeneric`, `DrawMultitextured`, `RB_FogPass`, `ProjectDlightTexture` vs `dlight.ts` (the port read, the C not opened); `tr_shadows.c`; `R_FogFactor` and `R_InitFogTable` vs `fog.ts`; `R_SetupEntityLighting` vs `q3-lighting.ts`; `R_LoadFogs` beyond the cited lines; `tr_sky.c` vs `sky.ts`; `tr_noise.c` beyond `R_NoiseInit`.
- **QVM:** `vm.c` symbols and restart; syscall number tables.
- **Not rendered or played:** every comparison is by reading, apart from the reproductions marked below.

## Strengths
- Collision is a term-for-term translation and keeps id's oddities on purpose: `CM_ClipHandleToModel` returning a real submodel for handle 255, the capsule handle failing unless it names a submodel, the double centering in `CM_TransformedBoxTrace`, `CM_TestBoundingBoxInCapsule` skipping the six axial planes, and the swapped upper/lower test in `CM_TestCapsuleInCapsule`.
- Patch generation matches in ordering of plane allocation, `CM_EdgePlaneNum` winding, bevel rejection (a rejected bevel's plane stays allocated), and the early return in `CM_AddFacetBevels` that omits the opposite plane.
- `ParseStage` keeps the `alphaGen == CGEN_IDENTITY` enum mix-up. `CollapseMultitexture` keeps the `alphaGen == CGEN_WAVEFORM` typo. `FinishShader` keeps the detail-stage `memset` that clears the following stage.
- `Team_FragBonuses` keeps the `v1` written twice with `v2` left measured from the flag. `Cmd_Vote_f` keeps the `msg[1]` test.
- Retail reach of the findings below is nil or very small. The default game path is not affected by SRC2Q3-002 to -006.

## Findings

### SRC2Q3-001 — `gc <slot>` naming a slot at or above `sv_maxclients` ends a native Q3 server in any team game
- **Verification (VERIFY-V): confirmed. Final severity: Critical.** Reproduced in a real simulation, not only the stub: `maxClients` 2, `g_gametype 3`, `playerCommand(actor, "gc", ["5","0"])` throws `GameCommandError` from commands.ts:151 via :412; gametype 0 and `gc 1 0` do not throw. No catch exists for the class in `src`, and the route is the one VERIFY-D confirmed for GAPQ3-001. C at g_cmds.c:870-871 reads `target->client` with the same missing guard, and `G_SayTo` returns at :813.
- Severity: Critical
- Category: security
- Location: src/content/q3/team-arena/commands.ts:412, :503-507, :149-152; src/content/q3/base/game/entities.ts:92
- Confidence: reproduced (the throw, `src2q3/gc.ts`); traced (process exit, by the path GAPQ3-001 established)
- Evidence: `gameCommand` accepts `slot < MAX_CLIENTS` (64), while only `slot < maxClients` has a client (entities.ts:92 `for (let index = 0; index < options.maxClients; index++) this.at(index).client = this.clientAt(index);`). `say` then evaluates `target !== null && gameType >= GameType.GT_TEAM && clientOf(target).sess.sessionTeam === ...`, and `clientOf` throws. Reproduction with `maxClients` 8 and `gc 8 0`: gametype 0 sends normally, gametype 3 gives `THROW GameCommandError Player command requires a client entity`. Original: `if ( player < 0 || player >= MAX_CLIENTS )` (`game/g_cmds.c:1180`), `G_Say( ent, &g_entities[player], SAY_TELL, ... )` (:1186), and `target->client->sess.sessionTeam` with a NULL client (:870-871). Clients are assigned only below `level.maxclients` (`game/g_main.c:463`). In a QVM that is a masked low-memory read (the same behavior SRCQ3 recorded for GAPQ3B-004), and `G_SayTo` then returns at `!other->inuse` (:813).
- Impact: Any connected client on a team, CTF or Team Arena server ends the process with one console command. This is not one of the three triggers in GAPQ3-001 (order 7, `follownext`, trailing ESC), and fixing the order bound alone leaves it open. A DLL build of id's game would crash here too; the retail QVM does not.
- Remediation: Treat a target with no client as "no location" in `say`, or return early in `gameCommand` when the slot has no client.

### SRC2Q3-002 — An autosprite shader on a non-quad surface throws at render time, where id warns and draws
- **Verification (VERIFY-V): confirmed. Final severity: Medium.** Reproduced at deform.ts:95, :150; tr_shade_calc.c:358-363, :435-440 only warn. No per-frame catch: the try blocks in render/scene/world.ts (:221, :752) are construction only. The finding's open part is now closed for models: my scan found 19 retail MD3 and skin bindings to autosprite shaders, all true quads, and 1313 BSP surfaces with 0 non-quad, so retail is safe. QVM polygons remain untraced.
- Severity: Medium
- Category: robustness
- Location: src/materials/deform.ts:95, :150; reached from src/materials/evaluate.ts:102
- Confidence: reproduced (the throw, `src2q3/repro.ts`); traced (no catch on the render path, per APP-001); retail scan reproduced
- Evidence: `if (mesh.vertices.length % 4 !== 0 || mesh.indices.length !== mesh.vertices.length / 4 * 6) throw new Error("autosprite requires independent four-vertex quads");`, and the same for autosprite2. Original: `ri.Printf( PRINT_WARNING, "Autosprite shader %s had odd vertex count", ...)` and "odd index count" with no return, then the loop runs (`renderer/tr_shade_calc.c:358-363`; autosprite2 at :435-440).
- Impact: A custom map that applies `deformVertexes autosprite` to a triangle or a surface with more than four vertices ends the client when the surface is drawn. Id draws garbage quads and continues. Retail scan: 64 autosprite shaders, 1313 BSP surfaces across all paks, none non-quad, so stock content is safe. Model surfaces and QVM polygons with such a shader were not scanned or traced, and may reach the same throw.
- Remediation: Print the warning and process the complete quads, skipping a trailing partial one.

### SRC2Q3-003 — A Kamikaze shockwave throws if an earlier victim's death frees a linked grapple hook
- **Verification (VERIFY-V): confirmed. Final severity: Low.** Reproduced (`vv/real4.ts`) by calling `kamikazeArea` directly on a baseq3 simulation: it throws at weapon.ts:297 once the player is listed before the hook. Two conditions the finding omits: the player must have relinked after the hook (normal for a moving player with an attached hook), and level time must be past the 2 s slot-reuse window, because before that the freed slot is reused by a linked tempEntity and nothing throws. Production reach is still Team Arena with a grapple.
- Severity: Low
- Category: robustness
- Location: src/content/q3/base/game/weapon.ts:295-297; src/content/q3/base/game/death.ts:265; src/content/q3/base/game/entities.ts:191-193
- Confidence: traced (not run)
- Evidence: Port loop: `if (shock ? target.kamikazeShockTime > combat.time : !target.takedamage || ...) continue; const link = world.linkState(number); if (link === undefined) throw new Error("Kamikaze area query returned an unlinked entity");`. The shock branch does not test `takedamage`, as in id. `damage` can kill a player, `playerDie` frees the hook (death.ts:265, `game/g_combat.c:461`), and `free` unlinks it (entities.ts:193). If the hook is later in the candidate list, `linkState` is undefined. Original: `KamikazeShockWave` reads `ent->r.absmin` of the cleared entity and calls `G_Damage`, which does nothing without `takedamage` (`game/g_weapon.c:988-1026`).
- Impact: A kamikaze whose shockwave kills a player with an attached or flying grapple ends the server, when the hook is listed after that player. It needs a Team Arena server with a grapple in play, and the 25-damage shockwave must be the killing blow.
- Remediation: Skip the candidate when `linkState` is undefined.

### SRC2Q3-004 — A short `rgbGen const` vector rejects the whole shader, where id warns and keeps parsing
- **Verification (VERIFY-V): confirmed. Final severity: Low.** Reproduced: `rgbGen const`, `( 1 1 1` and `( 1 1 )` are rejected at material.ts:834 via `vector` (:681). tr_shader.c:821 ignores the `ParseVector` result and :116-142 only warns. My scan found 0 retail shader files with `rgbGen const`.
- Severity: Low
- Category: bug
- Location: src/materials/material.ts:834, :676-686
- Confidence: reproduced (`src2q3/repro.ts`); retail scan reproduced
- Evidence: `case "const": return { kind, color: this.vector() };`, and `vector` uses `expect`/`required`, which call `fail`. The port already has the tolerant reader, `sourceVector` (:688), used for `tcGen vector` and fogParms. Original: `ParseVector( text, 3, color );` ignores the result (`renderer/tr_shader.c:821`), and `ParseVector` only warns and returns false (:116-142). Reproduced inputs `rgbGen const`, `rgbGen const ( 1 1 1` and `rgbGen const ( 1 1 )` all give `rejected ... Missing shader parameter`.
- Impact: Such a shader shows the default material, where id keeps the stage. For a missing closing parenthesis id has the real color; for a missing vector the color is an uninitialized local, so the id result is unspecified. A vector without an opening parenthesis fails in both, because the following number becomes an unknown stage keyword. Retail scripts contain no `rgbGen const` lines, so only custom content is affected.
- Remediation: Use `sourceVector` here, retaining the previous constant color when a component is missing.

### SRC2Q3-005 — Inverted trace bounds from a QVM throw, where id's `CM_Trace` accepts them
- **Verification (VERIFY-V): confirmed. Final severity: Low.** Reproduced on both paths, which the finding had only read for the server side: `models.trace` (client path) and `scene.trace` with the `bounds` shape built at server-game-syscalls.ts:81 (server path) both throw `RangeError` from world.ts:116 on inverted bounds, and return normally on ordered ones. cm_trace.c:1187-1193 has no ordering test. No retail caller found.
- Severity: Low
- Category: robustness
- Location: src/world/collision/q3/world.ts:115-117; src/world/collision/q3/model.ts:37-38, :41; src/compat/qvm/client-collision-syscalls.ts:70-72; src/compat/qvm/server-game-syscalls.ts:81
- Confidence: traced for the client syscall path; the server syscall path was read only at its shape construction
- Evidence: `if (... shape.mins.x > shape.maxs.x || ...) throw new RangeError("trace shape requires finite ordered bounds");`. The syscall passes guest vectors directly: `const shape: TraceShape = { kind: ..., mins, maxs };`. Original: `CM_Trace` computes `offset[i] = ( mins[i] + maxs[i] ) * 0.5` and the symmetric size with no ordering test (`qcommon/cm_trace.c:1187-1193`).
- Impact: A mod that passes reversed bounds to a trace trap runs on id's engine and ends the process here under VM-004. I did not find a retail call that does this; retail cgame traces use fixed player bounds. `CM_TempBoxModel` is already tolerant in the port (model.ts:205-206).
- Remediation: Accept unordered bounds in the trace path, matching `CM_Trace`, or report a guest fault as a drop.

### SRC2Q3-006 — Patch generation raises `RangeError` at id's silent array overruns
- **Verification (VERIFY-V): confirmed-with-changes. Final severity: Info.** The throws at patch.ts:255, :195, :393 are real, and id has no check at cm_patch.c:336-344. The stated consequence is wrong: "a hostile map exits rather than drops" assumes a reader of the drop code, but `instanceof CommonError` appears only at spawn.ts:217 and bots/behavior/library/weapons.ts:990, neither on this path. A `RangeError` and a `CommonError("drop")` behave the same: printed for a console map (application.ts:3526), process exit at startup. The remediation as written changes nothing without VM-004's fix.
- Severity: Info
- Category: robustness
- Location: src/world/collision/q3/patch.ts:255, :195, :393
- Confidence: traced (no such patch built)
- Evidence: `if (columns.length + 2 > 129) throw new RangeError("collision subdivision exceeds MAX_GRID_SIZE");` and `if (borderIndex >= 26) throw new RangeError("Patch border outside source facet allocation");`. Id has no check on `grid->width + 2` (`qcommon/cm_patch.c:336-344`). Its bevel code prints "too many bevels" and still writes `borderPlanes[numBorders]` (:860-861, :922-923).
- Impact: Id's behavior is memory overrun, so failing is defensible. The difference is the error type: a `RangeError` is not the `CommonError("drop")` used for the neighboring limits at :242-244, so a hostile map exits rather than drops. All retail maps load through this path.
- Remediation: Raise `CommonError("drop", ...)` at these sites.

### SRC2Q3-007 — The BSP fog color ignores `identityLight`, which the port's API accepts
- **Verification (VERIFY-V): confirmed. Final severity: Info.** fog.ts:42-43 omits the factor applied at tr_bsp.c:1613-1615. A search of `src` found no producer setting `identityLight` on the world view input, so world.ts:356 always uses 1 and there is no effect today.
- Severity: Info
- Category: bug
- Location: src/materials/fog.ts:42-43; src/render/scene/world.ts:103, :356
- Confidence: traced
- Evidence: `const byte = (value: number): number => (Math.trunc(Math.fround(value * 255)) & 255) / 255;` applied to `parameters.color`. Original: `out->colorInt = ColorBytes4 ( shader->fogParms.color[0] * tr.identityLight, ...` (`renderer/tr_bsp.c:1613-1615`). The port uses `identityLight: input.identityLight ?? 1`, and a search of `src` found no caller that sets it, so production runs at 1, where the two agree.
- Impact: None today. If overbright support sets `identityLight` below 1, fog volumes (21 retail maps, 68 volumes) would be too bright relative to surfaces.
- Remediation: Apply `identityLight` when preparing the fog color, or remove the optional input.

## Supplements to existing IDs
- **SRCQ3-002 should be withdrawn.** It says a zero-stage body "parses successfully" and that id draws no passes. In fact `ParseShader` ends with `if ( s == 0 && !shader.isSky && !(shader.contentFlags & CONTENTS_FOG ) ) { return qfalse; }` (`renderer/tr_shader.c:1599-1601`), so `R_FindShader` sets `defaultShader` (:2473-2476). `ShaderForShaderNum` then returns `tr.defaultShader` (`renderer/tr_bsp.c`, "if the shader had errors, just use default shader"), and `RE_RegisterShader` returns 0 (:2709). The port's material.ts:1421 and shaders.ts behavior match id. Only the wording of the port's error message ("source uses an implicit material") is inaccurate.
- **SRCQ3-004, the open part is settled.** After `fcomp`, an unordered result sets C0, C2 and C3. Reading the JIT tests (`qcommon/vm_x86.c:805-875`): OP_EQF, OP_LTF and OP_LEF take the branch on NaN, OP_NEF does not, and OP_GTF and OP_GEF do not. The port's IEEE compares (operations.ts:99-104) differ from the JIT on EQF, NEF, LTF and LEF, and agree on GTF and GEF. The interpreter's plain C compares are what the port follows.
- **LEFT-004 confirmed against source.** `LAN_AddServer` calls `NET_StringToAdr( address, &adr );` and ignores the result (`client/cl_ui.c:159`). `LAN_RemoveServer` does the same (:206). `LAN_GetServerPing` returns -1 out of range. Id resolves synchronously, so the port's recheck concern after `await` has no source counterpart.
- **VM-017 confirmed, with one addition.** `VM_ArgPtr` masks pointers and returns NULL for zero (`qcommon/vm.c`). The port's `memory.pointer` masks too, so that part matches. `memory.span` throws for a null pointer even when the count is 0 (memory.ts:67), which also rejects `memset(NULL, x, 0)` and `memcpy(dst, NULL, 0)`, both harmless on id's runtime in practice.
- **VM-003 confirmed.** `VM_CallInterpreted` has an unconditional `while ( 1 )` and no budget (`qcommon/vm_interpreted.c`), as the finding states.
- **VM-020 no change.** The entry frame matches `vm_interpreted.c:350-362` under either label.
- **GAPAPP2-002, Q3 part supported.** `FS_FOpenFileRead` returns not-found for `..` and `::` (`qcommon/files.c:1054`) and does not filter `//`, so id tolerates what the port rejects.
- **LEFT-005, GAPNET-007:** no counterpart in this tree (1.16n cgame; unified protocol), so not settled here.
