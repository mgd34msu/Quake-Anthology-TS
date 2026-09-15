import type { CommandContext, CommandDialect } from "../../contracts/common.ts";
import type { ActorId, ClientId, SeatId } from "../../contracts/identity.ts";
import type { CommandBuffer } from "../../core/commands/index.ts";

/** Quake host_cmd.c registers these client names before forwarding them to authority. */
export function registerQ1ClientCommands(commands: CommandBuffer, dialect: CommandDialect,
  execute: (name: string, args: readonly string[], seat: SeatId | null, source: CommandContext) => undefined): () => void {
  const registered: string[] = [];
  if (dialect.startsWith("q1")) for (const { name, summary } of [
    { name: "god", summary: "Toggle god mode; multiplayer authority controls cheat access." },
    { name: "notarget", summary: "Toggle monster targeting immunity; multiplayer authority controls cheat access." },
    { name: "noclip", summary: "Toggle movement through walls; multiplayer authority controls cheat access." },
  ]) {
    if (commands.exists(name)) continue;
    if (commands.register(name, invocation => {
      let origin = invocation.source.origin; while (origin.kind === "script") origin = origin.caller;
      return execute(name, invocation.args, origin.kind === "local-seat" ? origin.seat : null, invocation.source);
    }, { summary, usage: `${name} [client slot: server console only]`, examples: [name, `${name} 0`] })) registered.push(name);
  }
  return () => { for (const name of registered) commands.unregister(name); };
}

export function resolveQ1HostCommandActor(name: string, args: readonly string[], source: CommandContext | undefined,
  players: readonly { readonly actor: ActorId; readonly client: ClientId }[], localActor: () => ActorId): ActorId {
  let origin = source?.origin; while (origin?.kind === "script") origin = origin.caller;
  if (origin?.kind === "server-console") {
    const target = args[0];
    if (args.length !== 1 || target === undefined || !/^\d+$/.test(target))
      throw new Error(`Usage: ${name} <client slot>; connected slots: ${players.map(player => player.client.slot).join(", ") || "none"}`);
    const player = players.find(player => player.client.slot === Number(target));
    if (player === undefined) throw new Error(`Client slot ${target} is not on the server`);
    return player.actor;
  }
  if (args.length !== 0) throw new Error(`${name}: only the server console may select a client slot`);
  if (origin?.kind === "remote-client" || origin?.kind === "local-seat") {
    const client = origin.client, player = players.find(player => player.client.equals(client));
    if (player === undefined) throw new Error("Command requires an admitted client");
    return player.actor;
  }
  return localActor();
}
