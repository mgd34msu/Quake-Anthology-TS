import type { ModuleIdentity } from "./execution.ts";
import type { ClientId, SeatId, SessionId } from "./identity.ts";

/** Command and cvar dialects are independent of the selected network codec. */
export type CommandDialect = "q1-netquake" | "q1-quakeworld" | "q2-classic" | "q2-rerelease" | "q3";

export type CommandOrigin =
  | { readonly kind: "local-console" }
  | { readonly kind: "server-console" }
  | { readonly kind: "local-seat"; readonly seat: SeatId; readonly client: ClientId }
  | { readonly kind: "remote-client"; readonly client: ClientId }
  | { readonly kind: "script"; readonly name: string; readonly caller: CommandOrigin };

/** A buffered chunk retains this context through insertions, nested execution, and wait. */
export interface CommandContext {
  readonly session: SessionId;
  readonly origin: CommandOrigin;
  /** Source producer is provenance, not permission to bypass the authority origin. */
  readonly producer?: { readonly kind: "game-module" | "client-module"; readonly module: ModuleIdentity; readonly instance?: symbol };
}

export type CvarInfoTarget = "client-userinfo" | "server-info";

export type CvarPolicy =
  | { readonly kind: "q1-netquake"; readonly nameComparison: "exact"; readonly registrationOrder: "newest-first" }
  | { readonly kind: "q1-quakeworld"; readonly nameComparison: "exact"; readonly registrationOrder: "newest-first"; readonly infoTargets: readonly CvarInfoTarget[] }
  | { readonly kind: "q2-classic" | "q2-rerelease"; readonly nameComparison: "exact"; readonly registrationOrder: "newest-first" }
  | { readonly kind: "q3"; readonly nameComparison: "ascii-insensitive"; readonly registrationOrder: "newest-first" };
