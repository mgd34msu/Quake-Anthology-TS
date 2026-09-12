# Q1 official gameplay foundation

`Q1Foundation` supplies direct TypeScript implementations of the Q1 gameplay needed by the initial campaign and cross-game specimens. It uses the shared actor registry, bodies, synchronous callbacks, combat authority and inventory table. It does not allocate a second player health or ammunition store.

The actual rerelease `id1/pak0.pak:maps/e1m1.bsp` contains 428 authored entities and 41 class names. Every class has a spawn implementation or the original source removal behavior. Skill filtering retains 10 monsters on easy, 23 on normal, and 42 on hard/nightmare. The map has six counted secrets and exits to `e1m2`. Its gates include shootable triggers, button-controlled doors, start-open doors, two-stage secret doors, the three-button counter, teleportation, light switching, and killtargets.

## Source mapping

Implementation | Source behavior
--- | ---
`runtime.ts`, `entity.ts` | Quake entity fields; `subs.qc` target dispatch/delays and mover completion; `combat.qc` radius and visibility checks; `client.qc` powerup, environment and intermission timing
`spawns.ts` | `triggers.qc`, `misc.qc`, `world.qc`, `client.qc` spawn functions and `ai.qc` path corners
`movers.ts` | `doors.qc`, `buttons.qc`, `plats.qc`, including paired doors, keys, crush callbacks, reverse operation and secret-door stages
`pickups.ts` | `items.qc` health, armor, weapons, ammunition, keys, artifacts and grunt backpacks; classic item-owned megahealth decay and rerelease player-owned decay remain distinct
`weapons.ts` | `weapons.qc`, `player.qc`; all eight base weapons, source ammo fallback and shot timing, pellet grouping, autoaim, projectiles, radius damage and lightning traces
`callbacks.ts`, `checkpoint.ts` | Named source continuations, entity/player fields and saved actor references; `subs.qc` pending moves and delayed uses retain their source deadlines
`monsters.ts` | `monsters/grunt.qc`, `monsters/rottweiler.qc`, `ai.qc`, `fight.qc`; model-frame sequences, attacks, pain/death, gib/backpack behavior, target acquisition and patrols

The implementation authorities are `../qsrc/quake-rerelease-qc/quakec` and `../qsrc/quake/progs106`. Engine builtin comparisons use `../quake-1-re-ts/src/server/sv_move.ts` and `src/progs/pr_cmds.ts`. The movement implementation is shared through `src/movement/q1`; its original random integer branches and step/bottom logic are not duplicated here. Rerelease id1 leaves `USE_ADVANCED_PATHING` disabled in `ai_run`.

## Session integration

Construct `Q1Foundation(host, options)`, register expansion/base spawn handlers with `registerSpawn` (or deliberately replace a registered handler with `replaceSpawn`), and call `spawnMap(map)`. `maxClients` reserves source slots 1 through that value. World is source slot 0; authored nonworld slots follow the reservation. Dynamic source allocation also respects the reservation when only Q1 weapons are used on a foreign map.

The session owns player allocation, combat/body admission and the character model. `attachPlayer` adds Q1 arsenal state and can initialize or configure an existing shared inventory. Character identity does not determine the Q1 map's triggers or weapon behavior.

- `physicsEntity(actor, seconds, elapsed)` runs in the shared source actor traversal. `playerFrame` runs the source player timers and environment behavior. `physicsStep` is a convenience for direct provider use.
- The host schedules `ActorCallbackTable.think` at the requested source deadline. Touch/use/pain/death remain synchronous shared callbacks. Saved `forceRetouch` follows the source actor traversal: when nonzero, relink and touch each actor before its ordinary physics, then decrement once at frame exit. Teledeath uses this shared path, and teleport fog has a named delayed sound callback.
- `weaponInput` receives both pressed and released input each frame. Nail and lightning continuation runs at 0.1 second intervals while retaining the source 0.2 second attack lock after release. Jump/waterjump remain with the independently selected movement provider.
- `combatContext` supplies the Q1 combat policy's quad, team and momentum context. The shared combat policy applies quad once.
- `pusherServices` joins source `ltime` and `nextThink` to the shared pusher step, including obstruction callbacks before rider rollback. Shared linking owns trigger contacts, including monster touches on path corners.
- `moveToGoal`, `walkMove` and `checkBottom` use the shared Q1 monster movement builtins. `checkClient` uses source PVS/client cycling. Trace results retain `inOpen`/`inWater`, and missile movement requests select the source missile trace policy.
- `presentations` exposes current models and frames. `entity` also exposes solid/movement flags, callback state and source fields. Hidden brush triggers retain their original model in `originalModel`; ordinary brush actors retain their authored inline model.
- Intermission emits its camera and track, then `requestIntermissionExit` admits travel only after the source wait and a button press. The shared transition coordinator remains the sole travel owner.

## Current verification and remaining work

`bun test tests/gameplay/foundation/q1` runs four focused checks against the real archive with shared actor/combat/inventory and real BSP collision: source spawn/inhibition, an authored shootable gate plus secret/exit, Q1 pickups/quad/projectiles on a Q2 character, and a checked byte save restored into a fresh registry, shared stores and provider. The restore check advances an authored moving gate, a pending trigger reset, delayed target use, classic megahealth decay, an axe strike, monster frames and an independently rebound clone of an authored grunt, then compares the resulting source state with the uninterrupted provider. Mover tests drive unobstructed completion; they do not qualify the session's rider rollback or monster movement. Those operations are implemented and checked in the shared movement package and require combined session verification.

The shared bootstrap owns audio/render events, player admission, source scheduler phases, collision links and intermission presentation. Other base-game actors and expansions register their actual spawn behavior through `registerSpawn`; unknown spawn functions throw with the source ordinal instead of disappearing.

`capture()` returns a versioned `Q1FoundationCheckpoint`; `restore(checkpoint, { scheduleThinks })` reconstructs source objects around already restored actors and authority tables. The session restores actor slots, clocks/random streams and shared bodies/combat/inventory first, including the exact prior linked-body state and link counter. Register the same source modules before restoration, restore the provider, then rebuild collision links. Pending thinks resume after all references and extension state are bound; the session may defer that step with `scheduleThinks: false` and call `resumeThinks()` once. Restoration does not call map spawn functions, initialize player inventories, replay pickup effects or emit presentation events.

Named callbacks are registered through `game.named.register(name, handlers)`. Assign the appropriate bound callback using `named.use`, `named.touch`, `named.pain`, `named.die`, or `named.blocked`; use `named.action` for scheduled thinks, mover completions and path-end actions. Save capture rejects unnamed live callbacks. Changing source state belongs in entity/player fields or an extension registered through `registerStateExtension({ id, capture, restore })`; extension bytes use their source owner's checked codec. `entity.references` stores additional typed actor links and remaps them during restoration. `cloneEntity` copies initialized source/shared state and rebinds callbacks; state extensions may supply `clone` for their private records. It does not run spawn code or consume random values. `spawnEntity(entity, { deathmatch })` supports the synchronous source override used while initializing Hipnotic dormant templates, with restoration even when initialization throws. The caller controls the clone's final placement and collision link.

Mission-pack weapon definitions register firing, presentation, ammunition availability and optional animation through `registerWeapon`. `registerWeaponOrder` retains each source program's exact fallback order, including weapons deliberately excluded by QuakeC. `registerPlayerExtension` supplies admission and pre/post-physics behavior; saved players restore without rerunning admission. The shared session calls `beginFrame` with the actual source elapsed time, supplies held input through `playerInput` before prethink, and calls `playerAfterPhysics` once after movement for effects such as Hipnotic's wetsuit. Source gravity changes delegate to the selected movement host.

`replaceWeapon` supports explicit source overrides such as MG3's shotgun upgrades; `fireBaseWeapon` provides their unmodified fallback without recursive dispatch. `registerPickupRules` retains source pickup, ammunition-combination and respawn differences. `registerWeaponRules` supplies source attack sounds and delay changes. `registerDamageSourceEffects` forwards the shared policy's ordered preparation, armor, protection and health stages. `makeVectors` updates the saved QC basis so later source callbacks can observe previous `v_forward`, `v_right` and `v_up` values.

Complete native multiplayer message parity, final campaign/character integration, and execution against retail reference recordings remain outside these focused checks. Each registered base, mission-pack and addon module owns its private state and independent source verification. The foundation checks do not establish whole-game or multiplayer parity.
