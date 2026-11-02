# SRC3Q1A — Q1 mission packs compared against Hipnotic and Rogue QuakeC: monsters, weapons, items, world

Paths: `HIP` = `<scratchpad>/upstream/quake-rerelease-qc/quakec_hipnotic`, `ROG` = its `quakec_rogue` sibling, `WQ` = `upstream/Quake/WinQuake`. `mp/` = `src/content/q1/missionpacks/`. Port paths are at HEAD fcdc8af5.

Nothing from `upstream/` was executed. Map counts come from a read-only parse of the entity lumps that SRC2Q1 extracted (`<scratchpad>/src2q1/ents-hipnotic.json`, `ents-rogue.json`). All experiments were static; no reproduction ran from `clean`.

## Coverage

Every file under `mp/` was read, except the 15 files in `mp/monsters/tables/`, which were checked by script (below). Reading a port file is not the same as comparing it, so the two are listed separately.

**Compared against the original, both sides read:**
| Port file | Compared against |
|---|---|
| mp/hipnotic-weapons.ts | HIP weapons.qc:37-553, :1171-1329; player.qc:296-322 |
| mp/rogue-weapons.ts | ROG lava_wpn.qc, mult_wpn.qc, weapons.qc W_Attack, W_BestWeapon |
| mp/grapple.ts | ROG grapple.qc; player.qc:195-231 |
| mp/arsenal.ts, mp/pickup-rules.ts | HIP and ROG W_Attack, W_BestWeapon, RankForWeapon, weapon_touch |
| mp/selection.ts | HIP W_ChangeWeapon, CycleWeaponCommand; ROG W_ChangeWeapon. Partial: see below |
| mp/items.ts | HIP hipitems.qc, items.qc; ROG items.qc (powerup_touch, ammo_touch, weapon_touch), newitems.qc, random.qc |
| mp/player.ts | HIP combat.qc T_Damage, client.qc:1317-1350, :1542-1610; ROG combat.qc T_Damage, shield.qc, sphere.qc, new_ai.qc. Partial: see below |
| mp/obituaries.ts, Hipnotic half | HIP client.qc ClientObituary. SRC2Q1 covered the Rogue half |
| mp/world/hipnotic-hazards.ts | HIP hipitems.qc, hazards section to end of file; weapons.qc:991-1036 |
| mp/world/hipnotic-misc.ts | HIP hip_expl.qc, hipmisc.qc, hiprubbl.qc, hipquake.qc |
| mp/world/hipnotic-particles.ts | HIP hip_part.qc, hipholes.qc |
| mp/world/hipnotic-spawn.ts | HIP hipspawn.qc, hipsubs.qc |
| mp/world/hipnotic-triggers.ts | HIP hipcount.qc, hiptrig.qc, hip_brk.qc |
| mp/world/hipnotic-rotate.ts, rotate-targets.ts | HIP hiprot.qc, hipclock.qc |
| mp/world/hipnotic-train.ts, bobbing water and pushable parts | HIP hipwater.qc, hip_push.qc |
| mp/world/campaign.ts | HIP client.qc ExitIntermission; hipmisc.qc effect_finale, info_startendtext |
| mp/world/rogue-runes.ts, rogue-tag.ts, rogue-time.ts, rogue-ending.ts | ROG runes.qc, dmatch.qc, timemach.qc, ending.qc |
| mp/monsters/armagon.ts | HIP hiparma.qc, all functions |
| mp/monsters/gremlin.ts, gremlin-ai.ts, gremlin-weapons.ts | HIP hipgrem.qc, all functions |
| mp/monsters/wrath.ts, overlord.ts, sword.ts, lavaman.ts, mummy.ts | ROG wrath.qc, s_wrath.qc, invis_sw.qc, lavaman.qc, mummy.qc |
| mp/monsters/runtime.ts, helpers.ts | Read; compared only where a monster above calls them |

**Scripted, not read line by line:** all 15 `mp/monsters/tables/*.ts` (`tables/hipdecoy.ts` included) against their QC. `<scratchpad>/src3q1a/frames.py` parsed each `void() name = [$frame, next]` declaration, resolved `$frame` to its first declaration index, and compared name, frame number and next state: 1450 rows, 0 differences. The script does not compare the operations inside each frame body. Those were sampled.

**Partly compared:**
- mp/selection.ts: the Rogue cycle and both reverse cycles were read only in part (ROG weapons.qc:1450-1480 sampled).
- mp/player.ts: ROG client.qc CheckPowerups was not read; the expiry path was checked only against the Hipnotic version.
- mp/backpacks.ts: dropMissionPackBackpack against HIP DropBackpack only. tossRogueBackpack and tossRogueWeapon were not compared with ROG teamplay.qc.
- mp/world/shooters.ts: `use` branches against ROG misc.qc and HIP misc.qc spikeshooter_use. shooter_think, Hipnotic LaunchLaser and rogue:push were not compared.
- mp/travel.ts: Hipnotic parms only. ROG client.qc parms were not read.
- mp/monsters/scourge.ts: compared to the start of scourge_pain in HIP hipscrge.qc. The tail of that file (pain, death, spawn) and ScourgeTriggerThink/Touch were not read.
- mp/monsters/morph.ts, dragon.ts: compared except the spawn functions at the end of ROG morph.qc and dragon.qc.
- mp/monsters/eel.ts: against ROG eel.qc. T_EELZap in ROG combat.qc was not read, so helpers.ts `eelZap` is unverified.

**Read in the port, NOT compared. The exact remaining list:**
- mp/world/rogue-teams.ts against ROG teamplay.qc (1886 lines).
- mp/monsters/charm.ts, charmed-base.ts, paths.ts against HIP ai.qc, monsters/grunt.qc, monsters/rottweiler.qc, except HIP ai.qc:185-225 (path_follow).
- mp/monsters/decoy.ts against HIP hipdecoy.qc; mp/monsters/spikemine.ts against HIP hipspike.qc.
- mp/monsters/runtime.ts `moveToEnemy` and `foundDefault` against HIP ai.qc `RUN_STRAIGHT` and SightSound beyond lines 504-541.
- mp/commands.ts against the cheat and dump functions in HIP and ROG weapons.qc.
- mp/presentation.ts beyond the hammer frames; mp/messages.ts and mp/world/finale-text.ts strings were not diffed against any classic source.
- mp/world/rogue-misc.ts, rogue-plats.ts, rogue-hazards.ts, rogue-pendulum.ts were left to SRC2Q1, which listed them as compared.

Treat the items above as unaudited, not clean.

## Strengths
- All 1450 monster frame rows match the QC in frame number and successor.
- Source bugs are preserved on purpose and correctly: the unnormalized `f_y = f_x` side vector in HammerDamage and PlasmaDamage, the spike mine's double radius damage through the touch path, homing rockets that never get a `nextthink`, `self.ltime` freezing rubble after one hit, `trigger_command` bound to `oncount_use`, stale `v_forward` in Multi Rocket spawning and mummy grenades, `makevectors(dir)` in dragon_fireball.
- RankForWeapon, W_BestWeapon, W_ChangeWeapon, pickup amounts, respawn times and impulse aliases match in both packs. So do the Armagon, Dragon, Gremlin theft and evasive goal logic, and the Rogue ending's stage and frame sequence.
- findradius order is reproduced by reversing the actor list wherever order can change the result.
- Candidates dropped after checking: `if (!self.spawnflags & 2)` in effect_finale is correct as ported, because QCC parses `!` below `&`. `hurt_setdamage` (HIP hiprot.qc:200) has no shipped trigger_hurt target; the one SET_DAMAGE path_rotate (hip1m3) targets a rotate_object and func_movewall. `trigger_hurt` `cnt` (HIP triggers.qc:614) occurs on no shipped map. The gravity value "1" that the engine treats as normal gravity occurs on no shipped map.

## Findings

### SRC3Q1A-001 — Wetsuit does not block Thunderbolt, Shambler or Gremlin lightning
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** HIP weapons.qc:1007 gates on wetsuit, used by weapons.qc:1088, shambler.qc:240, hipgrem.qc:1347. Port checks exist only in hipnotic-weapons.ts:141 and hipnotic-hazards.ts:34; foundation/weapons.ts:144 and gremlin-weapons.ts:84 have none, and `"electric"` has no reader.
- Severity: Medium
- Category: bug
- Location: src/content/q1/foundation/weapons.ts:144; src/content/q1/base/monster-actions.ts:158-159 (`castLightning`); mp/monsters/gremlin-weapons.ts:84. Original: HIP weapons.qc:991-1036, callers weapons.qc:1088, monsters/shambler.qc:240, hipgrem.qc:1347
- Confidence: traced
- Evidence: HIP has a single LightningDamage, and all three of its hit tests carry the check: `if (trace_ent.takedamage && !trace_ent.wetsuit_finished)` (weapons.qc:1007). The port applies it only in `hammerDamage` (mp/hipnotic-weapons.ts:141) and hazard `lightningDamage` (mp/world/hipnotic-hazards.ts:34). A search for `wetsuit` across src/content/q1 and src/content/composition/q1 finds no other damage check apart from the discharge case at mp/player.ts:120. The `"electric"` cause passed at gremlin-weapons.ts:84 has no reader. Gremlin lightning also calls `game.effect("blood", trace.end, target, 120)` where the source emits `particle(trace_endpos, '0 0 100', 225, damage*4)`.
- Impact: The wetsuit's stated protection ("no damage from electrical attacks", HIP hipitems.qc:85) fails against Shamblers, gremlins holding a stolen Thunderbolt, and other players' Thunderbolts in deathmatch. Each beam tick does full damage where the original does none.
- Remediation: Add a Hipnotic damage rule that cancels lightning-beam hits on a wearer, using a real cause flag rather than three call-site checks. Use particle color 225 in the Gremlin path.

### SRC3Q1A-002 — The falling time machine explodes after it lands, not while it falls
- **Verification (VERIFY-T): confirmed. Final severity: Low.** The misplaced else is exact at mp/world/rogue-time.ts:42-43 against ROG timemach.qc:112-133. Effect is purely visual, in one ending sequence, so Low rather than Medium.
- Severity: Medium
- Category: bug
- Location: mp/world/rogue-time.ts:42-43. Original: ROG timemach.qc:112-133
- Confidence: traced
- Evidence: The source nests the random branch inside the unsplashed test:
  ```
  if (!self.pain_finished) { if (self.origin_z < -20) { TE_LAVASPLASH...; self.pain_finished = 1; } else if (random() < 0.3) { TE_EXPLOSION... } }
  ```
  The port closes the outer block early, so `else` binds to the outer test:
  ```
  if (e.number("pain_finished") === 0) { if (body.origin.z < -20) { ...; number(e, "pain_finished", 1); } }
  else if (g.host.random() < 0.3) g.effect("explosion", body.origin);
  ```
- Impact: On r2m8 the machine sinks with no explosions, then produces random explosions (30% per 0.1 s tick) for as long as the ending runs, below the lava and ever further down, because time_fall never stops.
- Remediation: Move the `else if` inside the `pain_finished === 0` block.

### SRC3Q1A-003 — Rogue weapons-stay pickups omit the lava, multi-rocket and plasma bonus
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** ROG items.qc:513,:525-573 grant bonus ammo on leave. mp/pickup-rules.ts:13-34 has no weaponAmmoGrant, and the only implementation is ad/ctf/arsenal.ts:78.
- Severity: Medium
- Category: bug
- Location: mp/pickup-rules.ts:13-34; src/content/q1/foundation/pickups.ts:267-269. Original: ROG items.qc:525, :535, :553, :563, :573
- Confidence: traced
- Evidence: ROG weapon_touch adds special ammo when weapons stay:
  ```
  if (leave) other.ammo_lava_nails = other.ammo_lava_nails + 20;   // nailgun, super nailgun
  if (leave) other.ammo_multi_rockets = other.ammo_multi_rockets + 3;   // GL, RL
  if (leave) other.ammo_plasma = other.ammo_plasma + 5;   // lightning
  ```
  `leave` is true in coop and deathmatch 2, 3 and 5. The port's rule object defines `weaponLeave`, `weaponRank`, `autoSwitch`, `weaponGranted` and `respawn`, with no `weaponAmmoGrant` or other grant. `offer.ammo` in foundation/pickups.ts holds only the base ammo. A search for `rogue:ammo` in foundation/ and base/ finds only the weapon-to-ammo mapping and the backpack labels.
- Impact: Rogue coop and weapons-stay deathmatch players never get these rounds from a weapon, so the powered weapons unlock later or not at all. `weaponGranted`'s switch to the powered variant on pickup (pickup-rules.ts:24-28) rarely fires on a first pickup, because the ammo it tests was not added.
- Remediation: Grant the bonus in the Rogue pickup rules on the leave path, before `weaponGranted` picks the selected weapon.

### SRC3Q1A-004 — Mission-pack explosions have no explosion sprite
- **Verification (VERIFY-T): confirmed. Final severity: Low.** Sites hipnotic-weapons.ts:90, rogue-weapons.ts:77,:110, player.ts:46, lavaman.ts:63 end effect then remove, while each original ends in BecomeExplosion. effects.ts:474 draws no sprite; lavaman.ts:63 doubles the effect. Cosmetic only, so Low.
- Severity: Medium
- Category: bug
- Location: mp/hipnotic-weapons.ts:90; mp/rogue-weapons.ts:77, :110; mp/player.ts:46; mp/monsters/lavaman.ts:63. Original: HIP weapons.qc:1181; ROG mult_wpn.qc:46, :209; ROG sphere.qc:45; ROG lavaman.qc lavaman_touch; BecomeExplosion at ROG weapons.qc:355-363
- Confidence: traced
- Evidence: Each original ends with `BecomeExplosion()`, which sets `progs/s_explod.spr` and runs six animation frames. The port's versions end with `game.effect("explosion", ...); return game.remove(entity);`. The base rocket shows that the effect does not supply the sprite: src/content/q1/base/projectiles.ts:168 emits the same effect and then sets `missile.model = "progs/s_explod.spr"` itself. WQ cl_tent.c TE_EXPLOSION spawns particles, a light and a sound, no sprite. The mp/world hazards and the Wrath missile do build the sprite, so these sites are the exceptions. PlasmaTouch (ROG mult_wpn.qc:494-495) and FireballTouch really do end in a plain `remove`, so mp/rogue-weapons.ts:193 and mp/monsters/dragon.ts:147 are correct here. mp/monsters/lavaman.ts:63 also emits the effect twice where the source writes one TE_EXPLOSION, which doubles the particles and sound.
- Impact: Proximity mines, multi grenades, multi rockets, Vengeance Spheres and Hephaestus fireballs detonate with no fireball sprite, unlike ordinary rockets in the same game.
- Remediation: Route these through a shared BecomeExplosion helper, and remove the duplicate effect in lavaman.ts.

### SRC3Q1A-005 — Mini grenades and plasma use the plain explosion instead of TE_EXPLOSION2 colors
- **Verification (VERIFY-T): confirmed. Final severity: Low.** ROG mult_wpn.qc:39-44,:487-492 write TE_EXPLOSION2 with 230,5 and 244,3; rogue-weapons.ts:77,:193 use the plain explosion effect.
- Severity: Low
- Category: bug
- Location: mp/rogue-weapons.ts:77, :193. Original: ROG mult_wpn.qc:39-44, :487-492
- Confidence: traced
- Evidence: MiniGrenadeExplode writes TE_EXPLOSION2 with `230, 5`; PlasmaTouch writes it with `244, 3`. The port calls `game.effect("explosion", ...)` for both. A `colored-explosion` event exists and is used correctly at mp/world/rogue-time.ts:37, mp/monsters/wrath.ts:53 and mp/monsters/dragon.ts:147. `grenadeExplode` also uses the plain effect for the parent grenade's GrenadeExplode path, which is correct there, so the fix needs the `mini` flag.
- Impact: Rogue's two signature explosions have the wrong color.
- Remediation: Emit `colored-explosion` with these ramps.

### SRC3Q1A-006 — Mjolnir lightning, proximity mines and plasma ignore FL_MONSTER entities that have no monster controller
- **Verification (VERIFY-T): confirmed. Final severity: Low.** Every cited original tests FL_MONSTER; the five port sites test a monster controller. trap_spike_mine (hipnotic-hazards.ts:112) and item_time_machine (rogue-time.ts:48) set flag 32 with no controller.
- Severity: Low
- Category: bug
- Location: mp/hipnotic-weapons.ts:118, :195; mp/rogue-weapons.ts:117, :145, :197. Original: HIP weapons.qc:335, :1257; HIP hipitems.qc:386; ROG mult_wpn.qc:270, :332, :439; ROG timemach.qc:215
- Confidence: traced
- Evidence: The source tests `head.flags & FL_MONSTER`. The port tests `entity?.monster !== null && entity?.monster !== undefined`. `trap_spike_mine` (mp/world/hipnotic-hazards.ts:112) and `item_time_machine` (mp/world/rogue-time.ts:48) set the flag (`movementFlags |= 32`) with no monster controller. Hazard `scan` in the same pack correctly uses the flag (hipnotic-hazards.ts:23). Map data: 29 placed spike mines and 18 func_spawn mines in Hipnotic.
- Impact: Mjolnir lightning never arcs to a spike mine, and a proximity mine never reacts to one, so mines cannot be detonated this way as in the original. Homing Multi Rockets and plasma ground-out ignore the time machine.
- Remediation: Test `movementFlags & 32` at these sites.

### SRC3Q1A-007 — Mine, lightning, tesla and God's Wrath kills lose their source obituary
- **Verification (VERIFY-T): confirmed. Final severity: Low.** HIP hipitems.qc:387,:571,:698,:791,:821 assign deathtype; the strings are absent from src. Composition isMonster is flag based (composition/q1/runtime.ts:126), so a mine reaches obituaries.ts:77-80 with an empty key, as claimed.
- Severity: Low
- Category: bug
- Location: mp/world/hipnotic-hazards.ts:112, :121, :124; mp/runtime.ts:56; mp/obituaries.ts:74, :77-80. Original: HIP hipitems.qc:387, :571, :698, :791, :821; HIP client.qc:1943-1947
- Confidence: traced
- Evidence: The source assigns `self.deathtype = "$qc_suicide_mine"`, `"$qc_suicide_electrocuted"` and `"$qc_suicide_wrath"`, and ClientObituary prints `attacker.deathtype` first. The port reads `text("deathtype")`, which covers map-authored values, but these strings occur nowhere in src. A mine kill then reaches `attacker?.isMonster` with `monsters.get("trap_spike_mine")` undefined, so the key is `""` and no message prints. Lightning traps fall through to the generic path.
- Impact: Deaths on Hipnotic's hazards print nothing or a generic line.
- Remediation: Set the `deathtype` field at spawn in the hazard registrations, and copy it to tesla bolts.

### SRC3Q1A-008 — Empathy Shields never play their hit sound
- **Verification (VERIFY-T): confirmed. Final severity: Low.** HIP combat.qc:235-242 plays `hipitems/empathy2.wav`; `empathy2` occurs in src only as the obituary key.
- Severity: Low
- Category: bug
- Location: mp/player.ts:132-142. Original: HIP combat.qc:235-242; hipitems.qc item_artifact_empathy_shields precache
- Confidence: traced
- Evidence: T_Damage plays `hipitems/empathy2.wav` on the target, rate-limited to 0.5 s, when the target has the item. `empathy2` occurs in src only as the obituary key `$qc_death_empathy2`. SRC2Q1's sound scan did not report it.
- Impact: Silent feedback for a shield that halves damage.
- Remediation: Play the sound on the shared damage path after the invulnerability check, keeping the timer per target unless the source's `self` quirk is wanted.

### SRC3Q1A-009 — Hipnotic shotgun bullet holes are not implemented
- **Verification (VERIFY-T): confirmed. Final severity: Low.** HIP weapons.qc:812-820 calls placebullethole; `s_bullet` and `bullethole` are absent from src.
- Severity: Low
- Category: bug
- Location: no port site; `s_bullet` and `bullethole` occur nowhere under src/content. Original: HIP weapons.qc:812-820; HIP hipholes.qc:52-128; world.qc:225
- Confidence: traced
- Evidence: FireBullets calls `placebullethole(trace_endpos)` for the first pellet per shot that hits the world. The source keeps at most 10 sprites, each for up to 300 s.
- Impact: Hipnotic walls never show shotgun holes.
- Remediation: Add the capped sprite list to Hipnotic's bullet path.

### SRC3Q1A-010 — Switching a lightning trap or coil on with no `nextthink` restarts it; the source stops it
- **Verification (VERIFY-T): refuted. Final severity: Info.** hipnotic-hazards.ts:114 yields due = fround(t + (0 - t)) = 0, and scheduler.ts:52 returns not-due for `due.value <= 0`, matching WQ sv_phys.c:130. Scheduling replaces the pending think (scheduler.ts:105), so the trap stops as in the source. Ran thinkCallbackTime with due 0: null for q1-netquake and q1-quakeworld.
- Severity: Low
- Category: bug
- Location: mp/world/hipnotic-hazards.ts:114. Original: HIP hipitems.qc:589-594; WQ sv_phys.c:130-132
- Confidence: plausible
- Evidence: `self.nextthink = self.huntingcharmer` stores the absolute map key, which defaults to 0, and SV_RunThink returns early on `thinktime <= 0`. So the source trap stops thinking permanently. The port calls `g.schedule(e, huntingcharmer - g.time, e.think)`, which sets `nextThink = 0` and calls `host.scheduleThink`. I did not run the host dispatch for a due time of 0, hence `plausible`; `nextThink >= 0` is treated as live at foundation/entity-services.ts:230. Map data: hip3m1 has 4 `q_lightning_2` traps with no `nextthink` and `state 0`, and one `q_lightning_1` with `nextthink 0`; hip2m5 has 2 coils with `state 1` and targetname 5500, affected if toggled twice. The shipped rerelease engine was not available to confirm it matches WQ here.
- Impact: On hip3m1, traps that never fire in the original may fire and do 30 damage per hit.
- Remediation: Confirm by running the dispatch, then skip the reschedule when `huntingcharmer <= 0`.

### SRC3Q1A-011 — Overlord and morph destinations ignore stale `think` on nearby entities
- **Verification (VERIFY-T): confirmed. Final severity: Low.** ROG s_wrath.qc:83 and items.qc:88 leave think set permanently in QC; entity-services.ts:313 clears it before each callback, so overlord.ts:16 sees only pending thinks.
- Severity: Low
- Category: bug
- Location: mp/monsters/overlord.ts:16; src/content/q1/foundation/entity-services.ts:313. Original: ROG s_wrath.qc:83; ROG items.qc:88
- Confidence: traced
- Evidence: isSpawnPointEmpty rejects a point if `neighbors.think` is non-zero. QC keeps the function pointer after it runs, so every placed item (`self.think = PlaceItem`) blocks the point permanently. The port's dispatcher clears `entity.think = null` before each callback, so `other?.think != null` is true only while a think is pending. Map data, approximate at 80 units from item origin: r2m4 has 3 of 4 destinations near an item, r2m6 has 1 of 6.
- Impact: Overlords and morph children appear at points the original excludes, which changes where the fight moves on r2m4.
- Remediation: Count an entity as occupying a point if it ever had a think, or test the item class explicitly.

### SRC3Q1A-012 — Mjolnir swing still lands after the wielder dies
- **Verification (VERIFY-T): confirmed. Final severity: Low.** HIP player.qc:299,:306 fire from frame functions; hipnotic-weapons.ts:128-133,:147-149 schedule a separate entity and test only for null player or body.
- Severity: Low
- Category: bug
- Location: mp/hipnotic-weapons.ts:128-133, :147-149. Original: HIP player.qc:299, :306
- Confidence: traced
- Evidence: HIP_FireMjolnir runs from the player's own frame function, which PlayerDie replaces. The port schedules a separate `hipnotic_hammer_strike` entity for 0.3 s later, and `hammerStrike` checks only that the player and body exist, not health. Same class as CONTENT1-014, which covers the axe; this is a separate implementation.
- Impact: A player killed mid-swing can still deal 50 damage, or spend 15 cells and raise a lightning base.
- Remediation: Return early in `hammerStrike` when the player's health is at or below 0.

### SRC3Q1A-013 — A gorging gremlin heals where the source's T_Heal refuses
- **Verification (VERIFY-T): confirmed. Final severity: Low.** HIP hipgrem.qc:738,:1787 run in a think where `other` is world, so T_Heal (items.qc:100-115) refuses; gremlin.ts:72 heals against entity.maxHealth.
- Severity: Low
- Category: bug
- Location: mp/monsters/gremlin.ts:72. Original: HIP hipgrem.qc:1787; HIP items.qc:100-115
- Confidence: traced
- Evidence: `T_Heal(self,ldmg,FALSE)` returns early on `e.health >= other.max_health`. Gremlin_Gorge runs in a think, where the engine sets `other` to world, so `max_health` is 0 and no healing happens. The port heals up to `entity.maxHealth` (101). When Gremlin_Split succeeds it resets health to at least 100 and halves it in both versions, so the difference shows only when the split fails.
- Impact: Gremlins that cannot split, because of the population cap or no room, regain health in the port and not in the original.
- Remediation: Drop the heal to match the source, or note it as a deliberate change.

### SRC3Q1A-014 — Small monster and item drifts
- **Verification (VERIFY-T): confirmed. Final severity: Low.** Checked each item: ROG weapons.qc:154-156, s_wrath.qc:326, morph.qc:151, dmatch.qc:159-164, sphere.qc:48-57; HIP client.qc:1336-1350, hiptrig.qc:44. All differ as stated at overlord.ts:68, morph.ts:31, rogue-tag.ts:35, player.ts:89,:96,:162, hipnotic-triggers.ts:44, hipnotic-weapons.ts:198. ## SRC3Q1B
- Severity: Low
- Category: bug
- Location: mp/monsters/overlord.ts:68; mp/monsters/morph.ts:31; mp/world/rogue-tag.ts:35; mp/player.ts:96, :162, :89; mp/world/hipnotic-triggers.ts:44; mp/hipnotic-weapons.ts:198
- Confidence: traced
- Evidence:
  - SpawnBlood scaling: ROG weapons.qc:156 emits `particle(org, vel*0.1, 73, damage*2)`. ROG s_wrath.qc:325 and morph.qc:151 are ported as direct particle events with `direction: vscale(direction, -100)` and `count: damage`, or 150 and 14: ten times the speed and half the count.
  - Tag quad: ROG dmatch.qc:159-164 plays `items/damage.wav` and flashes the screen. rogue-tag.ts:35 gives the message and powerup only.
  - Wetsuit bubbles: HIP client.qc:1340-1348 emits DeathBubbles three times per 7 s scuba cycle. player.ts:96 plays only the sound.
  - Disconnect: ROG client.qc:1700 and sphere.qc:48-57 bprint `$qc_death_denied_vengance` when a sphere's owner leaves. player.ts:162 removes it silently; the key is absent from src.
  - Empty message: player.ts:89 calls `missionMessage(game, id, timer.lost)` with `lost: ""` for wetsuit and empathy expiry; the source prints nothing.
  - Silver key text: HIP hiptrig.qc:44 tests `self.owner.items`, and owner is world, so the source always prints the gold-key text. hipnotic-triggers.ts:44 selects by flag. Both shipped trigger_usekey entities (hip1m2) set `message`, so this is not reachable on shipped maps.
  - Mjolnir target test: HIP uses `visible(head)` with `head.view_ofs` (ai.qc). hipnotic-weapons.ts:198 traces to `body.origin`, while hazard `visible` adds the offset.
- Impact: Cosmetic or minor targeting differences. None blocks progress.
- Remediation: Correct each at its site; SpawnBlood should be one shared helper.
