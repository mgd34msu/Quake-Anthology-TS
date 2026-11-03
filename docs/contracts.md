# Shared engine contracts

`src/contracts` holds the type declarations (and a few small helpers) that the other layers share. It
sits in the lowest tier of the layering rule (see [architecture.md](architecture.md)) and defines
ownership and data shapes, not behavior. The implementations live elsewhere.

Core declarations:

| File | Exports and owner |
| --- | --- |
| `math.ts` | `Vec2`, `Vec3`, `Vec4`, `Bounds`, `Plane`, `Axis`, `Mat4`; shared arithmetic uses plain coordinate records. `MutableVec3` preserves explicit output mutation. |
| `numeric.ts` | `NumericProfile`, `NumericOperations`, `RandomState`; the recipe selects operation rounding, integer conversion, and guest floating-point behavior. |
| `identity.ts` | `createIdentityOwner`, `ActorId`, `OwnedActor`, `SessionId`, `SeatId`, `ClientId`, `ProviderId`, `CallbackId`; the session registry keeps the construction capability. |
| `time.ts` | `ClockProfile`, `SourceTime`, `FrameContext`, `FrameOrdering`, `ThinkTiming`; clocks retain source units and callback order. |
| `content.ts` | `LaunchChoice`, `ExecutableRecipe`, `ResolvedResourceReference`, content, recipe and mount-plan ids; the catalog resolves content and all named overrides before simulation construction. |
| `common.ts` | `CommandDialect`, `CommandContext`; command buffering retains session and source context across inserted text and waits. |
| `world.ts` | `ActorRegistry`, `BodyTable`, `ActorCallbacks`, `ActorSchedule`; the world owns lifetime, bodies, links, and scheduled execution. |
| `gameplay.ts` | `AttackProvenance`, `CombatPolicy`, `DamageAuthority`, `InventoryTable`, `TransitionCoordinator`; each gameplay mutation has one owner. |
| `scene.ts`, `scene-trace.ts` | Source geometry, model and scene snapshot types; collision queries (`TraceQuery`, `SceneQueries`). |
| `render.ts`, `flare.ts` | Shared CPU and GL backend submission, render views, images, materials; scene flares. |
| `movement.ts` | Source movement state, commands, providers, and ordered results. |
| `protocol.ts` | Native protocol identities, user commands, snapshots, and recipient-specific messages. |
| `execution.ts` | Guest memory, raw entity views, API identities, and guest checkpoints. |
| `ui.ts` | Source UI callbacks, input bindings, and independent local-seat state. |
| `session.ts` | `Simulation`, `WorldSnapshot`, `SaveImage`, `SeatClientState`, `SeatPresentation`; headless simulation and local presentation have separate lifetimes. |
| `presentation.ts` | Owner key and media requests for component-supplied presentation output. |

Weapons, items and pickups:

| File | Contents |
| --- | --- |
| `pickups.ts`, `original-pickups.ts`, `qc-pickup-callers.ts` | Shared pickup admission and supply profiles, original-game pickup rules and outcomes, and the QuakeC pickup caller declarations. |
| `source-items.ts`, `source-match.ts` | Source item definitions, stores and leases; source team and objective state and match services. |
| `weapon-behavior.ts`, `native-weapon-behavior.ts`, `qc-weapon-stage.ts` | Weapon behavior definitions and projectile roles, native weapon declarations, and QuakeC weapon-stage declarations. |
| `held-weapon.ts`, `model-attachment.ts`, `equipment.ts` | Held-weapon model declarations, model attachment definitions, and the shared grapple control. |

Mod declarations (see [mod-compatibility.md](mod-compatibility.md)):

| File | Contents |
| --- | --- |
| `mods.ts` | Mod selection, identity and checkpoints. |
| `mod-callbacks.ts`, `mod-client-outputs.ts`, `mod-client-presentation.ts` | Callback bindings, client input and output declarations shared by all mod kinds. |
| `qvm-mod-callbacks.ts`, `qvm-mod-items.ts`, `qvm-mod-presentation.ts`, `qvm-mod-actor-frame.ts`, `qvm-combat.ts`, `qvm-grapple.ts` | Quake III QVM mod declarations: source calls, item and weapon stages, presentation programs, combat calls and the grapple definition. |
| `native-mod-callbacks.ts`, `native-mod-items.ts`, `native-mod-region.ts` | The same declarations for native Quake II mod modules. |


The identity classes have private fields and unexported constructors. A spread copy cannot satisfy their types. `createIdentityOwner` returns the capability held by the registry. Live handles are immutable and include their session, slot, and generation. Source network numbers and guest pointers remain separate representations. `SavedActorId` stores the slot and generation for restoration through a fresh registry.

`ActorObservation` permits inspection. `OwnedActor` permits changes through the owning tables and scheduler. The registry verifies that a handle is live and that the caller owns it. `LinkedBody` records the bounds visible at the last source-defined link. Changing a body does not imply a spatial relink.

`ActorCallbacks` and mutating domain operations return `undefined`. A Promise-returning function cannot satisfy them. Source callbacks that return values keep those values. Q2 admission returns `allowed` and the potentially changed `userinfo` (`Q2AdmissionResult`). Nested callbacks finish before their caller returns.

`NumericOperations` places arithmetic rounding at each operation. Its profile distinguishes binary32, x87 precision and rounding, and SSE denormal behavior. The explicit `donor-binary64` profile reproduces the arithmetic of the built-in Q1 or Q2 TypeScript code, not original native behavior. JavaScript numbers alone do not implement x87 extended precision. The guest implementation retains that representation. Unsupported arithmetic profiles fail during selection. Random generators have explicit checkpoint variants and draw counts. A provider owns its generator and its draw order.

`SourceTime` retains seconds or milliseconds. Native timing profiles distinguish NetQuake, QuakeWorld, Q2 classic 100-millisecond frames, Q2 rerelease frame preparation, and Q3 command subdivision. Mixed ordering records provider order, source entity order, and invocation ties. The selected protocol does not choose any clock.

`ExecutableRecipe` separates map geometry, map entities, campaign gamecode, movement, character, weapons, enemies, presentation, engine behavior, combat, inventory, match rules, transitions, and execution modules. `ActorConfiguration` applies movement, character, weapon, and inventory choices per actor. Q1 campaign gamecode remains independent of engine behavior. Q2 mount plans retain a complete default order and explicit prefix orders, including classic `maps/` precedence with rerelease assets.

`AttackProvenance` is captured before combat mutation. It records source cause and the selected weapon, combat, inventory, and movement providers. `CombatPolicy` computes an ordered `DamageDecision`. The damage authority applies each mutation once, delivers the actor controller's reaction, and then informs match rules. A deleted target produces `stale-target`. Inventory owns item identities, capacities, pickup results, and ammunition consumption. Impulses name the movement provider that consumes them.

Campaign controllers own mission gates. Match controllers own rounds and rotation. The transition coordinator resolves simultaneous intents and alone commits travel. Combined modes retain campaign gates even when a round ends. Competitive rotation does not mark a campaign objective complete.

`Simulation` has no renderer or SDL dependency. `SeatClientState` contains a specific seat, client, actor binding, UI state, and presentation binding. Events explicitly target the world, one seat, or one client. Shared events enter simulation once. Each seat builds its own frame and receives its own private messages.

`SaveImage` contains the recipe version, clocks, generators, slot generations, separate component tables, stable callback IDs, provider checkpoints, and guest checkpoints. Provider checkpoint bytes use an identified versioned codec. Saved native callbacks retain byte offsets and module identity. Restoration creates their live address-space bindings. No host closure or backend handle is part of the save contract. Runtime checkpoint implementations own their byte copies and reconstruct guest views and callbacks during restoration.

`bun tools/check-policy.ts src/contracts` runs the policy checker over these contracts. Tests of the identity constructors cover generation reuse, session isolation, invalid identifiers, and resource precedence.
