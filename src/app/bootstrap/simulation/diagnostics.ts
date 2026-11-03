// SPDX-License-Identifier: GPL-2.0-or-later
import type { AttackProvenance } from "../../../contracts/gameplay.ts";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { SourceMatchPlayer } from "../../../contracts/source-match.ts";
import type { Q1EntityServices } from "../../../content/q1/foundation/entity-services.ts";
import type { Q2PlayerMovementChange } from "../../../content/q2/base/player/types.ts";

type Team = 1 | 2;

/**
 * Read-only view of the runtime's match-layer state for tests and operator tooling, plus the two
 * mutations tests need to drive it (a player movement change and a recorded attack). It reads the
 * runtime's own state; nothing here is a second store.
 */
export interface SimulationDiagnostics {
  readonly modes: { readonly tag: boolean; readonly lmctf: boolean; readonly ctf: boolean; readonly deathball: boolean };
  readonly tag: {
    token(): OwnedActor | null;
    owner(): ActorId | null;
    count(): number;
    trackedHealth(): number;
    tracksHealth(actor: ActorId): boolean;
  };
  readonly lmctf: {
    flag(team: Team): { readonly actor: OwnedActor | null; readonly carrier: ActorId | null; readonly home: Vec3; readonly droppedAt: number | null } | undefined;
    rune(kind: string): { readonly actor: OwnedActor | null; readonly holder: ActorId | null } | undefined;
    team(actor: ActorId): Team | undefined;
  };
  readonly deathball: {
    ball(): OwnedActor | null;
    team(actor: ActorId): Team | undefined;
    goal(team: Team): Vec3 | undefined;
  };
  readonly horde: { wave(): number; pendingWave(): number; fraggedCount(): number };
  /** Which gameplay source family runs, plus the Q1 program and edition when it is a Q1 source. */
  source(): { readonly kind: string; readonly q1: { readonly program: string; readonly edition: string } | null };
  /** The Q1 gameplay services in play: the Q1 source itself, or the selected Q1 arsenal inside a foreign world. */
  q1Services(): Q1EntityServices | null;
  /** Grants a selected arsenal's weapons or ammunition to a player; false when no arsenal applies. */
  grantArsenal(actor: ActorId, category: "weapons" | "ammo"): boolean;
  selectArsenalWeapon(actor: ActorId, item: string): boolean;
  matchPlayer(actor: ActorId): SourceMatchPlayer | null;
  /** Applies a movement change to a player, as the Q2 teleport and noclip commands do. */
  movePlayer(actor: ActorId, change: Q2PlayerMovementChange): undefined;
  /** Records the provenance the next death observation of this actor will attribute its kill to. */
  recordAttack(actor: OwnedActor, attack: AttackProvenance): undefined;
}
