# GAPCOMPAT — Compat and QuakeC bindings that round 1 sampled or skipped

## Coverage
Experiments: `<scratchpad>/gap-exp/{foreign,goal,micro,rec}.ts` and `items.py`, run against `<scratchpad>/clean` with HOME and XDG_DATA_HOME under the scratchpad and retail data from <game-data>.

Read in full, compat/q2/classic: layout 146, combat-binding 305, combat-profile 98, inventory 86, pmove 130, pickup-profile 25, world-profile 52, records 170.
Read in full, compat/q2/rerelease: host 476 (all, including the 1-330 round 1 read), api 56, layouts 94, world-profile 239, source-state 183, foreign-actors 407, navigation 62, cgame 80, module 256, public-state 85, player-state 43, sounds 42, debug-shapes 44, world-text 36, pickup-protection 41, combat-binding 85, equipment-movement 59, body-shape 68, spatial 22, semantics 26, native-entries 25, client-profile 43.
Read in full, compat/q2: native-mod-actors 197, native-mod-armor 169, native-mod-clients 167, native-mod-combat 326, native-mod-client-stages 66, native-mod-deferred 111, native-mod-pickups 114, native-mod-protection 268, native-mod-region 105, native-mod-weapon-stage 100, native-mod-provider 900-1098 plus refresh/observe/flush 686-760, native-pickups 373, native-primary 35, native-primary-commands 157, -drop 157, -inventory 210, -player 103, -weapons 228, -validation 101, -profiles 84, -reader 38, -weapon-profile 82, native-mod-entries 26.
Read in full, compat/qvm: abi 846, entity-record 216, player-record 170, shared-entity-record 108, client-state-record 121, bot-navigation-records 264, script-record 68, trace-record 36, render-record 102, raw-entities 57, legacy-bot-abi 133, legacy-presentation 114, game-combat-binding 424, game-combat-scope 138, game-combat 151, game-weapons 318, game-pickups 314, game-inventory 169, mod-presentation 532, mod-items 284, grapple-provider 186, grapple-profile 71, item-catalog 104, item-storage 75, primary-inventory-profile 89, primary-pickup-profile 78, primary-player-profile 166, primary-presentation-profile 47, primary-profile 54.
Read in full, compat/qc: movement-host 127, pusher-host 89, mod-combat 151, mod-items 236, borrowed-actors 155, mod-pickups 84, mod-commands 18, mod-protection 252, actor-state 100, quakeworld-presentation 45.
Read in full, content/q1/quakec (all 2205): armor-points, armor-stage, damage-call, damage-scale, id1-attacks, id1-damage, id1-environment, id1-pickups, id1-program, id1-projectiles, pickup-callers, pickup-stage, weapon-stage, weapon-stage-declaration.
Outside scope, opened to trace reachability: quakec-source.ts 262-282 and 340-420, runtime.ts 3496-3530, world-host.ts 25-92, native-mod.ts 50-66, session/mods.ts (grep), qc/memory.ts 30-62, guest/core/memory.ts 130-279, server-message.ts 95-125, client-state-syscalls.ts 30-46.

Sampled: none beyond the partial reads named above.
Skipped, about 1,700 lines, not opened: compat/qvm game-input 214, game-equipment-movement 152, mod-weapon-stage 266, cgame-body 118, body-scope 28, mod-presentation-checkpoint 83, weapon-behavior-profile 62, legacy-client-abi 11, compatibility 53, allocation 8, client-state 8; compat/q2 native-input (round 1 read 125-175), native-damage 28, native-combat-call 53-122, native-primary-{command,drop,inventory,player}-profile 81; compat/q2/rerelease native-weapon-declaration 134, weapon-behavior-profile 164, q2eaks-weapon-profile 102, pickup-profile 33; compat/qc compatibility 35, weapon-behavior-profile 35. Files GUEST or VM already read in full were not reread except where noted.

## Strengths
- No path found from a guest pointer to host memory. Every pointer in these files is consumed through `MappedGuestMemory` (`offset`, `check`, `read*`, `borrow`, `copy`) or `QvmMemory` (`view`, `dataView`, `span`), which range-check. A bad pointer becomes an exception, never an out-of-bounds host access. This confirms the GUEST and VM strengths for the marshalling files they skipped.
- Record layouts are correct. I checked by hand, against my recollection of the id and rerelease headers, classic edict_t, trace_t, pmove_t, player_state_t, game_export_t and game_import_t; Q3 entityState_t, playerState_t, sharedEntity_t (including the 1.16n shift in `offset()`), snapshot_t, gameState_t, usercmd_t, refEntity_t, refdef_t, polyVert_t, pc_token_t, trace_t, bot_goal_t, bot_initmove_t, bot_moveresult_t, bot_entitystate_t, aas_entityinfo_t; and API2023 game_export_t, PathRequest, PathInfo, entity_state_t, sv_entity_t. Every offset agreed. The Q2 and Q3 import enums also agreed.
- Private-layout admission is strict. Rerelease and classic profiles are digest-bound, reject overlapping fields and check executable addresses before Init (`validateNativePrimary`, `validateRereleasePrimaryWorldProfile`, `qualifyQvmRegion`).
- The QuakeC stage analyzers (`qcArmorStage`, `qcDamageScale`, `safeFlow`) prove skipped regions are dead by dataflow, and pinned artifacts verify exact statements. This is careful work.
- Lifetimes held up where I tried to break them. Rerelease `#surfaces` is keyed by the stable BSP texinfo object and unmapped in `rebindWorld`; guest scratch mappings are in `try`/`finally`; QVM scratch save/restore nests correctly even though combat and weapons share one scratch address; mod-presentation prunes `commands` and `snapshots`.

## Findings

### GAPCOMPAT-001 — On a QuakeC world, attacking a selected foreign enemy with axe, shotgun or rocket, or a foreign enemy entering trigger_hurt or trigger_push, ends the process
- **Verification (VERIFY-Q): confirmed. Final severity: High.** The QC statements hold: RR triggers.qc:623-627 writes `other.velocity` when `health > 0`, and :592-595 calls T_Damage on any takedamage target. Foreign actors are a port feature with no original counterpart, so the throw is a port fault. Source review: SRCQ1
- Severity: High
- Category: bug
- Location: src/content/q1/quakec/id1-attacks.ts:84-85; src/content/q1/quakec/id1-projectiles.ts:68-71, :95; src/content/q1/quakec/id1-environment.ts:45-51; src/compat/qc/borrowed-actors.ts:80-84; src/app/bootstrap/simulation/runtime.ts:3501-3509; test tests/first-playable/application/guest-foreign-enemies.test.ts:44
- Confidence: reproduced (real id1 progs on e1m1 with selected Q2 soldiers, entry functions called directly on the live machine)
- Evidence: `damageRequest` calls `game.attacks.resolve(call)`, `game.environment.resolve(...)` and `game.projectiles.resolve(call)` in turn, and all three assume source-owned actors. `if (target === null || target.provider !== this.source.slots.options.provider) throw new QcProgramError("id1 attack target has no source projection")`. The projectile path uses `slots.at`, which does not know borrowed rows: `if (actor === null ...) throw new QcProgramError('Projectile references a free actor')`. The environment path has `throw new QcProgramError("id1 environment references a foreign or stale actor")`. `foreign.ts` output, where the target is a replaced soldier with `sourceOf` null:
  ```
  axe vs foreign THREW QcProgramError progs.dat: id1 attack target has no source projection
  shotgun vs foreign THREW QcProgramError progs.dat: id1 attack target has no source projection
  rocket touch vs foreign THREW QcProgramError progs.dat: Projectile references a free actor
  trigger_push vs foreign THREW QcProgramError progs.dat: Original QC cannot mutate borrowed field velocity outside its source owner
  hurt_touch vs foreign THREW QcProgramError progs.dat: id1 environment references a foreign or stale actor
  ```
  The axe and shotgun cases ran the real `W_FireAxe` and `W_FireShotgun`, with the trace hitting the borrowed row. `T_MissileTouch` used the player as a stand-in missile, but the throw is on the victim argument at line 95, so a real rocket takes the same branch. `trigger_push_touch` writes `other.velocity` for any non-grenade `other` with health above 0 (id1 triggers.qc, from memory).
- Impact: `--progs progs.dat` with `enemies: selected` is a shipped option covered by an application test. The first player shot at a replacement enemy, or the enemy walking into a hurt or push trigger, throws out of the tick and exits per APP-001. The existing test only asserts that soldiers can hurt the player, never the reverse. This effectively makes the feature unplayable.
- Remediation: Resolve targets through the same borrowed-or-source lookup that `Id1DamageProjection.actor` uses (quakec-source.ts:374), and skip source-only geometry for foreign targets. Route QC writes of projected fields to the owning body binding instead of rejecting them. Extend the test so the player kills a replacement enemy with each weapon.

### GAPCOMPAT-002 — `movetogoal` throws when the monster's goal edict has been freed, which id1 infighting produces
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Medium.** - The throw and SV_MoveToGoal's lack of a check are right (WQ sv_move.c:402-424). - The cited scenario is wrong. ThrowHead reuses self with `nextthink = -1` (RR player.qc:538-542, V101 player.qc:448), so heads are never freed. Barrel attackers are `self.enemy` (RR misc.qc:244). - A real route: a tarbaby hits others with `T_RadiusDamage(self, self, ...)` (monsters/spawn.qc:185) and is freed by BecomeExplosion (RR weapons.qc:337). A patroller that became its enemy then calls movetogoal on a freed goal. - Also, the freed goal is not fully zeroed: origin is, but absmin is not (pr_edict.c:133), and SV_CloseEnough reads absmin. Source review: SRCQ1
- Severity: High
- Category: bug
- Location: src/compat/qc/movement-host.ts:91-92; src/compat/qc/world-host.ts:71-72
- Confidence: reproduced (the throw, on e1m1 monster_army with a freed edict); scenario traced from id1 QC as I recall it, not played through
- Evidence: `const actor = world.actor(self), goal = world.actor(entities.slot(words.int(field("goalentity"))));` runs before the flags check, and `actor(slot)` starts with `if (this.isFreeEntity(slot)) throw new QcProgramError("world builtin references a free source edict")`. `goal.ts`: `monster slot 34 monster_army freed slot 164 isFree true` then `movetogoal THREW QcProgramError progs.dat: world builtin references a free source edict`. SV_MoveToGoal in id's sv_move.c just dereferences the zeroed edict. In id1, FoundTarget sets `goalentity = enemy`. When the enemy dies, ai_run clears `enemy` but not `goalentity`, then calls `th_walk` for a patrolling monster, and ai_walk calls `movetogoal`. A gibbed monster's head is removed by `SUB_Remove` 10-20 s later, which frees the goal. The throw is deliberate: tests/compat/qc/runtime.test.ts:660-661 asserts `expect(() => call("movetogoal", 1)).toThrow("free source edict")`, so the test pins this divergence from sv_move.c as intended behavior.
- Impact: A patrolling ogre that gibs an infighting grunt walks toward the head, and when the head expires the process exits per APP-001. This is the primary QuakeC path; VM-002 covered only `QcModProvider`. It needs infighting plus a patrol path, so it is intermittent in ordinary single player.
- Remediation: Check flags first as the source does, and read a freed goal's zeroed words instead of resolving an actor. Movement should treat it as a target at the origin. Change the runtime.test.ts assertion to match.

### GAPCOMPAT-003 — A hostile Q3 server can exit the client with a snapshot above 256 entities, where the original truncates
- **Verification (VERIFY-Q): confirmed. Final severity: High.** `CL_GetSnapshot` prints a developer message and truncates to `MAX_ENTITIES_IN_SNAPSHOT` (`client/cl_cgame.c:151-154`). Source review: SRCQ3
- Severity: High
- Category: security
- Location: src/compat/qvm/client-state-record.ts:75; src/compat/qvm/client-state-syscalls.ts:37-42; src/network/q3/server-message.ts:111-125, :102-103
- Confidence: reproduced (writer throw); traced (parser has no limit, packet not sent end to end)
- Evidence: `if (snapshot.areaMask.length !== 32 || snapshot.entities.length > 256) throw new RangeError("Invalid source snapshot_t extent")`. `rec.ts`: `257 entities: RangeError Invalid source snapshot_t extent`. `readPacketEntities` pushes one entity per delta with no count limit, and the only count check, `validateEntities` (limit 1023), is on the encode path at :164-165. CL_GetSnapshot in id's cl_cgame.c prints a DPrintf and truncates to MAX_ENTITIES_IN_SNAPSHOT (from memory).
- Impact: Any server the client connects to can send 257 entities in one snapshot. `CG_GETSNAPSHOT` throws inside the cgame syscall and the client exits per APP-001.
- Remediation: Truncate to 256 in `writeQvmSnapshot`, matching CL_GetSnapshot. Keep the strict check in `writeSourceQvmSnapshot`, whose input is local.

### GAPCOMPAT-004 — Legacy 1.16n presentation translation throws on server-supplied entity values
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** Re-ran: qvmEvent(47, reverse), qvmEntityType(12, reverse) and qvmPowerupBits(1<<9) all throw for q3-1.16n-base. Path is entity-record.ts setters from client-state-record.ts:98 via client-state-syscalls.ts:42. Reach needs a mounted qvm-compatibility.json naming that cgame digest (compat/qvm/compatibility.ts:17-20).
- Severity: Medium
- Category: robustness
- Location: src/compat/qvm/legacy-presentation.ts:74, :81, :104, :108, :112; src/compat/qvm/entity-record.ts:59, :99, :103, :113; src/compat/qvm/player-record.ts:112-113; src/compat/qvm/client-state-record.ts:98
- Confidence: reproduced (record writer with the legacy profile); traced to CG_GETSNAPSHOT
- Evidence: `rec.ts` with profile `q3-1.16n-base`:
  ```
  event 47 THREW QVM event 47 is not represented by the selected legacy ABI
  eType 12 (ET_TEAM) THREW Legacy QVM has no team entity type
  powerups bit 9 THREW Legacy ball or private powerup has no modern presentation mapping
  generic1=1 THREW Legacy QVM entity has no generic1 field
  ```
  These values come from network entity state through `writeQvmEntityState`. tests/compat/qvm/mod-player-events.test.ts:48 asserts the same throw for `readQvmPlayerState`, a guest-side read, so strictness is deliberate there; nothing distinguishes the remote client path.
- Impact: A client running a legacy cgame connected to a modern or mismatched server exits on the first unmapped event, team entity or ball powerup instead of ignoring the value. Reach is limited to the legacy profile, but the input is remote.
- Remediation: Map unknown values to EV_NONE and ET_GENERAL with a one-time warning on client paths. Keep the throw for local authoring checks.

### GAPCOMPAT-005 — NativeModProvider rescans all projections on every guest import
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/compat/q2/native-mod-provider.ts:994 flush and :1006 `finally { this.refresh(); ... this.observe(); }` bracket every import, and :686-727 rewrites and re-observes all shared fields. :997-998 spread projections for entity imports. native-mod-clients.ts:104 spreads entries per frame(slot) call. Cost not measured.
- Severity: Medium
- Category: performance
- Location: src/compat/q2/native-mod-provider.ts:994, :997-998, :1006, :686-727; src/compat/q2/native-mod-clients.ts:104
- Confidence: traced (not measured end to end)
- Evidence: `importCurrent` runs `this.flush();` before each import and `finally { this.refresh(); const frame = this.frames.at(-1); if (frame !== undefined) frame.observations = this.observe(); }` after it. `refresh` calls `validateInventoryCapacity`, `inventory.entries` and a scalar write per shared field per projection, then re-observes if frames are active. `flush` compares every observation with `memory.copy` plus `isDeepStrictEqual` and observes again. `linkentity`, `unlinkentity` and `setmodel` additionally do `[...this.projections.keys()].find(actor => this.address(actor)...)` and `this.owned?.entries().find(...)`. Outside imports, `advance` calls `clients.frame(slot)` once per edict slot, and it does `[...this.entries.values()].find(...)`.
- Impact: Cost is imports × projections × fields, with a `Uint8Array` per field, on an interpreter that GUEST-004 measured at under 1 MIPS. This is the native equivalent of VM-011. Native mods with several clients and many `trace` or `pointcontents` imports per frame pay this repeatedly.
- Remediation: Skip the flush and refresh for read-only imports (`trace`, `pointcontents`, `inPVS`, prints), use write observers for dirty tracking, and keep address-to-actor and slot-to-client maps.

### GAPCOMPAT-006 — The retail rerelease edict profile falls back to a linear field search on every access
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/compat/q2/rerelease/world-profile.ts:127 spreads a new layout; the fieldOffsets WeakMap is set only in structure(), so layouts.ts:40-44 falls to fields.find. Re-ran, 500k iterations over 147 fields: original 45/47 ns, spread copy 1611/2864 ns for spawn_count/health. source-state.ts:88 calls it per access.
- Severity: Medium
- Category: performance
- Location: src/compat/q2/rerelease/world-profile.ts:127; src/compat/q2/rerelease/layouts.ts:37, :40-44; src/compat/q2/rerelease/source-state.ts:88; src/compat/q2/rerelease/client-profile.ts:29
- Confidence: reproduced (microbenchmark)
- Evidence: `edict: { ...privateEdictPrefixLayout, byteLength: 3688 }` creates a new object, so the `fieldOffsets` WeakMap misses and `fieldOffset` runs `layout.fields.find(value => value.name === name)` over 147 fields. `RereleaseSourceEdict.at` calls this on every access. `micro.ts`, 2M iterations: profile layout `spawn_count` 986 ns and `health` 1736 ns; the original layout 26 ns and 22 ns. `retailRereleaseClientProfile.layout` is a literal with the same miss.
- Impact: A 40-80x cost on each private field access. Body `read` and `write`, combat `read`, each callback `present()` check and each foreign-actor `lookup` generation check go through it, at a 25 ms frame budget.
- Remediation: Build the offset map lazily for any layout on a WeakMap miss in `fieldOffset`.

### GAPCOMPAT-007 — Non-pinned QC programs hit fatal "unsupported damage" throws at first use rather than at load
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** No engine rule forbids these patterns; T_Damage is plain QC (RR combat.qc:141-264). A grep of the whole rerelease QC tree finds no `attacker.health`, so no upstream program shows that example pattern; the risk stays with third-party mods. Source review: SRCQ1
- Severity: Medium
- Category: robustness
- Location: src/content/q1/quakec/id1-damage.ts:110-115, :215-216, :259-260, :262-263
- Confidence: traced (no real mod was run through these branches)
- Evidence: For `layout.kind === "calls"`, which is every non-pinned program: `if (native && combatStore && store.reference !== frame.targetReference) throw new QcProgramError("Unsupported native damage redirects a combat store to another actor")`; `throw new QcProgramError("Native damage combat store follows its reaction continuation")`; `throw new QcProgramError("Native damage reaction precedes target health mutation")`. Also, a composed damage operation that changes knockback or direction gets `"QuakeC damage call accepts actor and amount changes; independent damage metadata requires a replacement"`.
- Impact: A mod whose T_Damage does `attacker.health = attacker.health + take` (a vampire rune), pushes the attacker, applies knockback after `th_pain`, or calls `th_pain` for a zero-damage hit passes load and then ends the process on that hit. These are ordinary QC patterns, and the failure appears only in play.
- Remediation: Detect the store patterns statically in `deriveNativeBinding` and reject the mod at load. Otherwise degrade to observation only for the frame instead of throwing.

### GAPCOMPAT-008 — NativeModCombat observes the whole edict table and can throw from inside a guest store
- **Verification (VERIFY-F): confirmed. Final severity: Medium.** src/compat/q2/native-mod-combat.ts:114-119 observes stride * capacity; :120-132 runs host.entities() per callback. :104 throws when one address is seen under two kinds. bind() also calls ensure for all four kinds, so the same throw fires at actor admission as well as inside a guest store.
- Severity: Medium
- Category: performance
- Location: src/compat/q2/native-mod-combat.ts:114-119, :120-132, :104
- Confidence: traced
- Evidence: `this.host.memory.observeWrites(table.base, bytes, ranges => this.changed(ranges))` with `bytes = table.stride * table.capacity`. `changed` re-reads the export table through `host.entities()`, then loops over slots and four callback kinds per written range. PERF1 indexes by page, but every edict page is watched, so each store to any edict still enters JS. `ensure` runs in that callback and does `if (prior.kind !== kind) throw new Error("One native callback entry has incompatible declared ABIs")`.
- Impact: Every guest edict store pays a callback once an owned combat actor exists, on top of GUEST-011. A mod that assigns one no-op function to two callback fields, such as `pain` and `die`, ends the process from inside a memory write.
- Remediation: Watch only the declared callback and deferred-damage fields per owned slot. Key `entries` by address plus kind, or refuse the actor at admission.

### GAPCOMPAT-009 — Foreign damage allocates a real guest edict per hit, using up slots under the source's reuse hold-off
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** Q3 part only: the one-second hold-off is at `game/g_utils.c:406`, with a forced second pass. Q2 half not settled here. Source review: SRCQ3
- Severity: Low
- Category: robustness
- Location: src/compat/q2/classic/combat-binding.ts:253-255, :300-301; src/compat/qvm/game-combat.ts:133-139, :147
- Confidence: plausible (G_Spawn reuse rules from memory; exhaustion not run)
- Evidence: Classic `address()` invokes `entries.spawn` per foreign attacker or inflictor per damage call and frees it in `finally`. id's G_Spawn will not reuse a slot for 0.5 s after `freetime` (Q3: 1 s).
- Impact: Sustained foreign damage raises `num_edicts`, which permanently raises reconcile cost (GUEST-012). At extreme rates it reaches `ED_Alloc: no free edicts`, which is `gi.error` and exits. The rerelease path keeps persistent projections and does not have this.
- Remediation: Keep one reusable proxy edict per foreign actor for the world's lifetime.

### GAPCOMPAT-010 — Classic combat team derivation diverges from ClientTeam for skins without a slash
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** g_cmds.c:34-37 returns the whole skin when there is no `/`. combat-binding.ts:94 yields empty for DF_SKINTEAMS. The model branch is correct. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: src/compat/q2/classic/combat-binding.ts:94
- Confidence: plausible (ClientTeam recalled from g_cmds.c, not checked here)
- Evidence: `(rules & profile.teams.skin) !== 0 ? \`q2:skin:${skin.split("/")[1] ?? ""}\``. id's `ClientTeam` returns the whole value when there is no `/`.
- Impact: Under DF_SKINTEAMS, all players with slashless skins share team `q2:skin:` in the shared combat view, while the DLL's own OnSameTeam treats them by full name.
- Remediation: Use the whole skin value when no `/` is present.

### GAPCOMPAT-011 — `readQvmRefdef` rejects text rows without a NUL, which the original treats as opaque bytes
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** `Com_Memcpy( tr.refdef.text, fd->text, ... )` copies opaque bytes (`renderer/tr_scene.c:307`). Source review: SRCQ3
- Severity: Low
- Category: robustness
- Location: src/compat/qvm/render-record.ts:57-62, :72-73
- Confidence: traced (no mod observed doing this)
- Evidence: `if (!row.includes("\0")) throw new BinaryError("QVM refdef_t", offset, "render text row has no NUL within 32 bytes")`. id's RE_RenderScene just copies `text`.
- Impact: A cgame or UI that leaves a `refdef_t` on the stack partly uninitialized runs on Q3 and exits here. It also builds 8 strings of 32 concatenations per RenderScene.
- Remediation: Copy the rows as bytes, and stop at the first NUL or the row end when decoding for deform text.

### GAPCOMPAT-012 — `mod-presentation` baseline writes centities by entity number without a capacity check
- **Verification (VERIFY-I): confirmed. Final severity: Low.** mod-presentation.ts:318-321 has no range check, while :311 does. :95 requires only capacity >= 1, so a declared capacity below 1024 is accepted. The write stays inside VM memory.
- Severity: Low
- Category: robustness
- Location: src/compat/qvm/mod-presentation.ts:318-321 (compare the check at :311)
- Confidence: traced
- Evidence: `const view = this.module.memory.dataView(entities.address + state.number * entities.stride, entities.stride);` has no `state.number < entities.capacity` test, though `scene.actors` rows are checked at :311.
- Impact: A declared centity capacity below 1024 lets a gameplay entity number write past the array into other cgame data. The write stays inside the VM.
- Remediation: Apply the same range check as line 311.

### GAPCOMPAT-013 — `RereleaseCgame` and the cgame export path have no production caller
- **Verification (VERIFY-I): confirmed. Final severity: Low.** grep finds RereleaseCgame, callCgame, bindCgame and rerelease/cgame only in cgame.ts, module.ts and tests/compat/q2/rerelease/native.test.ts. cgame.ts:29-38 allocates an exact size, unlike guest/runtime/common/memory.ts:106-114.
- Severity: Low
- Category: dead-code
- Location: src/compat/q2/rerelease/cgame.ts (80 lines); src/compat/q2/rerelease/module.ts:107-115, :139-143, :252-255; src/compat/q2/rerelease/cgame.ts:36-39
- Confidence: traced
- Evidence: A grep of `src` for `RereleaseCgame`, `callCgame`, `bindCgame` and `rerelease/cgame` finds nothing outside these files; only tests/compat/q2/rerelease/native.test.ts uses them. `#text` also allocates exact-size mappings, against the rule stated at guest/runtime/common/memory.ts:106 ("Native CRT routines probe page boundaries") that `module.string` follows, so it would need fixing if wired up.
- Impact: Carried code and a populated import table imply a rerelease native HUD the product does not run.
- Remediation: Remove it or wire it up, and use `allocateNativeMemory` in `#text` if it stays.

### GAPCOMPAT-014 — Native provider close and invocation cleanup can lose the original error or skip cleanup
- **Verification (VERIFY-I): confirmed. Final severity: Low.** native-mod-provider.ts:934 throws in finally before the restores and unmaps. :1082 and :1085 run outside the guarded block. native-primary-weapons.ts:207 writes in finally.
- Severity: Low
- Category: robustness
- Location: src/compat/q2/native-mod-provider.ts:934, :1082, :1085; src/compat/q2/native-primary-weapons.ts:207
- Confidence: traced
- Evidence: `finally { if (regionAuthority !== undefined) { const active = this.regionAuthorities.pop(); if (active !== regionAuthority) throw new Error("Native donor invocation ownership changed"); } ...` throws inside `finally`, which also skips the global restores and unmaps after it. `this.objectives.close(); this.releaseMatch?.();` and `this.clientOutputs.close();` run unguarded before the guarded block. `weaponDelay`'s `finally` calls `this.write`, which throws "Native weapon owner was retired" if the guest freed the actor, masking any original error.
- Impact: A failing cleanup leaves guest globals projected and scratch mapped, or leaves a provider half closed. This is the native analogue of VM-019.
- Remediation: Use `CleanupStack` throughout, and record an ownership mismatch after cleanup completes.

### GAPCOMPAT-015 — The same QuakeC analysis helpers are repeated across files
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** Port-only maintainability; not source-dependent. Source review: SRCQ1
- Severity: Low
- Category: maintainability
- Location: src/content/q1/quakec/weapon-stage.ts:17-19, :53-56, :117, :240, :246-250, :253; src/content/q1/quakec/armor-stage.ts:44, :104, :168, :179; src/content/q1/quakec/damage-scale.ts:26; src/content/q1/quakec/id1-program.ts:162; src/content/q1/quakec/pickup-callers.ts:51; src/compat/qvm/abi.ts:190-378, :499-606, :720-822
- Confidence: traced
- Evidence: `program.functions.reduce(...)` computing a function's end appears 11 times in content/q1/quakec, although `qcFunctionEnd` exists in weapon-stage.ts. The `named`, `temporary` and `pure` sets are written twice in weapon-stage.ts (:52-56 and :246-250). In abi.ts about 390 of 846 lines are `case` labels restating the enums above them.
- Impact: These analyzers prove safety properties, and a correction to one copy can miss another. In `deriveNativeBinding`, the per-function `reduce` is also O(functions²) at load.
- Remediation: Move function-end, temporary and access helpers to `compat/qc/program.ts` with a per-program cache. Generate the decode functions from the enums.

### GAPCOMPAT-016 — Riskiest paths in this scope have no tests
- **Verification (VERIFY-I): confirmed. Final severity: Low.** No test contains "mutate borrowed", and no tests/compat/qvm case covers an oversized snapshot. tests/compat/qc/runtime.test.ts:661 and tests/compat/qvm/mod-player-events.test.ts:48 are the required-throw assertions the finding describes.
- Severity: Low
- Category: test-gap
- Location: tests/first-playable/application/guest-foreign-enemies.test.ts:44-97; tests/compat/qvm/client-state.test.ts; tests/compat/qc/*
- Confidence: traced
- Evidence: A grep of `tests` for `mutate borrowed` finds nothing, and the QuakeC foreign test never has the player damage a replacement. A grep of tests/compat/qvm for `257`, `> 256` and `snapshot_t extent` finds no oversized-snapshot case. Freed-goal `movetogoal` and legacy event rejection are tested, but only as required throws (GAPCOMPAT-002, -004).
- Impact: GAPCOMPAT-001 and -003 exist on tested-looking paths, and two tests lock in fatal behavior.
- Remediation: Add the `<scratchpad>/gap-exp` cases as regression tests and revise the two throw assertions when those behaviors change.

## Supplements
- Supplements VM-002: the primary QuakeC source is affected through `world.actor` in `movetogoal`, contrary to that entry's "applies to QcModProvider, not the primary source" (see GAPCOMPAT-002).
- Supplements VM-014: `QvmSourceItemCatalog` with `source: "live"` adds about two watch ranges per item to the linear scan (item-catalog.ts:97-100). Only a test uses live mode today.
- Supplements GUEST-012: reconcile cost grows with the high-water edict count that GAPCOMPAT-009 raises.

## Candidates checked and refuted
- 1998 Xatrix item table using `flags: 56` and `tag: itemBytes - 8` while `armorInfo` shifts by 4 looked inconsistent. `items.py` dumped the real DLL (`0b0d119e...`): flags are at 56 (weapons 0x9, ammo 0x2), info at 60, tag at 64. The profile is correct.
- Native provider `restore` closes protection and pickups without reactivating them. `world/session/mods.ts:282` calls `runtime.activate()` after restore, so this is fine.
- `QcBorrowedActors` and QuakeCSource never unsubscribe `onRelease`. The registry is created per runtime (runtime.ts:648) and dies with them, so no retention beyond the world lifetime already reported.
- Rerelease `#surfaces` leak per trace: keys are stable `textureInfo` objects, bounded by the map, and unmapped on `rebindWorld`.
- `isDeepStrictEqual` on 4-byte arrays measured 28 ns here, so it is not the main cost in GAPCOMPAT-005; the rescans and allocations are.
