# VERIFY-I — Round 3 verification of verify-LOW2.txt (82 IDs) at HEAD fcdc8af5

Method: every cited location was opened at HEAD in <scratchpad>/clean. Experiments are in <scratchpad>/low2-exp.
Source comparisons: retail QuakeC disassembled from qfiles progs.dat (`low2-exp/qc.ts`), LMCTF C in ~/Projects/lmctf60-buzzmod, and the sibling C-derived port ~/Projects/quake-2-rerelease-ts (a port, not id's C, so treated as strong rather than absolute evidence). No Q3 game source is on disk, so Q3 source claims rest on recollection and say so.
Timing and RSS figures quoted by findings were not re-measured unless the reason says so.

### GAPAPP-013
Verdict: confirmed
Corrected severity: Low
Reason: demo-recording-commands.ts:68-69 finishes the current recording before DemoRecording.open uses `open(path, "wx")` (demo-recording.ts:58). The same order is at :83-84 and :133-134. abort (demo-recording.ts:109-114) closes without unlinking, so the partial file blocks a retry.

### GAPAPP-014
Verdict: confirmed
Corrected severity: Low
Reason: effects.ts:513 sets die to Infinity. The only other removals are effects.ts:511, :128 and :272, and :261-264 prunes other per-actor maps but not beams. killtarget reaches remove (content/q2/foundation/entity-services.ts:326-329), and onRelease (:36-43) emits no beam-off event.

### GAPAPP-015
Verdict: confirmed
Corrected severity: Low
Reason: content.ts:382, audio.ts:293-294, :314-315, :370 and :409, assets.ts:188, held-weapon.ts:34 and :52, and character-turntable.ts:506 store the pending promise with no eviction. assets.ts:156 shows the evicting pattern.

### GAPAPP-016
Verdict: confirmed
Corrected severity: Low
Reason: presentation-scene.ts:190-192, 244-246, 266-271, 277-279 and 303-305 insert keys containing slot and generation. The only removal is close at :417.

### GAPAPP-017
Verdict: confirmed
Corrected severity: Low
Reason: server-browser.ts:287 stores direct.remote, which may be a hostname. :348 compares browserAddress(entry.address) to that text and ignores the address resolved at :343, so q2Protocol is absent. startup.ts:1246 then selects q2-classic-baseq2.

### GAPAPP-018
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: effects.ts:323, presentation-scene.ts:340, q3-client.ts:560-561 and audio.ts:298-300 are as described. presentation-scene.ts:349-350 should be dropped: it is memoized by a 10 Hz key at :346-347, so it does not run per frame.

### GAPAPP-019
Verdict: confirmed
Corrected severity: Low
Reason: input.ts:412-442 repeats :497-547, with differing focus callbacks at :430 versus :518-519. configuration.ts:178-186 differs from prepared-startup.ts:324-332 only in identifier names. `{}` is present at content.ts:140 and :525, and builderLayout spans startup-menu.ts:509-738.

### GAPAPP-020
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The name greps hold, but tests/first-playable/server-browser-masters.test.ts:42-48 exercises fetchServerMasterList indirectly through browser.discover() against a local HTTP master. The gap is hostile or mixed-validity lists, not all coverage. registerSexedSound and refreshSystemInfo have no test references.

### GAPAPP2-008
Verdict: confirmed
Corrected severity: Low
Reason: q3-client/assets.ts:80-84 reads and retains every matching file for non-guest-async owners, and selected-q3-presentation.ts:94 creates a source-sync owner. An independent listing of baseq3 pk3s gives 598 sounds and 42.9 MiB, matching the finding.

### GAPAPP2-009
Verdict: confirmed
Corrected severity: Low
Reason: q2-native-hud.ts:33-43 loads each new layout name and stores misses in ids and pictures. Only clear (:18) removes entries, and it runs on content change (:22).

### GAPAPP2-010
Verdict: confirmed
Corrected severity: Low
Reason: ui.ts:136-142, q3-client/source.ts:75-76, q3-client/visibility.ts:20, :51 and :64-68, rerelease-presentation.ts:112 and :210-212, and effects/particles.ts:32 all allocate as stated. The finding's own measurements correctly keep this at Low.

### GAPAPP2-011
Verdict: confirmed
Corrected severity: Low
Reason: audio-settings.ts:12-16 throws for effectsVolume above 1, and view-settings.ts:30 throws for FOV above 160. configuration.ts:366 is outside any try, and the catch at :441-447 only cleans up and rethrows. server-administration.ts:56 is an unguarded JSON.parse.

### GAPAPP2-012
Verdict: confirmed
Corrected severity: Low
Reason: q1-wheel.ts:42 (from ui.ts:131), native-held-weapon.ts:33 (from presentation-scene.ts:241), q3-selected-weapon.ts:36 and :102, and finale.ts:44 all throw on these conditions with no local fallback. As the finding says, whether launch preflight excludes the held-weapon case is unestablished.

### GAPAPP2-013
Verdict: confirmed
Corrected severity: Low
Reason: addon-library.ts:210-215 only creates a tombstone. The rm calls at :181 and :192-197 target tombstones or staging, and content/catalog/addons.ts:111-116 only tests the tombstone. No purge path exists.

### GAPAPP2-014
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The blocking is real (addon-library.ts:61, :80, :56), but "indefinitely" is wrong. Measured: this Bun's fetch against a silent local listener rejected with TimeoutError after 300.0 s, so the menu blocks for about 5 minutes per stall. The Cancel gap and the dropped cancel promises stand.

### GAPAPP2-015
Verdict: confirmed
Corrected severity: Low
Reason: music.ts:75 replaces the record that a pending startTrack holds, and :249-250 writes to the stale copy. A rejecting openTrack at :248 leaves intro open. effects/q3.ts:52, :56, :124-125, :151 and :223 show bloodOwners is never written.

### GAPAPP2-016
Verdict: confirmed
Corrected severity: Low
Reason: Re-running the name grep gives exactly the stated counts: q2-native-hud 0, selected-q3-presentation 0, and the other six 1 each.

### GAPBOTS-003
Verdict: confirmed
Corrected severity: Low
Reason: ai-decision.ts:138 tests only botCTFCarryingFlag, while ai-combat.ts:224-227 keeps the three-way form. No Q3 source is on disk, but my independent recollection of ai_dmnet.c BotNearbyGoal matches the finding. objectiveNearbyRange at ai-decision.ts:864-870 bounds the effect as described.

### GAPBOTS-004
Verdict: confirmed
Corrected severity: Low
Reason: ai-combat.ts:600-602 is the speed-based test. No Q3 source is on disk, but my independent recollection of BotAimAtEnemy gives the same four-weapon list (machinegun, shotgun, lightning, railgun).

### GAPBOTS-005
Verdict: confirmed
Corrected severity: Low
Reason: goals.ts:1365 scans all bindings per candidate, and :1376 inserts. The only clears are :981, :1067 and :1073; :1387 only iterates, and :656 serializes all of them.

### GAPBOTS-006
Verdict: confirmed
Corrected severity: Low
Reason: source-game.ts:56-58 copies before any present test, ai-main.ts:467 calls it for all MAX_GENTITIES, and observations.ts:86-88 respreads every record. ai-combat.ts:68-71 and navigation-services.ts:16-32 match. Micro-benchmarks were not re-run.

### GAPBOTS-007
Verdict: confirmed
Corrected severity: Low
Reason: ai-context.ts:65 throws, and ai-main.ts:437 polls per frame. The cvar registry applies no length limit on the q3 path (the 64-byte limits at core/cvars/index.ts:550 and :561 are q2 only). A console line-length limit was not established, so rcon or a config file is the likely route.

### GAPBOTS-008
Verdict: confirmed
Corrected severity: Low
Reason: grep for FIGHTSUICIDAL, aiEnterBattleSuicidal and aiEnterBattleFight across tests finds nothing. The only aiNode mention (tests/bots/behavior/ai-save.test.ts:16, :34) round-trips a saved node name.

### GAPCOMPAT-009
Verdict: confirmed
Corrected severity: Low
Reason: combat-binding.ts:253-255 calls entries.spawn per foreign actor and :300-301 frees it in finally. The hold-off is confirmed in the mod source (lmctf g_utils.c:445, `level.time - e->freetime > 0.5f`). game-combat.ts:133-139 and :147 match for the inflictor case. Exhaustion was not run.

### GAPCOMPAT-010
Verdict: confirmed
Corrected severity: Low
Reason: combat-binding.ts:94 uses `skin.split("/")[1] ?? ""`. lmctf g_cmds.c:32-34 confirms ClientTeam returns the whole value when there is no slash.

### GAPCOMPAT-011
Verdict: confirmed
Corrected severity: Low
Reason: render-record.ts:57-62 throws on a row with no NUL, and :72-73 applies it to all 8 rows. The doc comment at :65 says bytes after NUL are retained, so the throw is the outlier.

### GAPCOMPAT-012
Verdict: confirmed
Corrected severity: Low
Reason: mod-presentation.ts:318-321 has no range check, while :311 does. :95 requires only capacity >= 1, so a declared capacity below 1024 is accepted. The write stays inside VM memory.

### GAPCOMPAT-013
Verdict: confirmed
Corrected severity: Low
Reason: grep finds RereleaseCgame, callCgame, bindCgame and rerelease/cgame only in cgame.ts, module.ts and tests/compat/q2/rerelease/native.test.ts. cgame.ts:29-38 allocates an exact size, unlike guest/runtime/common/memory.ts:106-114.

### GAPCOMPAT-014
Verdict: confirmed
Corrected severity: Low
Reason: native-mod-provider.ts:934 throws in finally before the restores and unmaps. :1082 and :1085 run outside the guarded block. native-primary-weapons.ts:207 writes in finally.

### GAPCOMPAT-015
Verdict: confirmed
Corrected severity: Low
Reason: Grep counts exactly 11 `functions.reduce` in content/q1/quakec (weapon-stage 4, armor-stage 4, three others 1 each), with qcFunctionEnd at weapon-stage.ts:17. The sets are repeated at :52-56 and :246-250. abi.ts has 382 `case` lines of 846.

### GAPCOMPAT-016
Verdict: confirmed
Corrected severity: Low
Reason: No test contains "mutate borrowed", and no tests/compat/qvm case covers an oversized snapshot. tests/compat/qc/runtime.test.ts:661 and tests/compat/qvm/mod-player-events.test.ts:48 are the required-throw assertions the finding describes.

### GAPCORE-003
Verdict: confirmed
Corrected severity: Low
Reason: playback.ts:145 slices on every currentFrame read and :157 reads it on every tick. presentation.ts:143 ticks per prepare, and roq-playback.ts:68-70 and :241 copy per decoded frame. The 177 MB/s arithmetic is correct.

### GAPCORE-004
Verdict: confirmed
Corrected severity: Low
Reason: createSourceQ3Collision and CollisionMapLoader appear only in q3/ and its barrel in src; the only other user is tests/world/collision/retail.test.ts. The live path uses decodedCollisionMap (map-resource.ts:521). The cycle check exists at formats/q3-map/decode.ts:208 and not in CollisionMapResource.load. collisionChecksum has no importer outside the barrel. Load cost was not re-measured.

### GAPCORE-005
Verdict: confirmed
Corrected severity: Low
Reason: No caller uses providers.register, clock, random or checkpoint. No src caller uses SessionMods setEnabled or restore (mods.ts:223, :228). The listed q3 session and kfont exports have no outside importer. q3-system.ts:439 falls through with no creator of ParticleType.Flat.

### GAPMAT-004
Verdict: confirmed
Corrected severity: Low
Reason: A case-insensitive grep finds none of the four cvars. All production compiles use DEFAULT_SHADER_PROFILE (assets.ts:137, q3-client/cinematics.ts:114), scene.ts:107 uses DEFAULT_RAIL_SETTINGS, and nothing sets curveError (world.ts:102, :679).

### GAPMAT-005
Verdict: confirmed
Corrected severity: Low
Reason: fog.ts fogAdjustment, shaderSort and shaderFogPass have no importer; the same-named material-finish.ts:177 is a separate local. finishImplicitShader, finishFailedShader, seatTextScale and spriteFog are unreferenced outside their files. legacy-fog.ts:80 lacks the falloff test that render/cpu/fog.ts:47 has.

### GAPMAT-006
Verdict: confirmed
Corrected severity: Low
Reason: Reproduced with LocalizationTable.merge: the three `{{` strings fail with "EOF before end of argument found", and `plain\nword` unquoted decodes as `plain\word`. localization-resources.ts:12 and :14 pass no options, so the warning never fires in production.

### GAPMAT-007
Verdict: confirmed
Corrected severity: Low
Reason: png-encoder.ts:4-11 is bitwise CRC and zlib.crc32 is available in this Bun. Measured encodePng at 599 ms for a random 1080p frame (8.3 MB output) and 44 ms for a poorly mixed one (447 KB), so the hitch scales with compressed size and the finding's 0.4 s is a high-entropy figure.

### GAPMAT-008
Verdict: confirmed
Corrected severity: Low
Reason: render/cpu/fog.ts:26-37 allocates color, result and the mix object (legacy-fog.ts:11-13, :93-95) per pixel, reached from rasterizer.ts:463. The 57 ms figure was not re-measured.

### GAPNET-008
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The wrap is real (r1q2.ts:583-584 and :610-611, q2pro.ts:350), but the stated trigger does not exist: no cl_forwardspeed or run-multiplier cvar is registered, and tuning writes change only alwaysRun (ui/settings/index.ts:256). Real reach is stacked input: keyboard 400 plus gamepad 400, or mouse-forward (input/user-command.ts:109-115), which can reach 800.

### GAPNET-009
Verdict: confirmed
Corrected severity: Low
Reason: nq15.ts:138-141 allows ent below 8192 and :248-249 uses the signed Short (network/q1/message.ts:83), while wide.ts:430 masks. wide.ts:437 reads a signed index. qw29.ts:204-205 can exceed QW29_MAX_ENTITY_NUMBER with no reader check.

### GAPNET-010
Verdict: confirmed
Corrected severity: Low
Reason: state-delta.ts:242-243 and :295-296 slice per record, and :58 and :66 spread per vector component. The cost is unmeasured, as the finding says.

### GAPNET-011
Verdict: confirmed
Corrected severity: Low
Reason: unified-components.ts:66 runs two indexOf calls per offset, :72-73 checks the 64 limit after decoding, and :85 checks sources after decoding them. indexOf is a byte scan and is likely fast, which supports Low.

### GAPNET-012
Verdict: confirmed
Corrected severity: Low
Reason: The file is 1056 lines with a 1059-column maximum. `"blue"` and `"spectators"` use readEventQ2CtfEventScoreboardRed, and readEventQ2WeaponEventViewWeaponWeapon reads command and winner fields. tools/ and the repository have no generator referencing it, and :615-617 is in a different style.

### GAPQ12-008
Verdict: confirmed
Corrected severity: Low
Reason: content/composition/q2/index.ts:161 requires edition === "rerelease", so q2/base/player/index.ts:387-393 gets 0 on classic. The Xatrix port at quake-2-rerelease-ts/src/xatrix/p_client.ts:695-732 drops item_quadfire under DF_QUADFIRE_DROP.

### GAPQ12-009
Verdict: confirmed
Corrected severity: Low
Reason: spheres.ts:122 and :130 use Math.max. The rogue port at g_sphere.ts:331 and :410 assigns level.time + 15 in the doppleganger branch, with a 30 s lifespan at :62-63, so the assignment shortens the timer and Math.max does not.

### GAPQ12-010
Verdict: confirmed
Corrected severity: Low
Reason: players.ts:447 clears state.spectator before :448 calls respawn, whose :429 test then copies the corpse. The kexgame port (p_client.ts:2158, :3838-3847) keeps resp.spectator true through respawn. :452 already copied the body on entering the waiting state.

### GAPQ12-011
Verdict: confirmed
Corrected severity: Low
Reason: ctf/presentation.ts:82-92 expands every match with replace and slices afterward, and :57-58 builds and sorts all entity candidates per location call. Cost was not measured.

### GAPQ12-012
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: vote.ts:21-24 clears before the check, but this is inherited: lmctf g_vote.c:40-43 calls Clear_All_Ballots before testing VoteStarted. The port widens reach: in C the skip entry is offered only when no vote is running (g_vote.c:214-218), while runtime.ts:159 accepts `lmctf-vote skip` from any client at any time.

### GAPQ12-013
Verdict: confirmed
Corrected severity: Low
Reason: monsters/state.ts:48 sets and :61 clears only in restore, with no delete. capture filters by isLive, and grep finds no onRelease under q2/missionpacks.

### GAPQ12-014
Verdict: refuted
Corrected severity: Info
Reason: The premise that the source clears the model is false. The rogue port dm_ball.ts:421-422 retains the C line commented out (`// self.s.modelindex = 0;`) in DBall_BallDie, so the source also leaves the ball drawn. deathball.ts:132-136 matches it.

### GAPQ12B-004
Verdict: confirmed
Corrected severity: Low
Reason: fixbot.ts:16-20 throws on a null goal, and :22, :82, :124 and :133 use it. foundation/monsters/index.ts:138 and :564 retarget goal. The window was not run. The xatrix port (m_fixbot.ts:346) needed an explicit null return here, consistent with C not throwing.

### GAPQ12B-005
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The defect is real but the source description is wrong. The kexgame port g_monster.ts:1185-1193 has no clamp: it refunds only when gibbed (health <= gib_health) and then nulls commander. foundation/monsters/index.ts:633 refunds on every first death, under `!state.dead`, and medic.ts:187-188 and :200-201 restore commander. Fix: move the refund to gib and clear commander.

### GAPQ12B-006
Verdict: confirmed-with-changes
Corrected severity: Info
Reason: rogue-teams.ts:96 has identical branches, but retail matches: disassembled TeamFlagStatusReport in rogue/pak0.pak compares `self.steam` to `flag1.team` for both flags (statements 221-222 and 286-287). This is a faithful source bug and not a port defect; "fixing" it would diverge from retail.

### GAPQ12B-007
Verdict: confirmed-with-changes
Corrected severity: Info
Reason: horde/index.ts:40 and :175 stop the chain, but retail matches: disassembled mg1 Countdown returns when SpawnWavePrep fails, and SpawnWavePrep prints "Last player died at round end, don't start new round!". Source-faithful behavior, not a port defect.

### GAPQ12B-008
Verdict: refuted
Corrected severity: Info
Reason: Retail morph_teleport in rogue/pak0.pak calls setorigin on the child and then `droptofloor()` with self unchanged (statements 42-43), and that builtin acts on self, the parent. morph.ts:67-68 `dropToFloor(monster)` is a faithful port. The conditional remediation does not apply.

### GAPQ12C-005
Verdict: confirmed
Corrected severity: Low
Reason: All cited throws exist in think, touch or use callbacks (hipnotic-train.ts:9, :11, :26; hipnotic-rotate.ts:49, :59, :62, :150; campaign.ts:52, :55; dragon.ts:153; lights.ts:16, :32; triggers.ts:216; ctf/maps.ts:11). Reaching the run loop still relies on APP-001, as the finding says.

### GAPQ12C-006
Verdict: confirmed
Corrected severity: Low
Reason: gladiator.ts:28 and :71 start a loop and die (:44-55) never stops it. audio.ts:609 only stops on leaving the snapshot. The source doubt is resolved: kexgame g_monster.ts:882 and :888-889 clear s.sound and reapply weapon_sound only while health > 0, so the source silences a dead gladiator.

### GAPQ12C-007
Verdict: confirmed
Corrected severity: Low
Reason: weapons.ts:365 uses offset 88 and the record accessor at :452 uses 80. :491 (the weapon record) is the source of 88, and :1011 runs the dump.

### GAPQ3-007
Verdict: confirmed
Corrected severity: Low
Reason: presentation/client.ts:378 calls particles.clear(resources) unawaited, while q3-system.ts:126-133 awaits registerShader per frame after close returns. resources.ts:141-145 does not cache nulls, and main.ts:34 handles unhandled rejections. As the finding says, no production rejection was found.

### GAPQ3-011
Verdict: confirmed
Corrected severity: Low
Reason: players.ts:629-662 (load) has no reset, and only :743-746 (loadDeferredPlayers) does. server-commands.ts:306 adds none. The source reset is from recollection of CG_LoadClientInfo, which matches the finding.

### GAPQ3-012
Verdict: confirmed
Corrected severity: Low
Reason: prediction.ts:101 spreads the result and :106-109 calls createBoxModel per non-brush solid per trace (model.ts:353-355). client.ts:283-288 and :321-323 build settings per call, and frame.ts:106-115 awaits per weapon. Cost was not measured.

### GAPQ3-013
Verdict: confirmed
Corrected severity: Low
Reason: players.ts:490-495 reads whole files for existence, though only after assets.has passes. resources.ts:124 and :133 and audio.ts:38 and :46 store failed lookups with no cap.

### GAPQ3-014
Verdict: confirmed
Corrected severity: Low
Reason: `callvote` has no test hits. The `tinfo` hit in tests/network/q3/network.test.ts is the substring of `getinfo` (:401, :438), which resolves the finding's open question. tests/app/q3-runtime-warnings.test.ts:26 constructs ClientServerCommandRuntime and application-save.test.ts:113 spies GameCommandRuntime, but neither covers these peer rules.

### GAPQ3B-004
Verdict: confirmed
Corrected severity: Low
Reason: mover-spawn.ts:167-169 passes a null activator, and use-participant.ts:16-19 throws on it. The helper at targets.ts:93 serves the listed handlers. The caller chain was accepted from the finding and SIM-012, not re-derived in full.

### GAPQ3B-005
Verdict: confirmed
Corrected severity: Low
Reason: Reproduced: `footsteps boot\nsex m\n`, a comment-only file and a 1,020-character token each give RangeError with parseError=false, and a truncated frame list gives PlayerAnimationParseError. players.ts:561-563 rethrows anything else, and server-commands.ts:160-163 disposes and rethrows.

### GAPQ3B-006
Verdict: confirmed
Corrected severity: Low
Reason: projection.ts:78 is setOrigin and return. grep finds `.s.time` written only at death.ts:116, and entities.ts:322 reads current.time for a stationary missile. My independent recollection of G_BounceMissile includes `ent->s.time = level.time / 4`.

### GAPQ3B-007
Verdict: confirmed
Corrected severity: Low
Reason: records.ts:99, :105, :107 and :128-136 allocate through ensureActor on any write. item-motion.ts:142-151 keeps using the entity after runThink, and ground.ts:11-13 writes through binding.body. entities.ts:115-117 skips non-inuse slots.

### GAPQ3B-008
Verdict: confirmed
Corrected severity: Low
Reason: records.ts:198-205, :216 and :239 are linear finds over the record table. My grep counts 160 nativeByActor and byActor references, not 127, which does not change the conclusion. Timings were not re-measured.

### GAPQ3B-009
Verdict: confirmed
Corrected severity: Low
Reason: All five names have 0 test files, and tests/gameplay/q3 plus tests/gameplay/foundation/q3 contain no func_train or path_corner. tests/ui/hud/powerups.test.ts:80 sets FOLLOW by hand.

### GAPSIM-009
Verdict: confirmed
Corrected severity: Low
Reason: rerelease-guest-services.ts:174 and classic-guest-services.ts:183 return new Map. All listed single-read and per-frame callers exist (native-mod-presentation.ts:119, network-q2-guest.ts:139, runtime.ts:5749-5750, :7419).

### GAPSIM-010
Verdict: confirmed
Corrected severity: Low
Reason: arsenal/q3-source.ts:301-307 refreshes all projected actors per step, :286-300 rebuilds the client configstring and netname in refresh, and :499-515 walks numEntities in publish.

### GAPSIM-011
Verdict: confirmed
Corrected severity: Low
Reason: network/q3.ts:120 stores the raw client string, and network-q3.ts:131 derives local from its `ip` value. server.ts:152 then skips rate limiting. Grep finds `ip` written only at admission (admission.ts:175, :183), and network-q3.ts:194 does not rewrite it on update.

### GAPSIM-012
Verdict: refuted
Corrected severity: Info
Reason: The throw exists (native-mod-presentation.ts:156), but the stated sequence cannot occur outside a tick: every transfer drains at its end (native-mod-provider.ts:945 and :971), including entry calls and commands (executeEntry just above :955, and :955-958), before a later disconnect. Disconnect runs its call while entries still hold the actor (native-mod-clients.ts:119-120). Publish defers only while owned.advancing, and no client release during that window was found.

### GAPSIM-013
Verdict: confirmed
Corrected severity: Low
Reason: classic-guest-services.ts:396-401 credits world, with knockback 0 and meansOfDeath 0, and its comment acknowledges the limitation.

### GAPSIM-014
Verdict: confirmed
Corrected severity: Low
Reason: q3/guest-bots.ts:79-82 scans all observations per nextEntity, :83-86 allocates a Uint8Array and TextDecoder per read, and :87-92 walks all BSP entities per modelClassname. goals.ts:1224 and :1240 are the full-pass callers.

### GAPSIM-015
Verdict: confirmed
Corrected severity: Low
Reason: source-hosts.ts:26-34 runs pointContents unconditionally, and :65-68 filters and sorts all observations per nearby. Cost was not measured.

### GAPSIM-016
Verdict: confirmed
Corrected severity: Low
Reason: Reproduced: for three entities with `"message" "C:\maps\"` in worldspawn, parseQ2Entities finds 3 and filterEntityText returns an empty string. guest-monsters.ts:48 is the backslash test, and only :90-92 has the count check.

### GAPSIM-017
Verdict: confirmed
Corrected severity: Low
Reason: q3/guest-player.ts:20-21 throws from playerUi with no local fallback. Whether the catalog scan can miss a weapon in a real mod remains unestablished.

### GAPSIM-018
Verdict: confirmed
Corrected severity: Low
Reason: The cited QVM host ranges measure 0.904 similar (SequenceMatcher). Both network hosts define headnodeVisible, and classic-guest-world.ts:126 and :158 hold the sync and async travel. The limits differ as stated: classic-guest-world.ts:213 (512) versus rerelease-guest-world.ts:177 (2048).

### GUEST-013
Verdict: confirmed
Corrected severity: Low
Reason: guest/runtime/common/memory.ts:107-114 rounds up to 4 KiB, core/memory.ts:655 and :753 splice, rerelease/module.ts:203 allocates per clientThink, and classic/records.ts:10-18 and windows/crt.ts:39-43 compute offsets per character. core/memory.ts:295 has findZero.

### GUEST-015
Verdict: confirmed
Corrected severity: Low
Reason: x64/cpu.ts:662 advertises bit 8 (CX8), but no 0F C7 case exists in the extended decoder, and the :727 range excludes it. x86/cpu.ts has no 0F A2 case. x64 routes 0F 77 through #numeric, which decodes ModRM at :775, while x86/cpu.ts:461 excludes 0x77.
