import type { CommandDialect } from "../../contracts/common.ts";
import type { LoadedApplicationContent } from "./content.ts";
import { sourceAdministrationCommandNames } from "./server-administration.ts";
import { applicationAudioCommands } from "./audio/commands.ts";
import { q3ProductMapCommands } from "../../core/q3-product-policy.ts";

/** Engine actions stay explicit when an original component emits console text. */
export function componentEngineCommands(dialect: CommandDialect, content: LoadedApplicationContent): ReadonlySet<string> {
  return new Set([...sourceAdministrationCommandNames(dialect).filter(name => name !== "sv"), ...applicationAudioCommands,
    ...q3ProductMapCommands(content.q3Product?.policy ?? { kind: "retail" }), "quit", "map", "gamemap", "changelevel", "map_restart", "save", "load", "exec", "cinematic"].map(name => name.toLowerCase()));
}
