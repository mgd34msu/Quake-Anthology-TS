# VERIFY-V — SRC2Q3 and SRC3Q3 findings, checked against id 1.32 source and the port at HEAD fcdc8af5, plus the SRC2Q3 supplement on SRCQ3-002

Scripts: `scratchpad/vv/` (`real2.ts`, `real3.ts`, `real4.ts`, `md3scan.py`, `order.py`, `bodies.py`). I also reran `src2q3/gc.ts`, `src2q3/repro.ts`, `src3q3/load.ts`, `firstadmit.ts`, `handicap.ts`, `spawnweapon.ts`. Nothing from `upstream/` was executed. No window or network was used. "Reproduced" means a simulation-level or component-level run; application-level claims are traced.

### SRC2Q3-001
Verdict: confirmed
Corrected severity: Critical
Reason: Reproduced in a real simulation, not only the stub: `maxClients` 2, `g_gametype 3`, `playerCommand(actor, "gc", ["5","0"])` throws `GameCommandError` from commands.ts:151 via :412; gametype 0 and `gc 1 0` do not throw. No catch exists for the class in `src`, and the route is the one VERIFY-D confirmed for GAPQ3-001. C at g_cmds.c:870-871 reads `target->client` with the same missing guard, and `G_SayTo` returns at :813.

### SRC2Q3-002
Verdict: confirmed
Corrected severity: Medium
Reason: Reproduced at deform.ts:95, :150; tr_shade_calc.c:358-363, :435-440 only warn. No per-frame catch: the try blocks in render/scene/world.ts (:221, :752) are construction only. The finding's open part is now closed for models: my scan found 19 retail MD3 and skin bindings to autosprite shaders, all true quads, and 1313 BSP surfaces with 0 non-quad, so retail is safe. QVM polygons remain untraced.

### SRC2Q3-003
Verdict: confirmed
Corrected severity: Low
Reason: Reproduced (`vv/real4.ts`) by calling `kamikazeArea` directly on a baseq3 simulation: it throws at weapon.ts:297 once the player is listed before the hook. Two conditions the finding omits: the player must have relinked after the hook (normal for a moving player with an attached hook), and level time must be past the 2 s slot-reuse window, because before that the freed slot is reused by a linked tempEntity and nothing throws. Production reach is still Team Arena with a grapple.

### SRC2Q3-004
Verdict: confirmed
Corrected severity: Low
Reason: Reproduced: `rgbGen const`, `( 1 1 1` and `( 1 1 )` are rejected at material.ts:834 via `vector` (:681). tr_shader.c:821 ignores the `ParseVector` result and :116-142 only warns. My scan found 0 retail shader files with `rgbGen const`.

### SRC2Q3-005
Verdict: confirmed
Corrected severity: Low
Reason: Reproduced on both paths, which the finding had only read for the server side: `models.trace` (client path) and `scene.trace` with the `bounds` shape built at server-game-syscalls.ts:81 (server path) both throw `RangeError` from world.ts:116 on inverted bounds, and return normally on ordered ones. cm_trace.c:1187-1193 has no ordering test. No retail caller found.

### SRC2Q3-006
Verdict: confirmed-with-changes
Corrected severity: Info
Reason: The throws at patch.ts:255, :195, :393 are real, and id has no check at cm_patch.c:336-344. The stated consequence is wrong: "a hostile map exits rather than drops" assumes a reader of the drop code, but `instanceof CommonError` appears only at spawn.ts:217 and bots/behavior/library/weapons.ts:990, neither on this path. A `RangeError` and a `CommonError("drop")` behave the same: printed for a console map (application.ts:3526), process exit at startup. The remediation as written changes nothing without VM-004's fix.

### SRC2Q3-007
Verdict: confirmed
Corrected severity: Info
Reason: fog.ts:42-43 omits the factor applied at tr_bsp.c:1613-1615. A search of `src` found no producer setting `identityLight` on the world view input, so world.ts:356 always uses 1 and there is no effect today.

### SRC3Q3-001
Verdict: confirmed
Corrected severity: High
Reason: Reproduced in both modes: q3dm3, q3dm4, q3dm5, q3dm7, q3dm10, q3dm18 throw at q3/runtime.ts:567; q3dm1 and q3dm2 load. g_spawn.c:304-305 and :475 only warn and free. pak0 `arenas.txt` order is q3dm1, q3dm2, q3dm3, as stated. The finding's "appears to catch" is settled by reading: on a console map change the throw is before `committed = true` (application.ts:3099), so :3526 prints it and the old map stays.

### SRC3Q3-002
Verdict: confirmed-with-changes
Corrected severity: High
Reason: Reproduced: q3tourney3, q3tourney5 and q3ctf4 throw 8/8 at item-lifecycle.ts:175 on admit without settle frames. First load (application.ts:1924) ends the process, but two impact claims are wrong by reading. A map change does not end it: :2839 runs before `committed = true` (:3099), so :3526 prints the error and the old map stays. "Dedicated servers are not affected" is false for travel: the admissions at :2828 cover every carried non-bot client, including network clients, so a `map` to these maps with a player connected fails the same way.

### SRC3Q3-003
Verdict: confirmed
Corrected severity: Medium
Reason: Reproduced: on q3ctf4 `ps.weapon` 2 with weapon bits 1110, unchanged after 600 ms; g_client.c:1230-1240 would select 3. The loop at client-spawn.ts:367 is behind `selectedPlayer === undefined`, and production always supplies it (q3/runtime.ts:201). In that command-free run `ps.eventSequence` stayed 0, so no pickup event was observed in `ps`; whether cgame autoswitch would correct it remains unverified.

### SRC3Q3-004
Verdict: confirmed
Corrected severity: Medium
Reason: Reproduced: handicap 50 gives health 125, stats max 50; id gives 75 (g_client.c:1191). The literal `"100"` is at simulation/runtime.ts:4196, and the correct line at client-spawn.ts:343 is in the unused branch. Bot handicaps at catalog.ts:236-238 match g_bot.c:600-608. Health stayed 125 for 74 s in a command-free run, so decay is by reading only (client-effects.ts:167).

### SRC3Q3-005
Verdict: confirmed
Corrected severity: Medium
Reason: The only `shadow-volume`/`shadow-finish` constructors are in tests and the worker-protocol decoder, and nothing sets `materialContext.projectionShadow` (world.ts:361). players.ts:214 drops the blob for modes other than 1, as cg_players.c:2022 does, and nothing replaces it. The finding's unrun scan is done: 0 retail BSP surfaces or MD3 surfaces use the projection deform, so the deform.ts:189 throw needs custom content. ui_main.c sets only 0 or 1, so modes 2 and 3 come from the console.

### SRC3Q3-006
Verdict: confirmed
Corrected severity: Low
Reason: `kind: "log"` is emitted at q3/host.ts:49 and otherwise appears only in unified-event-codec.ts; the handler at application.ts:1572-1578 has no case for it. `g_log` is registered at settings.ts:29 and has no reader in the native game. g_main.c:1095-1103 prints when dedicated and writes the file; `InitGame:` and `ShutdownGame:` are absent from `src`.

### SRC3Q3-007
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The port's order (assets.ts:84, shaders.ts:111) does differ from id, but id's order is not search-path order, and "None on retail" is wrong. tr_shader.c:2885 concatenates in reverse and the check at :2952 stops every file but the last-listed after its first shader, so the winner is the first shader of the earliest-listed file, otherwise the last-listed file. By `vv/order.py` (modelled from the C, not rendered): baseq3 has no difference, but Team Arena `console` (id gfx2.shader, port gfx.shader) and `models/flags/pole` (id models2.shader, port models.shader) get different bodies, and a custom pak does not generally win by pak priority.

### SRC3Q3-008
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Reproduced: a 64-byte new name throws `RangeError` at shader-remaps.ts:29-30 and 63 is accepted. Reach is as stated: `targetShaderName` at spawn.ts:167 through utilities.ts:170-172, and `remapTeams` from settings.ts:99, in frame through q3/runtime.ts:583, :684. The "not a drop" point has the same flaw as SRC2Q3-006: no reader of the drop code exists, so a `CommonError` would still end the process in a frame. Only the truncation remediation helps.

### SRC3Q3-009
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The missing check is real (g_main.c:360-363 has no port equivalent), but the impact is wrong. Reproduced with `g_gametype 9` on q3dm1: `createSimulation` throws `Selected Q3 objectives are unavailable: {"kind":"unsupported-mode",...}` at simulation/runtime.ts:3613-3614, so the map does not load, and the team-game branches the finding describes are never reached. Id resets to 0 and plays free-for-all.

### SRC3Q3-010
Verdict: confirmed
Corrected severity: Info
Reason: rankings.ts has no product selection and uses `case 23` at :385, :462, :607, :655. bg_public.h:597-603 gives `MOD_NAIL` 23 and `MOD_GRAPPLE` 28 under MISSIONPACK, and missile.ts:472 uses 28. `QGR_KEY_MATCH_RATING` (1112000001, g_rankings.h:70) appears nowhere in `src`, `teamName` has no caller, and no game file outside g_rankings.c calls `G_Rank*`.

### SRCQ3-002
Verdict: refuted
Corrected severity: Info
Reason: The SRC2Q3 supplement holds and this overturns VERIFY-R's "confirmed". tr_shader.c:1599-1601 makes `ParseShader` return false for zero stages unless sky or fog, so :2473-2476 sets `defaultShader` and tr_bsp.c:291-292 returns `tr.defaultShader`; id draws the default, not nothing, and :2270-2273 is only reached for sky and fog. The port matches: material.ts:1421 (surfaceparm lowercased at :1350), shaders.ts:79, and :359 returns null like `RE_RegisterShader` returning 0 (:2709). Only the wording of the port's message at :1421 is inaccurate.
