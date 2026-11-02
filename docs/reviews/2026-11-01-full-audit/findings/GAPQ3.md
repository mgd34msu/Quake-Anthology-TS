# GAPQ3 — Q3 content skipped in round 1: presentation (cgame), base/game, team-arena, foundation, equipment

All paths are relative to `src/content/q3/` unless they start with `src/` or `network/`. HEAD fcdc8af5.

Comparisons with ioquake3 and id's GPL game and cgame are from my memory of that source. It is not in the repository, so I could not diff against it. Reproductions are `gapq3/repro.ts` and `gapq3/repro2.ts` in the scratchpad. They import the modules from `clean/` and drive them with stub hosts. "Reproduced" below means the throw or value was observed at module level. The route from there to process exit was traced, not run end to end.

## Coverage
Scope is 27,641 lines across every file under q3/. CONTENT1 had already read about 4,500 of them.

**Read in full, about 12,500 lines new to this round:**
- presentation: weapons 780, players 749, client 397, events 403, entities 456 (CONTENT1 read only 135-165), server-commands 518, snapshots 197, frame 147, prediction 279, player-state 229, view 318, effects 268, state 261, resources 223, client-info 78, audio 133, hud 375, hud-corners 459, console 212, draw-status 201, scoreboard 202, mission-hud 601, mission-owner-draw 502, frame-audio 50, info 129, draw-icons 91
- team-arena: commands 695, client-admission 371, client-spawn 398, client-think 262, client-effects 248, server-commands 257, session 222, arenas 265
- base/game: format 266, spawn 304, targets 510, triggers 314
- foundation: arsenal 179

**Partly read:**
- presentation/media 287 of 846 (560-846; the first 560 lines are mostly registration tables)
- presentation/config 163 of 392 (230-392; the cvar table was not read)
- presentation/marks 70 of 139 (the second half, in addition to CONTENT1's first half)

**Also read, outside the scope, to trace paths:** `src/render/scene/particles/q3-system.ts` 1-159, `src/app/bootstrap/q3-client.ts` 470-529, `src/app/bootstrap/network/q3.ts` 40-175, `network/q3/server.ts` 90-125, `src/app/bootstrap/q3-client/assets.ts` 26-40 and 100-145, `src/app/bootstrap/simulation/q3/runtime.ts` 670-695.

**Skipped, about 10,000 lines, not analyzed:**
- base/game: save-values 680, save-state 182, utilities 199, misc 116, misc-spawn 169, mover-spawn 292, personal-portal 209, item-motion 213, entities 257, state 249, projectile 147, shader-remaps 106, and the files under 80 lines
- base: shared/* (including items 520, player-state 267), rankings beyond CONTENT1's sample, records beyond its sample, settings, combat-bridge, world-adapter
- team-arena: client-events 126, client-policy 120, objective-placement, foreign-objectives, movement-host
- foundation: character 267, player-pose 265, animation 159, animation-config 184, assets 121, presentation 116, events 89, weapon-pose 66, movement-hooks 48
- equipment/* (about 160 lines)
- presentation: mark-projector 219, scene 154, ref-entity 176, draw-tools 130, retail-snapshot 72, refdef, model-access, cgame-body-profile, ui-adapters, and the two partial files above

`utilities`, `misc`, `client-events`, `client-policy`, `animation`, `events`, `personal-portal` and `equipment/*` were dumped to a tool output, but I did not review that output. I count them as skipped.

## Strengths
- The port is unusually faithful. I compared cg_weapons, cg_players, cg_event, cg_ents, cg_predict, cg_playerstate, cg_view, cg_effects, g_cmds, g_client, g_active and g_trigger logic against the source line by line and found no gameplay logic deviation in the code read. That covers MOD tables, GTS team sounds, event channels, weapon registration tables, brass, tracers, damage kick, prediction error decay, spawn selection, regeneration and body queue.
- Original quirks are kept on purpose and documented, such as `ops` in the first-humiliation check, `cgs.clientinfo->team` in team votes, EV_USE_ITEM15 falling to the error path, and the argv aliasing in remapShader.
- Asynchronous client loading is well guarded. Lifecycle and per-slot request counters supersede stale loads, and the command queue serializes configstring work. I looked for a load race in `ClientInfoStore` and refuted it, because both paths run inside the serialized queue or the awaited frame.
- `gameFormat` truncates instead of overflowing, and `sendServerCommand` paths use source-sized bounds.

## Findings

### GAPQ3-001 — Any connected client can terminate a native Q3 server with `gc 0 7`, `follownext` or a trailing ESC
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Critical.** The three source faults are real: `game/g_cmds.c:1183` uses `>` so order 7 indexes past the 7-entry `gc_orders` (:1160-1168), and `SanitizeString` steps over the NUL at :163-165. The follow case is not undefined behavior in id: from `spectatorClient == -1` the loop at :772-797 never equals `original`, so with nobody to follow id's server hangs forever. The port's exit replaces a hang there, and replaces survivable reads in the other two. Source review: SRCQ3
- Severity: Critical
- Category: security
- Location: team-arena/commands.ts:503-505, 388, 131, 203-206; src/app/bootstrap/simulation/network-q3.ts:193; src/app/bootstrap/network/q3.ts:121, 174; src/app/bootstrap/network/q3-types.ts:64-67
- Confidence: reproduced (the throws); traced (process exit)
- Evidence: Three of these throws are source undefined behavior turned into `GameCommandError`, reachable from peer text:
  - `gameCommand`: `order > orders.length` admits 7, then `if (text === undefined) throw new GameCommandError("Cmd_GameCommand_f order 7 reads beyond the source order table")`.
  - `followCycle`: `team follow1` sets `spectatorClient = -1`. `follownext` with nobody playing reaches `throw new GameCommandError("Cmd_FollowCycle_f cannot terminate from an automatic-follow sentinel without an active player")`.
  - `sanitize`: `if (index + 1 === input.length) throw new GameCommandError("SanitizeString ESC pair crosses the terminating NUL")`. `follow "a\x1b"` triggers it, and `tokenizeCommand` keeps the ESC inside quotes (shown in repro2).
  - `cleanClientName` does not strip control bytes, so a peer named `b\x1b` makes every other player's `follow <name>` throw too, because `clientNumberFromString` sanitizes each netname.
  The route is `command` -> `q3GameCallback(() => host.command(...))` -> `nativeSource().playerCommand` -> `commands.dispatch`, with no catch on the way. `q3GameCallback` wraps the error as `Q3GameCallbackError`. `pollPackets` rethrows it (`if (error instanceof Q3GameCallbackError) throw error`), `application.ts:4686` rethrows the cause, and `main.ts:34-35` calls `process.exit(1)`. The flood check only limits command rate. Only the intermission branch (commands.ts:673) diverts these commands. NET's unified-server entry says "I did not find a specific argument that triggers one". These are specific arguments. Native game only: QVM guests use `source.command`.
- Impact: One packet from any admitted peer ends a dedicated or listen server and every other player's session. The server does not need cheats or votes enabled.
- Remediation: Make these three branches return as ordinary bad input, and catch `GameCommandError` at `dispatch` so it prints to the peer. Treat any throw from peer text as a drop of that peer, not a fatal callback.

### GAPQ3-002 — `callvote` accepts newlines, so a passed vote runs arbitrary server console commands
- **Verification (VERIFY-Q): confirmed. Final severity: Critical.** id 1.32 filters only `;` (`game/g_cmds.c:1242`). The newline claim holds: `MSG_ReadString` rewrites only `%` and values above 127 (`qcommon/msg.c:440-444`), and a quoted token copies anything but `"` (`qcommon/cmd.c:498-502`). A passed vote is appended raw (`game/g_main.c:1515`), and a pass needs `voteYes > numVotingClients/2` (:1524). So this is inherited from id, not a port regression. The ioquake3 fix is unverifiable here. Source review: SRCQ3
- Severity: Critical
- Category: security
- Location: team-arena/commands.ts:517, 538-546, 525; team-arena/match.ts:428, 431-432; base/settings.ts:37
- Confidence: reproduced (vote string); traced (execution)
- Evidence: The only filter is `if (command.includes(";") || parameter.includes(";"))`. `tokenizeCommand('callvote map "q3dm1\nrcon_password x\nquit"', 'q3')` returns the newline intact. `dispatch(0, ["callvote","map","q3dm1\nquit"])` produced `vote.string "map q3dm1\nquit"`. The quoted form also breaks out: `g_doWarmup "1"\nquit\n//"`. On pass, match.ts:428 runs `this.host.appendConsoleCommand(`${vote.string}\n`)`, and commands.ts:525 does the same for a pending vote. As I recall, ioquake3 fixed this by rejecting `\n` and `\r` as well as `;`. `g_allowVote` defaults to 1. A vote passes when `vote.yes > trunc(numVotingClients / 2)`. The caller's own yes counts and bots are not voters, so a lone human on a bot-filled server passes it alone, and two connections pass it on a server with up to three voters.
- Impact: A peer can run any server console command: `quit`, `set rconPassword ...`, `exec`, `map`. The precondition is winning the vote, which is trivial on empty or bot-filled public servers. The console-command operation is emitted at simulation/q3/host.ts:58. I did not run the command through a live server buffer.
- Remediation: Reject `\n`, `\r` and `"` in both vote arguments before building `vote.string`.

### GAPQ3-003 — Any team with more than 8 members exits every TypeScript cgame client on that team
- **Verification (VERIFY-Q): confirmed. Final severity: High.** `TEAM_MAXOVERLAY` is 32 (`game/bg_public.h:557`), `sortedTeamPlayers` has that size (`cgame/cg_draw.c:38`), `CG_ParseTeamInfo` has no bound (`cgame/cg_servercmds.c:120-125`), the server sends up to 32 (`game/g_team.c:1081`), and drawing clamps to 8 (`cgame/cg_draw.c:868`). The port's limit of 8 at the parse step has no source counterpart. Source review: SRCQ3
- Severity: High
- Category: bug
- Location: presentation/server-commands.ts:241-242; presentation/state.ts:159; team-arena/team.ts:436-460; presentation/hud-corners.ts:244
- Confidence: reproduced
- Evidence: `if (count > 8) throw new RangeError("Team overlay exceeds TEAM_MAXOVERLAY")`. The source constant is 32. This repository's own server sends up to 32 (`clients.length < 32`, `count < 32`, team.ts:438, 447), and the consumers clamp to 8 (`Math.min(this.state.numSortedTeamPlayers, MAX_TEAM_OVERLAY_PLAYERS)`), which only makes sense if larger counts arrive. `sortedTeamPlayers` was also sized to 8. config.ts:365-366 forces `teamoverlay` to 1, faithful to the source's "E3 HACK". team-arena forces `teamInfo` on. Repro: `tinfo 8` succeeds; `tinfo 9` throws `RangeError`; the next command rethrows it because `queue` disposes the runtime and poisons `pending` (server-commands.ts:160-164).
- Impact: A team game with 9 or more on one team, including bots, ends the process about one second after the ninth player joins. This covers local games with `addbot` and ordinary public servers. The message arrives in `executeNewServerCommands` inside `processSnapshots`, and nothing catches it.
- Remediation: Size `sortedTeamPlayers` to 32 and throw only above 32. Validate the client index in the loop at line 245 while there.

### GAPQ3-004 — Any IP ban makes every bot connection throw
- **Verification (VERIFY-Q): confirmed. Final severity: High.** `ClientConnect` filters `ip` for every client including bots (`game/g_client.c:918-919`). `""` skips the loop, so `in` reads uninitialized `m[4]` (`game/g_svcmds.c:181,186,197`), and only real connections receive an `ip` key (`server/sv_client.c:292,317`). The source reads indeterminate bytes and continues. Source review: SRCQ3
- Severity: High
- Category: bug
- Location: team-arena/server-commands.ts:154-172; team-arena/client-admission.ts:273-274
- Confidence: reproduced (the throw); traced (admission call)
- Evidence: `ClientConnect` calls `filterPacket(clientInfoValue(userinfo, "ip"))` for bots too, and bots have no `ip`. With `from === ""`, `initialized` is 0 and `initializedMask` is 0, so the compare passes for every filter and `if ((filter.mask & ~initializedMask) !== 0) throw new RangeError("IP filter reads uninitialized source octets")` fires. The nearby comment says this should matter only to a "matching filter", but with a zero mask every filter matches. Repro: empty list returns false; after `addip 1.2.3.4`, `filterPacket("")` throws. The source reads an indeterminate word and carries on.
- Impact: A server with `g_banIPs` set or any `addip` entry cannot add a bot. Whether the error ends the process depends on the caller. `addbot` from the console is printed by the application catch, but I expect bots reconnecting during a map change to reach the fatal world-change path. I did not trace that call.
- Remediation: Return `!denyMatches` when no address was supplied, or skip the filter for bots.

### GAPQ3-005 — Two ring buffers keep a source increment without modulo, and overflow becomes a fatal bounds error
- **Verification (VERIFY-S): confirmed. Final severity: High.** VERIFY-G's ruling stands. The source review found the missing wrap is inherited from id's cgame, but here it becomes a fatal bounds error that peers can trigger, where the original read out of range without exiting.
- Severity: Medium
- Category: robustness
- Location: presentation/server-commands.ts:493, 513; presentation/frame-audio.ts:21, 27-28; presentation/client.ts:345; team-arena/commands.ts:457-460
- Confidence: reproduced
- Evidence: `state.voiceChatBufferOut++` and `state.soundBufferOut++` omit the wrap, as the C does. C reads one slot past the array. TypeScript throws: `at(this.voices, 32)` gave `Source array index 32 outside 32` after 70 undrained `vchat` commands, leaving out=32, in=6. 39 buffered sounds gave `CG_PlayBufferedSounds: sound buffer index 20 outside 0..19`. The voice ring drains once per second, and `vsay` is flood-limited per client to about one per second, so two remote clients out-produce the drain and reach it in about a minute. A voice chat with no valid sounds stores `snd: null`, which stalls the drain (`.snd !== null`, line 513) and makes this faster.
- Impact: On Team Arena, any two peers can end every TypeScript client on the server. The buffered-sound ring needs a sustained burst of announcer events, which is unlikely except from a hostile server or mod.
- Remediation: Apply `% 32` and `% 20` at those increments.

### GAPQ3-006 — The weapon registration chain stays rejected after one failure, and a failed weapon can never become ready
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** `CG_Missile` only indexes `cg_weapons` (`cgame/cg_ents.c:412-415`), and `CG_MissileHitWall` has a tolerant default case (`cgame/cg_weapons.c:1752` onward). But `CG_RegisterWeapon` does call `CG_Error("Couldn't find weapon")` (`cgame/cg_weapons.c:633`), so an unknown weapon reaching it also ends the session in id through ERR_DROP. The difference is disconnect versus process exit, not tolerance versus failure, on that path. Source review: SRCQ3
- Severity: Medium
- Category: robustness
- Location: presentation/weapons.ts:511, 529-535, 552-554, 581; presentation/frame.ts:111, 113, 86, 115; presentation/events.ts:286-288; presentation/entities.ts:296-301
- Confidence: reproduced
- Evidence: `this.registration = this.registration.then(() => this.registerWeaponNow(number))` has no rejection arm. Repro: `registerWeapon(200)` rejects `RangeError: Invalid weapon media index 200`; then `registerWeapon(2)` and `registerItemVisuals(1)` reject with that same error, without trying. `registeredWeapons.add(number)` happens before the awaits and `readyWeapons.add` after them, so a partial failure leaves the record half filled, unretryable, and throwing in `requireWeapon` forever.
  - This is not a floating promise today. Each caller gets the promise it extended and awaits it, and each earlier promise has the next `.then` as a handler, so no unhandled rejection arises.
  - The first rejection already reaches the run loop, because frame.ts:115 and events.ts:288 await with no catch. So poisoning is currently masked by process exit, and it becomes the real behavior as soon as APP-001 or a drop-to-menu handler is added.
  - The triggers are remote and new. frame.ts:111 adds `current.weapon` for ET_PLAYER with no clamp (byte value from the snapshot). Lines 86 and 113 use `> count`, faithful to `CG_Missile`, but C then only indexes `cg_weapons[11]`, while the port calls `registerWeapon(11)`, which throws `Couldn't find weapon 11` (reproduced on baseq3). events.ts:286 does the same for `es.weapon` on EV_MISSILE_*, where source `CG_MissileHitWall` has a tolerant default case and registers nothing.
- Impact: Any server can end a client with one out-of-range weapon byte. A corrupt downloaded weapon model does the same, if the model loader throws on it, which I did not check.
- Remediation: Chain with a guard (`.catch(() => {}).then(...)`) so one failure stays with its caller, move `registeredWeapons.add` to success, and clamp weapon numbers at frame.ts and events.ts before registering.

### GAPQ3-007 — `particles.clear(resources)` in `close` is floating, and it re-registers shaders after the owner is closed
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** No source claim; port lifecycle only. Not re-tested. Source review: SRCQ3
- Severity: Low
- Category: robustness
- Location: presentation/client.ts:378, 206; src/render/scene/particles/q3-system.ts:126-133; presentation/resources.ts:141-145; src/main.ts:34; src/app/bootstrap/q3-client.ts:594-596; src/app/bootstrap/selected-q3-presentation.ts:172
- Confidence: reproduced (the unhandled rejection); plausible (a production trigger)
- Evidence: `clear` is `async`. `close` calls it without await or catch, while the map_restart path awaits it (server-commands.ts:336). The first segment runs synchronously, so 23 `registerShader` calls continue after `close` has returned and the caller has closed `media` and `sceneRenderer`. A stub whose second `registerShader` rejects produced `UNHANDLED: renderer retired`, and in production `main.ts:34` turns that into `process.exit(1)`. With pak6 present every name is cached and no host call happens (`pictures.get(key)`; explode1 is in baseq3/pak6.pk3, which I checked). Null results are not cached (`if (picture === null) return null`), so an install or mod without those frames calls `host.shader` after close. `provider.shaders` normally outlives the client, so I did not find a production rejection. The clear also rebuilds 1,024 particle records on the way out, to be discarded. Separately, `close` is a sequence with no try, so `frames.close()` throwing mid-frame skips all later cleanup.
- Impact: Normally wasted work on each close. If the provider is retired or a shader load fails during a world change, the process exits on a detached rejection that has no owner.
- Remediation: Use `particles.resetRound()` in `close`, which needs no shader work, and run the cleanup steps in a try/finally list like selected-q3-presentation.ts:172.

### GAPQ3-008 — One failed console command permanently closes the cgame console and wipes all player info
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** The statement "C reads past the array" is wrong for index 8. The source array has 32 slots (`game/bg_public.h:557`, `cgame/cg_draw.c:38`), and `CG_NextOrder_f` reads inside it (`cgame/cg_consolecmds.c:257`). The throw exists only because the port sized its tuple to 8 (`content/q3/presentation/state.ts:159`), the same root as GAPQ3-003. Source review: SRCQ3
- Severity: Medium
- Category: robustness
- Location: presentation/console.ts:93-95, 108, 133; presentation/mission-hud.ts:378-382; src/app/bootstrap/q3-client.ts:505
- Confidence: traced
- Evidence: `.catch((error: unknown) => { this.dispose(); throw error; })`, and `dispose` does `this.closed = true; ... this.host.clients.reset()`. After that, `handles()` throws `Cgame console runtime is closed`, and q3-client.ts:505 calls it for command lookup. Ordinary triggers:
  - `nextOrder`: `slot(this.state.sortedTeamPlayers, cg_currentSelectedPlayer)`. With 8 teammates and "Everyone" selected, the value is 8, so `Console source array index 8 outside 8`. C reads past the array.
  - `testmodel` on a model whose loader throws.
  - A non-byte character in any command (`sourceBytes`, line 73) is rejected earlier and does not dispose.
- Impact: A rejected rich command kills all later console commands, and `clients.reset()` clears `infoValid` on every player, so they stop drawing, for the rest of the map if the process survives. A single bad command should only print.
- Remediation: Print and continue for command errors. Keep dispose for lifecycle teardown only.

### GAPQ3-009 — Server-controlled values throw where the source tolerates them, and `CommonError("drop")` has no handler
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** Opened and confirmed as tolerant in id: gametype (`cgame/cg_servercmds.c:149`), flag status `s[0]-'0'` (:210), team `atoi` (`cgame/cg_players.c:925`), skull trail indexed with no guard (`cgame/cg_players.c:1768`), and ERR_DROP handling (`client/cl_cgame.c:422`). Not opened: the `Invalid view weapon team` and HUD `curWeapon` originals. Source review: SRCQ3
- Severity: Medium
- Category: robustness
- Location: presentation/server-commands.ts:121-127, 208, 245; presentation/players.ts:153 (`at`), 316, 700; presentation/weapons.ts:447; presentation/hud-corners.ts:289; presentation/hud.ts:133; src/core/common-error.ts:6
- Confidence: traced
- Evidence: Added rejections with no source counterpart, each from configstrings or snapshots:
  - `validGameType` throws for `g_gametype` outside the enum. A modded server with a custom gametype ends the client in `parseServerInfo` during `CG_Init` or on any serverinfo update.
  - `throw new RangeError("CTF flag status leaves source bytes uninitialized")` when CS_FLAGSTATUS is empty in CTF, reachable by a CTF-gametype mod that never sets it.
  - `throw new RangeError(`Invalid player team ${team}`)` for `t` outside 0-3 in CS_PLAYERS.
  - `throw new RangeError("Invalid view weapon team")` from PERS_TEAM.
  - `throw new RangeError(`No skull trail for entity ...`)` for a corpse with tokens.
  - `registry.weapon(client.curWeapon)` from `tinfo`, in two HUD paths, where C reads a neighbor and draws the defer icon.
  `grep` shows `instanceof CommonError` only in bots and in `base/game/spawn.ts`, and no `.code === "drop"` branch exists. The many faithful `CommonError("drop", ...)` sites in this scope therefore exit the process where the source returns to the menu. This supplies specific triggers for APP-001.
- Impact: Connecting to a mod server, or to any hostile server, ends the client instead of disconnecting it.
- Remediation: Clamp or default these values as the source does. Route `CommonError` with code `drop` to a disconnect at the client session boundary.

### GAPQ3-010 — Supplemental scene presentations throw on map_restart, music and shader-state commands
- **Verification (VERIFY-S): refuted. Final severity: Info.** VERIFY-G refuted the trigger. The source review states it did not re-test this and it has no source claim.
- Severity: Medium
- Category: bug
- Location: presentation/client.ts:130-133, 204-205, 320, 362-364; presentation/server-commands.ts:280, 291, 339; src/app/bootstrap/selected-q3-presentation.ts:110-122, 165
- Confidence: plausible
- Evidence: `CG_Init` guards these for scenes (`if (!sceneOnly) await serverCommands.startMusic()`, and the same for `shaderStateChanged`). After init the same hosts are unguarded: `startBackgroundTrack: (intro, loop) => { clientOptions(); ...}` and `remapShader: ... { clientOptions(); ...}` throw `Supplemental cgame scene cannot take over primary input, UI or movement`. `configModified` calls them for CS_MUSIC and CS_SHADERSTATE, and `mapRestart` calls `startMusic`. A scene session forwards `getServerCommand` from its transport (selected-q3-presentation.ts:122). The match sends `map_restart 0` at warmup end through the console, and that broadcast would reach `dispatch`. selected-q3-presentation.ts:165 closes the presentation and rethrows. I did not confirm that the source transport emits these commands in composed play. Separately, client.ts:320 runs `addPlayerWeapon` only when `primary !== null`, while line 330 runs `players.player` for scenes, so players in a supplemental scene draw with no weapon.
- Impact: A composed world with a Q3 source would end at the first map restart or shader remap, if those commands flow through this transport.
- Remediation: Make these three hosts no-ops in scene scope. Check whether the weapon omission is intended, since no comment says so.

### GAPQ3-011 — `newClientInfo` load omits the source's reset of existing player entities
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** `CG_LoadClientInfo` ends with the reset loop (`cgame/cg_players.c:726-734`). Source review: SRCQ3
- Severity: Low
- Category: bug
- Location: presentation/players.ts:629-662, 742-746
- Confidence: traced
- Evidence: `CG_LoadClientInfo` ends by calling `CG_ResetPlayerEntity` on all entities of that client ("they might have erroneous pointers from the old clientinfo"). The port does this only in `loadDeferredPlayers` (lines 743-746). `load` and `newClientInfo` do not, and no caller in server-commands.ts:306 does. The shared animation cells avoid dangling references (`setAnimations` copies by value), so the remaining effect is stale `frame`, `oldFrame` and timing until the next animation change.
- Impact: After a mid-game model change, the player can draw for a moment with frames from the old model's range, including past the new model's frame count. I did not check how the renderer handles that.
- Remediation: Move the reset loop into `load` as in the source, using the caller's slot index.

### GAPQ3-012 — Hot-path allocation in prediction traces and per-entity settings
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** The source calls `trap_CM_TempBoxModel` per solid (`cgame/cg_predict.c:119`), and `CM_TempBoxModel` (`qcommon/cm_load.c:798`) works on the static `box_model` and `box_brush` (`qcommon/cm_load.c:67,69`). So id allocates nothing per trace, as the finding says. Source review: SRCQ3
- Severity: Low
- Category: performance
- Location: presentation/prediction.ts:99, 101, 106-109; src/world/collision/q3/model.ts:353-355; presentation/client.ts:283-288, 321-323; presentation/players.ts:407; presentation/frame.ts:106-115
- Confidence: plausible
- Evidence: Each `trace` spreads the world result, and `createBoxModel(...)` constructs a new `TemporaryCollisionModel` per solid entity per trace, where C reuses one static temp box. Pmove traces several times per command for up to 63 commands per frame, against every solid. `settings()` closures build objects with about 10 cvar map lookups per call, once per `player()`. Each frame also builds a Set and awaits `registerWeapon` per required weapon, one promise hop per weapon, though all are no-ops after the first time. I did not measure this. The soak logs in the scratchpad are not specific to it.
- Impact: Garbage collection pressure scales as commands × traces × players in busy games at low frame rates or high latency.
- Remediation: Reuse one box model with mutable bounds, as the source does. Skip the registry call when `readyWeapons` already holds the weapon.

### GAPQ3-013 — Peer model names cause full file reads and unbounded per-map registries
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Low.** `CG_FileExists` only opens: `trap_FS_FOpenFile( filename, 0, FS_READ )` and tests the length (`cgame/cg_players.c:297-305`). The limit exists (`MAX_MOD_KNOWN` 1024, `renderer/tr_local.h:757`), but "stop this with a drop" is wrong at that site: the allocator returns NULL (`renderer/tr_model.c:57-58`). I did not read its caller. Source review: SRCQ3
- Severity: Low
- Category: performance
- Location: presentation/players.ts:490-495, 617-621, 654-658; presentation/resources.ts:124, 133; presentation/audio.ts:38, 46
- Confidence: traced
- Evidence: `exists` does `await this.host.assets.read(path)` to test for a file, including TGA icons, where C only opens it. Up to 8 candidates are tried per part. Failed lookups are stored: `this.modelNames.set(path, model)` stores defaults, `this.skins.set(path, skin)`, and the sound bank's `requests` map stores null sounds. A peer that changes `model` once a second adds up to about 30 entries on every client for the life of the presentation, with no cap. C's `MAX_MOD_KNOWN` would eventually stop this with a drop. Entries are small and are released when the presentation is replaced at map change.
- Impact: Small growth, plus a repeated load hitch on all clients that one peer can force. `cg_deferPlayers` reduces this only when another client already matches.
- Remediation: Use `assets.has` plus length for existence checks. Cap or skip caching of failed lookups for peer-supplied names.

### GAPQ3-014 — The riskiest peer-facing rules have no direct tests
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** No source claim; test gap only. Source review: SRCQ3
- Severity: Low
- Category: test-gap
- Location: tests/ (grep for `callvote`, `tinfo`, `"gc"` finds none of these Q3 paths; hits are in unrelated QW, cvar and Q2 tests, and tests/network/q3/network.test.ts matched only the generic file search)
- Confidence: traced
- Evidence: `grep -rn callvote tests` and `grep -rn tinfo tests` returned only unrelated matches in the first results. I did not read `tests/network/q3/network.test.ts`, which matched the combined search, so a `gc` or `tinfo` case there is possible. Each of GAPQ3-001 to 005 reproduces in a short stub-host script, so regression coverage would be cheap.
- Impact: These defects were invisible to the 97K-line suite.
- Remediation: Add peer-input tests for `GameCommandRuntime.dispatch`, `ClientServerCommandRuntime` `tinfo` at 32, and `filterPacket("")` with a ban.

## Supplements
- Supplements GAPSIM-011: the spoofed `ip=localhost` from a later `userinfo` also sets `client.pers.localClient = true` (client-admission.ts:234), and I would expect it to reach the ban and password checks (client-admission.ts:273-277) if that userinfo is reused on map-change reconnect (network-q3.ts:96-98). I did not trace which userinfo that reconnect receives.
- Supplements NET's unified-server and q3.ts callback entry ("I did not find a specific argument that triggers one"): GAPQ3-001 gives three.
