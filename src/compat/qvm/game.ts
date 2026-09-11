/* Quake III Arena server/sv_game.c, sv_client.c and game/g_public.h. GPL-2.0-or-later. */
import { QvmGameExport, QvmGameImport } from "./abi.ts";
import { QvmGameData } from "./game-data.ts";
import { QvmModule } from "./module.ts";
import type { QvmModuleOptions } from "./module.ts";

export class QvmGame {
  readonly module: QvmModule;
  readonly data: QvmGameData;
  readonly api = { kind: "q3-qagame", version: 8 } satisfies Extract<QvmModule["profile"]["api"], { readonly kind: "q3-qagame" }>;

  constructor(options: QvmModuleOptions) {
    if (options.artifact.role !== "qagame") throw new Error("QvmGame requires a qagame artifact");
    this.module = new QvmModule({ ...options, host: call => {
      if (call.kind === "engine" && call.role === "qagame" && call.code === QvmGameImport.G_LOCATE_GAME_DATA) {
        this.data.locate(call.words.getInt32(4, true), call.words.getInt32(8, true), call.words.getInt32(12, true), call.words.getInt32(16, true), call.words.getInt32(20, true));
        return 0;
      }
      return options.host(call);
    } });
    this.data = new QvmGameData(this.module.memory);
  }

  initialize(levelTime: number, randomSeed: number, restart = false): undefined {
    this.module.call([QvmGameExport.GAME_INIT, levelTime, randomSeed, Number(restart)]);
  }
  shutdown(restart: boolean): undefined { this.module.call([QvmGameExport.GAME_SHUTDOWN, Number(restart)]); }
  clientConnect(client: number, firstTime: boolean, isBot: boolean): string | null {
    const denied = this.module.call([QvmGameExport.GAME_CLIENT_CONNECT, client, Number(firstTime), Number(isBot)]);
    return denied === 0 ? null : this.module.memory.readString(denied);
  }
  clientBegin(client: number): undefined { this.module.call([QvmGameExport.GAME_CLIENT_BEGIN, client]); }
  clientUserinfoChanged(client: number): undefined { this.module.call([QvmGameExport.GAME_CLIENT_USERINFO_CHANGED, client]); }
  clientDisconnect(client: number): undefined { this.module.call([QvmGameExport.GAME_CLIENT_DISCONNECT, client]); }
  clientCommand(client: number, arguments_: readonly string[]): undefined { this.module.command([QvmGameExport.GAME_CLIENT_COMMAND, client], arguments_); }
  clientThink(client: number): undefined { this.module.call([QvmGameExport.GAME_CLIENT_THINK, client]); }
  runFrame(time: number): undefined { this.module.call([QvmGameExport.GAME_RUN_FRAME, time]); }
  consoleCommand(arguments_: readonly string[]): boolean { return this.module.command([QvmGameExport.GAME_CONSOLE_COMMAND], arguments_) !== 0; }
  botFrame(time: number): undefined { this.module.call([QvmGameExport.BOTAI_START_FRAME, time]); }
  /** The caller performs GAME_SHUTDOWN first and GAME_INIT after source data reload. */
  restart(bytes: Uint8Array): void { this.module.restart(bytes); this.data.clear(); }
  retire(): void { this.module.retire(); }
}
