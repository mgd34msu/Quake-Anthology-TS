# Shared engine contracts

`src/contracts` defines the boundaries consumed by the imported implementations. The source selections are recorded in [reference contracts](reference-contracts.md). These declarations establish ownership and data shapes. Runtime fidelity remains work for the corresponding implementation packages.

| File | Exports and owner |
| --- | --- |
| `math.ts` | `Vec2`, `Vec3`, `Vec4`, `Bounds`, `Plane`, `Axis`, and `Mat4`; shared arithmetic implementations use Q3-compatible coordinate records. `MutableVec3` preserves explicit output mutation. |
| `numeric.ts` | `NumericProfile`, `NumericOperations`, and `RandomState`; the recipe selects operation rounding, integer conversion, and guest floating-point behavior. |
| `identity.ts` | `createIdentityOwner`, `ActorId`, `OwnedActor`, `SessionId`, `SeatId`, and `ClientId`; the session registry keeps the construction capability. |
| `time.ts` | `ClockProfile`, `SourceTime`, `FrameContext`, and `FrameOrdering`; clocks retain source units and callback order. |
| `content.ts` | `LaunchChoice`, `ExecutableRecipe`, and `ResolvedResourceReference`; the catalog resolves content and all named overrides before simulation construction. |
| `common.ts` | `CommandDialect`, `CommandContext`, and `CvarPolicy`; command buffering retains session and source context across inserted text and waits. |
| `world.ts` | `ActorRegistry`, `BodyTable`, `ActorCallbacks`, and `ActorSchedule`; the world owns lifetime, bodies, links, and scheduled execution. |
| `gameplay.ts` | `AttackProvenance`, `CombatPolicy`, `DamageAuthority`, `InventoryTable`, and `TransitionCoordinator`; each gameplay mutation has one owner. |
| `scene.ts` | Source geometry, model, collision-query, and scene snapshot contracts. |
| `render.ts` | Shared CPU and GL backend submission, render views, images, and materials. |
| `movement.ts` | Source movement state, commands, providers, and ordered results. |
| `protocol.ts` | Native protocol identities, commands, snapshots, and recipient-specific messages. |
| `execution.ts` | Guest memory, raw entity views, API identities, and guest checkpoints. |
| `ui.ts` | Source UI callbacks and independent local-seat state. |
| `session.ts` | `Simulation`, `WorldSnapshot`, `SaveImage`, and `SeatPresentation`; headless simulation and local presentation have separate lifetimes. |

The identity classes have private fields and unexported constructors. A spread copy cannot satisfy their types. `createIdentityOwner` returns the capability held by the registry. Live handles are immutable and include their session, slot, and generation. Source network numbers and guest pointers remain separate representations. `SavedActorId` stores the slot and generation for restoration through a fresh registry.

`ActorObservation` permits inspection. `OwnedActor` permits changes through the owning tables and scheduler. The registry verifies that a handle is live and that the caller owns it. `LinkedBody` records the bounds visible at the last source-defined link. Changing a body does not imply a spatial relink.

`ActorCallbacks` and mutating domain operations return `undefined`. A Promise-returning function cannot satisfy them. Source callbacks that return values keep those values. Q2 admission returns `allowed` and the potentially changed `userinfo`; Q3 admission returns a denial string or null. Nested callbacks finish before their caller returns. `SourceGameLifecycle` preserves QC `StartFrame`, Q2 classic `RunFrame`, Q2 rerelease `PrepFrame` and `RunFrame(mainLoop)`, and Q3 `RunFrame(levelTimeMilliseconds)` as shared-scheduler entry points.

`NumericOperations` places arithmetic rounding at each operation. Its profile distinguishes binary32, x87 precision and rounding, and SSE denormal behavior. The explicit `donor-binary64` profile reproduces Q1 or Q2 TypeScript donor arithmetic, without claiming original native behavior. JavaScript numbers alone do not implement x87 extended precision. The guest implementation retains that representation. Unsupported arithmetic profiles fail during selection. Random generators have explicit checkpoint variants and draw counts. A provider owns its generator and its draw order.

`SourceTime` retains seconds or milliseconds. Native timing profiles distinguish NetQuake, QuakeWorld, Q2 classic 100-millisecond frames, Q2 rerelease frame preparation, and Q3 command subdivision. Mixed ordering records provider order, source entity order, and invocation ties. The selected protocol does not choose any clock.

`ExecutableRecipe` separates map geometry, map entities, campaign gamecode, movement, character, weapons, enemies, presentation, engine behavior, combat, inventory, match rules, transitions, and execution modules. `ActorConfiguration` applies movement, character, weapon, and inventory choices per actor. Q1 campaign gamecode remains independent of engine behavior. Q2 mount plans retain a complete default order and explicit prefix orders, including classic `maps/` precedence with rerelease assets.

`AttackProvenance` is captured before combat mutation. It records source cause and the selected weapon, combat, inventory, and movement providers. `CombatPolicy` computes an ordered `DamageDecision`. The damage authority applies each mutation once, delivers the actor controller's reaction, and then informs match rules. A deleted target produces `stale-target`. Inventory owns item identities, capacities, pickup results, and ammunition consumption. Impulses name the movement provider that consumes them.

Campaign controllers own mission gates. Match controllers own rounds and rotation. The transition coordinator resolves simultaneous intents and alone commits travel. Combined modes retain campaign gates even when a round ends. Competitive rotation does not mark a campaign objective complete.

`Simulation` has no renderer or SDL dependency. `SeatClientState` contains a specific seat, client, actor binding, UI state, and presentation binding. Events explicitly target the world, one seat, or one client. Shared events enter simulation once. Each seat builds its own frame and receives its own private messages.

`SaveImage` contains the recipe version, clocks, generators, slot generations, separate component tables, stable callback IDs, provider checkpoints, and guest checkpoints. Provider checkpoint bytes use an identified versioned codec. Saved native callbacks retain byte offsets and module identity. Restoration creates their live address-space bindings. No host closure or backend handle is part of the save contract. Runtime checkpoint implementations own their byte copies and reconstruct guest views and callbacks during restoration.

Source anchors include Q3 [math.ts](/home/buzzkill/Projects/quake-3-ts/src/core/math.ts), [numeric.ts](/home/buzzkill/Projects/quake-3-ts/src/core/numeric.ts), and [movement.ts](/home/buzzkill/Projects/quake-3-ts/src/shared/movement.ts); Q1 [profile.ts](/home/buzzkill/Projects/quake-1-re-ts/src/progs/profiles/profile.ts); and Q2 [kexapi/game.ts](/home/buzzkill/Projects/quake-2-re-ts/src/kexapi/game.ts). The original [Q2 game header](/home/buzzkill/Projects/qsrc/quake-2/game/game.h:225) preserves `ClientConnect`'s boolean result and mutable userinfo. The original [Q3 game header](/home/buzzkill/Projects/qsrc/quake-iii-arena/code/game/g_public.h:405) specifies its denial-string-or-null result. Q2's [combat API](/home/buzzkill/Projects/qsrc/quake-2/game/g_local.h:658) supplies direction, impact point, normal, damage, knockback, flags, and cause separately.

`bun tools/check-policy.ts src/contracts` runs the existing policy checker and strict compiler over these contracts. Direct constructor checks cover generation reuse, session isolation, invalid identifiers, and resource precedence. This validation does not claim the movement, guest, damage, or transition implementations are complete.
