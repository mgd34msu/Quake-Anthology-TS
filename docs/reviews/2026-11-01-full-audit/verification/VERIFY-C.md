# VERIFY-C: adversarial verification of High findings plus selected Medium findings

Run from scratchpad/clean with HOME and XDG_DATA_HOME under scratchpad/verify, SDL dummy drivers, and qfiles read-only. Scripts are in scratchpad/verify/s.
Oracles used: real `progs.dat` disassembly (verify/s/dis.ts), QuakeC-execution mode against the native TS port on the same map, and `objdump` of qfiles/q2/baseq2/gamex86.dll (verify/dll.s).
No repo oracle exists for the Quake engine C rules behind CORE-001 and CORE-002 (SV_ClipToLinks, SV_HullForEntity). Those two rules still rest on memory of id source; the measured TS behavior and the progs sizes do not.

### CORE-001
Verdict: confirmed-with-changes
Corrected severity: High
Reason: src/world/collision/index.ts:168-204 has no size test. On e1m1 in deathmatch, a real QC `W_FireGrenade` grenade (solid 2, size 0, owner = other client) and a native grenade placed by the script with the real touch both stop the walking player at 80u, against 306u in the control (verify/s/t2.ts). The stated impact is wrong: the player does not "stop on" a grenade. Contact fires the touch and detonates it. With touch removed, the native player steps over a floor grenade with no speed loss (z +4). The rule applies to NetQuake movement only; from memory, QW pmove has no such size filter, so do not apply the fix to the QW path without checking.

### CORE-002
Verdict: confirmed-with-changes
Corrected severity: High
Reason: src/world/collision/q1/index.ts:108-115. Real progs sizes confirm the mismatch: monster_army `VEC_HULL_MIN..'16 16 40'`, monster_dog `VEC_HULL2_MIN..'32 32 40'`. On real maps with settled monsters, hull:null vs the width-rule hull differ on these horizontal traces: e1m1 3/736, e1m3 54/1184, e2m1 0/1056, e3m1 24/1760 (max 240u), and on upward ceiling traces for 10-24 monsters per map (verify/s/t3.ts). Cost is worse than reported: 224-434 us vs 6-10 us per trace, about 30-60x rather than 13x. Before droptofloor, 9/23 e1m1 spawns report startSolid on the derived path and 0 on the hull path (t4.ts); settled counts are 0 on both.

### CONTENT1-001
Verdict: confirmed
Corrected severity: High
Reason: id1 progs FindTarget statements 991-1060 run range, visible and infront against `sight_entity`, then replace with `.enemy`; q1/base/monsters.ts:137-146 uses the enemy directly. Differential on e1m3 with the same monster pair, where B sees A but not the player (verify/s/t5.ts): QC mode, B wakes at tick 6 and 4 monsters are awake; native TS, B never wakes and 1 is awake. e2m1 native also leaves B asleep; QC mode aborted on that map (see Side observations).

### CONTENT1-002
Verdict: confirmed
Corrected severity: Medium
Reason: id1 T_Damage statements 1565-1572 set `pain_finished` after th_pain when skill is 3. Measured at skill 3 (verify/s/t7.ts), `pain_finished - time` in QC mode is 5.00 for ogre, army, knight, wizard, demon, zombie and shambler. Native TS gives ogre 1, knight 1, demon 1, shambler 2, zombie and wizard unset, and only army 5 (q1/foundation/monsters.ts:263).

### CONTENT1-003
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The stated impact is too broad. Every retail Rogue horde launch gets a clean rejection first: "Horde requires an authored horde_manager and monster spawn points" (src/app/bootstrap/match-modes.ts:34-35), as do id1 and hipnotic. The registration throw needs a horde-authored map in Rogue content. Copying mg1 horde1.bsp into the Rogue user content reproduced `Q1 spawn handler already registered: trigger_explosion` through Application.open (verify/s/t10.ts). composition/q1/runtime.ts:77-85 promises this pairing works, so it is still a bug, but only for custom content.

### CONTENT1-004
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Rerelease progs use a field named `killstring` and ClientObituary (statements 7586-7590) prints it; composition/q1/runtime.ts:209 reads `kill_string`. Scene on q1-rerelease-id1 e1m1: a grunt kills the player and the message is `$qc_death_died` (verify/s/t8.ts); classic correctly prints "was shot by a Grunt". Addition: fixing the key alone is not enough for grunts. Progs set `monster_army=$qc_ks_grunt` and `monster_dog=$qc_ks_rottweiler`, but baseSpecies has no army or dog entry (q1/base/species.ts:28 onward), and the live grunt's field was undefined.

### CONTENT1-005
Verdict: confirmed
Corrected severity: Medium
Reason: id1 progs WaterMove holds all five sounds, and `environment()` at q1/base/player.ts:264 has no caller. Same water spot on e1m3 (verify/s/t9.ts): QC mode's event stream carries inh2o and outwater; native TS emits none of the matched water sounds across entry, 16 s submerged (health -11 shows water damage ran) and exit. Gasp was not separately confirmed in the QC output, because the logged line was truncated.

### CONTENT2-001
Verdict: confirmed
Corrected severity: High
Reason: Real baseq2 jail2 in coop (verify/s/coop.ts): checkpoint and saveGame throw `Q2 save encountered an unnamed source callback` from t=0, earlier than reported because the closure is scheduled at spawn. Using target_changelevel prints `Campaign transition failed`, the world stays on jail2, `transitionStarted` stays true, and a second use does nothing. Controls pass: base1 coop travels to base2, and jail2 singleplayer travels to jail3. Code: src/content/q2/base/player/spawns.ts:34, targets.ts:219,244.

### CONTENT2-002
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Reproduced in a real base1 session (verify/s/h.ts): a hover killed without gibbing makes capture throw for ticks 11-16, then capture returns OK once the corpse is gone. The window was 0.6 s for this 150u spawn height and is capped at 15 s (src/content/q2/base/monsters/hover.ts:44-49). A failed save can simply be retried. The exit soft-lock needs a level exit inside this short window and was traced, not run in this hover scene.

### CONTENT2-003
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: The real DLL's check_dodge (around 0x2001854c) tests SVF_MONSTER, health > 0, `monsterinfo.dodge != 0` and infront; the port's fallback at src/content/q2/foundation/monsters/index.ts:676-682 omits the dodge gate. Reach is narrower than reported. The target must be unaware yet facing the shooter (ballistics.ts:146-153), and at skill 1-2 the hit often clears it: with a 15-damage pain call after the dodge, berserk ran on shot 1 and parasite recovered by shot 2 (verify/s/d2.ts). Tank stayed frozen over 6 shots with roll 0.5 (pain needs roll <= 0.2 at this damage per tank.ts), and tank and berserk stayed frozen at skill 3.

### CONTENT2-004
Verdict: confirmed
Corrected severity: Medium
Reason: The real DLL's T_Damage at 0x2000528c does `test ah,0x8` on [esi+0x308] (AI_DUCKED) and skips the pain call, then compares skill to 3.0 and stores time - (-5.0) in pain_debounce_time. Port src/content/q2/foundation/monsters/index.ts:157-163 has neither. Handlers do not compensate: gunner.ts:21-28 and mutant.ts:52-58 have no ducked gate and use +3. Traced against the binary; no TS scene was run.

### CONTENT2-005
Verdict: confirmed
Corrected severity: Medium
Reason: The DLL function at 0x20007fbb is train_blocked by shape: SVF_MONSTER and client test, T_Damage 100000 (MOD_CRUSH), BecomeExplosion1, return, then the debounce test and the `dmg != 0` test. Port src/content/q2/foundation/movers.ts:582-588 begins with the dmg and debounce returns and has no such branch; sibling doorBlocked at 533-537 has it. Traced against the binary; no TS scene was run.

### TESTS-001
Verdict: confirmed
Corrected severity: High
Reason: Confidence rises from traced to reproduced. Unmodified tests/first-playable/q3-client/application.test.ts and tests/settings/server-ui.test.ts, run with cwd holding game data and a scratch HOME, wrote 20 and 11 files under `$HOME/.local/share/quake-typescript` (audio, input seats, cvars, images.cfg). A second run read a seeded musicVolume 0.25 and rewrote audio.json, and input/seat-1.json content changed. This machine has Steam Quake directories that `resolveDefaultContentRoot` searches (src/content/roots.ts), so these launches can resolve data under the real HOME. Not run against the real HOME, per the rules. Autosave overwrite was not observed.

### TESTS-003
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Reproduced on all 3 cited files with no corpus and empty HOME: q1/source 7 fail, equipment 7 fail, q3-horde 1 fail, each with `Content ... requires`. The file-count totals were not re-run. Downgraded because this is test-infrastructure noise, not a runtime defect, and README.md says some tests need game data. tests/support/corpus.ts:7 also allows "skip or report the missing files", so failing is within its wording; the real problem is a red baseline.

### TESTS-004
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: tests/first-playable/operator-console.test.ts fails 2/2 with QTS_TEST_CORPUS set and `Content q2-classic-baseq2 requires: ...`. A file-level recount gives 108 of 213 test files calling parse/open with no `--content-root` or `corpusRoot:`, which supports "about half" (the regex differs from the auditor's 99/188). 8 files key on the copper path. intermission-character passes with the corpus because Steam is only its fallback. Downgraded because it is a hermeticity defect in tests; the damaging consequence is already TESTS-001.

### SIM-004
Verdict: confirmed
Corrected severity: Medium
Reason: Save and load through Application (verify/s/sim.ts). Tag on q1 dm3 and q3dm1: `tagToken` is null after restore and 2 token models exist after ticks. Confidence for the auditor's traced modes rises to reproduced: LMCTF on q3dm1 goes from 7 models to 14 (flags and runes doubled), and DeathBall from 1 ball to 2. src/app/bootstrap/simulation/runtime.ts:5824 respawns because the fields are not saved. Attacker-credit and inventory claims were not separately tested.

### SIM-005
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Tag and Deathball on q3dm1 report `source-reset` and, after a simulation-level restart with the bot restart calls: Tag has tagToken set but not live, no models after 50 ticks and a stale tagHealth; DeathBall has dbPrepared true and no ball model (verify/s/sim.ts). The LMCTF part is refuted for this launch: sourceRestartPlan returns `replace-world` ("Selected adjunct providers require full world replacement", runtime.ts:7198-7205), so its stale fields go with the replaced world. The full Application.restartSourceRound path was not completed, because the harness client has no admission owner.

## Side observations (not verified findings)
- QC mode on e1m1 threw `QcProgramError: Unmatched id1 synchronous damage scope` and on e2m1 threw `QcRuntimeError: unbound builtin objerror (11)` during t5.ts. That script teleports the player, so a harness cause is not excluded. An unbound `objerror` builtin is worth a separate look.
- In t2.ts QC mode, the player's z fell from -256 to -392 after the grenade contact at a spot with floor near -280. Likely the dead player falling through the floor; not investigated.
- With rules standard, a Rogue map containing horde_manager throws `Q1 official spawn not yet implemented: horde_manager`.
