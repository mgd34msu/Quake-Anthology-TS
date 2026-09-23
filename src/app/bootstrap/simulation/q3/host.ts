import type { CvarArchiveEntry } from "../../../../core/cvars/index.ts";
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import { Q3ServerState } from "./server-state.ts";
import type { Q3SourceHost, Q3SourceBots, Q3SourceEntityEvent, Q3SourcePlayerEvent } from "./types.ts";

export type Q3SourceEvent =
  | { readonly kind: "print" | "log"; readonly text: string }
  | { readonly kind: "server-command"; readonly client: number; readonly text: string }
  | { readonly kind: "console-command"; readonly execution: "append" | "now"; readonly text: string }
  | { readonly kind: "drop-client"; readonly client: number; readonly reason: string }
  | { readonly kind: "configstring"; readonly index: number; readonly value: string }
  | { readonly kind: "sound"; readonly actor: ActorId; readonly origin: Vec3; readonly velocity: Vec3; readonly path: string; readonly channel: number; readonly volume: number; readonly loop: boolean }
  | Q3SourceEntityEvent | Q3SourcePlayerEvent;

export interface Q3HostOperations extends Omit<Q3SourceHost, "engine" | "cvars" | "configstrings" | "bots" | "entityEvent" | "serverState"> {
  readonly bots: Q3SourceBots;
  emit(event: Q3SourceEvent): void;
  clientNumber(actor: ActorId): number;
}

export interface Q3HostSettings {
  readonly gameType: number;
  readonly singlePlayer: boolean;
  readonly maxClients: number;
  readonly mapName: string;
  readonly sourceRegistry?: import("../../../../core/cvars/index.ts").CvarRegistry;
  readonly sourceArchive?: readonly CvarArchiveEntry[];
  readonly cvars?: readonly { readonly name: string; readonly value: string }[];
}

/** Source engine imports publish real commands/configuration to W73's session event consumer. */
export function createQ3SourceHost(operations: Q3HostOperations, settings: Q3HostSettings): Q3SourceHost {
  const serverState = new Q3ServerState({ session: operations.actors.session, now: () => operations.now(),
    print: text => operations.emit({ kind: "print", text }), settings: { ...settings, cvars: [
      ...(settings.sourceRegistry === undefined ? [{ name: "g_gametype", value: String(settings.gameType) }] : []),
      { name: "ui_singlePlayerActive", value: settings.singlePlayer ? "1" : "0" }, ...(settings.cvars ?? []),
    ] } });
  return { ...operations, serverState, cvars: serverState.cvars, bots: operations.bots,
    entityEvent: event => operations.emit(event),
    configstrings: {
      get: index => serverState.configstrings.get(index),
      set: (index, value) => {
        if (serverState.hasConfigstring(index) && serverState.configstrings.get(index) === value) return;
        serverState.configstrings.set(index, value); operations.emit({ kind: "configstring", index, value });
      },
    },
    engine: {
      print: text => operations.emit({ kind: "print", text }), log: text => operations.emit({ kind: "log", text }),
      sendServerCommand: (client, text) => operations.emit({ kind: "server-command", client, text }),
      dropClient: (client, reason) => operations.emit({ kind: "drop-client", client, reason }),
      getUserinfo: client => serverState.getUserinfo(client) ?? `\\name\\Player ${client + 1}\\ip\\localhost\\handicap\\100\\model\\sarge/default\\team_model\\sarge/default`,
      setUserinfo: (client, value) => serverState.setUserinfo(client, value),
      getUserCommand: client => {
        const command = serverState.getUserCommand(client) ?? { serverTime: operations.now(), angles: [0, 0, 0] satisfies readonly [number, number, number], buttons: 0, weapon: 2, forwardmove: 0, rightmove: 0, upmove: 0 };
        return { ...command, angles: { x: command.angles[0], y: command.angles[1], z: command.angles[2] } };
      },
      appendConsoleCommand: text => operations.emit({ kind: "console-command", execution: "append", text }),
      executeConsoleNow: text => operations.emit({ kind: "console-command", execution: "now", text }),
    },
    sourceCommand: input => {
      const command = operations.sourceCommand(input);
      serverState.setUserCommand(operations.clientNumber(input.actor), { ...command, angles: [command.angles.x, command.angles.y, command.angles.z] });
      return command;
    },
  };
}
