import type { CommandContext, CommandDialect } from "../../contracts/common.ts";
import type { ActorId, ClientId, SeatId } from "../../contracts/identity.ts";
import type { CommandBuffer } from "../../core/commands/index.ts";

/** Quake host_cmd.c registers these client names before forwarding them to authority. */
export function registerQ1ClientCommands(commands: CommandBuffer, dialect: CommandDialect,
  execute: (name: string, args: readonly string[], seat: SeatId | null, source: CommandContext) => undefined): () => void {
  const registered: string[] = [];
  for (const { name, summary } of [
    { name: "god", summary: "Toggle god mode; multiplayer authority controls cheat access." },
    { name: "notarget", summary: "Toggle monster targeting immunity; multiplayer authority controls cheat access." },
    { name: "noclip", summary: "Toggle movement through walls; multiplayer authority controls cheat access." },
    { name: "give", summary: "Give all, health, armor, weapons, ammo, keys, or a named item; source authority controls cheat access." },
    { name: "giveall", summary: "Give the source all grant, including the currently selected arsenal." },
    { name: "kill", summary: "Suicide through the source game's player lifecycle." },
    { name: "suicide", summary: "Alias for kill." },
    ...(dialect === "q1-netquake" ? [{ name: "fly", summary: "Toggle flying with collision using NetQuake movement." }] : []),
  ]) {
    if (commands.exists(name)) continue;
    if (commands.register(name, invocation => {
      let origin = invocation.source.origin; while (origin.kind === "script") origin = origin.caller;
      const args = name === "giveall" ? origin.kind === "server-console" ? [...invocation.args, "all"] : ["all"] : invocation.args;
      return execute(name === "giveall" ? "give" : name === "suicide" ? "kill" : name, args, origin.kind === "local-seat" ? origin.seat : null, invocation.source);
    }, { summary, usage: name === "give" ? "give [client slot: server console only] <all|health|armor|weapons|ammo|keys|item> [amount]"
      : `${name} [client slot: server console only]`, examples: name === "give" ? ["give all", "give health 100"] : [name] })) registered.push(name);
  }
  return () => { for (const name of registered) commands.unregister(name); };
}

export function resolveQ1HostCommandActor(name: string, args: readonly string[], source: CommandContext | undefined,
  players: readonly { readonly actor: ActorId; readonly client: ClientId }[], localActor: () => ActorId, takesArguments = false): ActorId {
  let origin = source?.origin; while (origin?.kind === "script") origin = origin.caller;
  if (origin?.kind === "server-console") {
    const target = args[0];
    if ((!takesArguments && args.length !== 1) || target === undefined || !/^\d+$/.test(target))
      throw new Error(`Usage: ${name} <client slot>; connected slots: ${players.map(player => player.client.slot).join(", ") || "none"}`);
    const player = players.find(player => player.client.slot === Number(target));
    if (player === undefined) throw new Error(`Client slot ${target} is not on the server`);
    return player.actor;
  }
  if (!takesArguments && args.length !== 0) throw new Error(`${name}: only the server console may select a client slot`);
  if (origin?.kind === "remote-client" || origin?.kind === "local-seat") {
    const client = origin.client, player = players.find(player => player.client.equals(client));
    if (player === undefined) throw new Error("Command requires an admitted client");
    return player.actor;
  }
  return localActor();
}
