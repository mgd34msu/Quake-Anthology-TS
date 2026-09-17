import type { SeatId } from "../contracts/identity.ts";
import { asciiFold, type CommandBuffer, type CommandHandler, type CommandInvocation } from "../core/commands/index.ts";

export interface ClientCommandRegistration {
  register(name: string): void;
  remove(name: string): void;
  close(): void;
}

/** Guest instances own claims; one published input owns the shared dispatchers. */
export class ClientCommandBindings {
  private readonly owners = new Set<{ readonly seat: SeatId; readonly names: Set<string> }>();
  private readonly installed = new Map<string, CommandHandler>();
  private active = false;
  constructor(private readonly commands: CommandBuffer, private seats: readonly SeatId[],
    private readonly execute: (command: CommandInvocation, seat: SeatId) => undefined) {}

  publishSeats(seats: readonly SeatId[]): void {
    for (const owner of this.owners) if (!seats.some(seat => seat.equals(owner.seat))) {
      this.owners.delete(owner);
      for (const name of owner.names) this.removeUnused(name);
      owner.names.clear();
    }
    this.seats = [...seats];
  }

  createOwner(seat: SeatId): ClientCommandRegistration {
    if (!this.seats.some(value => value.equals(seat))) throw new Error("Client commands require a local seat");
    const owner = { seat, names: new Set<string>() };
    this.owners.add(owner);
    return {
      register: name => {
        if (!this.owners.has(owner)) throw new Error("Client command owner is retired");
        const key = asciiFold(name);
        owner.names.add(key);
        if (this.active) this.install(key);
      },
      remove: name => {
        const key = asciiFold(name);
        if (owner.names.delete(key)) this.removeUnused(key);
      },
      close: () => {
        if (!this.owners.delete(owner)) return;
        for (const name of owner.names) this.removeUnused(name);
        owner.names.clear();
      },
    };
  }

  activate(): void {
    if (this.active) return;
    this.active = true;
    for (const owner of this.owners) for (const name of owner.names) this.install(name);
  }

  deactivate(): void {
    this.active = false;
    for (const [name, handler] of this.installed) this.commands.unregister(name, handler);
    this.installed.clear();
  }

  dispatch(command: CommandInvocation): boolean {
    if (!this.active) return false;
    let origin = command.source.origin;
    while (origin.kind === "script") origin = origin.caller;
    const seat = origin.kind === "local-seat" ? origin.seat : origin.kind === "local-console"
      ? this.seats.find(candidate => [...this.owners].some(owner => owner.seat.equals(candidate))) : undefined;
    if (seat === undefined) return false;
    const name = asciiFold(command.argv[0] ?? "");
    if (![...this.owners].some(owner => owner.seat.equals(seat) && owner.names.has(name))) return false;
    this.execute(command, seat);
    return true;
  }

  private install(name: string): void {
    if (this.installed.has(name) || this.commands.exists(name)) return;
    const handler: CommandHandler = command => { this.dispatch(command); };
    if (this.commands.register(name, handler)) this.installed.set(name, handler);
  }

  private removeUnused(name: string): void {
    if ([...this.owners].some(owner => owner.names.has(name))) return;
    const handler = this.installed.get(name);
    if (handler === undefined) return;
    this.commands.unregister(name, handler);
    this.installed.delete(name);
  }
}
