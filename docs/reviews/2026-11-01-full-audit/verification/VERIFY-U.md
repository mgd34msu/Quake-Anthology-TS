# VERIFY-U — verification of SRC2Q2, SRC3Q2, SRC4Q2

HEAD fcdc8af5. Port paths are relative to the project root. `Q2/` is `<scratchpad>/upstream/Quake-2/`, `ORIG/` is `<scratchpad>/upstream/quake2-rerelease-dll/original/baseq2/`, `RR/` is `<scratchpad>/upstream/quake2-rerelease-dll/rerelease/`. Retail DLL evidence comes from `<scratchpad>/baseq2.dis`, a disassembly of qfiles/q2/baseq2/gamex86.dll.

Method note: the finding files cited `Q2/game` alone. Diffing it against `ORIG/` shows real differences in only two cited places: g_weapon.c:683 (rail) and p_weapon.c:1389 (BFG noise). The retail DLL agrees with `ORIG/` on both, which refutes SRC2Q2-010 and SRC3Q2-011. g_func, g_items, g_ai, g_monster, m_move, p_hud, p_trail, g_chase, g_combat and the cited m_*.c files have no differences; g_cmds, g_misc and p_client differ only in lines no finding depends on. Re-run from `<scratchpad>/clean`: src2q2/button.test.ts, src4q2/repro-medic.ts, repro-hostile.ts, repro-dl.ts. All other verdicts come from reading code.

## SRC2Q2

### SRC2Q2-001
Verdict: confirmed
Corrected severity: High
Reason: movers.ts:262-263 clears `touch` for every `use` caller and buttonTouch (:517-518) calls `use`; Q2/game/g_func.c:726-752 button_fire never clears it. Re-run: `touch after first press false`, still false after the button returns. Nothing restores it; :307 is the only assignment.

### SRC2Q2-002
Verdict: confirmed
Corrected severity: Medium
Reason: g_cmds.c:559-587 scans downward, and Use_Weapon (p_weapon.c:311-340) only sets newweapon, so the last owned weapon wins, which is the one above current. RR/g_cmds.cpp weapnext uses `selected_weapon + i`. commands.ts:171-173 with player.ts:60 (definition order blaster to bfg) stops at the first hit going down, so both editions are reversed.

### SRC2Q2-003
Verdict: confirmed
Corrected severity: Medium
Reason: commands.ts:9 returns the model part when bit 64 (DF_SKINTEAMS, q_shared.h:1022) is set; g_cmds.c:39-46 returns the model only under DF_MODELTEAMS and otherwise the skin. The mapping is inverted.

### SRC2Q2-004
Verdict: confirmed
Corrected severity: Medium
Reason: items.ts:766 raises entry capacity on a pack pickup; index.ts:201 keeps it (`{ ...entry, count: 0 }`) and ensure (items.ts:506-508) skips existing entries. p_client.c:622-627 and :1117-1125 reset the maxima on every deathmatch spawn.

### SRC2Q2-005
Verdict: confirmed
Corrected severity: Medium
Reason: commands.ts:45-59 has no power-armor case and power armor is droppable (items.ts:373). items.ts:858-866 stores the used item's kind, and the binding reads only cells (:492-500). g_items.c:688-702 derives the type live, shield first, and :747-752 toggles off on the last drop.

### SRC2Q2-006
Verdict: confirmed
Corrected severity: Medium
Reason: composition/q2/index.ts:261-267 runs attach, which restores carry (index.ts:186, :190-191), then putInServer(false), whose :252 clearPowerups (:397-399) removes flag 4096 and the protection. p_client.c:662 and :672 preserve FL_POWER_ARMOR, and MoveClientToIntermission does not touch it (port :605 does).

### SRC2Q2-007
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: The flag bug is real: scenery.ts:117 sets 12 where g_misc.c:1260 means 6, and actor-execution.ts:73 with world/collision/contents.ts:60 then gives it solid monster contents. The impact is overstated: the box is 16 units tall (scenery.ts:119) and STEPSIZE is 18 (movement/q2/types.ts:55), so a floor-placed corpse is a step-over bump, not a corridor block.

### SRC2Q2-008
Verdict: confirmed
Corrected severity: Low
Reason: The only nonzero bonusAlpha write and pickup selectedItem write are in rerelease/index.ts:205-207. Foundation pickup completion (items.ts:688-697) does neither; g_items.c:777 and :785-786 do both. Listing every `selectedItem =` and `bonusAlpha` site in src/content/q2 found no classic writer.

### SRC2Q2-009
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: items.ts:858-885 emits no sound or message, and no port source plays items/damage.wav or items/protect.wav for these items; misc/power1 and power2 occur only in lmctf/runes.ts. The citation is incomplete: runtime.ts:1243 is the foreign-world hook, and the native Q2 source prints the same line from runtime.ts:3705.

### SRC2Q2-010
Verdict: refuted
Corrected severity: Info
Reason: ballistics.ts:236 matches retail. gamex86.dll at 0x2001902f is `cmp [eax+0xf8],2` (solid == SOLID_BBOX) inside the rail ignore test, and ORIG/g_weapon.c:683-685 has the same "ZOID" clause, as does RR/g_weapon.cpp:801-806. Only the Q2/game tree omits it, so the proposed remediation would diverge from retail.

### SRC2Q2-011
Verdict: confirmed
Corrected severity: Low
Reason: g_weapon.c:353 sets SVF_DEADMONSTER on bolts. fireBlaster (ballistics.ts:313-318) and projectileForActor (:290-298) set no serverFlags, while lmctf/weapons.ts:63 sets 2 on its goop. World collision therefore treats bolts as solid monster contents for player masks. Effect not measured.

### SRC2Q2-012
Verdict: confirmed
Corrected severity: Low
Reason: commands.ts:185 goes through index.ts:116-118 with the world as attacker, so obituary.ts never takes the `attacker === victim` branch and table entry 23 prints "suicides"; g_cmds.c:648-656 passes ent as attacker, giving "killed himself". Repeating `kill` subtracts 2 from a corpse until the -40 branch at index.ts:319. It needs 6 s or more dead because of the respawnTime gate.

### SRC2Q2-013
Verdict: confirmed
Corrected severity: Low
Reason: commands.ts:126 toggles in every mode, and view.ts:117 turns that into layout bit 1; p_hud.c:276-291 returns first in single player. commands.ts:135 always forces the board on in deathmatch, while Cmd_Help_f calls the toggling Cmd_Score_f.

### SRC2Q2-014
Verdict: confirmed
Corrected severity: Low
Reason: index.ts:371 only sets the flag, so the first board waits for :479's `& 31` tick; p_client.c:530-531 sends it at death. :543 sends entity.enemy, which has no player write under base/player or composition/q2, where p_client.c:309 and :313 set it. No `killer` read was found in q2-match-ui, seat-hud-state, events or CTF presentation.

### SRC2Q2-015
Verdict: confirmed
Corrected severity: Low
Reason: "entered the game" occurs in src only for Q1 and Q3, and there is no MZ_LOGIN counterpart (p_client.c:1276-1281, :1339-1344). afterClientThink (index.ts:411-413) has no upmove chase cycling (p_client.c:1725-1736). :523 relies on putInServer's holdMilliseconds 0 (:259). The :1711 latch difference is narrow, because beginFrame clears latches at :428.

### SRC2Q2-016
Verdict: confirmed
Corrected severity: Low
Reason: commands.ts:24 tests `kind === "weapon"`, which excludes ammo_grenades even though items.ts:372 and :375 mark it usable and weapon. The catalog order comes from items.ts:69-93. :42 writes the selection, which Cmd_Use_f (g_cmds.c:396-422) does not. :162 prints "No item to use." for invdrop against g_cmds.c:630. g_items.c:191 and :535 revalidate after a drop; the port does not.

### SRC2Q2-017
Verdict: confirmed
Corrected severity: Low
Reason: trainWait (movers.ts:420-422) reads target.wait; train_wait reads moveinfo.wait (g_func.c:1500), set only in train_next (:1568) and not by train_resume (:1586-1599). The elevator path reaches resumeTrainAt via base/entities/movers.ts:231. Retail path data was not checked.

### SRC2Q2-018
Verdict: confirmed
Corrected severity: Low
Reason: base/entities/movers.ts:274 sets 0x2010003 (MASK_PLAYERSOLID); g_misc.c:726 sets MASK_MONSTERSOLID (0x2020003). simulation/physics.ts:310 uses the motion's clipMask.

### SRC2Q2-019
Verdict: confirmed
Corrected severity: Low
Reason: movers.ts:153 and :496-503 share the path_corner setup and z +/-8. g_misc.c:474-484 frees the entity in deathmatch and uses z +/-16. Survival in deathmatch is inert without monsters; the box size is the only behavioral part.

### SRC2Q2-020
Verdict: confirmed
Corrected severity: Low
Reason: movers.ts:190-191 starts the middle loop on every team member, while g_func.c:902-906 and :933-937 gate s.sound on !FL_TEAMSLAVE. :527 and base/entities/movers.ts:143 play on the door, while g_func.c:1135 plays on `other`, and secret doors use door_touch as well (:2025).

### SRC2Q2-021
Verdict: confirmed
Corrected severity: Low
Reason: scenery.ts:187-194 traces a box and moves only on fraction 1, returning early when `other` has no combat record. g_misc.c:873-885 calls M_walkmove.

### SRC2Q2-022
Verdict: confirmed
Corrected severity: Low
Reason: client-messages.ts:51 collects every string command and q2.ts:373-400 runs them all with no count; sv_user.c:525 and :655 cap at 7 executed. The throws at client-messages.ts:70-71 and :87-88 reach the q2.ts:441-447 catch and drop the peer, where sv_user.c:583-584 and :615-619 return silently.

## SRC3Q2

### SRC3Q2-001
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: simulation/network.ts:382-425 applies no PHS, PVS or area test and q2.ts:528-535 queues everything, unlike sv_send.c:161-242. The MVD path at network.ts:268-276 does scope sounds and flashes. One correction: footsteps are entity events in frames (index.ts:469-472) and are not in this list, so they are not part of the leak.

### SRC3Q2-002
Verdict: confirmed
Corrected severity: Medium
Reason: q2.ts:505-560 has no budget test before channel.send, and no `rate` key is read in network/q2, network/q2*.ts bootstrap, simulation/network.ts or base/player. sv_main.c:913-924 parses and clamps it; SV_RateDrop in sv_send.c applies it.

### SRC3Q2-003
Verdict: confirmed
Corrected severity: Low
Reason: chick.ts:36 maps chick_dead to finishCorpse, dispatch calls handler(context) (monsters/index.ts:378), so common.ts:60's default z -24..-8 applies; m_chick.c:299-300 uses 0..16. The effect is limited to an ungibbable corpse with no gameplay consequence, hence below the reported Medium.

### SRC3Q2-004
Verdict: confirmed
Corrected severity: Medium
Reason: jorg.ts:16 sets model2, boss-common.ts:61 calls throwGib with head:true on the same entity, gibs.ts:70-97 never clears model2, and entity-services.ts:347 still sends it. g_misc.c:193 sets modelindex2 = 0. The gib lives 10-20 s (gibs.ts schedule).

### SRC3Q2-005
Verdict: confirmed
Corrected severity: Low
Reason: g_misc.c:183-200 sets s.sound = 0. standardGib (common.ts:33-41) and the throwGib head branch emit no stop. hover.ts:16 starts a loop, and audio.ts:609 stops it only when the actor leaves the snapshot. Boss code calls stopLoop explicitly (boss-common.ts:57), so this is specific to the standard path.

### SRC3Q2-006
Verdict: confirmed
Corrected severity: Low
Reason: monsters/index.ts:574 clears and sets only resurrection bits, and 0x200 and powerArmorTime exist only in player code. brain.ts:13-33 does have powered screens, so g_monster.c:346-350 applies. The "no cue" impact holds: no src/content/q2 or src/world code emits screen or shield sparks either.

### SRC3Q2-007
Verdict: confirmed
Corrected severity: Low
Reason: network.ts:389 and :407 push every print, and no `msg` key is read in the Q2 network or player paths; sv_send.c:70 and sv_main.c:927-930 filter by it.

### SRC3Q2-008
Verdict: confirmed
Corrected severity: Low
Reason: infantry_dead and mutant_dead (m_infantry.c:304-313, m_mutant.c:534-543) leave nextthink set, and g_monster.c:380-388 re-enters the endfunc each frame, so M_FlyCheck re-rolls. ai.ts:402-407 and mutant.ts:85 cancel the think and roll once. m_medic.c:63 skips corpses with a nextthink; the port has no such delay.

### SRC3Q2-009
Verdict: refuted
Corrected severity: Info
Reason: attenuation 1 is the correct value: audio/mixer.ts:543 multiplies Q2 loop attenuation by 0.003, exactly SOUND_LOOPATTENUATE (snd_dma.c:38, :863), via audio.ts:530 and engine.ts:311-313. The remediation would break it. New evidence of the inverse: loops emitted with 3 (scenery.ts:205, foundation/movers.ts:167, :179 and :191, base/entities/movers.ts:29) mix at 0.009, three times too steep.

### SRC3Q2-010
Verdict: confirmed
Corrected severity: Low
Reason: common.ts:13 is sound(path, channel, attenuation). gladiator.ts:22 passes attenuation 2 against m_gladiator.c:54-56 ATTN_NORM. boss2.ts:14 is unconditional at attenuation 1 against m_boss2.c:41-44's 50 percent ATTN_NONE. supertank.ts:34 passes channel 4 against m_supertank.c:44-46 CHAN_VOICE.

### SRC3Q2-011
Verdict: refuted
Corrected severity: Info
Reason: The player.ts:627 comment is accurate for retail: ORIG/p_weapon.c:1389 passes the uninitialized `start`, and gamex86.dll 0x2002f678 passes a stack address (`lea ecx,[esp+0x24]`) with no earlier write in that path. Only Q2/game/p_weapon.c:1389 uses ent->s.origin. An explicit zero is a deterministic stand-in for that undefined value; moving to the origin is a design choice, not a port defect.

### SRC3Q2-012
Verdict: confirmed
Corrected severity: Low
Reason: scenery.ts:178 uses real division where g_misc.c:925 is integer arithmetic (2*150/200 = 1 against 1.5). barrelDropToFloor (scenery.ts:198-203) uses 0x2010003 and leaves origin unchanged on failure; g_monster.c:315-322 uses MASK_MONSTERSOLID and keeps the +1.

### SRC3Q2-013
Verdict: confirmed
Corrected severity: Low
Reason: q2.ts:339-342 and :352-363 have no state guard, and newClient (:289-295) sets active false and clears frames; sv_user.c:66-69, :130-133 and :187-190 reject these commands after spawn. Self-inflicted only, aside from the reliable reply traffic.

### SRC3Q2-014
Verdict: confirmed
Corrected severity: Low
Reason: index.ts:565 clears the target before chase, so findIndex gives -1 and :552 picks the first candidate; g_chase.c:111-133 advances from the old slot. g_chase.c:173 prints "No other players to chase."; the port has no such text. g_chase.c:89 uses PM_DEAD; index.ts:582 always freezes.

### SRC3Q2-015
Verdict: confirmed
Corrected severity: Low
Reason: q2PowerupSound (presentation.ts:28-33) has no quadfire input or branch; RR/p_weapon.cpp:666-671 plays ctf/tech3.wav with a 1 s limiter. Port tech3 use is limited to multiplayer/ctf/techs.ts:121.

## SRC4Q2

### SRC4Q2-001
Verdict: confirmed
Corrected severity: High
Reason: Re-run: `sprites/s_bfg1.sp2 installed: true => THROW`; an md2 returns ready. q2-downloads.ts:314 validates before the installed and permission tests, and the :243-248 regex has no sprites/ prefix. g_items.c:1539 and :1040-1043 put these names in the model list; cl_parse.c:74-82 tolerates them. q2.ts:698 and remote-application.ts:2322 have no guard. Exit itself rests on APP-001 and was not run live.

### SRC4Q2-002
Verdict: confirmed
Corrected severity: Medium
Reason: Re-run: revived medic `frames with enemy=player 50 moves medic_move_run,medic_move_stand`, control `100`, flag stays true. perception.ts:355-356 clears it only for rogue and g_ai.c:811-817 always does; medic.ts has no clear. The behavior is real, but it affects one species and makes the game easier without blocking play, so it is below High.

### SRC4Q2-003
Verdict: confirmed
Corrected severity: Medium
Reason: Re-run: `with A hunting: B enemy player after ticks 1`, control `C enemy null`. perception.ts:288 is ungated and :207 reads it for players; g_ai.c:357, :509, :797 and :863 are the only show_hostile uses and all writes are on monsters. RR/g_ai.cpp:497 is the source of the rerelease behavior.

### SRC4Q2-004
Verdict: confirmed
Corrected severity: Medium
Reason: `violator` has no hit under src/content/q2. Rerelease: entity-services.ts:247 makes disguise count as notarget, so ballistics.ts:132 returns on weapon noise, against RR/p_weapon.cpp:178-187 and RR/g_ai.cpp:715-717. Classic Rogue: original/rogue/p_weapon.c:108 and g_ai.c:520 have no port counterpart, and reportNoise (perception.ts:169-171) tests only FL_NOTARGET.

### SRC4Q2-005
Verdict: confirmed
Corrected severity: Low
Reason: (a) perception.ts:452 find returns undefined where p_trail.c:103-109 and :132-138 wrap to the oldest marker. (b) :460 lacks g_ai.c:1040-1044's dist = d1. (c) :462-469 use monsterSolidMask against MASK_PLAYERSOLID at g_ai.c:1052-1069. (d) PickFirst's visible uses viewheight (g_ai.c:293-297) and the port does not. (e) Per-player trails at :160-162.

### SRC4Q2-006
Verdict: confirmed
Corrected severity: Low
Reason: perception.ts:424 adds hintPath, combatPoint and soundTarget conditions; m_move.c:525 has none. closeEnough (:432-438) uses origin + bounds with no link epsilon, whereas absmin and absmax are widened by 1 in sv_world.c.

### SRC4Q2-007
Verdict: confirmed
Corrected severity: Low
Reason: perception.ts:304 is ungated, g_ai.c:362-366 has no such test, and RR/g_ai.cpp:519-522 marks it as a Paril change. For a missing combattarget, g_ai.c:371 sets movetarget = enemy; port :307 goes to huntTarget without it.

### SRC4Q2-008
Verdict: confirmed
Corrected severity: Low
Reason: monsters/index.ts:466 and dropToFloor (:539-547) never step or touch triggers, and that file has no walkMove or touchTriggers. g_monster.c:677-679 and :701 call M_walkmove(self, 0, 0), which reaches G_TouchTriggers (m_move.c:287-291).

### SRC4Q2-009
Verdict: confirmed
Corrected severity: Low
Reason: commands.ts:40 prints weapon.ammo, an id such as q2:ammo_shells, with one sentence for both results; p_weapon.c:327 and :333 use two sentences with pickup names. Nothing under src reads select_empty or passes allowEmpty true to player.ts:139.

### SRC4Q2-010
Verdict: confirmed
Corrected severity: Low
Reason: player.ts:263 and :276 use game.sound, which is a positional event (entity-services.ts:351-352) sent to all peers by the path in SRC3Q2-001. RR/p_weapon.cpp:445 uses gi.local_sound.

### SRC4Q2-011
Verdict: confirmed
Corrected severity: Low
Reason: ballistics.ts:519 emits the last pierce trace's end. RR/g_weapon.cpp:1117-1136 writes tr.endpos from the unobstructed trace to the target point, separate from pierce_trace.

### SRC4Q2-012
Verdict: confirmed
Corrected severity: Low
Reason: presentation.ts:24-27 doubles the rate for any nonzero frame, and animationTime (player.ts:356-363) uses it. RR/p_weapon.cpp:465 exempts IF_NO_HASTE while firing, with the flag on RR/g_items.cpp:1817 and :1872. `noHaste` and `NO_HASTE` have no hit under src/content/q2.

### SRC4Q2-013
Verdict: confirmed
Corrected severity: Low
Reason: rerelease/environment.ts:58 stores landmarkNoiseTime and :65 reports noise in the same call. Its only other use is the write at base/player/environment.ts:69, and reportNoise (perception.ts:169-171) has no landmark test. RR/p_weapon.cpp:173-175 returns for that case.

### SRC4Q2-014
Verdict: confirmed
Corrected severity: Low
Reason: ai.ts:93-94 uses strict comparisons, so a difference of exactly +180 stays positive and -180 stays negative. m_move.c:319-328 uses >= and <= under an ideal > current test, which flips both.

### SRC4Q2-015
Verdict: confirmed
Corrected severity: Low
Reason: RR/rogue/g_rogue_newai.cpp:247 calls face_wall, which has no port equivalent in monsters/index.ts:745-759. Port water test is deep.end.z + 48; RR/g_monster.cpp:203-221 reaches WATER_UNDER at in_point + mins + 49, 25 units above the floor for infantry, so the port refuses later.

### SRC4Q2-016
Verdict: confirmed
Corrected severity: Low
Reason: q2-downloads.ts:325-327 always sends `download ${path}` with a new sink; cl_parse.c:94-112 resumes from the .tmp length. parseMd2 and parseSp2 at :264-270 are unguarded and :332 rethrows. cl_main.c's tolerance was taken from the finding and recollection, not reopened.

### SRC4Q2-017
Verdict: confirmed
Corrected severity: Low
Reason: server-messages.ts:175-176 and :302-304 throw on entity 0; cl_parse.c:368-370 has no zero test. q2.ts:630-700 has no try or catch around receive at :674. Needs a hostile or modified server, and exit depends on APP-001.
