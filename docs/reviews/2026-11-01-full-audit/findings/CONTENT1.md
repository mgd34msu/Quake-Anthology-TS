# CONTENT1 — Game content: q1/{base,foundation,missionpacks,addons,equipment}, q3/*, composition/*, monsters/*

All paths are relative to `src/content/` unless they start with `src/` or `tests/`. HEAD fcdc8af5.

QuakeC and Q3 comparisons are against my knowledge of the original source. That source is not in the repository, so I could not diff against it. Where the repository's own MG3 or Hipnotic ports show the original behaviour, I cite them as corroboration.

## Coverage
Scope as briefed: 363 `.ts` files, 52,667 lines (the catalog, mods and archive directories were excluded, per the brief's "That is ..." list).

**Read in full (about 11,770 lines):**
- q1/base: monsters 450, monster-actions 192, projectiles 239, rules 238, species 194, creatures 88, provider 186, map-entities 184, player 282, travel 56
- q1/foundation: entity-services 728, pickups 437, weapons 233, spawns 394, movers 236, monsters 317
- composition: q1/runtime 284, q2-q1-supply 48, q2-q3-supply 37, q3-q1-supply 43, q3-q2-supply 46, q1-q2-supply 42, q1-q3-supply 36, expansion-supply 78
- q1/missionpacks: monsters/runtime 196, monsters/helpers 60, monsters/gremlin 165, monsters/gremlin-ai 103, backpacks 99, pickup-rules 35, world/rogue-runes 83
- q1/addons: context 153, horde/index 250, horde/squads 44, monsters/heavy/rune-knight 74, monsters/heavy/runtime 89, monsters/bosses/final 284, monsters/bosses/registry 29, monsters/ai/controller 189, monsters/startup 82, ctf/flags 103, ctf/runes 83, ctf/scoring 69
- q3/base/game: combat 250, death 380, item-pickup 310, item-lifecycle 506, missile 500, weapon 332, hitscan 263, mover 435
- q3/team-arena: team 651, match 486
- q3/presentation: local-entities 399

**Sampled:**
- q3/presentation: entities 135-165 plus the first 135 lines of 456, resources 65/223, marks 70/139, client 30/397
- q3/base: records 60/285, game/rankings 60/704
- q1/missionpacks: hipnotic-weapons 120/250, monsters/charm about 80/86
- q1/equipment: threewave-grapple 110/196
- q1/addons: campaign 75/225, monsters/ordinary/index 106/136, horde/loot partial, ctf/state 18/69
- monsters: q2 50/451, q2-rerelease 40/621

**Script-checked, not read line by line:**
- All frame tables (3,788 lines): dangling `next` references, frame indices, and whether each action name resolves.
- Both Q3 item tables, dumped and compared with my memory of `bg_itemlist`.
- Near-duplicate shingling over all 363 files.
- Dead-export scan over all 363 files.
- Module-level mutable-state scan over all 363 files.
- A composition reproduction across every Q1 program with and without horde.

**Skipped (about 35,000 lines), so bugs there are not excluded:**
- Most of q3/presentation (about 10,000 lines: weapons, players, media, mission-hud, hud, events and others).
- The rest of q3/base/game (save-values, targets, triggers, spawn, format, misc and others).
- q3/team-arena commands and client-* files.
- q3/foundation and q3/equipment.
- The remaining missionpack monsters and world files.
- The remaining addon monsters, items and brushes.
- monsters/{q1,expansions,mg3-resources,roster}.

## Strengths
- **Module-level state:** the scan found no mutable module state that survives a map change. The only module-level `let` (`q1/foundation/pickups.ts:119`) is a lazily built immutable lookup. Every module-level Map is an immutable table, and the WeakMaps are keyed by per-session objects.
- **Per-map state:** `SharedSimulation` builds a new `SessionActorRegistry` (`src/app/bootstrap/simulation/runtime.ts:648`). `createQ1SourceComposition` hangs its state off that, and `registry.close()` clears all `onRelease` listeners. I traced no listener or world-pinning leak. Per-actor maps in Q1Creatures, Q1LevelRules, RogueRunes and Q1AddonContext all have `onRelease` removal.
- **QC quirks kept deliberately:** examples are the discarded `normalize` in LightningDamage (`q1/foundation/weapons.ts:136`), fish double-counted in the total (`q1/base/monsters.ts:405`), the `monster_ogre_marksman` CheckAttack path, the `shooter_think` 500 velocity, and SoldierCheckAttack's chances.
- **Q3 fidelity:** the weapon, combat, team-scoring and mover ports matched the source in every comparison I made, including the Team Arena bonuses, source oddities (documented inline) and `qsort`. The Q3 item tables have no duplicates and the quantities match.
- **Bounded effects:** the local-entity pool (512) and marks use bounded storage.
- **Frame tables:** no dangling `next` or unresolved action survived checking. The apparent misses (`gremlin_gib`, `rknight_run`, `boss_final_decide`, `ai_back(n)`, `dragon_move(n)`) are registered as actions or built from templates.

## Findings

### CONTENT1-001 — id1 and Rogue monsters do not chain-wake through a sighting monster
- **Verification (VERIFY-Q): confirmed. Final severity: High.** RR ai.qc:305-310 sets `client = sight_entity` and returns TRUE early when `client.enemy == self.enemy`; visibility and range run against that monster (ai.qc:327-344), and only ai.qc:349-358 swaps to `client.enemy`. V101 has the same logic. q1/base/monsters.ts:137-138 and foundation/monsters.ts:56 start from `sightEntity.monster.enemy`. Source review: SRCQ1
- Severity: High
- Category: bug
- Location: q1/base/monsters.ts:137-146; q1/foundation/monsters.ts:56-63
- Confidence: traced
- Evidence: `const candidate = game.sightEntity !== null && game.sightTime >= game.time - 0.1 && ... ? game.sightEntity.monster?.enemy ?? null : game.host.checkClient(entity.actor);`, followed by range and `this.visible(candidate)` against that candidate. QC FindTarget sets `client = sight_entity`, runs range, visibility and infront against the sighting monster, and only afterwards replaces it with `client.enemy`. The repository's own ports do this correctly: `q1/addons/monsters/ai/controller.ts:87-111` and `q1/missionpacks/monsters/charm.ts:58-76` (`candidate = game.sightEntity.actor.id`). `MissionMonster.findTarget` only uses the correct path for hipnotic (`q1/missionpacks/monsters/runtime.ts`), so Rogue inherits the bug.
- Impact: In id1, Rogue, and every grunt or dog, a monster that can see the alerted monster but not the player stays asleep. A monster that cannot see the alerted monster but can see the player wakes without a `checkClient` PVS pass and without facing the alerter. Room-wide alerts, a core part of Quake encounter pacing, behave differently from the original.
- Remediation: Port the MG3 and Hipnotic form into BaseMonster and foundation/monsters, including the `client.enemy == self.enemy` early return and the player check.

### CONTENT1-002 — Nightmare pain suppression is missing for almost every monster
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** RR combat.qc:255-261 and V101 combat.qc:219 set `pain_finished = time + 5` after every `th_pain` on skill 3. q1/base/monsters.ts:290-335 has no such rule; foundation/monsters.ts:263 has it only for army. Source review: SRCQ1
- Severity: Medium
- Category: bug
- Location: q1/base/monsters.ts:290-335; q1/foundation/monsters.ts:263 (the only implementation)
- Confidence: traced
- Evidence: QC T_Damage runs `self.th_pain(attacker, take); if (skill == 3) self.pain_finished = time + 5;` for every monster. `src/world/gameplay` never touches `painFinished` (grep across `src/`). The only `skill === 3` pain rule in Q1 content is inside the `army` branch of `monsterPain`, so dogs also skip it. `BaseMonster.pain`, `MissionMonster.pain`, `Q1HeavyMonster.pain` and the boss controllers have none.
- Impact: On Nightmare, knights, ogres, shamblers and others enter pain frames at Hard-skill rates. Sustained fire can stun-lock them, which makes Nightmare materially easier than the original. Zombies also lose the "second hit within 5 s drops them" behaviour.
- Remediation: Set `painFinished = time + 5` on skill 3 in one place after any source pain callback, such as `bindActorCallbacks` `pain`, and remove the army special case.

### CONTENT1-003 — Rogue plus q1:horde throws while the session is being composed
- **Verification (VERIFY-S): confirmed-with-changes. Final severity: Low.** VERIFY-C's ruling stands. The source review made no claim about severity: horde has no original counterpart.
- Severity: Medium
- Category: bug
- Location: composition/q1/runtime.ts:77-85; q1/addons/triggers.ts:81; q1/missionpacks/world/rogue-misc.ts:30; q1/addons/field-triggers.ts:44; q1/missionpacks/world/shooters.ts:52; q1/foundation/entity-services.ts:246-249; catalog/launch.ts:101-118
- Confidence: reproduced
- Evidence: Scratch script `scratchpad/c1scr/horde-repro.ts`, run from the clean checkout. It creates the composition for each program with `horde: true` and `false`. Result: `rogue horde=true THROW: Q1 spawn handler already registered: trigger_explosion`. All other combinations are OK. The code comment says "authored horde maps must work on every Q1 program", and `validateLaunchRoles` only requires a Q1 world family. `trigger_push` is also registered by both sides.
- Impact: Selecting the horde match on a Rogue launch fails at session startup with an uncaught registration error.
- Remediation: Have the horde adjunct use `replaceSpawn` or skip classnames the program already owns, or reject the pairing in `validateLaunchRoles`. Add the matrix as a test, because it needs no map.

### CONTENT1-004 — Rerelease monster obituaries read the wrong field, so kill strings never appear
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** RR client.qc:1736-1738 prints `attacker.killstring`, set e.g. at monsters/grunt.qc:317 and misc.qc:199. Port writers use "killstring" (q1/base/monsters.ts:382) and the reader uses "kill_string" (composition/q1/runtime.ts:209). Source review: SRCQ1
- Severity: Medium
- Category: bug
- Location: composition/q1/runtime.ts:209; q1/base/monsters.ts:382; q1/base/map-entities.ts:69,150,164; q1/base/rules.ts:144
- Confidence: traced
- Evidence: The writers use `entity.fields.set("killstring", spec.killString)`. The only reader uses `killString: entity?.text("kill_string") ?? ""`. Repository-wide grep finds no other reader of `killstring` and no writer of `kill_string`. `q1Obituary` then fails `attacker.killString !== ""` and returns `input.deathType === "falling" ? "$qc_death_fall" : "$qc_death_died"`.
- Impact: In id1 rerelease and addon programs, a player killed by a monster, trap spikeshooter, fireball or changelevel sees the generic "died" text instead of "was slain by ...". The classic edition is unaffected because it uses its own tables. Mission packs use their own obituary table.
- Remediation: Use one key on both sides and add an obituary test for a monster attacker.

### CONTENT1-005 — Player gasp and water-transition sounds exist only in a method nothing calls
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** RR client.qc:1075-1077 (gasp), :1101 (outwater), :1135-1141 (inlava, inh2o, slimbrn2) run per frame in the live path. A grep for `.environment(` under src finds no caller. Source review: SRCQ1
- Severity: Medium
- Category: bug
- Location: q1/base/player.ts:264-281; q1/foundation/entity-services.ts:532-548
- Confidence: traced
- Evidence: `grep -rn '\.environment(' src tests` returns no results. `Q1CharacterActor.environment` is the only place that plays `player/gasp1.wav`, `player/gasp2.wav`, `misc/outwater.wav`, `player/inlava.wav` and `player/slimbrn2.wav`. These are precached (`q1/foundation/precache-world.ts:26,64`), and the only other match is an unrelated `player/inh2o` use in `q1/addons/field-triggers.ts:39`. The live path, `playerFrame`, has a second copy of the drowning and hazard damage with no sounds.
- Impact: Native Q1 players get no surfacing gasp and no water entry, exit, lava or slime sounds. The dead method's state (`airFinished`, `drownDamage`, `hazardAt`, `inWater`) is still saved and restored in checkpoints.
- Remediation: Keep one environment implementation. Move the sounds into the live path and delete the other copy along with its saved fields.

### CONTENT1-006 — Grunts and dogs publish non-player enemies as sight targets, spreading infighting
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** RR ai.qc:265-269 publishes sight_entity only when `self.enemy.classname == "player"`, and ai.qc:350-357 rejects non-player targets. foundation/monsters.ts:51 publishes unconditionally. Source review: SRCQ1
- Severity: Medium
- Category: bug
- Location: q1/foundation/monsters.ts:48-53,239-244; q1/base/monsters.ts:125,137-147
- Confidence: traced
- Evidence: `foundTarget` does `game.sightEntity = entity; game.sightTime = game.time;` unconditionally. BaseMonster guards this with `if (this.game.isPlayer(target))`. `retaliate` calls `foundTarget` with a monster attacker. BaseMonster then reads `game.sightEntity.monster?.enemy` and calls `found(candidate)` with no player check. QC rejects it: `if (self.enemy.classname != "player") { self.enemy = world; return FALSE; }`.
- Impact: When an ogre grenade hits a grunt, any idle id1 or Rogue monster with sight of the ogre within 0.1 s also attacks the ogre. Infighting then spreads to bystanders, which the original never does.
- Remediation: Guard the publish on `isPlayer`, and require a player target in `findTarget` (fixing 001 covers the second part).

### CONTENT1-007 — The enemy-lost interrupt in `play` can leave a downed zombie permanently non-solid
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** No interrupt exists in QC; ai_run alone handles a dead enemy (RR ai.qc:650-667), and zombie.qc:374-388 only sets or restores solid inside paine10/12. Correction: "only splash can hurt it" is a port-only effect, because PF_findradius skips SOLID_NOT (WQ pr_cmds.c:898); see SRCQ1-002. The interrupt also fires on notarget, which QC never checks for an existing enemy; see SRCQ1-005. Source review: SRCQ1
- Severity: Medium
- Category: bug
- Location: q1/base/monsters.ts:66-72; q1/base/frames.ts:1114; q1/base/monster-actions.ts:177,182-185
- Confidence: traced
- Evidence: Before every frame, if the enemy is ineligible, `play` redirects to `this.play(this.enemy === null ? this.route() === null ? this.spec.stand : this.spec.walk : this.spec.run)`. QC has no such interrupt: animations finish and `ai_run` handles a dead enemy. `zombie_paine10` sets `{"kind":"solid","solid":"none"}`, and only `zombie_paine12` restores `slidebox`, about 5 s later. Redirecting out of paine10-12 skips that restore. `inPain` stays 2 until `zombie_run1`, and nothing else restores `solid`.
- Impact: In coop, with infighting, or with notarget toggled, a zombie that is down when its enemy dies stands up non-solid. Direct shots and nails pass through it, so only splash damage can hurt it. It still counts toward the kill total, and this can block monster-count completion. Other monsters also have attack and pain sequences cut short, unlike the original.
- Remediation: Remove the interrupt and let `ai_run` handle lost enemies, as QC does. If it is intentional, at minimum exempt frames with pending state restoration.

### CONTENT1-008 — Grunt and dog AI exist in three separate implementations, and layers import each other
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** Maintainability, port-only. The QC has one implementation path (RR monsters/grunt.qc, rottweiler.qc on ai.qc). SRCQ1-003, -004 and -005 are further drift in the second copy. Source review: SRCQ1
- Severity: Medium
- Category: maintainability
- Location: q1/foundation/monsters.ts:1-317; q1/missionpacks/monsters/charmed-base.ts + tables/grunt.ts + tables/rottweiler.ts; q1/addons/monsters/ordinary/army.ts; q1/foundation/monsters.ts:10; q1/foundation/pickups.ts:12-15
- Confidence: traced
- Evidence: foundation/monsters.ts is a separate sequence-array AI that does not use BaseMonster or `frames.ts`. Findings 001, 006 and 009 show the copies drifting apart. Further duplicates:
  - `initTrigger` has three variants (`q1/foundation/spawns.ts:23`, `q1/base/map-entities.ts:19`, `q1/addons/context.ts:118`).
  - Changelevel logic exists in `q1/foundation/spawns.ts:116,223` and `q1/base/map-entities.ts:89,150`.
  - Foundation imports upward: `from "../base/projectiles.ts"`, plus q3 and composition modules in pickups.ts. `ammoItem` in entity-services.ts:715-728 hard-codes pack weapons.
- Impact: Each AI fix must be found and applied up to three times. Today's bugs are the result.
- Remediation: Express army and dog as BaseMonster species using the existing frame tables, and make foundation depend on nothing above it.

### CONTENT1-009 — A dog can hang forever after a leap that lands on a ledge edge
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** RR monsters/rottweiler.qc Dog_JumpTouch (lines 84-115) has the `!checkbottom && FL_ONGROUND` branch that restarts dog_leap1. foundation/monsters.ts:234-236 has only the grounded branch, and dog_leap9 loops on itself in QC too. Source review: SRCQ1
- Severity: Low
- Category: bug
- Location: q1/foundation/monsters.ts:230-237
- Confidence: traced
- Evidence: `const grounded = game.host.checkBottom(entity.actor.id); if (grounded) {...} return undefined;`. QC Dog_JumpTouch has a second branch: when `checkbottom` fails but the dog is on ground, it re-leaps ("jump randomly to not get hung up"). `q1/base/monster-actions.ts:39` and the gremlin both keep that branch. Leap mode holds the last frame (line 170) and `movement` stays `toss`.
- Impact: A dog landing partly over an edge stays frozen in its leap frame until killed.
- Remediation: Add the on-ground branch.

### CONTENT1-010 — CTF always announces "blue" on flag pickup
- **Verification (VERIFY-Q): refuted. Final severity: Info.** Source-faithful. up/quake-rerelease-qc/quakec_ctf/teamplay.qc:1041-1044 prints `$qc_ks_blue_picked_up` in both the blue and red branches; no red string is used. q1/addons/ctf/flags.ts:53 matches. Source review: SRCQ1
- Severity: Low
- Category: bug
- Location: q1/addons/ctf/flags.ts:53 (compare lines 20, 33, 48)
- Confidence: traced
- Evidence: `state.announce("$qc_ks_blue_picked_up", actor);`. Every sibling announcement branches on team. A red-flag string does not appear anywhere in src. I could not check the rerelease string table, so this could be source-faithful only if the original also lacks a red variant.
- Impact: A blue player taking the red flag is announced as taking the blue flag.
- Remediation: Branch on team if the source has a red string; otherwise document the quirk.

### CONTENT1-011 — Small AI and pickup deviations from QC
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Low.** Painforward is confirmed (RR ai.qc:399 uses `ideal_yaw`; q1/base/monsters.ts:180 uses angles.y). HuntTarget on oldenemy is confirmed (ai.qc:654-658). The megahealth item is refuted: RR items.qc:187-188 and V101 items.qc:178-179 return at `health >= 250` before T_Heal, which matches foundation/pickups.ts:33. Source review: SRCQ1
- Severity: Low
- Category: bug
- Location: q1/base/monsters.ts:180; q1/base/monsters.ts:187; q1/foundation/pickups.ts:33; q1/foundation/monsters.ts:110
- Confidence: traced
- Evidence:
  - `case "painforward": case "forward": ... angles.y`, while QC `ai_painforward` uses `ideal_yaw` and MG3 has it right (`q1/addons/monsters/ai/controller.ts:130`).
  - Switching back to `oldEnemy` skips HuntTarget, so there is no 1 s attack delay and no re-think. MG3 calls it (controller.ts:152).
  - Megahealth is refused at 250 health (`health >= (mega ? 250 : player.maxHealth)`), while QC T_Heal with `ignore=1` still consumes it.
- Impact: Small behaviour differences only.
- Remediation: Align with QC when fixing 001.

### CONTENT1-012 — `misc_fireball` default speed "corrects" a QC bug the port otherwise preserves
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Low.** Classic has the bug: V101 misc.qc:197 and up/Quake/qw-qc/misc.qc both have `self.speed == 1000`, and id1 PAK0 progs misc_fireball has LOAD_F speed, NOT, IFNOT, then EQ_F with a discarded result. Rerelease fixed it (RR misc.qc:201-202 `self.speed = 1000`). So q1/base/map-entities.ts:164 is right for rerelease and wrong only for classic and QW editions. Source review: SRCQ1
- Severity: Low
- Category: bug
- Location: q1/base/map-entities.ts:164
- Confidence: plausible
- Evidence: `entity.speed ||= 1000`. The id1 misc.qc has the no-op `if (!self.speed) self.speed == 1000;`, so unset speed stays 0 and `fire_fly` launches at z = 0-200, not 1000-1200. This is from memory, and I do not know whether the rerelease QC fixed it. The code does not branch on edition.
- Impact: Classic-edition lavaballs without an authored speed fly about five times higher.
- Remediation: Check against both QC sources and branch on edition if they differ.

### CONTENT1-013 — Missing source feedback sounds
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** RR triggers.qc:629-635 plays windfly with the fly_sound limiter; RR doors.qc:228-231 plays misc/talk.wav with the message. foundation/spawns.ts:125 only precaches, and foundation/movers.ts:131 only shows the message. Source review: SRCQ1
- Severity: Low
- Category: bug
- Location: q1/foundation/spawns.ts:125,369-374; q1/foundation/movers.ts:131
- Confidence: traced
- Evidence: `ambience/windfly.wav` is precached, but `push_touch` never plays it. The Rogue version does (`q1/missionpacks/world/shooters.ts:48`). `doorTouch` shows the door message without `misc/talk.wav`, whereas the horde copy of the same function plays it (`q1/addons/horde/index.ts:57`).
- Impact: Wind tunnels are silent, and locked or message doors give no audio cue.
- Remediation: Add both sounds. Horde should reuse the door logic rather than copy it.

### CONTENT1-014 — The axe strike still lands after the attacker dies
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** RR player.qc:179, :184 and :189 fire W_FireAxe from the axe frame functions, which player death frames replace. foundation/weapons.ts:215-226 checks neither health nor intermission. RR weapons.qc W_FireAxe has no guard because the frame chain provides one. Source review: SRCQ1
- Severity: Low
- Category: bug
- Location: q1/foundation/weapons.ts:176-177,215-226
- Confidence: traced
- Evidence: The strike is a separate 0.2 s timer actor. `axeStrike` checks only that the player state and body exist, not health or intermission. In QC the hit runs in `player_axe3`, which death frames replace.
- Impact: A player killed within 0.2 s of swinging can still deal 20 damage.
- Remediation: Return early if health is at or below 0.

### CONTENT1-015 — Entity lookups and float-backed fields are linear or string-based in AI paths
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** QC caches `self.goalentity` and `movetarget` at start (RR ai.qc:238, monsters.qc start functions). The port's q1/base/monsters.ts:149-152 re-finds on each call. Performance only; no behavior claim. Source review: SRCQ1
- Severity: Low
- Category: performance
- Location: q1/foundation/entity-services.ts:388-394; q1/base/monsters.ts:149-152,167,193,213-217; q1/foundation/monsters.ts:102; q3/presentation/resources.ts:151-153
- Confidence: traced (no benchmark)
- Evidence:
  - `find` is `[...this.entities.values()].filter(...)`. It allocates and scans every entity on each walking monster's AI tick, where QC caches `goalentity`.
  - `targetActors` also concatenates and sorts on each `useTargets`.
  - `updateRunKnowledge` writes `String(...)` world fields three times per running monster per tick, and `entity.number()` runs `parseFloat` on each read.
  - `ResourceOwner.picture` runs a regex replace on the shader name on every HUD draw call.
- Impact: Cost scales as walkers × 10 Hz × entities. On a large authored map with many monsters this is avoidable churn, but I did not measure it and it is unlikely to dominate a frame.
- Remediation: Index by targetname, cache route goals, and key pictures by handle or a precomputed lowercase name.

### CONTENT1-016 — Generated-looking tables are committed with no generator, and some are near-duplicates
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** Port-only maintainability; not source-dependent. Source review: SRCQ1
- Severity: Low
- Category: maintainability
- Location: q1/base/frames.ts; q1/missionpacks/monsters/tables/*; q1/addons/monsters/heavy/tables/*; q1/addons/monsters/bosses/frames/*; q1/addons/monsters/heavy/tables/mg3_lavaman.ts vs q1/missionpacks/monsters/tables/lavaman.ts; monsters/q2.ts vs monsters/q2-rerelease.ts; composition/q1-hipnotic-supply.ts:5, q2-q1-supply.ts:41, q3-q1-supply.ts:37
- Confidence: traced
- Evidence:
  - 3,788 lines of frame tables have no generator (`grep` for frame output under `tools/` finds none).
  - The shingle scan rates the lavaman pair at 0.82 overlap, and the diff is only a few `ai charge` operations. It rates q2 vs q2-rerelease at 0.65 (resource lists).
  - The `hipnoticWeapons` overlay is written three times, and only the Q2 version also extends `weaponOwners`.
- Impact: Corrections to frame data must be repeated by hand. Frame-table drift can only be caught through tests.
- Remediation: Generate from QC, or derive MG3 lavaman from the Rogue table with a small operation patch. Share one hipnotic overlay helper.

### CONTENT1-017 — Dead content
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** Port-only dead code; not source-dependent. Source review: SRCQ1
- Severity: Low
- Category: dead-code
- Location: q3/base/map-spawns.ts:27-45; q3/base/game/mover-spawn.ts:290; q3/base/game/item-pickup.ts:77; q3/team-arena/team.ts:76; q3/base/game/state.ts:248-249; q3/presentation/ref-entity.ts:133,160; q1/addons/monsters/bosses/orb.ts:116; q1/addons/monsters/bosses/szombie.ts:101; q1/missionpacks/monsters/helpers.ts:56,58; q1/base/monsters.ts:41; q1/base/projectiles.ts:228
- Confidence: traced (grep across src, tests and tools)
- Evidence:
  - `createQ3SpawnHandlers` has no callers. Its table is a live twin of `src/app/bootstrap/simulation/q3/runtime.ts:462-482`, and the two can drift. `createMoverSpawnHandlers` is also unused.
  - The scan found 22 exports with no reference anywhere (word match; type-only exports included). Those named here are confirmed.
  - `lightningCount` is written and saved but never read.
- Impact: Extra code to read, and a misleading second spawn table.
- Remediation: Delete these, or have the runtime call the shared `createQ3SpawnHandlers`.

### CONTENT1-018 — Throws on content conditions that QC tolerates
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** RR monsters/chthon.qc:381-385 does `dprint` and return, while q1/base/provider.ts:124 throws. item_backpack has no spawn function in RR items.qc (:1429 only sets a classname at drop), so a map-placed one prints "No spawn function" and is freed (WQ pr_edict.c:966), whereas foundation/pickups.ts:92-98 accepts it and throws on a bad key. Source review: SRCQ1
- Severity: Low
- Category: robustness
- Location: q1/base/provider.ts:124; q1/foundation/pickups.ts:98
- Confidence: plausible (outer handling not traced end to end; see the SIM scope)
- Evidence: `throw new Error("event_lightning is missing its two lightning electrodes")`, while QC does `dprint("missing lightning targets\n"); return;`. `throw new Error("Unsupported Q1 backpack weapon ...")` is driven by a map-supplied `weapon` key on `item_backpack`. `q1/base/rules.ts:54` (no DM spawns) matches QC's failure mode, so I do not count it.
- Impact: A malformed custom map can raise an error from a use callback or spawn, rather than the original's debug print. The earlier review (B1) notes that errors in the step can leave the host loop.
- Remediation: Match QC for the lightning case, and warn and ignore for the backpack key.

### CONTENT1-019 — The riskiest AI rules have no direct tests
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** Test gap; not source-dependent. Source review: SRCQ1
- Severity: Low
- Category: test-gap
- Location: tests/ (grep)
- Confidence: traced
- Evidence: `grep -rln 'sightEntity\|sightTime' tests` returns nothing. `grep -rn 'painFinished' tests` returns nothing, and neither do `kill_string`, `$qc_ks_knight` or `qc_death_died`. The only `q1:horde` test (`tests/content/catalog/catalog.test.ts`) covers launch selection, not composition.
- Impact: Findings 001-004 and 006 went unnoticed.
- Remediation: Add behaviour tests for sight chaining, Nightmare pain and obituaries, plus the program-by-match composition matrix.

### CONTENT1-020 — FIXME at q3/presentation/entities.ts:147 is faithful to the source, but leaves discarded work
- **Verification (VERIFY-Q): confirmed. Final severity: Info.** `cgame/cg_ents.c:681-692` computes angular deltas, applies only translation, and ends in the quoted FIXME. Source review: SRCQ3
- Severity: Info
- Category: docs
- Location: q3/presentation/entities.ts:140-149
- Confidence: traced
- Evidence: `// The baseline computes angular deltas but only applies translation (its FIXME).` This matches CG_AdjustPositionForMover, which ends in `// FIXME: origin change when on a rotating object`. The two `evaluateTrajectory(mover.apos, ...)` calls have their results discarded.
- Impact: There is no defect against retail. A client standing on a rotating mover is not rotated in prediction, as in the original, and the two calls allocate and do nothing.
- Remediation: Remove the two calls, or implement the rotation as an opt-in improvement.

### CONTENT1-021 — The Q3 rankings port targets a defunct service
- **Verification (VERIFY-J): confirmed-with-changes. Final severity: Info.** The untraced consumer is now traced: reports flow to ApplicationQ3Rankings (q3-rankings.ts:26-31) and RankingLifecycle, which need options.rankings (application.ts:247). No production code supplies that option or implements RankingServiceProvider, so reports have no live sink. rankings.ts is 704 lines.
- Severity: Info
- Category: maintainability
- Location: q3/base/game/rankings.ts (704 lines; sampled)
- Confidence: plausible
- Evidence: This is a transliteration of g_rankings.c into integer-keyed reports, called from every pickup, shot and death (`if (this.warmup()) return;` guards the sink). It has an attached owner in `src/app/bootstrap/application.ts:274`, but I did not trace what consumes the reports.
- Impact: 704 lines of rarely useful code are called on hot gameplay paths.
- Remediation: Decide whether the reports have a real consumer, and remove them if not.
