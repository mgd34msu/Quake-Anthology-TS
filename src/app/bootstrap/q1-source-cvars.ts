import { CvarRegistry } from "../../core/cvars/index.ts";

/** A staged world owns fresh storage while retaining source declarations and console-created variables. */
export function cloneQ1SourceCvars(source: CvarRegistry, print: (text: string) => void): CvarRegistry {
  const candidate = new CvarRegistry({ dialect: source.dialect, context: source.context, print });
  candidate.restoreSaveState(source.captureWorldTransferState());
  return candidate;
}

export function registerQ1BotControls(cvars: CvarRegistry): void {
  if (cvars.find("bot_minplayers") === undefined || cvars.isConsoleCreated("bot_minplayers")) cvars.register("bot_minplayers", "0");
}
