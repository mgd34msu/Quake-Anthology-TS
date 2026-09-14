import { CommonError } from "../../core/common-error.ts";
import { tokenizeCommand } from "../../core/commands/text.ts";
import { nativeAtoi } from "../../core/numeric.ts";
import type { ClientGameStateStorage } from "./game-state.ts";

export interface Q3ServerCommandBindings {
  assertCurrent(): void;
  systemInfo(): Promise<void>;
  mapRestart(): void;
  localServerRunning(): boolean;
  levelShot(): void;
}

/** CL_GetServerCommand execution is shared by network and local delivery owners. */
export class Q3ServerCommandExecutor {
  private bigConfigString = "";
  clear(): void { this.bigConfigString = ""; }
  async execute(command: string, gameState: ClientGameStateStorage, bindings: Q3ServerCommandBindings): Promise<readonly string[] | null> {
    let text = command, argv = tokenizeCommand(text, "q3").argv, name = argv[0] ?? "";
    if (name === "disconnect") throw new CommonError("server-disconnect", argv.length >= 2 ? `Server Disconnected - ${argv[1] ?? ""}` : "Server disconnected\n");
    if (name === "bcs0") { this.bigConfigString = `cs ${argv[1] ?? ""} "${argv[2] ?? ""}`.slice(0, 8191); return null; }
    if (name === "bcs1" || name === "bcs2") {
      const suffix = argv[2] ?? "", last = name === "bcs2";
      if (this.bigConfigString.length + suffix.length + (last ? 1 : 0) >= 8192) throw new CommonError("drop", "bcs exceeded BIG_INFO_STRING");
      this.bigConfigString += suffix;
      if (!last) return null;
      this.bigConfigString += '"'; text = this.bigConfigString;
      argv = tokenizeCommand(text, "q3").argv; name = argv[0] ?? "";
    }
    if (name === "cs") {
      const index = nativeAtoi(argv[1] ?? "");
      if (gameState.modify(index, argv.slice(2).join(" ")) && index === 1) { await bindings.systemInfo(); bindings.assertCurrent(); }
      argv = tokenizeCommand(text, "q3").argv;
    } else if (name === "map_restart") { bindings.mapRestart(); }
    else if (name === "clientLevelShot") { if (!bindings.localServerRunning()) return null; bindings.levelShot(); }
    return argv;
  }
}
