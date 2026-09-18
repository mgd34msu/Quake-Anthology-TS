import { randomIndex, type BotRandomT } from "./rng.ts";

/** Q1 chats.txt names numbered localization families, selected from the bot's saved random stream. */
export function q1BotChatText(locstring: string, lookup: (key: string) => string | null, random: BotRandomT): string {
  const key = locstring.startsWith("$") ? locstring.slice(1) : locstring;
  const variants: string[] = [];
  for (let index = 0; index < 64; index++) {
    const text = lookup(`${key}_${index}`);
    if (text === null) break;
    variants.push(text);
  }
  if (variants.length !== 0) {
    const text = variants[randomIndex(random, variants.length)];
    if (text === undefined) throw new Error("Bot chat random selection exceeded its source family");
    return text;
  }
  return lookup(key) ?? key;
}
