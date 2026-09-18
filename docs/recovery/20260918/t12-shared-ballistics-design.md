T12 Team Arena ballistics extraction proposal (read/design only)

Grounded canonical source: .artifacts/resume-20260917/t10-combined/source.
No source changes, tests, compiler or native execution in this design pass.

Decision
Keep q3StepProjectile as the sole trajectory/impact implementation. Extract native mine rules into content/q3/base/game/proximity.ts, with typed actor/body/combat/time/event ports. Native MissileRuntime and foreign Q3SharedBallistics adapt existing owned actors to it. Do not synthesize GameEntity/GameClient, add another movement engine, or merely enable weapon12.

Alternatives considered
1. Reuse native MissileRuntime by constructing temporary native entities: rejected; creates a competing lifetime/record owner and loses foreign actor identity.
2. Extract pure proximity transitions plus a world-owned actor registry: chosen; adapters retain representation, common rules own decisions, world registry resolves mixed-origin stacking.
3. Move all source missiles/physics into a new universal service: unnecessarily large; existing Q3ProjectileHost already has special/reflection hooks.

Proposed owned source paths
- src/content/q3/base/game/proximity.ts (new shared rules/state/actor lookup contract).
- src/content/q3/base/game/missile.ts (native adapter, remove duplicated proximity rules, preserve callback identifiers).
- src/content/q3/base/game/projectile.ts only if a small mutable splash/radius view or phase extension is necessary; reuse special/reflection today.
- src/app/bootstrap/simulation/q3-ballistics.ts (foreign adapter, product union, mine state/save reader, cleanup, product-correct hitscan/reflection).
- src/content/q3/base/game/invulnerability.ts (new pure sphere/impact result) + weapon.ts narrow delegation, retaining existing native event publication.
- Focused new shared tests and existing tests/gameplay/q3/base/combat.test.ts extraction coverage.

Required additional ownership/joins before implementation
- Runtime owner supplies the product-discriminated Team Arena port and the same per-world mine registry to native and foreign adapters. Root/shared effects owner owns actor invulnerability expiry/ticking state; it must distinguish the TA sphere from ordinary god-mode invulnerability.
- Need narrow event additions in src/app/bootstrap/network/unified-event-codec.ts and src/app/bootstrap/effects/q3.ts (or assigned owners). Existing type alias in simulation/types.ts derives from Q3SharedBallisticEvent and should not need editing.
- Foreign armed mines need ActorCallbackTable access and real GameplayAuthority bindings, not a private health field that bullets cannot damage. The foreign host needs the existing callback table and a typed combat-binding factory/descriptor, using the already registered combat provider. Shared trigger actors must be linked through the existing body/scene owner and their real touch callback; no destination-only proximity test.

State and API sketch
Q3ProximityPhase =
  {kind:'flight'}
| {kind:'arming'; due:number; normal:Vec3; surfaceFlags:number; struck:ActorId|null}
| {kind:'armed'; due:number; trigger:ActorId}
| {kind:'triggered'; due:number}
| {kind:'attached'; due:number; target:ActorId}
| {kind:'retiring'; due:number}
| {kind:'spent'; target:ActorId};

Q3ProximityMine stores actor/owner/team, leftOwner, mutable splash/radius, and phase. Actor references remain ActorId/OwnedActor; time remains source integer milliseconds. Native adapters can expose mutable source scalar accessors; foreign adapters own tagged records in existing projectile checkpoint.

One world-owned registry maps mine ActorId to its live binding and player ActorId to the attached mine. This is component state, not another actor/physics world. Native and foreign launches register with it; release/unbind is idempotent. It enables cross-adapter stacking and one attachment owner without fabricating native records.

q3ProximityImpact(mine, hit, host): boolean
q3ProximityThink(mine, host): void
q3ProximityTouch(mine, touchedActor, host): void
q3ProximityKilled(mine, host): void
q3ProximityAfterMove(mine, host): void
q3ProximityRelease(mine, host): void

Ports borrow the existing Q3ProjectileHost time/live/origin/move/link/release and add:
- player(actor): {origin, health, team, invulnerabilityUntil}|null;
- mine(actor): live shared registry binding or null;
- canDamage(player,point), explode(), directJuicedDamage(player,1000,NO_KNOCKBACK,MOD_JUICED);
- armDamageableMine(health=1, deathCallback), createTrigger(origin,radius,touchCallback), releaseTrigger(actor);
- setPlayerTicking(player,mine|null), clearPlayerInvulnerability(player);
- emit typed mine lifecycle/invulnerability effect; update visibility/bounds/loop sound through owning adapter.
No arbitrary callback injection into scheduling: source callback names delegate to transitions, foreign projectile scheduler calls the same due-state transition.

Exact retained source behavior
- Prox launch: gravity, speed700, lifetime3000, splash100/radius150, MOD25, team captured at launch.
- Owner exclusion ends only after actual source trace shows the mine left its owner.
- Stationary impact snaps toward trajectory base, stick event/surface, oriented normal, bounds±4, arm after2000ms.
- Activation: health1/damageable, ticking loop, real radius trigger, source proxMineTimeout.
- Trigger: source client predicate (native does not add a health check), radius/team/LOS checks; stop tick, trigger event, detonate after500ms.
- Shot/death: defer explosion one millisecond; clear trigger exactly once.
- Player attachment: stick, existing ticking mine gains damage and binary32 radius*1.5; redundant mine retires on scheduled source think. Otherwise hide/attach, tick player, explode after10000ms or2000ms for TA invulnerability.
- Attachment explosion: clear ticking; invulnerable target receives source1000/no-knockback/MOD27 and juiced event, sphere expires; preserve its consumed/inert think state so it cannot damage again each frame (do not invent an extra native free); ordinary target relocates mine to source player position and explodes with MOD25.
- Preserve source event retention, actor-release reentrancy and cleanup. Do not add an invented mover-follow transform: native stuck mine stays at source stationary origin and retains struck identity.
- Reflection applies to missionpack hitscan/nails/other projectiles; proximity explicitly bypasses bubble reflection. Reuse source radius42 sphere intersection/binary32 normalization.

Save/lifetime
Serialize tagged mine phases, captured team, deadlines, health, trigger and attachment actor identities, and stacked splash/radius. Resolve all saved actors before one registry/callback rebind; preserve native source callback IDs and support old non-proximity shared projectile records. Native old proximity records can be reconstructed only from their already saved native trajectory/nextthink/attachment/trigger/callback state; no identity or idle-state fallback. Releasing target releases attached mine; releasing mine clears player ticking and trigger. World retirement discards map-local mines; persistent equipment remains the effects owner's responsibility.

Event boundary
Add a typed proximity presentation payload for stick/armed/trigger/attached/detached/juiced and invulnerability-impact geometry. Carry actor/time/source origin and required target/normal/radius state. Wire codec read/write and local effects together; do not emit unknown variants or disguise arming as generic missile impacts. Restored armed/attached state must republish current presentation without replaying damage or one-shot sounds.

Bounded proof after approval
1. Existing native missile/combat tests unchanged in behavior after extraction, with source timer/team/LOS/stack/death/release/juiced cases added where absent.
2. Shared state transitions tested with actual actor/body/combat owners; checkpoint each non-flight phase, remap actors and continue the same deadline/event sequence; cross-adapter attachment stacking.
3. Focused foreign Q1 and Q2 scene fixtures verify real trajectory collision, damageable armed mine, trigger touch and source reflection. Same-family baseQ3/TA adapters exercise one registry; no full Application/native run without grant.
4. Event codec roundtrip and presentation-state restore for new tagged events.
Only after ballistics, foreign TA equipment and product/loadout joins are complete should the central Team Arena exclusion be removed.
