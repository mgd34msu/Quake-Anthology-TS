import type { VictimArmorContext } from "../../../../world/gameplay/armor.ts";
import type { MoverActorAccess } from "../../../../content/q3/base/game/mover.ts";
import type { ExecutableRecipe, ProviderReference } from "../../../../contracts/content.ts";
import type { DamageRequest } from "../../../../contracts/gameplay.ts";
import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import type { ActorCommand } from "../../../../contracts/session.ts";
import type { ModuleIdentity, QvmAbiProfile } from "../../../../contracts/execution.ts";
import type { Q3PlayerState } from "../../../../contracts/protocol.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { ActorCallbackTable, SessionActorRegistry, SharedBodyTable } from "../../../../world/actors/index.ts";
import type { GameplayAuthority, SharedInventoryTable } from "../../../../world/gameplay/index.ts";
import type { ActorCollision, SharedSceneQueries } from "../../../../world/collision/index.ts";
import type { CvarRegistry } from "../../../../core/cvars/index.ts";
import type { GameEntity } from "../../../../content/q3/base/game/state.ts";
import type { EntityState } from "../../../../content/q3/base/shared/entity-state.ts";
import type { ConfigStringStore } from "../../../../content/q3/base/game/utilities.ts";
import type { Product } from "../../../../content/q3/base/shared/definitions.ts";
import type { UserCommand } from "../../../../content/q3/base/shared/player-state.ts";
import type { Q3DeathAnimationSequence } from "../../../../content/q3/foundation/character.ts";
import type { ClientBotServices } from "../../../../content/q3/team-arena/client-admission.ts";
import type { ClientMovementHost } from "../../../../content/q3/team-arena/movement-host.ts";
import type { SpawnPose } from "../../../../content/q3/team-arena/client-spawn.ts";
export type { ClientMovementOptions, ClientMovementResult } from "../../../../content/q3/team-arena/movement-host.ts";

export interface Q3SourceEntityEvent {
  readonly kind: "entity-event";
  readonly actor: ActorId;
  readonly state: EntityState;
  readonly origin: Vec3;
  readonly time: number;
}

/** Original component enums and source client numbers require the originating presentation module. */
export interface Q3SourcePlayerEvent {
  readonly kind: "player-event";
  readonly actor: ActorId;
  readonly source: { readonly module: ModuleIdentity; readonly abiProfile: QvmAbiProfile };
  readonly playerState: Q3PlayerState;
  readonly event: number;
  readonly parameter: number;
  readonly sequence: { readonly kind: "external"; readonly time: number } | { readonly kind: "predictable"; readonly sequence: number };
  readonly origin: Vec3;
  readonly time: number;
}

export interface Q3SourceEngine {
  print(text: string): void;
  log(text: string): void;
  sendServerCommand(client: number, text: string): void;
  dropClient(client: number, reason: string): void;
  getUserinfo(client: number): string;
  setUserinfo(client: number, value: string): void;
  getUserCommand(client: number): UserCommand;
  appendConsoleCommand(text: string): void;
  executeConsoleNow(text: string): void;
}

export type Q3SourceBots = ClientBotServices & (
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "available"; testAas(origin: Vec3): void; interbreedEndMatch(): void; consoleCommand(argv: readonly string[]): void }
);

/** W73 supplies the existing owners; this provider contains source game records and phase functions. */
export interface Q3SourceHost extends ClientMovementHost {
  ammoTimerStored?(actor: ActorId, weapon: number, value: number): void;
  timerOwnership?(actor: ActorId): import("../../../../content/q3/team-arena/client-effects.ts").ClientTimerOwnership;
  speedMultiplier?(actor: ActorId): number;
  readonly serverState: import("./server-state.ts").Q3ServerState;
  readonly moverActors: Pick<MoverActorAccess, "observe" | "write" | "link" | "release">;
  primaryAttackAllowed?(actor: ActorId): boolean;
  grantSelectedArsenal?(actor: ActorId, category: "weapons" | "ammo"): boolean;
  giveSelectedItem?(actor: ActorId, args: readonly string[]): boolean;
  previewPickup?(item: import("../../../../content/q3/base/game/item-lifecycle.ts").SourcePickupDescriptor): import("../../../../content/q3/base/game/item-lifecycle.ts").SourcePickupPreview;
  admitPickup?(item: import("../../../../content/q3/base/game/item-lifecycle.ts").SourcePickupDescriptor): import("../../../../content/q3/base/game/item-lifecycle.ts").SourcePickupAdmission;
  readonly actors: SessionActorRegistry;
  readonly bodies: SharedBodyTable;
  readonly callbacks: ActorCallbackTable;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
  readonly originalPickups?: import("../../../../contracts/original-pickups.ts").OriginalPickupAdmission;
  readonly scene: SharedSceneQueries;
  readonly engine: Q3SourceEngine;
  readonly cvars: CvarRegistry;
  readonly configstrings: ConfigStringStore;
  readonly deathAnimations: Q3DeathAnimationSequence;
  readonly bots: Q3SourceBots;
  now(): number;
  schedule(actor: OwnedActor, dueMilliseconds: number | null): undefined;
  runThink(actor: OwnedActor, timeMilliseconds: number): undefined;
  collision(actor: OwnedActor, collision: ActorCollision): undefined;
  armorContext(request: DamageRequest): VictimArmorContext;
  foreign(actor: ActorId): GameEntity | null;
  isPlayer(actor: ActorId): boolean;
  /** Convert command units for source policy; moveClient still runs the selected provider. */
  sourceCommand(input: ActorCommand): UserCommand;
  spawnPlayer(entity: GameEntity, pose: SpawnPose): void;
  entityEvent(event: Q3SourceEntityEvent): void;
}

export interface Q3SourceOptions {
  readonly weaponBehavior?: import("../../../../contracts/weapon-behavior.ts").WeaponBehaviorProjectilePort;
  readonly recipe: ExecutableRecipe;
  readonly weaponProvider: ProviderReference;
  readonly product: Product;
  readonly entities: string;
  readonly seed: number;
  readonly maxClients: number;
  readonly buildDate: string;
  readonly sessionCarry?: Q3SourceSessionCarry;
}

/** g_session.c's seven source fields survive maps; scores, health and weapons are new-level state. */
export interface Q3SourceSessionCarry {
  readonly kind: "q3";
  readonly world: string;
  readonly clients: readonly { readonly slot: number; readonly session: string; readonly userinfo: string }[];
}
