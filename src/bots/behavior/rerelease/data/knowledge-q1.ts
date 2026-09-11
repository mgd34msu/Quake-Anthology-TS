import type { BotSourceFiles } from "../../assets.ts";
import { readBotSourceText } from "./source-files.ts";
import { BotKnowledge } from "./knowledge.ts";

/** Source mount precedence is already resolved by the owner. No bot-definition cache survives a mount change. */
export function loadQuake1Knowledge(files: Pick<BotSourceFiles, "read">): BotKnowledge | null {
  const read = (path: string): string | null => readBotSourceText(files, path);
  const weapons = read("bots/weapons.txt");
  if (weapons === null) return null;
  const settings = read("bots/settings_PC.txt") ?? read("bots/settings_Consoles.txt") ?? read("bots/settings_Nintendo.txt");
  if (settings === null) throw new Error("Quake rerelease bot weapons were mounted without source skill settings");
  return new BotKnowledge({ weapons, settings, characters: read("bots/characters.txt") ?? "", items: read("bots/items.txt") ?? "",
    monsters: read("bots/monsters.txt") ?? "", interactables: read("bots/interactables.txt") ?? "", gameRules: read("bots/game_rules.txt") ?? "",
    teams: read("bots/teams.txt") ?? "", chats: read("bots/chats.txt") ?? "" });
}
