# CONTENT2 — Quake II content: src/content/q2/** and src/content/monsters/q2*.ts

## Coverage
Read in full (about 7,400 lines of logic):
- foundation/monsters: index.ts (882), ai.ts (450), perception.ts (483), soldier.ts (273), types.ts (205), gibs.ts (102)
- foundation: entity-services.ts (397), runtime.ts (84), callbacks.ts (72), targets.ts (354), host.ts (293), weapons/ballistics.ts (552)
- base/monsters: common, tank, flyer, boss-common, brain, makron, medic, mutant, floater, hover, berserk, boss2, jorg, boss3-stand, chick, flipper, gladiator, index
- base/player/spawns.ts lines 1-50 of 113 (the spawn module); multiplayer/horde.ts (121); multiplayer/ctf/flags.ts (133); rerelease/monsters/generate-tables.ts (123)

Sampled:
- foundation/items.ts: lines 1-347 and 350-884 of 933
- foundation/movers.ts: lines 120-619 of 619
- foundation/monsters/moves.ts: lines 1-700 of 1623 (rest scripted); infantry.ts: lines 55-70 of 224
- base/monsters/gunner.ts: lines 1-55 of 59. base/entities/movers.ts: lines 150-230 of 280
- equipment/ctf-grapple.ts: lines 20-130 of 230. missionpacks/projectiles/trap.ts: lines 20-193 of 193 (about 90%, read against Trap_Think)
- multiplayer/lmctf/runtime.ts: lines 95-160 of 179. multiplayer/ctf/techs.ts: lines 50-72 of 136
- base/player/index.ts: lines 140-160 of 672. rerelease/players.ts: lines 96-106 of 526
- monsters/q2.ts: lines 1-60 of 451

Scripted across the whole scope:
- All 70 move tables (1,031 moves, about 33K lines): row count vs frame span, duplicate names, nextframe range, byte-identical moves and tables, move names unreferenced by logic.
- All non-table .ts files: schedule and callback naming, module-level mutable state, actor-keyed collections with no removal path, long-line density.

Skipped (not read; no claim either way):
- foundation/weapons/player.ts (768) and smaller foundation files (motion, angular-motion, scenery, weapon-attachments, hand-action, generic-frame); base/player/index.ts remainder, commands.ts, view.ts, character.ts
- base/monsters actor.ts, insane.ts, parasite.ts, supertank.ts; move tables were scripted only
- base/entities scenery.ts, turrets.ts, targets.ts, triggers.ts
- Nearly all of missionpacks (monsters, spheres, mines, nuke, bolts, modes, about 4,800 lines of logic)
- Nearly all of rerelease logic (entities.ts, index.ts, players.ts remainder, monsters/*, base-variants/*, q64)
- equipment/hand-grenades.ts, lmctf-grapple.ts, grapple-weapon.ts; lmctf and ctf files not listed above
- monsters/q2-expansions.ts, monsters/q2-rerelease.ts (read only their headers)

Comparisons to id and rerelease source come from recollection of the source, because no checkout is available. Divergences I could not confirm by another route are labeled `plausible`.

## Strengths
- The classic port is unusually faithful. I compared tank, flyer, brain, medic, mutant, hover, floater, berserk, makron, jorg, soldier, M_MoveFrame, ai_stand/ai_charge, M_CheckAttack, fire_lead/rail/hit/blaster/grenade/rocket/bfg, doors, trains, plats, item pickup and CTF capture line by line. Constants, channels, attenuations, dangling-else quirks and map hacks (jail5, fact1) all match.
- Module-level mutable state is effectively absent. The only module-level WeakMap/WeakSet instances are keyed by per-world objects (flyer.ts, brain.ts, boss-common.ts, makron.ts, power-armor.ts), so they cannot pin an old world. Q2ProductRuntime is built per world (runtime.ts:3807).
- Actor-keyed maps are cleaned through `actors.onRelease`. The scan found no real unbounded collection in the code it covered.
- Move registration validates frame rows, source AI and callback references at startup (index.ts:221-227). The scan found no out-of-range nextframe and no duplicate move name inside any table.
- Saves use name-based callbacks with a hard failure on an unnamed one, which is why finding 001 fails loudly instead of corrupting a save.

## Findings

### CONTENT2-001 — Inline think closures make every checkpoint throw on 15 coop maps, which blocks saves and level exits
- **Verification (VERIFY-Q): confirmed. Final severity: High.** The original saves functions by table, so it cannot fail here. p_client.c:108-117 and :137-162 set named think SP_CreateCoopSpots/SP_FixCoopSpots on `security` and the same 14 coop maps the port lists; the port's lambdas are the only divergence. Source review: SRCQ2
- Severity: High
- Category: bug
- Location: src/content/q2/base/player/spawns.ts:15, :34; src/content/q2/foundation/callbacks.ts:34-37; src/content/q2/foundation/entity-services.ts:65, :175-178; src/content/q2/foundation/targets.ts:219, :244; src/app/bootstrap/application.ts:3556, :3589
- Confidence: reproduced for the capture throw; traced for the travel consequence
- Evidence:
  - spawns.ts:34 passes a lambda: `game.schedule(entity, 0.1, (self, active) => {` for `info_player_coop` on the `fixedCoopMaps` list (jail2, jail4, mine1-4, lab, boss1, fact3, biggun, space, command, power2, strike). Line 15 does the same for `info_player_start` on `security`.
  - The think wrapper does not clear `entity.think` after firing: `const callback = entity.think; entity.nextThink = null; callback(entity, this)`. So the closure stays on the entity for the rest of the map.
  - `capture()` calls `sourceCallbacks.think.name(think)`, which throws `Q2 save encountered an unnamed source callback`.
  - c2/repro-save.ts output: `jail2 info_player_coop after think fired capture THROWS: Q2 save encountered an unnamed source callback`; `security info_player_start` the same; `base1` capture OK.
  - Q2 campaign travel checkpoints the world first: application.ts:3556 `advanceQ2Travel(parseQ2Travel(original), carry)`, then :3589 `this.simulation.checkpointLoading(...)`, then `captureQ2Product`. The throw is caught at :3557 and only printed as `Campaign transition failed: ...`.
  - `use_target_changelevel` has already set `self.transitionStarted = true` (targets.ts:244), and nothing resets it, so that exit never fires again.
- Impact: Starting coop on any listed map (`security` included) means manual saves fail and the first level exit fails with a console error. That target_changelevel is then dead, so the party is stuck unless another exit exists. Singleplayer does not hit this path because both spawns are coop-gated.
- Remediation: Name both callbacks and add them to a `callbacks` table on `q2PlayerSpawns`, as other modules do. Clear `transitionStarted` when travel fails.

### CONTENT2-002 — Classic hover corpse think is an unregistered closure, so saves and level exits fail while it falls
- **Verification (VERIFY-S): confirmed-with-changes. Final severity: Low.** VERIFY-C's measured 0.6 s window stands. The source review confirmed the difference from m_hover.c but did not re-measure reach.
- Severity: Medium
- Category: bug
- Location: src/content/q2/base/monsters/hover.ts:44-49
- Confidence: reproduced
- Evidence: `const think: Q2Think = (self, services) => {...}; return game.schedule(entity, 0.1, think);`. This is the only classic base monster doing so; the Rogue and rerelease hover variants register theirs. The repro at c2/repro-dodge.ts prints `hover_dead fired capture THROWS: Q2 save encountered an unnamed source callback`.
- Impact: From hover_dead until the corpse lands or 15 s passes, a save fails. Taking a level exit in that window fails as in 001 and leaves that exit latched dead (traced), a singleplayer soft-lock with a small window. The closure's `deadline` is also not persisted.
- Remediation: Use a named module-level `hover_deadthink` with `entity.timestamp` as the deadline, as the Rogue variant does at missionpacks/monsters/hover.ts:15.

### CONTENT2-003 — Classic monsters with no dodge callback acquire an enemy on a 25% roll, then freeze in their stand animation
- **Verification (VERIFY-S): confirmed-with-changes. Final severity: Medium.** VERIFY-C's narrow-trigger finding stands. The source review confirmed the mechanism at g_weapon.c:47 but did not re-test how often monsters stay frozen.
- Severity: High
- Category: bug
- Location: src/content/q2/foundation/monsters/index.ts:676-682; src/content/q2/foundation/monsters/perception.ts:240, :318
- Confidence: reproduced
- Evidence:
  - check_dodge in the source requires `tr.ent->monsterinfo.dodge`. The port's fallback runs for every definition without `dodge`: `if (r > 0.25) return undefined; if (entity.enemy === null) entity.enemy = attacker; if (state.kind === "infantry") ...; if (state.kind !== "soldier") return undefined;`.
  - Only soldier and infantry have a follow-up animation. Tank, gladiator, berserk, mutant, parasite, flyer, floater, hover, flipper, supertank, boss2, jorg, makron and the rest get the enemy with no FoundTarget.
  - ai_stand then calls findTarget, which hits `if (candidate === entity.enemy ...) return true`, and `runAi` returns before hunting or attacking (ai.ts:305).
  - reactToDamage also returns early because `attacker === entity.enemy` (perception.ts:318), so taking damage does not wake it through FoundTarget either.
  - Repro with `monster_tank`, in c2/repro-dodge.ts: after `dodge()` with roll 0.1, `enemy player move tank_move_stand`. 5.5 s later with the player 200 units directly in front: `move tank_move_stand enemy player goal null`.
- Impact: In classic play, shooting a blaster, hyperblaster, rocket or BFG (fireBlaster, fireRocket, fireBfg call checkDodge) along a line that hits an unaware monster has a 25% chance per shot (skill 0: about 6%, because check_dodge also rolls) of disabling its AI. It only recovers if a pain animation ends in its run callback. On skill 3 most pain handlers return before the animation, and pain with low damage is ignored on tank, so it can stay frozen. The extra `host.random()` draw also shifts the RNG stream compared with source.
- Remediation: In the classic branch, return before rolling unless the kind has a source dodge (soldier and infantry; the others already provide `definition.dodge`).

### CONTENT2-004 — T_Damage's AI_DUCKED pain gate and the nightmare debounce are not ported for classic monsters
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** g_combat.c:508-514: `if (!(aiflags & AI_DUCKED) && take) { pain(...); if (skill == 3) pain_debounce_time = level.time + 5; }`. index.ts:157-163 has neither condition. Source review: SRCQ2
- Severity: Medium
- Category: bug
- Location: src/content/q2/foundation/monsters/index.ts:157-163
- Confidence: traced
- Evidence:
  - Source: `M_ReactToDamage(targ, attacker); if (!(targ->monsterinfo.aiflags & AI_DUCKED) && take) { targ->pain(...); if (skill->value == 3) targ->pain_debounce_time = level.time + 5; }`.
  - Port: `this.perception.reactToDamage(context, reaction.attacker); ... else definition?.pain?.(context, reaction);`. There is no ducked check and no `+ 5`.
  - A repo-wide grep for `painTime` finds only species handlers and the missionpack adjustment. GameplayAuthority dispatches pain unconditionally (world/gameplay/authority.ts:594).
- Impact:
  - Ducking soldiers, gunners, medics, chicks and brains flinch out of their duck.
  - The leaping mutant (`state.ducked = true` at mutant.ts takeoff) is knocked into a pain move mid-jump instead of finishing the leap.
  - On nightmare, pain sounds and the soldier and gladiator airborne pain moves retrigger every 3 s instead of every 5 s.
- Remediation: Add both source conditions to the classic branch of `sourcePain`.

### CONTENT2-005 — train_blocked lost the branch that destroys non-living obstacles
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** g_func.c:1461-1471 has the non-living branch (100000 damage, then BecomeExplosion1) before the debounce and dmg checks. movers.ts:582-588 omits it. Source review: SRCQ2
- Severity: Medium
- Category: bug
- Location: src/content/q2/foundation/movers.ts:582-588
- Confidence: traced
- Evidence:
  - Source starts with `if (!(other->svflags & SVF_MONSTER) && !other->client) { T_Damage(..., 100000, 1, 0, MOD_CRUSH); if (other) BecomeExplosion1(other); return; }`, before the debounce and `dmg` checks.
  - Port: `if (body === null || self.damage === 0 || services.host.now() < state.debounce) return undefined; ... if (services.host.combat.read(other) !== null) services.damage(other, self, self.actor.id, self.damage, ...)`.
  - The sibling `doorBlocked` at movers.ts:533-537 has the branch.
- Impact: A solid non-living object in a train's path is not removed. An explobox takes 100 damage instead of being destroyed, and a grenade or trap with no combat record, or any obstacle against a `BLOCK_STOPS` train (damage 0), just stops the train until it leaves. A train used as a lift can stall.
- Remediation: Port the same branch used in doorBlocked ahead of the debounce check.

### CONTENT2-006 — func_button receives door_blocked, which hurts blockers and reverses the button
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** SP_func_button (g_func.c:763) sets no `blocked` and no `dmg`. movers.ts:280 and :311 give buttons both. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/movers.ts:278-280, :311, :539-541
- Confidence: traced for the assignment; plausible for how often it triggers, since I did not run the pusher physics
- Evidence: SP_func_button sets no `blocked`. `spawnDoor` is shared and sets `entity.blocked = this.doorBlocked` for all kinds, clearing it only for water, and `entity.damage ||= 2` also applies to buttons.
- Impact: A player or monster blocking a button's travel takes 2 damage per block and flips its direction, where source would hold in place until the obstacle moved.
- Remediation: Clear `blocked` for buttons as is done for func_water.

### CONTENT2-007 — Classic soldier die omits `s.skinnum |= 1`, so corpses can keep the undamaged skin
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** m_soldier.c:1166 `self->s.skinnum |= 1` runs on every regular death. soldier.ts:162-165 has no equivalent for classic. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/monsters/soldier.ts:163 (soldierDie regular-death block); src/content/q2/foundation/monsters/index.ts:666-667
- Confidence: traced
- Evidence: Source soldier_die sets `self->s.skinnum |= 1` before choosing the death sound. The port only sets the skin in soldierPain, and `setSkin` returns early for classic: `context.game.options.edition !== "rerelease"`. Killed reactions do not call pain.
- Impact: A soldier killed from above 50% health, a common case with 20-40 HP soldiers, shows the healthy skin on its corpse.
- Remediation: Set `entity.skin |= 1` in the classic regular-death path.

### CONTENT2-008 — Classic soldier gib set appears to differ from source
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** m_soldier.c:1152-1155: 3 sm_meat, 1 chest, head2. soldier.ts:155-157 throws 2 bone, 4 sm_meat, head2 in the classic branch. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/monsters/soldier.ts soldierDie classic gib branch
- Confidence: plausible
- Evidence: The port throws 2 bone, 4 sm_meat and head2. My recollection of m_soldier.c is 3 sm_meat, 1 chest, head2. monsters/q2.ts precaches `models/objects/gibs/chest/tris.md2` for soldier, which is consistent with that, although bone is also listed.
- Impact: Wrong gib models and counts, plus a different RNG draw count on gib.
- Remediation: Check against m_soldier.c and adjust if confirmed.

### CONTENT2-009 — An authored monster `item` is dropped again after a medic revive
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** g_monster.c:511-520 clears `self->item = NULL` after Drop_Item. index.ts:644-648 reads the spawn value each first death. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/monsters/index.ts:644-648; src/content/q2/base/monsters/medic.ts cable attack frame attack50 branch
- Confidence: traced
- Evidence: Source monster_death_use does `Drop_Item(self, self->item); self->item = NULL;`. The port reads `entity.spawn.values.get("item")` on every first-death path and never clears it, and `respawn` resets `state.dead = false`. The medic revive clears target, targetname, combatTarget and deathTarget, but not the item.
- Impact: Each revive-and-kill cycle yields another copy of the item, including keys when a map authors one.
- Remediation: Record the drop on the entity and skip later drops.

### CONTENT2-010 — Killed() bookkeeping missing: coop kill score and "medics won't heal their own kills"
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** g_combat.c:105-109 has both the coop `resp.score++` and `targ->owner = attacker`. index.ts:637 has neither. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/monsters/index.ts:637-638
- Confidence: traced by grep, comparing against recalled source
- Evidence: Source Killed has `if (coop->value && attacker->client) attacker->client->resp.score++;` and `if (strcmp(attacker->classname, "monster_medic") == 0) targ->owner = attacker;`. The port only does `game.counters.killedMonsters++`. obituary.ts scores deathmatch only, and `"monster_medic"` appears only in the definition.
- Impact: Coop scoreboards stay at 0 for monster kills. Medics can revive monsters they killed during infighting.
- Remediation: Add both to `die`.

### CONTENT2-011 — stepDirection uses a wrapped angle delta where classic used a raw one
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** m_move.c:369-370 tests the raw `angles[YAW] - ideal_yaw` (also original/xatrix/m_move.c:381-382, original/rogue/m_move.c:631-634). Rerelease uses FacingIdeal instead. ai.ts:214 wraps for all editions, so it is wrong only for classic. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/monsters/ai.ts:214-215
- Confidence: plausible
- Evidence:
  - Classic m_move.c: `delta = ent->s.angles[YAW] - ent->ideal_yaw; if (delta > 45 && delta < 315) { restore origin }`. This is not wrapped, so a negative delta (turning toward a higher yaw) never cancels the step.
  - Port for all editions: `((angles.y - idealYaw) % 360 + 360) % 360`, which matches the rerelease FacingIdeal but rejects steps in classic that source accepted (angles 20, ideal 90: source steps, port does not).
- Impact: Classic walkers stall for extra frames on one turning direction, changing movement cadence and path shape relative to source.
- Remediation: Use the raw delta when edition is classic and rules are base.

### CONTENT2-012 — SV_NewChaseDir axis swap probability looks wrong for base rules
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Low.** m_move.c:444 and original/rogue/m_move.c:709 are `(rand()&3)&1`; rerelease/m_move.cpp:1073 is `brandom()`. All are 1/2. ai.ts:233 gives 3/4 for every non-rogue rule, so rerelease without Rogue is also wrong, not only base. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/monsters/ai.ts:232-233
- Confidence: plausible
- Evidence: `(rules === "rogue" ? (directionRoll & 1) !== 0 : directionRoll !== 0) || Math.abs(delta.y) > Math.abs(delta.x)`. The base branch swaps with probability 3/4. My recollection of Q2 m_move.c, Q1 sv_move.c and the rerelease is `((rand()&3) & 1)` (1/2). The rerelease edition without Rogue also takes this branch, since `setSourceCombatRules("rogue")` is only set for the rogue pack (missionpacks/monsters/index.ts:55).
- Impact: Different chase-direction bias when a monster is blocked.
- Remediation: Check against a source checkout. No test pins this (grep of tests finds no reference).

### CONTENT2-013 — Small source omissions in triggers and targets
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** g_trigger.c:338 and :346 play on `activator`; targets.ts:259 plays on self. g_target.c:178-180 is the mine3 hack. g_target.c:292 is the exit broadcast. Neither exists in the port. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/targets.ts:259, :143-148, :225-230
- Confidence: traced for the code; recollection for the source lines
- Evidence:
  - trigger_counter plays talk1 on the counter entity (`services.sound(self, "misc/talk1.wav", 0)`). Source plays it on `activator`, so it can be inaudible when the counter is far away.
  - SP_target_secret's map hack for `mine3` at origin (280, -2048, -624), `ent->message = "You have found a secret area."`, is absent. A grep for `mine3` finds only the coop spawn list.
  - The deathmatch `"%s exited the level."` broadcast from use_target_changelevel is absent.
- Impact: Cosmetic and message-level differences.
- Remediation: Port the three lines.

### CONTENT2-014 — player_noise entities are orphaned when a player actor is released
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Low.** The original also never frees mynoise (p_weapon.c:78-95; ClientDisconnect at p_client.c:1504 does not touch it), but the pointers live on the reused client edict, so the count is bounded by 2 x maxclients. The port's per-actor pair grows with reconnects, which is the real difference. The "orphaned" wording alone would also describe the original. Source review: SRCQ2
- Severity: Low
- Category: leak
- Location: src/content/q2/foundation/monsters/perception.ts:174-180, :136
- Confidence: traced
- Evidence: `reportNoise` creates two `player_noise` entities per player. `release(actor)` runs `this.noises.delete(actor)` without calling `game.remove` on them, and the entities remain in `game.entities`, holding source slots.
- Impact: Two leaked entity slots per released noisy player, scaling with reconnects within one map. Bounded by the world's lifetime since the runtime is per map.
- Remediation: Remove the pair in `release`.

### CONTENT2-015 — Per-monster, per-frame full entity scan in rerelease dodge checks, plus avoidable sorts
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** rerelease/g_monster.cpp:847-853 gates on dodge_time and uses gi.BoxEdicts over absmin-512..absmax+512. The port's full entity scan has no original counterpart; the proposed remedy matches the source. Source review: SRCQ2
- Severity: Low
- Category: performance
- Location: src/content/q2/foundation/monsters/index.ts:727, :309; src/content/q2/foundation/entity-services.ts:144, :295, :310-334
- Confidence: reproduced for the scan cost (micro-benchmark only); traced for the rest
- Evidence:
  - `checkDodge` does `for (const projectile of game.entities.values())` once per think for every live monster with duck, sidestep or dodge. A model of 100 monsters × 1,500 entities × 40 Hz cost 22 ms per simulated second before any trace (c2/bench.ts). This is a Map-iteration model, not a capture from the game.
  - `endFrame` allocates and sorts all contexts every rerelease frame.
  - `allocateActor` spreads and sorts `freedSlots` per allocation.
  - `targetActors` rebuilds and sorts all entities on every iteration of the `useTargets` loop.
- Impact: About 2% of a core in a large rerelease map from the scan alone. O(targets × entities) on target fires.
- Remediation: Keep a live-projectile set or use `host.nearby` with the 512-unit box. Keep a min-ordered free list.

### CONTENT2-016 — Horde spawns a batch at the same point when points are fewer than the batch
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** No source claim; port-only feature. See Coverage. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: src/content/q2/multiplayer/horde.ts:110-117
- Confidence: plausible
- Evidence: `const point = this.points[(this.spawnedThisWave + index) % this.points.length]` with a batch of up to 4 and no occupancy check or killbox. `sourceMoveStep` rejects steps that start solid (ai.ts:180-183).
- Impact: On a map with fewer points than the batch, monsters overlap at one origin and can be unable to walk apart. After wave 15 the think stops with no match end (horde.ts:35).
- Remediation: Check occupancy before spawning and defer if the point is blocked. Signal completion.

### CONTENT2-017 — 1.39 MB of frame tables with partial provenance, heavy duplication and retained dead moves
- **Verification (VERIFY-Q): confirmed. Final severity: Info.** The source-data claims hold: m_boss2.c declares boss2_move_fidget at original/baseq2/m_boss2.c:213, m_actor.c:134 declares actor_move_run as run02-run07 and m_float.c:238 declares floater_move_activate as actvat01-31. Source review: SRCQ2
- Severity: Info
- Category: maintainability
- Location: src/content/q2/base/monsters/tables/*, src/content/q2/missionpacks/monsters/tables/*, src/content/q2/rerelease/monsters/tables/*, src/content/q2/foundation/monsters/moves.ts, frames.ts; src/content/q2/rerelease/monsters/generate-tables.ts
- Confidence: reproduced (scripted)
- Evidence:
  - Table files total 32,924 lines and 1,393,535 bytes.
  - generate-tables.ts handles only rerelease syntax, needs `QTS_Q2_RERELEASE_SOURCE`, and a grep finds no reference to it from package.json, tools or scripts. Base and mission-pack tables have no generator in the repo.
  - 349 of 1,031 moves are byte-identical to a move in another file. rerelease/tables/boss32.ts equals base/tables/boss32.ts entirely. Many pairs share over 80% of moves (for example, rogue-flyer and base flyer 17/19, tank 16/19).
  - 83 moves are unreferenced by logic. Most are source-retained (for example `hover_move_takeoff`, `fixbot_move_land`, `guncmdr_move_pain1`).
  - 14 moves have rows differing from their span, all explained by source data: `boss2_move_fidget` first=21 last=0, `actor_move_run` 12 rows for 6 frames, and `floater_move_activate` 30 rows for 31 frames, filtered out at base/monsters/floater.ts:11 and rogue-variants.ts:54.
- Impact: A correction to a shared move has to be made in up to four places, and the base tables cannot be regenerated.
- Remediation: Share identical moves by reference and check in a generator or a provenance note for the base and pack tables. Not urgent, since the data is correct as far as checked.

### CONTENT2-018 — Dead state and layering leaks
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Low.** The flyer part is faithful dead code, not a port defect: m_flyer.c:497 flyer_setstart has no table reference in the source either (only the prototype at :47), and `static int nextmove` (:33) is only written there. Keep or drop by choice. The ballistics, bodyOf and import claims have no source angle and stand. Source review: SRCQ2
- Severity: Low
- Category: dead-code
- Location: src/content/q2/foundation/weapons/ballistics.ts:66-68, :133-137; src/content/q2/foundation/monsters/ai.ts:450; src/content/q2/base/monsters/flyer.ts:8, :44-49; src/content/q2/foundation/items.ts:17-20
- Confidence: traced
- Evidence:
  - `Q2Ballistics.noises`, `soundEntity` and `sound2Entity` are written and checkpointed, but a grep finds no reader outside checkpoint code. `MonsterPerception` keeps its own `primary` and `secondary`.
  - `bodyOf` has no callers.
  - `flyer_setstart` is not referenced by any table, so `nextMoves` is never set, `flyer_nextmove` is always a no-op, and the module-level WeakMap is dead.
  - foundation/items.ts imports `content/q3/base/shared/items.ts`, `content/q3/foundation/arsenal.ts` and `composition/q3-q2-supply.ts`, so the Q2 foundation depends on Q3 content and on composition.
- Impact: Extra save format surface for unused data, and a coupling that blocks independent Q2 loading.
- Remediation: Delete the unused fields. Inject foreign item definitions through composition.

### CONTENT2-019 — Very dense lines in the riskiest logic
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** No source claim. Source review: SRCQ2
- Severity: Low
- Category: maintainability
- Location: src/content/q2/foundation/monsters/index.ts (24 lines over 200 characters, for example :177, :450); src/content/q2/foundation/monsters/perception.ts:37, :58
- Confidence: reproduced (scripted count)
- Evidence: 243 non-table lines under src/content/q2 exceed 240 characters. Classic, rerelease and rogue rules are interleaved in one expression, for example perception.ts:37 and :54-58. The classic-only bugs above (003, 004) sit in such branches.
- Impact: Edition-specific divergences are hard to review against source, and a change to one edition can affect another.
- Remediation: Split edition rules into separate functions at the entry points of checkAttack, moveFrame and dodge.
