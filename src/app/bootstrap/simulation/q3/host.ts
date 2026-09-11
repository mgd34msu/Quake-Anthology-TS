import type { ActorId } from "../../../../contracts/identity.ts";
import { CvarFlag, CvarRegistry } from "../../../../core/cvars/index.ts";
import type { UserCommand } from "../../../../content/q3/base/shared/player-state.ts";
import type { Q3SourceHost, Q3SourceBots, Q3SourceEntityEvent } from "./types.ts";

export type Q3SourceEvent =
  | { readonly kind: "print" | "log"; readonly text: string }
  | { readonly kind: "server-command"; readonly client: number; readonly text: string }
  | { readonly kind: "console-command"; readonly execution: "append" | "now"; readonly text: string }
  | { readonly kind: "drop-client"; readonly client: number; readonly reason: string }
  | { readonly kind: "configstring"; readonly index: number; readonly value: string }
  | Q3SourceEntityEvent;

export interface Q3HostOperations extends Omit<Q3SourceHost, "engine" | "cvars" | "configstrings" | "bots" | "entityEvent"> {
  readonly bots: Q3SourceBots;
  emit(event: Q3SourceEvent): void;
  clientNumber(actor: ActorId): number;
}

export interface Q3HostSettings {
  readonly gameType: number;
  readonly singlePlayer: boolean;
  readonly maxClients: number;
  readonly mapName: string;
  readonly cvars?: readonly { readonly name: string; readonly value: string }[];
}

/** Source engine imports publish real commands/configuration to W73's session event consumer. */
export function createQ3SourceHost(operations: Q3HostOperations, settings: Q3HostSettings): Q3SourceHost {
  const values = new Map<number, string>(), userinfo = new Map<number, string>(), commands = new Map<number, UserCommand>();
  const cvars = new CvarRegistry({ dialect: "q3", context: { session: operations.actors.session, origin: { kind: "server-console" } },
    print: text => operations.emit({ kind: "print", text }) });
  for (const [name, value] of [["g_gametype", String(settings.gameType)], ["ui_singlePlayerActive", settings.singlePlayer ? "1" : "0"],
    ["sv_maxclients", String(settings.maxClients)], ["sv_mapname", settings.mapName]]) {
    if (name !== undefined && value !== undefined) cvars.set(name, value, true);
  }
  cvars.register("mapname", settings.mapName, CvarFlag.ServerInfo | CvarFlag.ReadOnly);
  for (const variable of settings.cvars ?? []) cvars.set(variable.name, variable.value, true);
  const copyCommand = (command: UserCommand): UserCommand => ({ ...command, angles: { ...command.angles } });
  return { ...operations, cvars, bots: operations.bots,
    entityEvent: event => operations.emit(event),
    configstrings: {
      get: index => values.get(index) ?? "",
      set: (index, value) => {
        if (!Number.isInteger(index) || index < 0 || index >= 1024) throw new RangeError("Q3 configstring outside source range");
        if (values.get(index) === value) return;
        values.set(index, value); operations.emit({ kind: "configstring", index, value });
      },
    },
    engine: {
      print: text => operations.emit({ kind: "print", text }), log: text => operations.emit({ kind: "log", text }),
      sendServerCommand: (client, text) => operations.emit({ kind: "server-command", client, text }),
      dropClient: (client, reason) => operations.emit({ kind: "drop-client", client, reason }),
      getUserinfo: client => userinfo.get(client) ?? `\\name\\Player ${client + 1}\\ip\\localhost\\handicap\\100\\model\\sarge/default\\team_model\\sarge/default`,
      setUserinfo: (client, value) => { userinfo.set(client, value); },
      getUserCommand: client => {
        const command = commands.get(client);
        return command === undefined ? { serverTime: operations.now(), angles: { x: 0, y: 0, z: 0 }, buttons: 0, weapon: 2,
          forwardmove: 0, rightmove: 0, upmove: 0 } : copyCommand(command);
      },
      appendConsoleCommand: text => operations.emit({ kind: "console-command", execution: "append", text }),
      executeConsoleNow: text => operations.emit({ kind: "console-command", execution: "now", text }),
    },
    sourceCommand: input => {
      const command = operations.sourceCommand(input);
      commands.set(operations.clientNumber(input.actor), copyCommand(command));
      return command;
    },
  };
}
