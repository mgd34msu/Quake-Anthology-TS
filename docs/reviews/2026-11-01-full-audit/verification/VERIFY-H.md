# VERIFY-H — refutation pass over verify-LOW1.txt (82 IDs) at HEAD fcdc8af5

Method: every cited location was opened at HEAD. CLI parsing and StampSet were re-run from clean. Retail behavior was checked against disassembled progs.dat (id1 PAK0, rerelease id1 pak0, rerelease ctf pak0) and the retail baseq2 and rogue gamex86.dll. Scripts: scratchpad qcdis.py, dll.py, verifyh-opts.ts, verifyh-stamp.ts, docs-audit/jsdoc.ts. Measured performance numbers quoted in findings were not re-measured unless stated.

### APP-014
Verdict: confirmed
Corrected severity: Low
Reason: Allocations are present at application.ts:1047, 4356-4369, 4430, 4441-4447, 4550-4551; remote-application.ts:234-237; startup.ts:253. Unprofiled, as the finding says.

### APP-015
Verdict: confirmed
Corrected severity: Low
Reason: startup.ts:1171 and :257 are unguarded. step reaches launch at :1321 and the baseline at :1410; run (:1427) propagates to main.ts:90-94, which logs and returns 1. persistPreferences (:245-249) catches nothing.

### APP-016
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: main.ts:55 uses cwd only for source runs; a compiled build imports from dirname(execPath), so "launch from that directory" means the executable's directory there. The re-import is proven: llm/settings.ts:278 rm's other.key, and main.ts:60 copies it back on next launch if a legacy copy exists. baseUrl is limited to HTTPS or loopback by settings.ts:50-51.

### APP-017
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Five literal paths exist (application.ts:420, 467; remote-application.ts:533; startup.ts:209, 811). main.ts:13, 26 are not literals; they call defaultUserContentRoot() and ignore the option. remote-application.ts:532 does honor host.saveDirectory, while startup.ts:811 does not.

### APP-018
Verdict: confirmed
Corrected severity: Low
Reason: Re-run from clean: all six cited inputs parse as described (options.ts:176-177, 263-264, 304-305). `--game --dedicated` gives product "--dedicated", dedicated false. Explicit `--mode singleplayer` becomes coop with --seats 2 or --listen.

### APP-019
Verdict: confirmed
Corrected severity: Low
Reason: main.ts:19-21 appends up to 32768 tail characters per entry. No rotation or size check appears in main.ts, the only src file mentioning crash.log.

### APP-021
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: application.ts:2651 opens content, :2669 can throw, and the try starts at :2723. Only startup-source.ts:80 is a realistic trigger (maxclients over 64). Line 68 clamps first (:67), so it is unreachable for finite values. The path also requires sameSourceOwner and no save, map or skirmish override.

### APP-022
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The cited addons.close rejection is refuted: addon-library.ts:119 wraps every pending in .catch, and HttpDownloadQueue.cancel (http-downloads.ts:358) is synchronous with no await-dependent failure. The bare steps at application.ts:4776, 4778 and startup.ts:1467 remain, plus uncited startup.ts:1445 (Promise.all of movie preparations), which is the stronger candidate after closed=true.

### APP-023
Verdict: confirmed
Corrected severity: Low
Reason: this.gtv is set at startup.ts:1266 and cleared only at :1439; returnToFrontend (:1071-1091) leaves it. savedGames is assigned only at application.ts:500 with ??=.

### APP-025
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Correct path is src/app/bootstrap/network/qw-server.ts:93; the cited network/qw-server.ts does not exist. application.ts:1845 passes Math.random; handshake.ts:242 builds the challenge from two 15-bit draws. Q2 and Q3 use crypto at :1841.

### APP-026
Verdict: confirmed
Corrected severity: Low
Reason: grep for EPIPE across tests and src is empty; "Server sound is absent" occurs only in remote-application.ts. tests/app/crash-log.test.ts:10 calls main without a directory override, as APP-008 states.

### AUDIT-005
Verdict: confirmed
Corrected severity: Low
Reason: Measured now: dist 2.5G with 16 entries, .artifacts/snapshots 1.8G with 23 entries, .git 42M, tree 4.3G. tools/build.ts's only rm is on an unpublished candidate (:117).

### AUDIT-006
Verdict: confirmed
Corrected severity: Low
Reason: tools/verify/snapshot.ts:37 excludes only .git, .artifacts and dist; :46 refuses only q3key names. .gitignore:18-31 lists the credential names that would be copied. build.ts:90-94 records absolute paths. No such credential file was present in the project root at this check, so exposure is conditional.

### AUDIT-010
Verdict: confirmed
Corrected severity: Low
Reason: evidence/architecture-metrics.txt states 2104 files, 64 unreachable, 4119 lines, 1816 unimported exports and 235 test-only exports. Sample modules have no importers from reachable runtime code per that scan; the counts were not re-derived.

### AUDIT-012
Verdict: confirmed
Corrected severity: Info
Reason: Re-counted: 1058 of 2104 files have no copyright, license, SPDX or GPL text in their first 2 KB; 232 use SPDX. classic.ts:3 follows imports. This is a provenance observation, and the audit has shown no attribution defect, so Info.

### AUDIT-013
Verdict: confirmed
Corrected severity: Low
Reason: All four files exist. generate-tables.ts has no reference from src, tools, tests or package.json; generate-mg3-monster-resources.ts:3-4 requires an external donor; profile-frame.ts:17 defaults to a home path.

### BOTS-015
Verdict: confirmed
Corrected severity: Low
Reason: ai-main.ts:412 throws when stripped arguments are under 2 characters, and removeColorEscapeSequences (:44-52) strips `^1` to empty. `print x` also reaches it. No local catch.

### BOTS-016
Verdict: confirmed
Corrected severity: Low
Reason: brain.ts:957 computes aim.yaw + 180 every frame in the window. Only checkSixUntil and checkSixNextAt exist (:372-373), so the "Captured ONCE" comment at :1973-1977 describes state that does not exist.

### BOTS-017
Verdict: confirmed
Corrected severity: Low
Reason: chat.ts:622 pushes with no cap or clear; :425 structuredClones into checkpoints; :502 restores them. goals.ts:1484 has the same pattern.

### BOTS-018
Verdict: confirmed
Corrected severity: Low
Reason: nav.ts:91 maps on each getter read and brain.ts:1781 reads it in an up-to-8 loop. nav.ts:98 calls nodeView per node only because brain.ts:1846 always sets caps.avoid. The optional call would otherwise skip it.

### BOTS-019
Verdict: confirmed
Corrected severity: Low
Reason: brain.ts:1282 has no carrier test. selectGoal resets goalEntityId at :1632, but objectiveGoal then sets the carrier at :1301 and returns null at :1303. The combat and roam branches do not clear it, so :715-716 can rest the carrier and :1366 skips restStaticGoal.

### BOTS-020
Verdict: confirmed
Corrected severity: Low
Reason: Heaps differ only by field name (runtime.ts:25-54, estimates.ts:9-36). graph.ts:9 maps AAS 4 (barrier) and 5 (jump) both to "jump", and nav.ts:67 treats 5 as BarrierJump, so AAS jumps invert on rerelease bots. load.ts:37-38 makes AAS reachable for Q1/Q2 maps.

### BOTS-021
Verdict: confirmed
Corrected severity: Info
Reason: 101 case labels in 1038 lines; botdata.ts:798-801, 900-903 match. No defect is shown, only a refactoring opportunity.

### BOTS-022
Verdict: confirmed
Corrected severity: Low
Reason: The six named methods each have exactly one occurrence across src and tests. The stuckCount doc at path-follow.ts:171 contradicts brain.ts:36-40 and :735. brain.ts:957 destructure, :1204 `now > 0`, the :1508 orphan comment and runtime.ts:248-255 all match.

### CONTENT1-009
Verdict: confirmed
Corrected severity: Low
Reason: foundation/monsters.ts:234-236 returns undefined when checkBottom fails. Retail id1 Dog_JumpTouch statements 22-34 test FL_ONGROUND and re-enter dog_leap1. Leap holds its last frame (:170), and monster_dog is live through foundation/spawns.ts:174.

### CONTENT1-010
Verdict: refuted
Corrected severity: Info
Reason: flags.ts:53 is source-faithful. Retail rerelease ctf progs TeamCaptureFlagTouch statements 194-203 branch on team, and both branches pass `$qc_ks_blue_picked_up`; the progs contains no red variant. Localization defines qc_ks_red_picked_up, so this is an original bug, preserved. Keep only as an optional documented quirk.

### CONTENT1-011
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Megahealth bullet refuted: retail health_touch statements 7-10 (id1 and rerelease) return at health >= 250, matching pickups.ts:33. Painforward stands: retail reads ideal_yaw, monsters.ts:180 uses angles.y. HuntTarget stands: retail ai_run statement 14 calls it, monsters.ts:187 does not.

### CONTENT1-012
Verdict: confirmed
Corrected severity: Low
Reason: Now proven rather than plausible. Retail id1 misc_fireball statements 11-15 load speed and run EQ_F with no store; rerelease statements 15-18 store 1000. map-entities.ts:164 uses `||= 1000` with no edition branch, so classic is the wrong one.

### CONTENT1-013
Verdict: confirmed
Corrected severity: Low
Reason: Retail trigger_push_touch and door_touch play windfly and talk in both editions. foundation/spawns.ts:369-374 and movers.ts:131 emit neither; entity-services.ts:382-383 emits only a message event. Only the Rogue and Horde copies have the sounds.

### CONTENT1-014
Verdict: confirmed
Corrected severity: Low
Reason: weapons.ts:176-177 schedules an independent strike actor. axeStrike (:215-226) checks only player and body presence. "axe_strike" appears nowhere else, so death does not cancel it.

### CONTENT1-015
Verdict: confirmed
Corrected severity: Low
Reason: entity-services.ts:388 spreads and filters per call; base/monsters.ts:151 and :167 reach it from the walk tick; :215-217 writes strings; resources.ts:153 runs a regex per lookup. Unmeasured, as stated.

### CONTENT1-016
Verdict: confirmed
Corrected severity: Low
Reason: Tables total 3788 lines. The lavaman pair differ by a 42-line diff. hipnoticWeapons is defined at q1-hipnotic-supply.ts:5, q2-q1-supply.ts:41 and q3-q1-supply.ts:37. The shingle scores were not re-run.

### CONTENT1-017
Verdict: confirmed
Corrected severity: Low
Reason: createQ3SpawnHandlers, createMoverSpawnHandlers and all ten other sampled exports have one occurrence across src, tests and tools. lightningCount is only written and saved (monsters.ts:41, 50, 56; projectiles.ts:228).

### CONTENT1-018
Verdict: confirmed
Corrected severity: Low
Reason: provider.ts:124 throws where retail lightning_use statements 18-19 dprint "missing lightning targets" and return. pickups.ts:98 throws on an authored item_backpack weapon value.

### CONTENT1-019
Verdict: confirmed
Corrected severity: Low
Reason: Greps for sightEntity, sightTime, painFinished, kill_string, $qc_ks_knight and qc_death_died across tests return nothing. q1:horde occurs only in tests/content/catalog/catalog.test.ts.

### CONTENT2-006
Verdict: confirmed
Corrected severity: Low
Reason: movers.ts:270 and :149 route buttons through spawnDoor; :311 assigns doorBlocked and only water clears it (:314-315); :280 defaults damage to 2; :538-541 damages and reverses. Trigger frequency under pusher physics was not run.

### CONTENT2-007
Verdict: confirmed
Corrected severity: Low
Reason: soldier.ts sets skin only in pain (:79) and gib (:146); the regular death path (:160-171) does not. index.ts:667 limits setSkin to rerelease. Retail soldier_die at 0x200257d0 has an OR on the skin field after its deadflag check.

### CONTENT2-008
Verdict: confirmed
Corrected severity: Low
Reason: Now proven. Retail soldier_die (0x200257d0) sets ebx=3 for sm_meat (0x20043b30), then chest (0x20045a58), then head2 (0x20043934). soldier.ts:155-157 throws 2 bone, 4 sm_meat and head2.

### CONTENT2-009
Verdict: confirmed
Corrected severity: Low
Reason: index.ts:644-648 reads spawn.values each first death and never clears it. medic.ts:94-95 clears other fields and calls respawn, and admit resets dead to false (index.ts:407), so the drop repeats.

### CONTENT2-010
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: index.ts:637 only increments the counter, and no coop kill score exists. The port sets no owner on the corpse, while base medic.ts:24 filters on owner, so the medic behavior gap is real. Correction: monster_medic is not "only in the definition"; index.ts:633 and the rogue and rerelease medics use it for other logic.

### CONTENT2-011
Verdict: confirmed
Corrected severity: Low
Reason: Now proven. Retail SV_StepDirection at 0x200232ec-f5 does fld yaw, fsub ideal_yaw, then compares to 45 and 315 with no anglemod. FacingIdeal at 0x20001b00 does call it, so the two are distinct. ai.ts:214 wraps for all editions, so angles 20, ideal 90 differ.

### CONTENT2-012
Verdict: confirmed
Corrected severity: Low
Reason: Now proven for classic. Retail base and rogue SV_NewChaseDir (0x20023509, 0x20037569) use `test al,1`, probability 1/2. ai.ts:233 base branch uses directionRoll !== 0, probability 3/4. The rerelease edition was not disassembled.

### CONTENT2-013
Verdict: confirmed
Corrected severity: Low
Reason: targets.ts:259 plays on self. No mine3 message exists (only a spawn list at spawns.ts:5). No Q2 "exited the level" broadcast exists, while the retail DLL contains both strings.

### CONTENT2-014
Verdict: confirmed
Corrected severity: Low
Reason: perception.ts:136 deletes the map entry without removing entities created at :174. player_noise has no other removal path in src.

### CONTENT2-015
Verdict: confirmed
Corrected severity: Low
Reason: index.ts:727 iterates all entities per monster think; :309 sorts all contexts per frame; entity-services.ts:144 spreads and sorts; :310-312 rebuilds per loop iteration at :333. Benchmark not re-run.

### CONTENT2-016
Verdict: confirmed
Corrected severity: Low
Reason: horde.ts:112-116 picks a point by modulo with no occupancy check, and :35 stops thinking after wave 15 with no end signal in the file. The inability to separate is inferred from ai.ts:179-183, not run.

### CONTENT2-018
Verdict: confirmed
Corrected severity: Low
Reason: Outside ballistics, noises is a different class's field and soundEntity/sound2Entity appear only in checkpoint code. bodyOf has one occurrence. flyer_setstart is in no table, so base flyer.ts:46-47 always returns. items.ts:17-20 has the imports.

### CONTENT2-019
Verdict: confirmed
Corrected severity: Low
Reason: index.ts has 24 lines over 200 characters. My count under src/content/q2, excluding paths containing "tables", is 241 lines over 240, close to the cited 243.

### CORE-009
Verdict: confirmed
Corrected severity: Low
Reason: Re-run from clean: begin at 0xffffffff gives epoch 4294967296, and mark(1) returns true twice. stamp.ts:22-23 cannot observe zero.

### CORE-010
Verdict: confirmed
Corrected severity: Low
Reason: classic.ts:11-14 builds math and declares a class inside the call; swept.ts:26 calls createMovementMath per sweep and :46-55 converts at each callback. The timing was not re-measured.

### CORE-011
Verdict: confirmed
Corrected severity: Low
Reason: commands/index.ts:793 is the only alias budget and is gated on isQ2; :794 reinserts otherwise. batchBudget (:702) covers batches only. Traced here; the finding's timeout was not re-run.

### CORE-012
Verdict: confirmed
Corrected severity: Low
Reason: event-ring.ts:141, 326 and 349 reach slots.fill(null) over capacity 32768 (commands/index.ts:87). pendingText is a concatenating getter (:397) read at :549.

### CORE-013
Verdict: confirmed
Corrected severity: Low
Reason: commands/index.ts:363 and :369 add with no removal; :293-294 share the sets; :318 is linear. Callers of discardClient are local only (input.ts:340, application.ts:3785).

### CORE-014
Verdict: confirmed
Corrected severity: Low
Reason: registry.ts:61 runs findIndex from slot zero per allocation.

### CORE-015
Verdict: confirmed
Corrected severity: Low
Reason: math.ts:611-615 documents allocation-free; :619-640 allocates objects and arrays each call; :875-876 points to the unused vector store.

### CORE-016
Verdict: confirmed
Corrected severity: Low
Reason: packActorKey, actorKeyOf, FixedPool, SysEventQueue, createVec3Store and ByteArena have no src references outside foundation. The five files total 593 lines. cleanup.ts add and push are identical.

### CORE-017
Verdict: confirmed
Corrected severity: Low
Reason: scheduler.ts:168-175 rescans per iteration. Scheduler .advance calls occur only in tests/core/scheduler.test.ts.

### CORE-018
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: All 11 exports occur in one file; 12 of 42 contract files are runtime-specific; scene.ts has 90 exports; contents.ts:93 sniffs contents; the inversions exist. Correction: contracts/scene.ts is imported by 162 src files, or 209 with tests, not 174.

### DOCS-006
Verdict: confirmed
Corrected severity: Low
Reason: match-modes.ts:34-35 refuses without horde_manager. horde.ts:94 also does nothing without a manager, and nothing in src synthesizes one for Q2. docs/playing.md:45-46 is therefore wrong for TypeScript Q2. No launch was run.

### DOCS-008
Verdict: confirmed
Corrected severity: Low
Reason: File is 17,343 bytes; tsconfig.json:26 includes **/*.ts; docs/completion-status.json does not exist, though remaining-source-rows.md:357 names it as the default input.

### DOCS-010
Verdict: confirmed
Corrected severity: Low
Reason: src/version.ts is 1.1.9 at both v1.1.10 and v1.2.0. The four commits are ancestors of v1.1.10, and its notes do not mention movement or characters. Known-issue sections end at 1.1.6. HEAD is 11 commits past v1.2.6 at version 1.2.6.

### DOCS-012
Verdict: confirmed
Corrected severity: Low
Reason: fbabc9a2..HEAD is 78 commits; `git diff --stat HEAD -- src` is empty; both named files are absent; native-commands.ts was added in db69fc92. Report lines 54, 84 and 1815 match.

### DOCS-013
Verdict: confirmed
Corrected severity: Low
Reason: Cited lines match at verification-plan.md:3, source-assessment.md:3, project-plan.md:3, comparison-q2.md:3 and reference-contracts.md:37. verification/, work-packages.json and dependency-graph.mmd are absent. I count 12 docs with the placeholder outside the audit directory, not 13.

### DOCS-014
Verdict: confirmed
Corrected severity: Low
Reason: quake-mixer.ts is absent; the five #installed-build links exist and execution-status.md has no matching heading; all six orphan docs have zero references; only releases 1.0.0 and 1.2.6 are linked.

### DOCS-016
Verdict: confirmed
Corrected severity: Info
Reason: Re-run of docs-audit/jsdoc.ts reproduces app/bootstrap 10.8% and content/q2 5.4%. It measures presence only and shows no defect, and the finding itself rejects a coverage goal, so Info.

### DOCS-018
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Parser, foundation, art-review, windows README, profile-frame and prompt items hold (--bot-skill error re-run). Correction: README.md:63-71 is followed by more shapes in prose at :76-79 (single game folder, symlinks), so "shows one shape" overstates it; only the "these shapes" wording is off.

### FORMATS-016
Verdict: confirmed
Corrected severity: Low
Reason: startup-saves.ts:120 runs full readSavedGame for uncached files; save-image.ts:83-88 decodes the whole file; the cache at :90-92 is keyed by mtime and size.

### FORMATS-017
Verdict: confirmed
Corrected severity: Low
Reason: paths.ts:35 readdirs per component and :39 throws on ambiguity; mounts/index.ts:314 bypasses #listing; textures.ts:177 reads outside the try at :182.

### FORMATS-018
Verdict: confirmed
Corrected severity: Low
Reason: BinaryReader.bytes copies (core/binary/index.ts:69-71), so q1-map/index.ts:92 and :114, :127 duplicate data. No src consumer of Q1Map.lumps outside formats (other .lumps hits are WAD). md3.ts:290 and md4.ts:182 slice.

### FORMATS-019
Verdict: confirmed
Corrected severity: Low
Reason: playback.ts:92 calls readMedia, which allocates at source.ts:53, before ogg.ts:32 checks the limit. ogg.ts:66 and :90 join copies.

### FORMATS-020
Verdict: confirmed
Corrected severity: Low
Reason: q2-classic-guest.ts:123 reallocates to the exact end on each extending write. No cap beyond the range validation. Not measured with a retail save.

### FORMATS-021
Verdict: confirmed
Corrected severity: Low
Reason: q1-map/index.ts:155 validates only the start offset. queries.ts:14-18 throws on truncation or bad zero runs at first query, from visibility.ts:149 and collision q1/index.ts:281. No catch at those sites.

### FORMATS-022
Verdict: confirmed
Corrected severity: Low
Reason: decode.ts:262-265 and :271-275 walk each surface's full range with no overlap or total budget. ibsp44.ts:84-100 walks nodes per model with fresh visited sets.

### FORMATS-023
Verdict: confirmed
Corrected severity: Low
Reason: source-json.ts:18 regex per character; :54 array literal per value; :57 slice per number. The timing ratio was not re-measured.

### FORMATS-024
Verdict: confirmed
Corrected severity: Low
Reason: bspx.ts:184 skips validation with zero leaves, and lookup at :200-211 loops on a self-referencing root. The live materials path guards at q2-lightgrid.ts:46. Only retail.test.ts:7 uses the bspx copy.

### FORMATS-025
Verdict: confirmed
Corrected severity: Low
Reason: save-image.ts:91-95 has no fsync or containment. It has no src callers; only tests call it. writeContainedSave (save-policy.ts:48) is the production path.

### FORMATS-026
Verdict: confirmed
Corrected severity: Low
Reason: mounts/index.ts:72-73 uses a fixed temp name, and the map only gains entries (:69). loadDiskDigests resets to empty on parse failure. Interleaving was not reproduced.

### FORMATS-028
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: tests/formats has only the five cited directories, and no bomb or cycle tests exist there. Correction: tests/content/catalog/archive.test.ts is a dedicated archive suite, so "only as helpers" is wrong, but its three tests cover ordering, containment and changed bytes, not hostile limits.

### GAPAPP-009
Verdict: confirmed
Corrected severity: Low
Reason: startup-selection.ts:456-458 rebuilds recursively with no cache; rows reaches it through skins (:695-698). builderLayout (startup-menu.ts:523) is called from :206, :863 and :955. Timing was not re-measured.

### GAPAPP-010
Verdict: confirmed
Corrected severity: Low
Reason: character-turntable.ts:344-345 allocates a closure and two arrays per sample; :357 and :382 allocate per render; :542 renders synchronously at a 40 ms cadence (:53). Timing was not re-measured.

### GAPAPP-011
Verdict: confirmed
Corrected severity: Low
Reason: r_customwidth and r_customheight are Archive cvars (image-settings.ts:86-87), set each frame at :231 and part of signature (:197-198). :238 saves through writeAtomic. Callers at startup.ts:1418, application.ts:4678 and remote-application.ts:1033 have no guard.

### GAPAPP-012
Verdict: confirmed
Corrected severity: Low
Reason: remote-application.ts:1033 passes peer presentations with frontend assets; image-settings.ts:263 records applied; :242 makes the :1035 peer refresh return early. presentation.ts:166 commits the frontend-derived font into the peer. Traced, not run.
