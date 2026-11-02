# GAPQ12B — Q1/Q2 content left unread by GAPQ12: mission-pack monsters, rerelease, player view and spawns, Q1 mission-pack and addon logic

All paths are relative to `src/content/` unless they start with `src/`. HEAD fcdc8af5.

No QuakeC or game C source is in the repository or in `qfiles`. Source comparisons come from my memory of the Rogue, Xatrix and rerelease C and of runes.qc and teamplay.qc. Each finding that relies on memory says so. Frame and move tables were skipped as instructed.

## Coverage
**Read line by line (about 7,300 lines). To fit my context limit, some reads cut each line at a fixed width, so a few very long lines were not seen to their end. The widths were 420 characters for the q2/base/player and q2/rerelease groups, 360 for the q1/missionpacks group except the last two files, 340 for the first addon group, and 500 for the second addon group, morph excepted. Known cut lines are rogue-teams.ts 20, 90, 98, 119, 121, 140 and 157, gremlin-weapons.ts 112 and rogue-plats.ts 60. Everything in q2/missionpacks/monsters and q2/rerelease/monsters was read uncut:**
- q2/missionpacks/monsters (2,900): hints, medic, spawn, state, types, carrier, widow, widow2, widow/common, widow/death, fixbot, rogue-common, index, combat, dabeam, power-armor, chick-heat, flyer, gekk, gladb, hover, rogue-gunner, rogue-jumpers, rogue-arsenal
- q2/rerelease/monsters (680): base-variants/medic, common, spawn-placement, beam, boss
- q2/rerelease (495): spawns, q64/index, killbox, environment, lights, fog
- q2/base/player (466): spawns, landmarks, environment, character
- q1/missionpacks (1,245): monsters/runtime, monsters/decoy, monsters/gremlin-weapons, monsters/morph, monsters/overlord, backpacks, grapple, world/hipnotic-spawn, world/rogue-runes, world/rogue-teams, world/rogue-ending, world/rogue-plats
- q1/addons (1,530): ctf/runes, ctf/state, ctf/flags, ctf/drops, ctf/teams, ctf/index, ctf/arsenal, ctf/scoring, ctf/observer, horde/index, horde/loot, monsters/bosses/final, monsters/bosses/oldnew-children, monsters/bosses/sacrifice

**Sampled, only to trace a finding:** q2/foundation/monsters/index.ts (284-300, 342-362, 391-413, 622-640), q2/foundation/callbacks.ts 15-35, q2/foundation/items.ts 346-350 (this closes the line GAPQ12 left open), q2/base/monsters/common.ts 43-51, q1/missionpacks/monsters/gremlin.ts 28-48 and grep, q1/missionpacks/player.ts 132-140, q1/foundation/entity-services.ts 123-131, 278-296, 408-418, q1/foundation/weapons.ts 89-115, composition/q1/clients.ts, composition/q1/runtime.ts 63-66, 116, 216-218, src/world/gameplay/inventory.ts, src/app/bootstrap/simulation/runtime.ts 1285, 2616-2622.

**Could not reach (not read; no claim either way, about 9,000 lines, a few hundred of them types and index files):**
- q2/missionpacks/monsters: rogue-infantry, rogue-soldier, rogue-variants, soldierh, xatrix-variants (about 590).
- q2/rerelease/monsters: arachnid, berserk, gladiator, guardian, guncmdr, gunner, index, shambler, supertank, tank, generate-tables, and base-variants other than medic (about 2,500).
- q2/rerelease: view, obituary, types, world-text, debug-shapes (about 300).
- q2/base/player: view, obituary, types, checkpoint, resources (about 460).
- q2/foundation/items.ts and movers.ts: nothing further read beyond the lines above. CONTENT2 and GAPQ12 cover most of them, and I did not recheck that.
- q1/missionpacks: items, selection, runtime, travel, obituaries, presentation, messages, pickup-rules; monsters gremlin (except as sampled), gremlin-ai, dragon, lavaman, mummy, wrath, scourge, eel, sword, spikemine, paths, helpers, charmed-base; world shooters, rotate-targets, rogue-time, rogue-tag, rogue-pendulum, rogue-misc, rogue-hazards, hipnotic-triggers, hipnotic-train, hipnotic-rotate, hipnotic-particles, campaign, finale-text, common (about 2,500).
- q1/addons: brushes, campaign, effects, field-triggers, lights, rope, travel, corpses, context, base-triggers, triggers past line 80, ctf/{maps,grapple,travel,types}, horde/{squads,types}, items/{pickups,upgrades,weapons,lavasuit,common}, monsters/* except the three boss files above (about 2,600).
- composition: not re-read.

**Comparison limits:** Carrier, widow, medic, fixbot, kamikaze and spawn growth matched my memory of the C closely. Rerelease comparisons are weaker. I have no reliable memory of MG1 horde.qc or rogue morph.qc.

## Strengths
- Summon accounting is careful. The classic medic clears `spawnedBy` before a revive (medic.ts:135), so a revived child does not refund a slot twice. Widow, carrier and medic children all return slots through one path (foundation/monsters/index.ts:629-634).
- The kamikaze's three exits (blocked, explode, no enemy) return the slot exactly once and match flyer_blocked. `explode` frees the entity, so `isLive` in `blocked` stops a double refund. This was a suspicion, and it is refuted.
- Power armor: `configure` does not validate count against capacity, so the widow's stale `entry.capacity` closure (power-armor.ts:21) cannot throw. I suspected a crash on the skill-3 re-arm. It is refuted.
- The gremlin's ammunition starts as a source counter (gremlin.ts:138) and `cloneEntity` copies the inventory, so `adjustSourceCounter` cannot throw on a split child. This was a suspicion, and it is refuted.
- Hint path restore validates chain indexes before use (hints.ts:42), and `finalize` runs once from composition/q2/index.ts:303.
- Death debris, spawn growth, the widow's powerup think and the legs think are all named callbacks. None of them repeats the CONTENT2-001 closure problem.
- CTF `afterQuad` tolerates a released attacker because it reads inventory by id (ctf/runes.ts:74). `friendly` in ctf/scoring.ts is safe too, because `playerNumber` returns 0 for a released actor (addons/context.ts:86-92). Rogue's rune hook does not tolerate it; see GAPQ12B-001.

## Findings

### GAPQ12B-001 — In Rogue deathmatch, a projectile whose owner has left terminates the server when it does damage
- **Verification (VERIFY-Q): confirmed. Final severity: High.** quakec_rogue/combat.qc:184-185 runs RuneApplyBlack in deathmatch, and runes.qc:188-193 reads `who.rune` from an edict that persists, so no fault is possible. The port throw is a port fault. Source review: SRCQ1
- Severity: High
- Category: robustness
- Location: q1/missionpacks/world/rogue-runes.ts:31,42,71; q1/foundation/weapons.ts:110-115; composition/q1/runtime.ts:216-218; src/app/bootstrap/simulation/runtime.ts:1285
- Confidence: reproduced for the throw (fixture built from tests/gameplay/q1-missionpacks/world/world.test.ts on map ctf1, script gapq12b/rogue.test.ts in the scratchpad, printed `RUNE: Error: Rune operation needs a live actor`). The path from a real disconnect to that call is traced. I did not run it through the full simulation.
- Evidence: `afterQuad: (request, amount) => ({ kind: "continue", amount: game.options.deathmatch !== 0 && request.attack.attacker !== null ? this.damage(request.attack.attacker, amount) : amount })`, then `damage` calls `this.state(actor)`, which has `if (owner === null) throw new Error("Rune operation needs a live actor");`. The hook is registered for every Rogue session, whatever `gamecfg` says (rogue-runes.ts:30). Disconnect releases the actor synchronously (`disconnect: actor => { const player = this.requirePlayer(actor); return this.actors.release(player.actor); }`), and projectiles keep the released id: `game.damage(direct, entity.actor.id, entity.owner, amount, entity.projectileWeapon)`. Nothing removes a player's projectiles on release in the files I read. In QC the edict outlives the client and no fault is possible.
- Impact: On any Rogue deathmatch server, a player fires a rocket or lays a grenade (2.5 s fuse) and leaves before it explodes. The next damage from it ends the host through the run loop (APP-001). It happens by accident on a busy server, and any client can do it on purpose. The rune feature does not have to be enabled.
- Remediation: In `damage`, return `amount` when the attacker does not resolve; apply the same to the other `state` callers. A read-only lookup would also stop the hook creating rune records for every actor that deals or takes damage.

### GAPQ12B-002 — Team-change enforcement keeps using a player it has just disconnected, which terminates the server
- **Verification (VERIFY-D): confirmed. Final severity: High.** ctf/teams.ts:31 calls `services.disconnect(actor)` with no return, then uses `state.owner(actor)` which throws post-release; rogue-teams.ts:64 disconnects then `setColor`→clients.require throws ("Q1 source client is not admitted", clients.ts:34, record deleted by onRelease:31). Five `color` commands drop every player via the host.
- Severity: High
- Category: robustness
- Location: q1/addons/ctf/teams.ts:31-35; q1/addons/ctf/state.ts:37; q1/addons/context.ts:94-96; q1/missionpacks/world/rogue-teams.ts:64-65,42; composition/q1/runtime.ts:64,116,216-218; composition/q1/clients.ts:31,34,46-47
- Confidence: traced. On the Rogue fixture I confirmed the player is released on the fifth change and execution continues past that point (gapq12b/rogue2.test.ts printed `TEAM iterations 4 live: false`). The fixture's `setTeamColor` does not throw, so the final throw comes from reading `clients.ts`.
- Evidence: ThreeWave CTF: `if (state.number(actor, "suicideCount") > 3) state.services.disconnect(actor);` has no return, and the next lines are `state.set(actor, "killed", ...)` and `state.game.host.combat.setTraits(state.owner(actor), ...)`. `setPlayerNumber` throws `Addon player is no longer admitted` and `owner` throws `CTF player is no longer admitted`. Rogue: `if (state.number("suicide_count") > 3) { ...; this.hooks.disconnect(actor); }` is followed by `game.damage(actor, actor, actor, 1000)` and `return this.setColor(actor, previous)`, which reaches `this.clients.colors` and then `require`, which throws `Q1 source client is not admitted` because `onRelease` deleted the record. QC issued `stuffcmd(self, "disconnect\n")`, which only takes effect later, so the code that follows was safe there. Here the disconnect is synchronous, and `composition.disconnect` releases the actor before it returns.
- Impact: On a CTF server with static teams (`CTF_FLAGS.staticTeams`), or a Rogue server with teamplay 4, 5 or 6 and `gamecfg` bit 16 clear, any client sends `color` five times and every player is dropped. The feature meant to punish this client takes down the host. The trigger comes from an untrusted peer and needs no timing.
- Remediation: `return` immediately after each `disconnect` call. Better still, defer the disconnect to the end of the frame so that per-player iteration does not lose its actor partway through.

### GAPQ12B-003 — Rogue copies the whole entity table several times per player per tick to find per-player records
- **Verification (VERIFY-S): confirmed. Final severity: Low.** VERIFY-G's measured cost stands, about 0.5 ms per tick for 8 players. The source review only noted it is port-specific.
- Severity: Medium
- Category: performance
- Location: q1/missionpacks/world/rogue-teams.ts:37-38,56; q1/missionpacks/grapple.ts:24,78; q1/missionpacks/world/index.ts:52
- Confidence: traced for the scans and for the missing removal; the cost was not measured
- Evidence: `private state(actor) { const found = [...this.game.entities.values()].find(entity => entity.classname === "rogue_team_state" && ...)`. `frame` calls it for every player from `afterPhysics`, then `team()` calls it again for each lookup, up to four times per damage request in teamplay. `RogueGrapple.hook` does the same spread and `service` calls it per player per frame, whether or not a hook exists. No code removes `rogue_team_state`, so each connection adds one entity for the rest of the map.
- Impact: This adds to GAPQ12-007. A Rogue session makes about four full copies of the entity table per player per tick. With 1,000 entities and 8 players that is about 32,000 array slots per tick, before any game logic, and the scan grows with reconnects.
- Remediation: Replace both with a `Map<ActorId, ...>` cleared through `onRelease`, as `RogueRunes.players` already does. Remove the state entity on disconnect.

### GAPQ12B-004 — Fixbot throws when its goal entity has been freed
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Low.** original/xatrix/m_fixbot.c:724-736 and :1066-1076 dereference goalentity unchecked. A freed edict is stale but valid, as claimed, so the port's throw is stricter there. However the source also sets goalentity to NULL (:319, :341, :511), where C crashes, so the fallback should cover that case, too. Source review: SRCQ2
- Severity: Low
- Category: robustness
- Location: q2/missionpacks/monsters/fixbot.ts:16-20,22,82,124,133; foundation/monsters/index.ts (FoundTarget via reaction)
- Confidence: traced for the throw and for the way the goal changes; the window was not run. The source side is from memory.
- Evidence: `const entity = context.game.entity(context.entity.goal); if (entity === null) throw new Error("Fixbot source movement requires its bot goal");`. `goal()` is used by `turn` (from `ai_move2`, `ai_facing`, `fly_vertical`, `fly_vertical2`), `use_scanner` and `weldstate`. Damage reaction points `goal` at the attacker when `pain` is inside its debounce, so the takeoff, landing, turn or forward move continues with a player or monster as its goal. If that actor then disconnects or is gibbed and freed before the move ends, the next frame throws. In C the pointer dangles to an edict that is still valid, so it reads stale data and carries on.
- Impact: A Xatrix coop session can end when a player leaves within about a second of hitting a fixbot in these moves, or when infighting frees the target. The window is narrow.
- Remediation: Have `goal()` return null and fall back to `fixbot_move_stand`.

### GAPQ12B-005 — A rerelease medic commander gains slots when a revived child dies again
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Low.** The recollection is wrong in detail: rerelease/g_monster.cpp:705-713 has no max(0, ...). It refunds only after gibbing (`health <= gib_health`, comment at :704) and then clears commander. The port refunds on first death, before any revive, at foundation/monsters/index.ts:633. That is the real defect, and it can drive monsterUsed negative as described. The remedy should be refund on gib and clear, not clamp. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: q2/foundation/monsters/index.ts:633; q2/rerelease/monsters/base-variants/medic.ts:187-188,200-201
- Confidence: traced in the port; the source side is from memory
- Evidence: `commanderState.monsterUsed -= state.monsterSlots` has no floor and does not clear `commander`. The revive deliberately restores `revived.state.spawnedBy = spawnedBy; revived.state.commander = commander; revived.state.monsterSlots = slots`. A child therefore refunds its slots on each death. As I recall it, the rerelease uses `max(0, used - slots)` and clears the commander.
- Impact: `monsterUsed` goes negative, `state.monsterSlots - state.monsterUsed` grows, and a commander that keeps reviving its own children can summon more than its authored limit.
- Remediation: Clamp at zero and clear `commander` after the refund.

### GAPQ12B-006 — Rogue flag status compares against the red flag in both branches
- **Verification (VERIFY-Q): refuted. Final severity: Info.** Source-faithful. quakec_rogue/teamplay.qc:1498 and :1523 both test `self.steam == flag1.team`, including in the flag2 branch, so q1/missionpacks/world/rogue-teams.ts:96 reproduces the source bug. Source review: SRCQ1
- Severity: Low
- Category: bug
- Location: q1/missionpacks/world/rogue-teams.ts:96
- Confidence: traced in the port. I did not compare with teamplay.qc, so this could be a faithful source bug.
- Evidence: `const own = this.mode === 4 ? index === 0 : this.team(actor) === (index === 0 ? red?.number("team") : red?.number("team"))`. The two branches are identical.
- Impact: In teamplay 6, impulse 23 tells a red player that the blue flag is "Your flag", and tells a blue player that their own flag is "Blue flag".
- Remediation: Use `blue?.number("team")` in the second branch, after checking the QC.

### GAPQ12B-007 — Horde stops for good if a countdown fires with nobody alive
- **Verification (VERIFY-Q): refuted. Final severity: Info.** Source-faithful. quakec_mg1/horde.qc:1677-1681 returns 0 with no living players, and Countdown at :1792-1793 just returns with no reschedule. The port's q1/addons/horde/index.ts:39-41 matches. Source review: SRCQ1
- Severity: Low
- Category: bug
- Location: q1/addons/horde/index.ts:39-41,175
- Confidence: traced in the port; I have no memory of MG1 horde.qc
- Evidence: `if (!this.prepare(entity)) return undefined;` and `const players = this.livingPlayers().length; if (players < 1) return false;`. Nothing reschedules the manager on that path. `requestRespawn` restarts the map only when a dead player presses to respawn.
- Impact: On a dedicated server, if the last player disconnects before a countdown fires, the manager's think chain ends. Players who join later find a horde map with no more waves.
- Remediation: Reschedule `countdown` when `prepare` returns false.

### GAPQ12B-008 — Morph child spawn drops the parent to the floor instead of the child
- **Verification (VERIFY-Q): refuted. Final severity: Info.** Source-faithful. quakec_rogue/morph.qc:544-545 does `setorigin(theChild, ...); droptofloor();` with self still the parent. Source review: SRCQ1
- Severity: Low
- Category: bug
- Location: q1/missionpacks/monsters/morph.ts:62-68
- Confidence: plausible; I have no memory of morph.qc
- Evidence: `setup(controller); game.setOrigin(next, game.body(destination).origin); dropToFloor(monster);`. Everything else in the function works on `next` and `controller`, and `monster` is the parent, already standing.
- Impact: A child appears at the teleport destination's height. If that destination is above the floor, the child is not settled and the parent can be moved instead.
- Remediation: Check against morph.qc and pass `controller` if the source drops the child.

## Supplements
- Supplements GAPQ12-013: `Q2RogueHints.pursuers` (hints.ts:51,125) has the same shape, with `set` in `source` and `clear` only in `restore`. `findDead` in both medics calls `source.get(target)` for every dead candidate, which also adds entries to the GAPQ12-013 map.
- Supplements CONTENT1-018: rogue-runes.ts:49 (`Rogue runes require an info_player_deathmatch spawn`) and ctf/runes.ts:20 (`CTF has no info_player_deathmatch to spawn a rune`) throw from a timer 0.1 s after the first player frame on a map with no deathmatch spots. This condition is map-authored.
- Supplements APP-001: GAPQ12B-001 and GAPQ12B-002 are further specific peer-triggered routes to the run loop.
- Supplements CONTENT2-001: base/player/spawns.ts:15 and :34 are the closures behind that finding; I read them and have nothing to add.
