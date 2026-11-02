# VERIFY-Z — verification of SRC9, X-001 and X-002

HEAD fcdc8af5, run from `<scratchpad>/clean`; the six main cited port files were compared with `cmp` against the project and are identical. Port paths are relative to `src/`. C paths are relative to `upstream/Quake-III-Arena/code/`. Nothing from upstream was executed. Rerun: `src9/live.ts`, `src9/live3.ts`, `src9/pp.ts`. New: `verifyZ/nan.ts`, `verifyZ/zero.ts`, `verifyZ/menus.ts`, `verifyZ/browser.ts`.

### SRC9-001
Verdict: confirmed
Corrected severity: Critical
Reason: guest-bots.ts:72 deletes the record and :98 throws; goals.ts:1285 reads it; be_aas_entity.c:77-87 and be_ai_goal.c:1655-1664 keep and read the stale record. Rerun of `live.ts`, unmodified, 4 bots: `Bot entity 124 is not observed` at frame 43, 2.15 simulated seconds, the same as SRC9.
Process exit, which SRC9 only traced, is now reproduced: `src/main.ts --game q3-classic-lrctf --map q3ctf1 --dedicated --listen 0 --bind 127.0.0.1 +set bot_minplayers 4` exits 1 with `Bot entity 129 is not observed`, stack through application.ts:4701 and `main`, and a crash.log entry. The listen and local path is traced only (startup.ts:1384, main.ts:82-94); no window was launched.
Severity basis: this is a normal-use crash, not a remote one. No hostile or malformed input is involved, every unpatched run ended, and whole-process loss drops all clients. The trigger is ordinary bot item-seeking, and the setup is a supported action (`addbot`, Match controls "Add bot" at ui/library/match.ts:25, `bot_minplayers`; README.md:137 lists QVM mods; q3-guest.test.ts:70-77 tests a bot).
Limits the catalog must state, and the case for High: every other Critical here is peer-triggered, and this one is not. A peer cannot add bots: g_cmds.c has no `addbot`, and LRCTF's vote list string names no bot option. Bots are opt-in, with 0 by default, and LRCTF's own sv_lrctf.cfg:166,:169 sets `bot_enable 0` and `bot_minplayers 0`. q3-baseq3 and q3-missionpack are unaffected (director.ts is src/bots/behavior/director.ts:139, using observations that keep records). LRCTF is a user-installed mod (docs/playing.md:25), so "shipped" means the mod's own bytecode. "Any QVM game" is traced through content.ts:210 (every non-built-in Q3 product); only LRCTF was run. If "normal use" is read to exclude an opt-in mod plus bots, this is High.

### SRC9-002
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: guest-bots.ts:74-75 gives interval 0 and `lastVisibleOrigin === origin` after a delete or on first sight; be_aas_entity.c:89,:93 use the stale slot. Rerun of `live3.ts`: 140 zero-interval client reads and 0 NaN traces, the same as SRC9. Items 2 and 3 stand as written (goals.ts:1242, bot-navigation-syscalls.ts:118, be_aas_entity.c:341-349).
Correction, the consequence is understated: a NaN aim point does not just misaim, it ends the process. world/collision/q3/world.ts:325 throws `RangeError: trace requires finite coordinates`, where C has no such guard. Fault injection in `zero.ts`, forcing the port's zero-interval record on every client read of the LRCTF bytecode (with the SRC9-001 throw patched), threw that RangeError at frame 410 through server-game-syscalls.ts:80. That proves the consequence, not its frequency. `nan.ts`: a NaN trace throws at start or end; a NaN velocity into prediction does not throw.
Correction, the stated cause is wrong: SRC9 says NaN was absent "probably because new players hold the machinegun", but `wi` at ai_dmq3.c:3389 is the aiming bot's weapon. The real narrowing is :3395 (dist <= 100, or a stale `enemyorigin` from :3352-3356) plus a one-update window. The NaN in `enemyvelocity` is harmless (only :3364 compares it); the live path is :3432 to the trace at :3506 or the ground-target trace.
Severity: stays Medium because natural reach is unproven. Two uninjected runs gave 0 throws: `live3.ts` (140 reads) and `zero.ts churn` (8 bots, 43 remove-and-add cycles, 2117 reads, 67.55 simulated seconds). SRC9-001 currently masks it. Raise to High if it is ever seen uninjected. The SRC9-001 remediation removes it only if never-seen slots also start from a zero record.

### SRC9-003
Verdict: confirmed
Corrected severity: Low
Reason: bot-library-syscalls.ts:54 calls library.ts:141-145, which only stores the time, and guest-bots.ts:71-75,:81 never clear `valid`; be_aas_main.c:242-244 invalidates each frame. Guards are absent at bot-library-syscalls.ts:56 (be_interface.c:285-291, be_aas_entity.c:69-73). ai_main.c:1456-1526 updates or NULLs every entity right after start frame, so the stock game sees no difference.
Addition: when not initialized, library.ts:142 throws where C returns BLERR_LIBRARYNOTSETUP. No stock path reaches it.

### SRC9-004
Verdict: confirmed
Corrected severity: Low
Reason: mission-hud.ts:80-84,:252-255 build plain text, and :295-299 pass it to loadMenuDefinitions, whose only production caller is that site; script-sources.ts:186 and client-script-syscalls.ts:78 compress, as does l_script.c:1367. Rerun of `pp.ts` reproduces all three table rows. New differential (`menus.ts`): 49 retail missionpack `ui/*.menu` files, with includes resolved, give 0 token and 0 diagnostic differences between plain and compressed, so retail is unaffected as claimed.

### SRC9-005
Verdict: confirmed
Corrected severity: Info
Reason: guest-bots.ts:73-74 copies state bounds; be_aas_entity.c:114-125 and sv_bot.c:262-273 use radius bounds when any angle is nonzero. sv_game.c:135-138 confirms r.mins comes from CM_ModelBounds, so unrotated models agree. :125-136 leaves other solids alone as stated. The only consumers found are BotEntityVisible (ai_dmq3.c:2834,:2918-2919) and guest-bots.ts:56.

### SRC9-006
Verdict: confirmed
Corrected severity: Info
Reason: `saveroutingcache`, `max_routingcache` and `.rcd` appear in src only at bots/behavior/q3/ai-main.ts:36,:259,:437,:449, so the variable is set and never read; be_aas_main.c:269-272 and be_aas_route.c:1241 have no counterpart. estimate-aas.ts:69-76 is a 16 MB LRU that evicts any entry, where be_aas_route.c:701-702 spares portal area caches. ai_main.c:1647 is CVAR_CHEAT. A recursive scan of 17 pk3 files under q3a (SRC9 counted 14) found 0 `.rcd`.

### SRC9-007
Verdict: confirmed-with-changes
Corrected severity: Info
Reason: the conclusion holds. There is no AAS_Show, AAS_Draw or AAS_DebugLine in src, BOTLIB_TEST returns 0 (guest-runtime.ts:379), `trap_BotLibTest` has no caller, the only AAS_PredictClientMovement caller passes qfalse (ai_dmq3.c:3416-3419), and be_ai_move.c:3346-3348 is `#ifdef`-gated.
Correction: "no `DebugPolygon` code exists in src" is false as written. Hits are world/collision/q3/patch.ts:18, render/cpu/triangle-kernel.ts:4, content/q3/base/bot-debug.ts:2 and `debugLine` at content/q3/base/game/utilities.ts:60. These are collision, renderer and game-side helpers, not be_aas_debug.c.

### X-001
Verdict: confirmed
Corrected severity: Info
Reason: browser-view.ts:229 breaks on any row at 32; cl_main.c:3154 tests only inside `ping == -1`, so :3182 still consumes overflow. `browser.ts` (stubbed transport), 32 `-1` rows then 2 `0` rows with 2 overflow addresses: 32 pings sent, overflow still 2, row 32 still ping 0; by reading C, both addresses are consumed in that call. A later pass reaches them, so the impact is as stated.

### X-002
Verdict: confirmed-with-changes
Corrected severity: Info
Reason: browser-view.ts:277-281 clears address and handle, and `browser.ts` shows the re-query sends a second request; cl_main.c:2672-2677 only sets `retrieved`, including on a slot picked for an unmatched address.
Correction, the impact is overstated: the stock UI does not reach the cached-result difference for the status panel. After success ui_main.c:4176-4178 sets `nextServerStatusRefresh = 0`, so :4162-4166 stops polling until a forced refresh, and :4171 resets all slots on both sides. Find-player resets all at :4051 and moves on after :4109, so only a repeated address in one search could differ. q3_ui declares the trap and has no caller.
