import type { CommandContext, CommandDialect, CommandOrigin } from "../../contracts/common.ts";
import type { SeatId } from "../../contracts/identity.ts";
import type { CommandCvarRouting } from "../../core/commands/index.ts";
import { asciiFold, sourceCommandText } from "../../core/commands/text.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";

export interface ApplicationConsoleServer {
  readonly cvars: CvarRegistry;
  /** Names declared by the source game that a client may also register as mirrors. */
  readonly sharedNames: readonly string[];
}

export interface ApplicationConsoleRoutingOptions {
  readonly fallback: CvarRegistry;
  sourceDialect(): CommandDialect;
  server(): ApplicationConsoleServer | null;
  seat(id: SeatId): CvarRegistry | null;
  /** A null id selects the primary input seat for local startup commands. */
  readonly input?: (id: SeatId | null) => CvarRegistry | null;
  /** Existing input tuning variables retain their movement provider's cvar policy. */
  readonly movement?: () => CvarRegistry | null;
  readonly shared?: () => CvarRegistry | null;
}

function caller(origin: CommandOrigin): Exclude<CommandOrigin, { readonly kind: "script" }> {
  while (origin.kind === "script") origin = origin.caller;
  return origin;
}

interface CvarOwners {
  readonly server: ApplicationConsoleServer | null;
  readonly seat: CvarRegistry | null;
  readonly input: CvarRegistry | null;
  readonly movement: CvarRegistry | null;
  readonly origin: ReturnType<typeof caller>;
}

/** Session authority and the invoking seat stay separate throughout a command drain. */
export class ApplicationConsoleRouting implements CommandCvarRouting {
  private closed = false;

  constructor(private readonly options: ApplicationConsoleRoutingOptions) {
    if (options.sourceDialect() !== options.fallback.dialect) throw new Error("Console dialect must match the source game");
  }

  private owners(source: CommandContext): CvarOwners {
    if (this.closed) throw new Error("Application console owner is closed");
    const dialect = this.options.sourceDialect();
    if (source.session !== this.options.fallback.context.session) throw new Error("Console command belongs to another session");
    if (dialect !== this.options.fallback.dialect) throw new Error("Changing source command dialect requires a new console owner");
    const server = this.options.server(), origin = caller(source.origin);
    if (origin.kind === "remote-client") throw new Error("Remote client cvars require an explicit client owner");
    const seat = origin.kind === "local-seat" ? this.options.seat(origin.seat) : null;
    const input = origin.kind === "server-console" ? null : this.options.input?.(origin.kind === "local-seat" ? origin.seat : null) ?? null;
    const movement = this.options.movement?.() ?? null;
    if (movement !== null && movement.context.session !== source.session) throw new Error("Movement cvars belong to another session");
    for (const registry of [server?.cvars, seat, input]) {
      if (registry === undefined || registry === null) continue;
      if (registry.context.session !== source.session || registry.dialect !== dialect) throw new Error("Console cvar registry has another session or source dialect");
    }
    if (input !== null && caller(input.context.origin).kind !== "local-seat") throw new Error("Mouse settings require a local seat owner");
    if (origin.kind === "local-seat") {
      if (origin.seat.session !== source.session || origin.client.session !== source.session) throw new Error("Console seat belongs to another session");
      for (const registry of [seat, input]) {
        if (registry === null) continue;
        const seatOrigin = caller(registry.context.origin);
        if (seatOrigin.kind !== "local-seat" || !seatOrigin.seat.equals(origin.seat) || !seatOrigin.client.equals(origin.client)) {
          throw new Error("Console cvar registry belongs to another seat");
        }
      }
    }
    return { server, seat, input, movement, origin };
  }

  owner(nameInput: string, source: CommandContext): CvarRegistry {
    const name = sourceCommandText(nameInput), { server, seat, input, movement, origin } = this.owners(source);
    const shared = this.options.shared?.();
    if (shared?.find(name) !== undefined) return shared;
    const serverHas = server !== null && server.cvars.find(name) !== undefined;
    if (input !== null && input.find(name) !== undefined) {
      if (serverHas && server?.cvars !== input) throw new Error(`Console cvar ${name} has conflicting server and input declarations`);
      return input;
    }
    const seatHas = seat !== null && seat.find(name) !== undefined;
    const movementHas = movement !== null && movement.find(name) !== undefined;
    if (server !== null && serverHas && ((seatHas && server.cvars !== seat) || (movementHas && server.cvars !== movement))) {
      const key = server.cvars.dialect === "q3" ? asciiFold(name) : name;
      if (!server.sharedNames.some(shared => (server.cvars.dialect === "q3" ? asciiFold(shared) : shared) === key)) {
        throw new Error(`Console cvar ${name} has conflicting server and seat declarations`);
      }
      return server.cvars;
    }
    if (server !== null && serverHas) return server.cvars;
    if (seatHas && movementHas && seat !== movement) throw new Error(`Console cvar ${name} has conflicting seat and movement declarations`);
    if (seat !== null && seatHas) return seat;
    if (movement !== null && movementHas) return movement;
    if (this.options.fallback.find(name) !== undefined) return this.options.fallback;
    if (origin.kind === "server-console" && server !== null) return server.cvars;
    return seat ?? this.options.fallback;
  }

  visible(source: CommandContext): readonly CvarRegistry[] {
    const { server, seat, input, movement } = this.owners(source), registries = new Set<CvarRegistry>();
    const shared = this.options.shared?.(); if (shared !== undefined && shared !== null) registries.add(shared);
    if (input !== null) registries.add(input);
    if (server !== null) registries.add(server.cvars);
    if (seat !== null) registries.add(seat);
    if (movement !== null) registries.add(movement);
    registries.add(this.options.fallback);
    return Object.freeze([...registries]);
  }

  close(): void { this.closed = true; }
}
