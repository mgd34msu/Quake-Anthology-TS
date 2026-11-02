# SRC2Q1 — Q1 port compared against original source: movers, client.qc, player.qc, mission packs, add-ons, q1-solid

Paths: `RR` = `<scratchpad>/upstream/quake-rerelease-qc/quakec`; `HIP`, `ROG`, `MG1`, `MG3`, `CTF` = its `quakec_hipnotic`, `quakec_rogue`, `quakec_mg1`, `quakec_mg3`, `quakec_ctf` siblings; `V101` = `upstream/Quake-Tools/qcc/v101qc`; `WQ` = `upstream/Quake/WinQuake`. Port paths are at HEAD fcdc8af5; `q1/` means `src/content/q1/`.

Nothing from `upstream/` was executed. Map counts come from a read-only parse of the entity lumps in `<game-data>/q1/{rogue,hipnotic}/pak0.pak` and `q1/rerelease/*/pak0.pak` (`<scratchpad>/src2q1/ents*.py`, `q*.py`). One component reproduction ran from `clean` (`<scratchpad>/src2q1/door.test.ts`).

## Coverage

**Compared function by function, both sides read in full:**
| Port file | Compared against |
|---|---|
| q1/foundation/movers.ts | RR doors.qc, buttons.qc, plats.qc; V101 lip formula lines |
| q1/base/map-entities.ts | RR misc.qc, plats.qc (trains), triggers.qc, items.qc (sigil) |
| q1/foundation/spawns.ts | RR triggers.qc, misc.qc (barrel, lights). Q3-authored and rerelease-only cases have no id1 counterpart here |
| q1/foundation/pickups.ts, Q1 half (lines 27-116, 246-437) | RR items.qc. The foreign Q3 pickup half has no Q1 counterpart |
| q1/base/player.ts | RR player.qc, client.qc PainSound, DeathSound, PlayerDie, WaterMove, PostThink |
| q1/base/rules.ts | RR client.qc in full; V101 client.qc ClientObituary tail |
| q1/base/travel.ts | RR client.qc parms functions |
| q1/foundation/entity-services.ts: useTargets, calcMove, playerFrame, beginIntermission | RR subs.qc, client.qc |
| q1/missionpacks/world/hipnotic-train.ts, func_train2 part only | HIP hiptrain.qc |
| q1/missionpacks/world/rogue-plats.ts | ROG newplats.qc, elevatr.qc |
| q1/missionpacks/world/rogue-hazards.ts | ROG buzzsaw.qc, lightnin.qc, earthq.qc |
| q1/missionpacks/world/rogue-misc.ts | ROG newmisc.qc |
| src/world/geometry/q1-solid/{index,sweep,clipspace,polyhedron}.ts (534 lines) | WQ gl_model.c hull bounds (:967-984). The derived-cell path has no original counterpart. I checked the Minkowski arithmetic by hand and found no error |

**Partly compared:**
- q1/missionpacks/world/rogue-pendulum.ts: spawn, touch and use against ROG pendulum.qc 300-410. The swing frame table was not compared.
- q1/missionpacks/obituaries.ts: against ROG client.qc 1950-2085 only; HIP obituary not read.
- src/content/composition/q1/runtime.ts: read in full; compared only where it applies client.qc rules.
- q1/missionpacks/player.ts and q1/missionpacks/world/shooters.ts: read; compared only to RR, not to the pack client.qc or misc.qc.
- q1/addons/base-triggers.ts: read; not compared statement by statement.
- src/movement/q1/player-actions.ts: read against RR client.qc CheckWaterJump and PlayerJump.

**Scan-only evidence, weaker than reading:**
- Every `.wav` string, `$` message key and QUAKED classname in RR, HIP, ROG, MG1, MG3 and CTF was searched for in the port. Each hit reported here was then read at the source.
- Normalized statement diffs against RR: ROG and HIP monster files; ROG and HIP doors, buttons, plats, subs, combat, ai, fight; MG1 and MG3 doors, buttons, plats, subs, combat. MG3 was diffed against MG1. Statement counts for their triggers, misc, ai and monsters were taken, but those diffs were not read.
- Each map entity key was checked per class against the port.

**NOT compared. The exact remaining list:**
- q1/missionpacks/monsters/*: armagon, charm, charmed-base, decoy, dragon, eel, gremlin, gremlin-ai, gremlin-weapons, lavaman, morph, mummy, overlord, paths, scourge, spikemine, sword, wrath, against HIP hiparma, hipgrem, hipscrge, hipdecoy and ROG dragon, eel, lavaman, morph, mummy, s_wrath, wrath, new_ai.
- q1/missionpacks: arsenal, backpacks, commands, grapple, hipnotic-weapons, items, pickup-rules, presentation, rogue-weapons, selection, travel; and world/{campaign, hipnotic-hazards, hipnotic-misc, hipnotic-particles, hipnotic-rotate, hipnotic-spawn, hipnotic-triggers, rogue-ending, rogue-runes, rogue-tag, rogue-teams, rogue-time, rotate-targets}. The bobbing water and pushable parts of hipnotic-train.ts are also uncompared.
- q1/addons: brushes, campaign (read 130-160 only), commands, context, corpses, effects, field-triggers, lights, rope, travel, triggers (read 120-150 only); horde/*; ctf/* (scoring.ts read in part); items/*; monsters/* (ai, bosses, heavy, infected, ordinary, demodog).
- q1/equipment/*, q1/quakec/*, src/compat/qc builtins.
- src/content/composition/q1/{clients,commands,give}.ts.
- q1/base/frames.ts player and monster tables (TABLES reviewers covered them).
- MG1 and MG3 client.qc, player.qc, items.qc, weapons.qc, triggers.qc beyond the cited lines; the upstream/Quake/qw-qc tree; WQ net and client protocol code.

Reason for the remainder: I stopped after finding that pack-specific behavior is missing wholesale, not subtly wrong. Those findings outrank line-level comparison of the remaining files, and the remaining files need a separate pass. Treat them as unaudited, not clean.

## Strengths
- movers.ts plats, trains, secret doors and normal doors follow the QC closely, including sound slot swaps per `sounds` value, `self.wait` handling and door link order. Negative `nextthink` is reproduced by guards. `EntitiesTouching` uses local bounds, as QC does.
- hiptrain, newplats, elevatr, buzzsaw, lightnin, earthq and newmisc ports are accurate, including source quirks: `LightningDamage`'s unnormalized side vector, plat2 state encoding, and the `f_y = f_x` bug.
- base/rules.ts level flow, spawn selection and rerelease obituary order match. base/travel.ts matches the parms functions. Backpack selection in base/projectiles.ts is edition-aware and correct.
- Candidates dropped after checking the source: MG3 `aggro_target` (the QC reader is inside a comment, MG3 ai.qc:498-522), `func_train` nonsolid (occurs only on id1 maps, whose QC has no such flag), and `sound_wind1`-style unknown classes (the throw is documented in q1/foundation/README.md:40).

## Findings

### SRC2Q1-001 — MG1 and MG3 doors and buttons ignore the map's `movedir` key, so 694 entities move the wrong way and the wrong distance
- **Verification (VERIFY-T): confirmed. Final severity: High.** q1/foundation/movers.ts:42,:89 always derive movedir from angles; MG1 doors.qc:528-533 and buttons.qc:252-257 use the map vector. Counts match (MG1 154+8, MG3 447+85); mge1m1 `*19` has `movedir 0 0 256`. No func_door or func_button replacement reads the key (ad/context.ts:121 is triggers only).
- Severity: High
- Category: bug
- Location: q1/foundation/movers.ts:42, :46-49, :88-90
- Confidence: reproduced
- Evidence: MG1 doors.qc:528-533 and buttons.qc:252-257 (MG3 has the same logic) read:
  ```
  if(self.movedir) { self.pos1 = self.origin; self.pos2 = self.pos1 + self.movedir; self.angles = '0 0 0'; }
  else { SetMovedir(); ... }
  ```
  The port always runs `entity.movedir = moveDirection(body.angles, game)` and adds `size - lip`. No Q1 door or button code reads the `movedir` field, and the add-ons do not replace `func_door` or `func_button` (only horde wraps `spawnDoor`). Map counts: MG1 154 doors and 8 buttons; MG3 447 doors and 85 buttons. Example: mge1m1 `*19` has `"movedir" "0 0 256"`. Reproduction: `spawnDoor` on a 64x16x128 door with `movedir "0 0 256"` gave `pos2 {x:56,y:0,z:0}`. The source gives `{0,0,256}`.
- Impact: Across both campaigns, doors, pistons, chains and bars slide east by their width instead of along the authored vector. Passages can stay blocked or open wrongly, and progression can break. MG3 has 447 such doors.
- Remediation: In spawnDoor and spawnButton, when the `movedir` key is non-zero, use `pos2 = pos1 + movedir` for these programs, and do not derive a direction from angles.

### SRC2Q1-002 — Rogue statue knights and death knights are not implemented, so 35 frozen statues on r2m1 are live monsters from the start
- **Verification (VERIFY-T): confirmed-with-changes. Final severity: Medium.** ROG knight.qc:279-306,:355-376 are as cited and `statue`, `knight_pause` occur nowhere in src. Change: 3 of the 35 flagged entities have no targetname, and the source returns early for those, so 32 are the triggered set. One map with no crash or progress block, so Medium rather than High.
- Severity: High
- Category: bug
- Location: q1/base/monsters.ts:372-396; q1/base/species.ts (knight, hellknight); q1/missionpacks/monsters/runtime.ts (Rogue registers no base-species replacement)
- Confidence: traced
- Evidence: ROG knight.qc:355-374 and hknight.qc (`monster_hell_knight` from :485) handle spawnflag 2: stone skin 1, a frozen frame (default 44 or 73), and `th_stand = th_walk = th_run = knight_pause1`, which sets `takedamage = DAMAGE_NO` (:301-306). `self.use = knight_pause` (:279-296, hknight.qc:449-468) plays `statue/see.wav`, enables damage and attacks. Statues also use `statue/*.wav` and `statgib*.mdl`. A search for `statue`, `statgib` or `knight_pause` in src finds nothing. Map data: r2m1 has 18 `monster_knight` and 17 `monster_hell_knight` with the flag.
- Impact: On r2m1 the 35 statues appear as ordinary, normally skinned, damageable monsters that wake on sight, instead of invulnerable decor that a trigger animates. The map's set piece and its difficulty are lost.
- Remediation: Add a Rogue definition for both species covering skin, frame, invulnerable pause, `use` wake, statue sounds and gibs.

### SRC2Q1-003 — Rogue zombie spawnflags are read with base meanings: 40 lying, 94 ambush and 9 sneaky zombies behave as something else
- **Verification (VERIFY-T): confirmed-with-changes. Final severity: Medium.** ROG zombie.qc:74-77,:650-693 are as cited; counts 40, 94, 9 match. Change: the claim that the port tests only bit 1 is too narrow. monsters.ts:378 tests bit 1 for crucifixion, but ambush uses `spawnflags & 3` (monsters.ts:137), which is why bit 2 zombies are deaf. The impact stands.
- Severity: Medium
- Category: bug
- Location: q1/base/monsters.ts:378, :394
- Confidence: traced
- Evidence: ROG zombie.qc:74-77 redefines the flags as `SPAWN_LYING = 2, SPAWN_AMBUSH = 4, SPAWN_SNEAKY = 8`. :656-668 spawns lying zombies with `solid = SOLID_NOT`, `th_stand = zombie_sleep`, wake on any stimulus, and flat bounds. :672-693 spawns sneaky zombies frozen until `zombie_escape`; :102-118 is their lurk. :667-668 and :696-697 remap ambush 4 to spawnflag 2 for FindTarget. The port tests only bit 1, and `zombie_sleep`, `zombie_wake`, `zombie_escape` and `zombie_lurk` do not exist. Map data: 40 with bit 2, 94 with bit 4, 9 with bit 8.
- Impact: Lying zombies stand upright, solid, and ambush-deaf. Rogue ambush zombies are not deaf. Sneaky crucified zombies never drop off the wall as scripted.
- Remediation: Add a Rogue zombie definition matching monster_zombie's flag branches.

### SRC2Q1-004 — Rogue boss ogres are absent: no multi-grenades, no boss skin, no random promotion
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** ROG ogre.qc:140-150,:490-508 are as cited; 27 of 238 flagged. Under mp/, ogre classnames occur only in monsters/paths.ts:44, obituaries.ts:34, gremlin.ts:69 and hipnotic-spawn.ts:41, so no Rogue ogre definition exists.
- Severity: Medium
- Category: bug
- Location: q1/base/species.ts (ogre); q1/missionpacks/monsters/index.ts:25
- Confidence: traced
- Evidence: ROG ogre.qc:142-149 fires `MultiGrenade` from a boss ogre, and :396 and :419 drop `ammo_multi_rockets`. :494-500 promotes unflagged ogres to boss with 25% chance when skill > 0, and :505 sets skin 1. The port's only ogre classname references in missionpacks are the drag sound and obituary table. Map data: 27 flagged out of 238 Rogue ogres, plus the random 25% of the rest above Easy.
- Impact: Rogue's hardest common monster fires normal grenades and drops rockets, so the mission pack is easier and short of multi-rocket ammo.
- Remediation: Add a Rogue ogre definition using the existing MultiGrenade in rogue-weapons.ts.

### SRC2Q1-005 — Rogue Spawn have no skins, health tiers or mitosis
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** ROG tarbaby.qc:255-285,:316-345 give skins, health tiers and mitosis; q1/base/species.ts:36 is one fixed definition, and `mitosis`, `mytosis` are absent from src. 33 Spawn confirmed.
- Severity: Medium
- Category: bug
- Location: q1/base/species.ts:36
- Confidence: traced
- Evidence: ROG tarbaby.qc monster_tarbaby selects skin 0, 1 or 2 by flags 2, 4, 8, or randomly by skill. Health is 80, 60 or 100, and non-blue variants get `th_pain = tbaby_mitosis`. tbaby_mitosis (:255-285) splits off a new counted Spawn with 35% chance, playing `blob/mytosis.wav`. `mitosis` and `mytosis` do not occur in the port. All 33 Rogue Spawn use the fixed base species.
- Impact: Spawn fights lack their defining multiplication, and all Spawn have the same look and health.
- Remediation: Add a Rogue definition with `tbaby_checknew`, including the total_monsters update.

### SRC2Q1-006 — MG1 and MG3 door fields `speed2`, `DOOR_CRUSHER` and `DOOR_NONSOLID` are ignored
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** MG1 doors.qc:97-100, MG3 doors.qc:58,:71,:519 are as cited; `speed2` is absent from src and door_blocked always reverses (movers.ts:189-192). Counts: speed2 92, crusher 38 (25 with wait >= 0, the only ones where reversal differs), nonsolid 16 on secret2.
- Severity: Medium
- Category: bug
- Location: q1/foundation/movers.ts:15-19, :189-192, :43
- Confidence: traced
- Evidence: MG1 doors.qc:97-100 uses `self.speed2` for the closing move. MG3 doors.qc:71 returns from door_blocked for crushers without reversing, and :58 is the crusher hack. :519 sets `SOLID_NOT` for flag 4096. `speed2` appears nowhere in src; door_blocked always reverses. Map data: `speed2` on 92 doors, crusher flag on 38, nonsolid on 16 (MG3 secret2).
- Impact: Timed doors close at opening speed. A crusher that should keep moving through a player reverses instead, which can change puzzles and make crushers harmless. Nonsolid doors block players.
- Remediation: Read these fields in spawnDoor, doorDown and door_blocked, gated by the add-on programs.

### SRC2Q1-007 — MG1 and MG3 key-locked buttons open without a key
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** MG1 buttons.qc:229-232,:87-145 have the key gate; movers.ts:84-95 and the `button_touch` callback fire for any player. Counts MG1 12, MG3 8. No add-on replaces func_button (horde wraps only func_door, ad/horde/index.ts:68).
- Severity: Medium
- Category: bug
- Location: q1/foundation/movers.ts:84-95, :143-148, :201
- Confidence: traced
- Evidence: MG1 buttons.qc:229-232 sets `self.items` from `DOOR_SILVER_KEY` and `DOOR_GOLD_KEY`. button_touch (:87-145) refuses with `$qc_need_*` and noise3 when the key is absent, and spends the key otherwise. button_fire (:65-72) plays noise4. The port's button_touch calls buttonFire for any player, and spawnButton has no key handling. Map data: 20 buttons (MG1 12, MG3 8), including mgend and map4.
- Impact: Key gates on those maps are bypassed and keys are not consumed. Horde's key economy can also go wrong, since horde_key_spend (:140) never runs for buttons.
- Remediation: Port the button key branch for MG1 and MG3.

### SRC2Q1-008 — Per-entity `worldtype` on MG1 and MG3 doors and keys is ignored
- **Verification (VERIFY-T): confirmed. Final severity: Low.** MG1 subs.qc:447-457 and doors.qc:445 resolve per-entity worldtype; movers.ts:38,:136-140 and pickups.ts:78-79 use only game.worldType. Counts 37 doors, 7 keys match.
- Severity: Low
- Category: bug
- Location: q1/foundation/movers.ts:38, :136-140; q1/foundation/pickups.ts:78-79
- Confidence: traced
- Evidence: MG1 subs.qc:447 SUB_SetWorldtype takes `self.worldtype - 1` and otherwise `world.worldtype`, and doors.qc:246-269, :446-460 and items.qc:1012, :1053 use it. It also adds `WORLDTYPE_HUB`. The port uses only `game.worldType`. Map data: 37 doors and 7 keys carry the key.
- Impact: Wrong key model, pickup sound, door lock sound and "need key" text on those entities.
- Remediation: Resolve world type per entity for these programs.

### SRC2Q1-009 — Base Q1 pickups print no pickup message
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** RR items.qc:198 prints; q1/foundation/pickups.ts:392-416 emits sound and effect only, and the file has no game.message call. `kind: "pickup"` events are Q2-only, and effects.ts:426 is the flash. `$qc_got_quad` is used only by mp/world/rogue-tag.ts.
- Severity: Medium
- Category: bug
- Location: q1/foundation/pickups.ts:392-416
- Confidence: traced
- Evidence: RR items.qc prints on every pickup: health :198 `$qc_item_health`, armor :285 `$qc_item_armor`, weapons :522, ammo :715, keys :953, powerups :1165, all `sprint`. V101 has the same text. The completion callback plays a sound and a flash only. `$qc_got_item` occurs only in missionpacks, addons and horde/ctf drops, and `$qc_item_health` only in horde loot. Backpacks do print (q1/base/projectiles.ts:107). No consumer of the pickup effect prints text (src/app/bootstrap/effects.ts:426 is the flash).
- Impact: Nothing tells the id1 player what was picked up, including ammo and health amounts, on any map.
- Remediation: Add a message per definition in `complete`, with classic strings per edition.

### SRC2Q1-010 — CheckPowerups, SuperDamageSound and the invulnerability hit sound are missing in the base game
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** RR client.qc:1245-1258, weapons.qc:1351-1358, combat.qc:205-212 are as cited. In q1/ the base powerup sounds appear only in precache lists (pickups.ts:330-342, precache-world.ts:41), apart from gremlin.ts:55. Expiry is a silent delete at entity-services.ts:520-523.
- Severity: Medium
- Category: bug
- Location: q1/foundation/entity-services.ts:520-523, :668-671; q1/foundation/weapons.ts
- Confidence: traced
- Evidence: RR client.qc:1245-1390 gives fade warnings (`$qc_ring_fade`, `$qc_protection_fade`, `$qc_quad_fade`, `$qc_biosuit_fade`), `bf` flashes each second for the last 3 seconds, `items/inv2`, `protect2`, `damage2`, `suit2`, and the repeating `items/inv3.wav` loop while invisible (:1254-1258). RR weapons.qc:1351-1358 plays `items/damage3.wav` when firing with quad, and combat.qc:209 plays `items/protect3.wav` when an invulnerable player is hit. In the port these paths appear only in precache lists (pickups.ts:328-343, precache-world.ts:41), apart from Hipnotic and Rogue-only timers in missionpacks/player.ts:22-27, which omit the base four, and the gremlin. The `*_fade` keys appear nowhere. Expiry just deletes the entry silently.
- Impact: Powerups run out with no warning in every Q1 program. Invisible players and quad shots are silent to opponents, which removes a deathmatch cue.
- Remediation: Add a CheckPowerups player extension plus the two sound hooks. The existing mission-pack `timers` table is the pattern.

### SRC2Q1-011 — QuakeC WaterMove's velocity drag is not applied on NetQuake movement
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** RR client.qc:1147-1148 is as cited. netquake.ts waterMove (:205-225) applies engine friction only; a search of src/movement/q1, q1/ and composition finds no equivalent term (mp/player.ts:99 is a wetsuit boost). `0.8` in netquake.ts:331 is ideal pitch.
- Severity: Medium
- Category: bug
- Location: src/movement/q1/netquake.ts:205-225, :299-308; q1/foundation/entity-services.ts:532-548
- Confidence: traced
- Evidence: RR client.qc:1147-1148 and every pack: `if (!(self.flags & FL_WATERJUMP)) self.velocity = self.velocity - 0.8*self.waterlevel*frametime*self.velocity;`, run in PlayerPreThink at any waterlevel above 0. V101 client.qc:901 has it too; qw-qc does not. A search of src/movement/q1, players.ts, runtime.ts and foundation finds no equivalent: the 0.8 hits are ideal pitch scale and armor. Engine friction in waterMove is the only decay. QC-program worlds get this from bytecode, so only native Q1 is affected.
- Impact: Velocity decays about 2.4 per second less at waterlevel 3 than the source, and 0.8 per second less when wading, on top of engine friction. Entering water at speed, rocket-jump exits and wading stops carry further. The steady swim speed changes little because prethink runs before acceleration.
- Remediation: Add the term to the source player prethink for the NetQuake clock, excluding water jump and noclip.

### SRC2Q1-012 — First-contact slime and lava damage ticks once, not twice
- **Verification (VERIFY-T): confirmed. Final severity: Low.** RR client.qc:1108-1145 resets dmgtime after first-contact damage; entity-services.ts:541-547 never resets hazardAt. q1/base/player.ts:264 `environment` has the reset but has no caller.
- Severity: Low
- Category: bug
- Location: q1/foundation/entity-services.ts:541-547
- Confidence: traced
- Evidence: RR client.qc:1108-1127 deals damage when `dmgtime < time`. Then :1129-1145, the first frame without FL_INWATER, sets `self.dmgtime = 0`, so the next frame damages again before the normal interval starts. playerFrame never resets `hazardAt`. The uncalled `environment` method at q1/base/player.ts:279 has the reset, placed correctly, but it is not the live path (CONTENT1-005).
- Impact: Touching lava or slime costs one hit less on entry than in the original, up to 30 health in lava at waterlevel 3.
- Remediation: Track in-water state in playerFrame and clear `hazardAt` on entry after the damage check.

### SRC2Q1-013 — Exploding barrels are bounding boxes with no movetype; the source has SOLID_BSP and MOVETYPE_PUSH
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** RR misc.qc:272-273 vs q1/foundation/spawns.ts:79. Grounding requires SOLID_BSP (WQ sv_phys.c:284), and port isBsp resolves through isBrush (simulation/players.ts:400) while actor-execution.ts:68 maps bbox to box. canDamage (entity-services.ts:450-453) takes the non-push branch where RR combat.qc:39-41 uses the center.
- Severity: Medium
- Category: bug
- Location: q1/foundation/spawns.ts:79; src/movement/q1/netquake.ts:83; src/app/bootstrap/simulation/actor-execution.ts:68; q1/foundation/entity-services.ts:450-453
- Confidence: traced
- Evidence: RR misc.qc:272-273 and V101 use `SOLID_BSP` and `MOVETYPE_PUSH`. The port has `entity.solid = "bbox"; entity.movement = "none"`. Two source rules depend on this:
  - WQ sv_phys.c SV_FlyMove sets FL_ONGROUND only when `trace.ent->v.solid == SOLID_BSP`. Port `c.isBsp` maps "bbox" to "box" and returns false.
  - RR combat.qc CanDamage traces to the center of absmin and absmax for MOVETYPE_PUSH. The port's `push` is false, so it uses `origin` and ±15 offsets, which for a barrel with mins 0 is the bottom corner at floor height.
- Impact: A player on a barrel is never grounded, so they cannot jump, have no ground friction and keep air control. Barrel chain reactions test line of sight to the floor corner rather than the center, so low lips block blasts they should not, and the reverse.
- Remediation: Make isBsp and CanDamage treat barrels as brush and push targets, or use a brush-solid body with the `b_explob.bsp` hull.

### SRC2Q1-014 — SUB_UseTargets messages have no talk sound
- **Verification (VERIFY-T): confirmed. Final severity: Low.** RR subs.qc:255-261 plays talk.wav; entity-services.ts:401 only sends the message, and no talk.wav reference exists on this path.
- Severity: Low
- Category: bug
- Location: q1/foundation/entity-services.ts:401
- Confidence: traced
- Evidence: RR subs.qc:255-261: `centerprint(activator, self.message); if (!self.noise) sound(activator, CHAN_VOICE, "misc/talk.wav", 1, ATTN_NORM);`. The port only emits the message. CONTENT1-013 covers door_touch only, whereas this path covers trigger_once and trigger_multiple messages on every map.
- Impact: Map messages appear silently.
- Remediation: Add the sound when the entity has no `noise`, using the sounds-derived noise for multi triggers.

### SRC2Q1-015 — Classic obituary checks the attacker before water
- **Verification (VERIFY-T): confirmed. Final severity: Low.** V101 client.qc:1351-1384 tests watertype before FL_MONSTER; q1/base/rules.ts:135-142 runs the classic monster and trap branch ahead of the water lines.
- Severity: Low
- Category: bug
- Location: q1/base/rules.ts:135-142
- Confidence: traced
- Evidence: V101 client.qc ClientObituary tests `rnum == -3, -4, -5` (drown, slime, lava) first, then `attacker.flags & FL_MONSTER`, then explo_box, squish, falling, traps. The port runs `edition === "classic" && attacker !== null` with monster and trap messages ahead of the water block.
- Impact: Dying in water to a grunt says "was shot by a Grunt" where the original says "sleeps with the fishes".
- Remediation: Move the water block ahead of that branch for classic.

### SRC2Q1-016 — MG1, MG3 and CTF obituary rules are not ported
- **Verification (VERIFY-T): confirmed. Final severity: Low.** MG3 client.qc:1955-2001 and MG1 client.qc:1961 before :2026 are monsters-first; CTF client.qc:1500-1502,:1679-1681 carry the keys. Those keys are absent from src, and only packs override the obituary (composition/q1/runtime.ts:193).
- Severity: Low
- Category: bug
- Location: src/content/composition/q1/runtime.ts:193; q1/base/rules.ts:119-132, :140-145
- Confidence: traced
- Evidence: Only mission packs override q1Obituary.
  - MG3 client.qc:1953-2001 tests monsters first with per-variant keys: `$mg3_qc_obit_demodog`, `_rocketogre`, `_slime`, `_supershambler`, `_lavaman`, then traps, then water. None of these keys occurs in src.
  - MG1 client.qc has the same monsters-first order.
  - CTF client.qc:1500-1502 has `$qc_ks_changed_teams` and `$qc_ks_tried_change_teams`, and :1679-1683 has `$qc_death_hook1/2`. They do not occur in src, and a grapple kill falls to `message(attacker.killString)`, which is empty, so it prints nothing.
- Impact: Wrong or missing death lines in those programs, independent of CONTENT1-004.
- Remediation: Give addon programs an obituary override, as missionPackObituary does.

### SRC2Q1-017 — Smaller Rogue client and combat omissions
- **Verification (VERIFY-T): confirmed-with-changes. Final severity: Low.** All four omissions hold (ROG client.qc:505-511,:1370-1377; lava_wpn.qc:84; combat.qc:113-117). Change: the suicide cap is not team-play only. ClientKill's test is unconditional and client.qc:1659 resets the count at connect, while rogue-teams.ts:64-65 covers only the color-change path.
- Severity: Low
- Category: bug
- Location: src/content/composition/q1/runtime.ts:273-276; q1/missionpacks/player.ts:22-27; q1/missionpacks/rogue-weapons.ts
- Confidence: traced
- Evidence:
  - ROG client.qc:505-510 refuses a suicide after `suicide_count > 3` with `$qc_suicided_too_much`.
  - ROG client.qc:1370-1377 plays `belt/use.wav` every 3 seconds while antigrav runs.
  - ROG lava_wpn.qc:84 prints `$qc_out_lava_nails`.
  - ROG combat.qc:114-118 forces `health = -99` when killed by buzzsaw, Vengeance or pendulum.
  None of these keys, paths or the health rule occurs in the port.
- Impact: Unlimited `kill` in Rogue team play, a silent belt, and those trap kills do not always gib.
- Remediation: Add each to the Rogue player and damage effects.

### SRC2Q1-018 — Hipnotic lying zombies and fish gibbing are missing
- **Verification (VERIFY-T): confirmed. Final severity: Low.** HIP monsters/zombie.qc:74,:489,:560-563 and rotfish.qc:158-170 are as cited; `zombie_lay` is absent from src and fish has gibHealth -Infinity (species.ts:37). 8 lying zombies on hip2m4.
- Severity: Low
- Category: bug
- Location: q1/missionpacks/monsters/runtime.ts (hipnotic baseBehavior definitions, line 37 region); q1/base/species.ts:37
- Confidence: traced
- Evidence: HIP monsters/zombie.qc:489 and :560-563 stand a flag-4 zombie in `zombie_lay` until FindTarget, then `zombie_lay12`. HIP monsters/rotfish.qc:158-170 and :223 gib a fish below -20 health. The port's species have neither: fish has `gibHealth: -Infinity`, and `zombie_lay` does not occur. Map data: 8 lying zombies on hip2m4.
- Impact: Hip2m4's ambush zombies stand upright, and fish never gib.
- Remediation: Add both to the Hipnotic definitions.

### SRC2Q1-019 — Coop spawn rotation skips info_player_start and wraps to the first coop point
- **Verification (VERIFY-T): confirmed. Final severity: Low.** RR client.qc:562-570 falls to info_player_start at list end; rules.ts:47-51 wraps through `entities.find(coopPoint)` first.
- Severity: Low
- Category: bug
- Location: q1/base/rules.ts:47-51
- Confidence: traced
- Evidence: RR client.qc:563-570: `lastspawn = find(lastspawn, classname, "info_player_coop"); if (lastspawn == world) lastspawn = find(lastspawn, classname, "info_player_start");`. When coop points run out, the source uses the start point, and the next search continues after its slot. The port's `?? entities.find(coopPoint)` wraps to the first coop point and uses the start point only if no coop point exists. The activated-point filter is a separate rerelease feature and is not the issue.
- Impact: Different respawn order, and the start point is never reused once a coop point exists.
- Remediation: Fall back to info_player_start at the end of the coop list.

### SRC2Q1-020 — Timelimit and fraglimit are not checked in coop
- **Verification (VERIFY-T): confirmed. Final severity: Low.** RR client.qc:1203-1204 includes coop; composition/q1/runtime.ts:148 gates on deathmatch only.
- Severity: Low
- Category: bug
- Location: src/content/composition/q1/runtime.ts:148
- Confidence: traced
- Evidence: RR client.qc:1203-1204 has `if (deathmatch || coop) CheckRules ();`. The port gates on `deathmatch !== 0` only.
- Impact: A coop server with a timelimit or fraglimit never ends the level by those rules.
- Remediation: Include coop in the gate.

### SRC2Q1-021 — Third-person axe animation plays 6 frames; the source plays 4
- **Verification (VERIFY-T): confirmed. Final severity: Low.** RR player.qc:177-195 runs four frames per swing; q1/base/player.ts:187-190 uses count 6 and animates as an attack. Pain gate is RR player.qc:389.
- Severity: Low
- Category: bug
- Location: q1/base/player.ts:187-190
- Confidence: traced
- Evidence: RR player.qc:177-195 has four frames per swing (`axatt1-4`, `axattb1-4`, `axattc1-4`, `axattd1-4`), then player_run. The port uses `count: 6` from `119 + variant * 6`. `attackAnimation` also suppresses pain frames for that time, so pain gating lasts 0.2 s longer than the source's `self.weaponframe` test (:389).
- Impact: Others see extra swing frames and the pain animation is delayed after an axe swing.
- Remediation: Use count 4 for axe.

### SRC2Q1-022 — Bubbles differ: parents survive the split and are culled by contents
- **Verification (VERIFY-T): confirmed. Final severity: Low.** RR misc.qc:454-455,:474 remove the parent at split and only time-limit otherwise; map-entities.ts:84-85 keeps the parent and adds a contents cull.
- Severity: Low
- Category: bug
- Location: q1/base/map-entities.ts:84-85
- Confidence: traced
- Evidence: RR misc.qc:454-455 in bubble_split: `if (self.waterlevel != 3) remove (self);`. Bubbles are MOVETYPE_NOCLIP, whose physics never sets waterlevel, so the parent is always removed. misc.qc:474 removes only at `cnt == 20`, with no contents test. The port keeps the parent at frame 1 with count 10, producing two bubbles per split, and removes any bubble leaving liquid.
- Impact: Twice the bubbles after the split, and they pop at the surface where the source lets them rise on for their timer.
- Remediation: Remove the parent at split and drop the contents test, or record the change as deliberate.

### SRC2Q1-023 — Small mover, trigger and spawn drifts
- **Verification (VERIFY-T): confirmed. Final severity: Low.** Checked each item: RR doors.qc:132-133,:281-284; buttons.qc:70,:79,:164-165; triggers.qc:90-95,:639-640; client.qc:314,:642-656 against movers.ts:90,:139,:145, spawns.ts:370-373, entity-services.ts:600, rules.ts:54. All hold. The PUSH_ONCE wording should read dead non-grenade touchers. ## SRC3Q1A
- Severity: Low
- Category: bug
- Location: q1/foundation/movers.ts:90, :33, :139, :145, :200-201; q1/foundation/spawns.ts:370, :372-373; q1/foundation/entity-services.ts:600; q1/base/rules.ts:54
- Confidence: traced
- Evidence:
  - Button lip: RR buttons.qc:164-165 uses the fabs-vector formula, and the door at movers.ts:48 is edition-aware, but the button always uses V101's `fabs(movedir*size)`. Only non-axial angles differ. No official Rogue or Hipnotic button has one, and other maps were not counted.
  - Key sound: RR doors.qc:132-133 plays noise4 in door_fire whenever a key door fires, including a remote trigger or shot. The port plays it only from touch.
  - RR doors.qc:281-284 clears touch on the touched door and its next link only. A third linked door still asks for a key. The port clears all of them. This is arguably better, but undocumented.
  - RR buttons.qc:70 and :79 set `self.enemy` before button_fire's state test, so a later toucher becomes the activator. The port assigns after the test.
  - RR triggers.qc:90-95 sends `ACH_FIND_DOPEFISH`; `DOPEFISH` does not occur in src.
  - RR triggers.qc:639-640 removes a PUSH_ONCE trigger on any touch. The port's early return at :370 keeps it for dead or non-grenade touchers.
  - RR client.qc:314 uses `pos.mangle`, which is zero for an info_player_start fallback. entity-services.ts:600 uses that entity's angles.
  - RR client.qc:642-656 tolerates a deathmatch map with no deathmatch points by deferring. rules.ts:54 throws, which ends the process under APP-001. V101 spins into a runaway error instead, so this deviation applies to rerelease only.
- Impact: Minor presentation differences, one lost achievement, and one rerelease-only process exit for `deathmatch 1` on a single-player custom map.
- Remediation: Fix each locally. The throw should defer as the source does.
