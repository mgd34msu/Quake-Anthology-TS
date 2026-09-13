import type { CommandDialect } from "../../contracts/common.ts";
import type { SeatId } from "../../contracts/identity.ts";
import type { CommandBuffer } from "../../core/commands/index.ts";
import { q2ClientCommands } from "../../content/q2/base/player/commands.ts";

type ExecuteQ2ClientCommand = (name: string, args: readonly string[], seat: SeatId | null) => undefined;

export function registerQ2ClientCommands(commands: CommandBuffer, dialect: CommandDialect, execute: ExecuteQ2ClientCommand): () => void {
  const registered: string[] = [];
  if (dialect === "q2-classic" || dialect === "q2-rerelease") {
    for (const definition of q2ClientCommands) {
      const name = definition.name === "help" ? "gamehelp" : definition.name;
      if (commands.exists(name)) continue;
      const documentation = definition.name === "help"
        ? { ...definition.documentation, usage: "gamehelp", examples: ["gamehelp"], summary: `${definition.documentation.summary} For console command help, use help <name>.` }
        : definition.documentation;
      if (commands.register(name, invocation => {
        let origin = invocation.source.origin;
        while (origin.kind === "script") origin = origin.caller;
        return execute(definition.name, invocation.args, origin.kind === "local-seat" ? origin.seat : null);
      }, documentation)) registered.push(name);
    }
  }
  return () => { for (const name of registered) commands.unregister(name); };
}
