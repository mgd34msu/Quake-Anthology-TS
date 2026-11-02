# GAPQ12 — Q1/Q2 content skipped by round 1: mission packs, rerelease, players, multiplayer, addons, composition

All paths are relative to `src/content/` unless they start with `src/`. HEAD fcdc8af5.

No QuakeC or game C source is in the repository or in `qfiles`. Source comparisons come from my memory of rogue, xatrix, rerelease, hipnotic and rogue QC. I have no usable memory of LMCTF 6.0 or MG1/MG3 QC, so findings in those mods rest on the code alone, and each one says so.

## Coverage
**Read in full, line by line (about 10,900 lines):**
- q2/missionpacks (3,391): damage, doppleganger, index, items, players, random-items, spheres, types, entities/{index,movers,rogue,types,xatrix}, modes/{deathball,tag,index}, projectiles/{common,index,mines,bolts,nuke,trap}, weapons/{definitions,player}, monsters/{boss5,stalker,state,turret,types}
- q2/foundation/weapons/player.ts (768)
- q2/rerelease (1,541): index, players, entities, triggers, campaign, checkpoint, goals
- q2/base/player (1,010): commands, index
- q2/multiplayer (1,707): ctf/{index,match,native-grapple-hooks,presentation,techs,types}, lmctf/{admin,flags,grapple,index,match,presentation,runes,runtime,spawns,types,vote,weapons}
- composition (979): q1/{types,clients,commands,give,index}, q2/{index,match,match-selection,save,types}, q3-q2-supply
- q1/missionpacks (1,344): hipnotic-weapons, rogue-weapons, player, arsenal, commands, monsters/{armagon,charm}, world/{hipnotic-hazards,hipnotic-misc}
- q1/addons (183): commands, items/commands

**Sampled:**
- q2/foundation/items.ts lines 1-120 and 885-933; q2/foundation/movers.ts lines 20-119 and 455-520. These fill most of what CONTENT2 left unsampled (items line 348-349 is still unread). I did not re-read the rest of either file.
- q1/addons/triggers.ts lines 1-80 of 253.
- generic-frame.ts lines 1-60, to establish when ammunition is checked.
- Outside scope, only to trace a finding: network/remote.ts, presentation-scene.ts, assets.ts, network-q1.ts, network-unified.ts, unified-server.ts, runtime.ts playerCommand.

**Could not reach (not read; no claim either way, about 19,000 lines of logic):**
- q2/missionpacks/monsters: carrier, chick-heat, combat, dabeam, fixbot, flyer, gekk, gladb, hints, hover, index, medic, power-armor, rogue-arsenal, rogue-common, rogue-gunner, rogue-infantry, rogue-jumpers, rogue-soldier, rogue-variants, soldierh, spawn, widow, widow/*, widow2, xatrix-variants (about 2,900 lines). Hints and the medic are the riskiest of these.
- q2/rerelease/monsters/* logic including base-variants (about 3,000); environment, spawns, view, q64, killbox, obituary, types, lights, fog, world-text, debug-shapes.
- q2/base/player: character, environment, view, spawns (round 1 read lines 1-50), landmarks, obituary, types, checkpoint, resources.
- q2/multiplayer: ctf/{flags,grapple,checkpoint} and horde; round 1 read flags and horde.
- q1/missionpacks: items, grapple, selection, runtime, travel, obituaries, presentation, backpacks, the rest of monsters/* and world/*.
- q1/addons: almost everything else (brushes, campaign, effects, field-triggers, lights, rope, the rest of triggers, ctf/*, horde/*, items/{pickups,upgrades,weapons,lavasuit,common}, monsters/*). Round 1 read part of this.
- composition: expansion-supply family, q1-*-supply, q2-q1, q2-q3, q3-q1 and q1/runtime. Round 1 read most of them.
- Frame tables: skipped as instructed.

**Comparison limits:** rogue and xatrix code that I compared closely matched my memory of the C almost everywhere. The rerelease comparison is weaker, and I could not check rerelease constants one by one.

## Strengths
- The Rogue and Xatrix ports track the source closely, including its oddities. I compared g_sphere.c, Prox and Tesla, T_RadiusNukeDamage, Nuke_Think and Nuke_Quake, tracker and blaster2, plat2, dm_tag.c, DBall_ChangeKnockback, Weapon_ChainFist, Use_Doppleganger and the rotating_light and misc_viper_missile spawns. Constants and damage flags agree, and the source oddities are kept and commented.
- Tesla and prox trigger fields follow a moving mine, because actor-execution.ts:205 moves the teamchain. I suspected this was missing and refuted it.
- misc_crashviper and misc_transport are correct through `spawnTrain`'s ship branch; this suspicion was also refuted.
- All mission-pack callbacks register in `Q2ProductRuntime.registerCallbacks` (composition/q2/index.ts:250) and again before restore (save.ts:83), so saves do not depend on an item having been fired first.
- LMCTF `capture()` strips both passwords (lmctf/runtime.ts:59).
- `ctf-settings` validates its values before they reach the throwing `configure` (ctf/index.ts:213-229).
- Hand grenades reserve ammunition at the start of the throw (weapons/player.ts:267), and BFG rechecks cells at the shot (player.ts:630). The same care is missing in the case in GAPQ12-002.

## Findings

### GAPQ12-001 — Any player whose Q2 skin names a model this client lacks ends the client process
- **Verification (VERIFY-Q): confirmed. Final severity: High.** client/cl_parse.c:430-437 falls back to players/male when RegisterModel fails, and :445-461 falls back on skin. The original cannot exit here. Source review: SRCQ2
- Severity: High
- Category: robustness
- Location: src/app/bootstrap/network/remote.ts:289-292; src/app/bootstrap/presentation-scene.ts:196; src/app/bootstrap/assets.ts:325; q2/base/player/index.ts:255
- Confidence: traced
- Evidence: `path = \`players/${model}/tris.md2\`` (remote.ts:291) takes `model` straight from the other player's configstring, with no check that the file exists and no fallback. presentation-scene.ts:196 runs `await this.assets.model(source.content, source.path)` unguarded, and assets.ts:325 throws `Model is absent from selected content`. The local simulation has the same route: index.ts:255 sets `entity.model = ... \`players/${state.skin.split("/")[0] || "male"}/tris.md2\`` from unfiltered userinfo. GAPAPP-005 covers the same throw for a map's or mod's models. This is a separate trigger, and it comes from another player.
- Impact: Custom player models are ordinary on public Q2 servers. A client that does not have the model, with downloads off or failed, exits when that player enters its view. One peer can also do it deliberately: `skin nosuch/x` takes down every client that sees them and, on a listen server, the host after that player's next spawn. Original Q2 falls back to male/grunt.
- Remediation: Resolve Q2 player models through a per-path existence check and fall back to `players/male`. GAPAPP-005's general fix would also cover this.

### GAPQ12-002 — Dropping ammunition during a Phalanx shot or a held Tesla terminates the server
- **Verification (VERIFY-Q): confirmed. Final severity: High.** original/xatrix/p_weapon.c:1636-1690 and original/rogue/p_weapon.c:615-668 decrement with no check. original/rogue/g_items.c:807-826 guards only `AMMO_GRENADES`. The original goes negative and never faults. Source review: SRCQ2
- Severity: High
- Category: robustness
- Location: q2/foundation/weapons/player.ts:263; q2/missionpacks/weapons/player.ts:118,129,161; q2/base/player/commands.ts:53-58
- Confidence: reproduced for the throw (the repro script removes the ammunition with the same `inventory.consume` call that `drop` makes); the path from the command to that call is traced
- Evidence: `if (!game.host.inventory.consume(self.actor, definition.ammo, count)) throw new Error("Q2 weapon fired without its admitted ammunition");`. C decremented the counter and could go negative, so it never faulted.
  - Phalanx: ammunition is checked on entering the firing phase (frame 6) and consumed only on frame 8 (`if (second) { weapons.consume(context); ...`).
  - Tesla: the throw checks `ammo > 0` and reserves nothing, unlike hand grenades, then can hold for as long as attack is down. It consumes on release.
  - `drop` protects only one case: `const grenade = ... item.id === "q2:ammo_grenades"`. `canDrop` passes for Tesla whenever count is at least 2 (the repro printed `canDrop true`), and `quantity = Math.min(item.quantity, count)` (5 for Tesla) can then empty the stack. Mag Slugs have no weapon definition with that item, so they get no check at all.
  - Repro output, both from the mission-pack test fixture: `PHALANX: Error: Q2 weapon fired without its admitted ammunition` and `TESLA: Error: Q2 weapon fired without its admitted ammunition`. Script: gapq12/t/repro.test.ts in the scratchpad.
- Impact: A deathmatch or coop client on Xatrix, Rogue or rerelease holds attack with Tesla and types `drop tesla`, or fires the Phalanx and drops Mag Slugs within 0.2 s. The exception reaches the run loop (APP-001) and ends the server. It needs no cheats and works with default dmflags unless weapons-stay (4) is set, which blocks only the Tesla route via `canDrop`.
- Remediation: Do not throw on a shortfall in `consume`. Abort the shot or clamp, as the BFG path already does (player.ts:630), or give Tesla and Phalanx the hand grenade's reservation.

### GAPQ12-003 — `give` with bad arguments from a coop peer terminates a unified Q1 host
- **Verification (VERIFY-Q): confirmed. Final severity: High.** WQ host_cmd.c:1528-1534 gates only on deathmatch, then switches on `t[0]`; empty or unknown arguments do nothing. The port throws. Source review: SRCQ1
- Severity: High
- Category: robustness
- Location: composition/q1/give.ts:12,56,76,80; src/app/bootstrap/simulation/runtime.ts:7691-7695; src/app/bootstrap/simulation/network-unified.ts:230; src/app/bootstrap/network/unified-server.ts:129,163
- Confidence: traced
- Evidence: `if (input === undefined) throw new Error("Usage: give <all|weapons|ammo|health|armor|keys|item> [amount]");`. Unknown items also throw at give.ts:76 and :80. The runtime gate only checks deathmatch: `if (source.game.options.deathmatch !== 0 && (...)) return ...; return giveQ1(source.composition, actor, args);`, so coop reaches it, which matches Host_Give_f. Unified wraps the handler (`hostCall(() => this.host.command(...))`) and rethrows `UnifiedHostFailure` as the cause. SIM-020 recorded this path as having no known trigger when cheats are disabled; this is one.
- Impact: Any admitted coop peer on a unified Q1 host sends `give` with no arguments and the host exits. The NetQuake route catches the same exception and only kicks that peer (network/q1.ts:155), so its impact is limited to the sender.
- Remediation: Print usage and unknown-item text to the sender instead of throwing, and treat command errors as a peer fault (SIM-020's remedy).

### GAPQ12-004 — `ctf-menu` runs menu actions whether or not the menu offers them
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** original/ctf/g_ctf.c:3092 CTFJoinTeam is reached only through menu entries, and original/ctf/g_cmds.c:508-511 opens the join menu only for CTF_NOTEAM. No client command names a menu action. Source review: SRCQ2
- Severity: Medium
- Category: bug
- Location: q2/multiplayer/ctf/index.ts:203-211,258,261; ctf/presentation.ts:98-100
- Confidence: traced
- Evidence: Any listed action goes straight to `menuAction` (`case "join-red": ... this.menuAction(entity, game, action); break;`), and `case "join-red": this.join(entity, game, 1)` has no checks of its own. `teamCommand` enforces "Can't change teams in a match" and the suicide on a team change. The join menu is only built for players with no team, or on request, and it hides "Request match" unless `competition !== 0 && phase === "none"`. In C the menu was the only route into CTFJoinTeam, and only team-less players could open it through `inven`. The `ctf-menu` command is new here and is reachable from any client.
- Impact: A playing or dead client sends `ctf-menu join-red` and respawns immediately at full health, with no death or score penalty and no respawn delay. Team switching during a match works when `matchLock` is off. `ctf-menu match` starts an election when competition is 0 or a match is running, and if it passes, `setup` resets every player.
- Remediation: Validate in `menuAction`: join only from team 0, and apply the same competition and phase condition the menu uses. Better still, track the menu entries last offered to each player.

### GAPQ12-005 — Any LMCTF client can pause and unpause the server
- **Verification (VERIFY-G): confirmed. Final severity: Medium.** lmctf/admin.ts:9-12 checks the referee flag only for pause_match; runtime.ts:154-155 runs admin commands before the pause filter; match.ts togglePause flips state and autoLock. Upstream LMCTF behavior remains unknown.
- Severity: Medium
- Category: security
- Location: q2/multiplayer/lmctf/admin.ts:9-12; lmctf/runtime.ts:150,154-155; lmctf/match.ts:14-19
- Confidence: traced; I could not compare this with LMCTF source
- Evidence: `if (name === "pausematch" || name === "unpausematch" || name === "pause_match") { if (name !== "pause_match" || (state.extraFlags & 2) !== 0) match.togglePause(game); return true; }`. Only the `pause_match` spelling checks the referee flag. `lmctfAdminCommand` runs before the pause filter, so a paused non-referee can still toggle. When paused, `canMove` is false for everyone except referees. No test mentions these commands.
- Impact: One client can freeze an LMCTF server for everyone, repeatedly. With `autoLock` it also flips the team lock. If upstream allowed this, it is still a griefing hole, but then it is a faithful one.
- Remediation: Apply the referee check to all three spellings, or confirm from LMCTF source that a client must be able to do this.

### GAPQ12-006 — MG1 and MG3 developer impulses are not gated in multiplayer
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Low.** Source-faithful, not a port omission. quakec_mg3/weapons.qc:1571-1739 (100-105, 111-122, 219, 222, 223, 227, 228) and quakec_mg1/weapons.qc:1457 (219) are ungated in ImpulseCommands; the cheats_allowed test exists only in the cheat command (mg3 :1230, mg1 :1179). Remains a hardening option on a public server. Source review: SRCQ1
- Severity: Medium
- Category: security
- Location: q1/addons/commands.ts:47-79; q1/addons/items/commands.ts:68-90; composition/q1/runtime.ts:162-163
- Confidence: traced; I could not compare this with MG1 or MG3 QC
- Evidence: `if (impulse === 219) { omnicideQ1Addons(context, actor); return true; }` has no check. Neither do `case 222: game.travel(game.mapName, actor)`, `case 223` (sets skill 3 and the bloody-nightmare flag), 101-105 (campaign rune flags), 116-121, 100, 111-115 (upgrades), 118 (Mjolnir), 122 (infinite ammo) and 227-228. Other cheats in the same files are gated: `(deathmatch || coop) && sv_cheats === 0` in `noKeys` and in impulses 9 and 99. The caller at runtime.ts:162-163 adds no gate.
- Impact: Any coop peer on MG1 or MG3 can remove every monster and fire their death targets, restart the level, change skill for the session, set rune flags or give themselves infinite ammunition. With omnicide this reaches into DM as well because the check does not test mode.
- Remediation: Put these impulses behind the same `cheats_allowed` test as `noKeys`, after checking the QC for which ones are really open.

### GAPQ12-007 — Mission-pack player state costs a full entity copy per player tick and is never removed
- **Verification (VERIFY-G): confirmed. Final severity: Low.** player.ts:50 spreads and finds; :52 creates; no removal found by grep. Measured 15.6 us per spread+find at 1,000 entities, so about 0.25 ms per tick for 8 players at two calls each. Growth bounded by the map.
- Severity: Medium
- Category: performance
- Location: q1/missionpacks/player.ts:49-53,78,109,135,145
- Confidence: traced for the scan and the missing removal; the cost is an estimate, not measured
- Evidence: `const existing = [...this.game.entities.values()].find(entity => entity.classname === "missionpack_player_state" && ...)`. `frame` and `afterPhysics` each call it per player per tick, and `afterQuad` calls it on each hit. Grep finds only this one lookup and the `create` beside it, with no removal, so each connection adds one entity for the rest of the map.
- Impact: Every Hipnotic and Rogue session spreads the entity table into a new array twice per tick per player, plus a linear scan. On a map with 1,000 entities this is roughly 16 KB of garbage per tick per player. Reconnecting repeatedly grows the table a little more, and the scan with it.
- Remediation: Keep a `Map<ActorId, Q1Actor>` and remove from it with the existing `onRelease` hook, also removing the entity on disconnect.

### GAPQ12-008 — Classic Xatrix never drops QuadFire on death
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** original/xatrix/p_client.c:438-441 tests DF_QUADFIRE_DROP (q_shared.h:1017, 0x10000) with `quadfire_framenum > framenum + 10`, in classic. composition/q2/index.ts:161-162 gates it on rerelease. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: composition/q2/index.ts:161-162; q2/base/player/index.ts:387-393
- Confidence: traced in the port; the source side is from memory
- Evidence: `quadFireDropUntil: actor => configuration.edition === "rerelease" && (configuration.services.dropQuadFire?.() ?? true) ? ... : 0`. Xatrix TossClientWeapon tests `DF_QUADFIRE_DROP` (0x10000) and drops `item_quadfire` when set. The mission-pack item's `droppedQuadFire` branch (missionpacks/items.ts:225-227) exists to handle that drop, but classic can never produce one.
- Impact: The server option has no effect on classic Xatrix deathmatch.
- Remediation: Return the timer on classic Xatrix when flag 0x10000 is set.

### GAPQ12-009 — Doppleganger spheres keep 30 seconds instead of dropping to 15
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** original/rogue/g_sphere.c:359-363 and :462-465 assign `wait = time + 15` in the doppleganger branch, shortening from 30. spheres.ts:122,130 use Math.max. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: q2/missionpacks/spheres.ts:122,130
- Confidence: traced in the port; the source side is from memory
- Evidence: Both paths use `entity.wait = Math.max(entity.wait, game.host.now() + 15)`. In C, the doppleganger branch assigns `self->wait = level.time + MINIMUM_FLY_TIME` before the shared `if ((wait - time) < MINIMUM_FLY_TIME)`, and the comment there says the timeout is meant to be short. A new sphere's `wait` is now + 30, so the assignment shortens it and `Math.max` does not.
- Impact: A dead doppleganger's hunter or vengeance sphere chases for twice as long.
- Remediation: Assign unconditionally when the doppleganger flag is set.

### GAPQ12-010 — A coop squad respawn copies a second, invisible corpse
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** rerelease/p_client.cpp:3731-3736 copies once and sets resp.spectator; :1626 skips the copy while it is set; :2250 clears it inside PutClientInServer, after respawn's test. The port clears before calling respawn. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: q2/rerelease/players.ts:429-430,447-448,452
- Confidence: traced; the source side is from memory
- Evidence: A player who could not respawn already had `copyToBodyQueue` (line 452). When allowed, `state.spectator = false` runs before `this.respawn(entity, game)`, and `respawn` tests `if (!...state.spectator) this.copyToBodyQueue(...)`. C tests `resp.spectator`, which PutClientInServer only clears later, so C skips the copy.
- Impact: Each such respawn burns one of the eight corpse slots on an invisible copy, and a real corpse disappears early.
- Remediation: Clear the spectator state after `respawn`, or skip the copy in this path.

### GAPQ12-011 — CTF team chat expands `%l` and `%n` without a limit
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Low.** The buffer is 256 bytes, not 1024: original/ctf/g_ctf.c:2462 and rerelease/ctf/g_ctf.cpp:2136. So the original also truncates team chat at 254 bytes where the port keeps 1023. The loop stops only when output fills, so expansion cost is bounded by that limit, tighter than the finding states. Source review: SRCQ2
- Severity: Low
- Category: performance
- Location: q2/multiplayer/ctf/presentation.ts:57-58,82-92
- Confidence: traced; the cost was not measured
- Evidence: `words.replace(/%(.)/g, ...)` calls `this.location` per match, and the `.slice(0, 1023)` runs only after all of them. `location` scans every entity with spreads and flatMap, and traces for each nearby item. C stops expanding when its 1,024-byte output buffer fills, so a location expansion can only run about a hundred times.
- Impact: A long `say_team %l%l%l...` runs hundreds of expansions in one tick. Flood protection limits the rate, not the cost per message.
- Remediation: Stop expanding when the output buffer is full, and cache the location within a message.

### GAPQ12-012 — Asking for an LMCTF vote during a vote wipes all ballots
- **Verification (VERIFY-I): confirmed-with-changes. Final severity: Low.** vote.ts:21-24 clears before the check, but this is inherited: lmctf g_vote.c:40-43 calls Clear_All_Ballots before testing VoteStarted. The port widens reach: in C the skip entry is offered only when no vote is running (g_vote.c:214-218), while runtime.ts:159 accepts `lmctf-vote skip` from any client at any time.
- Severity: Low
- Category: bug
- Location: q2/multiplayer/lmctf/vote.ts:21-24
- Confidence: traced; I could not compare this with LMCTF source
- Evidence: `for (const [, player] of players) player.extraFlags &= ~192;` runs before `else if (this.startedAt !== null) ... "Vote has already been started"`.
- Impact: One client sending `lmctf-vote skip` near the end clears all votes, so the 75% vote fails.
- Remediation: Check for a running vote before clearing.

### GAPQ12-013 — Rogue monster state is kept for dead monsters until the map ends
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** No source claim. Source review: SRCQ2
- Severity: Low
- Category: leak
- Location: q2/missionpacks/monsters/state.ts:37,42-49
- Confidence: traced
- Evidence: `actors` has `set` in `get` and `clear` in `restore`, and nothing removes an entry when an actor is released. `capture` filters by `isLive`, so saves are unaffected. CONTENT2's strength note about `onRelease` does not hold here.
- Impact: Growth scales with Rogue monsters created on one map, including carrier and widow summons. Each entry is small and the map boundary clears it, apart from the known world leak.
- Remediation: Delete on actor release.

### GAPQ12-014 — The DeathBall stays drawn during its two-second reset
- **Verification (VERIFY-Q): refuted. Final severity: Info.** original/rogue/dm_ball.c:439 has `// self->s.modelindex = 0;` commented out in DBall_BallDie, and the ball stays drawn while non-solid. The port is faithful. The inference that C cleared the model was wrong. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: q2/missionpacks/modes/deathball.ts:132-136,142
- Confidence: plausible; the source side is from memory and I did not run it
- Evidence: `resetBall` makes the ball non-solid and schedules `respawn`, but it does not clear the model or hide the ball. `respawn` sets `entity.model` again, which suggests the C cleared `modelindex` in the die and goal paths.
- Impact: After a goal, a non-solid ball hangs in the goal for two seconds.
- Remediation: Check against dm_ball.c, and clear the model in `resetBall` if the source does.

### GAPQ12-015 — Hipnotic `info_command` runs map text on the local console
- **Verification (VERIFY-Q): confirmed. Final severity: Info.** quakec_hipnotic/hipmisc.qc:219-223 calls `localcmd(self.message)`. Faithful. Source review: SRCQ1
- Severity: Info
- Category: security
- Location: q1/missionpacks/world/hipnotic-misc.ts:72; src/app/bootstrap/application.ts:1500-1503
- Confidence: traced
- Evidence: `game.registerSpawn("info_command", (g, e) => ... g.host.emit({ kind: "server-command", text: e.message }))`, and the application appends that text to its command buffer with no filter. QC's `localcmd` does the same, so this is faithful.
- Impact: A third-party map on the Hipnotic program can run any console command when it loads. Any QuakeC mod has the same power, so this adds no new class of risk for those users.
- Remediation: None needed for parity. An allowlist would be a hardening choice.

## Supplements
- Supplements GAPAPP-005: its absent-model throw has a remote trigger, a player's skin string. See GAPQ12-001.
- Supplements SIM-020: the "no trigger found" note no longer holds; `give` in Q1 coop is a trigger with cheats off. See GAPQ12-003.
- Supplements APP-001: GAPQ12-002 is a further specific client-triggered route to the run loop.
- Supplements CONTENT2-015: `spheres.ownedSphere` (spheres.ts:33) and Tesla's `actors.observations()` scan (mines.ts:239) are further linear scans. The Tesla one runs per mine per frame in classic.
