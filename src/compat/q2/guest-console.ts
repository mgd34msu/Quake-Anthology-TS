// SPDX-License-Identifier: GPL-2.0-or-later

/** Commands retail game modules append to the server console (level changes, kicks, chat, config files). */
const allowed: ReadonlySet<string> = new Set(["map", "gamemap", "kick", "say", "echo", "exec", "wait"]);

/**
 * `AddCommandString` runs with server-console authority, so a game module only gets the commands real modules need.
 * `quit`, `rcon_*`, `set*`, `bind`, `alias` and the rest are dropped. Returns the permitted commands and the refused names.
 */
export function filterGuestConsole(text: string): { readonly text: string; readonly refused: readonly string[] } {
  const commands: string[] = [];
  let current = "", quoted = false;
  for (const character of text) {
    if (character === "\"") quoted = !quoted;
    if ((character === ";" && !quoted) || character === "\n") { commands.push(current); current = ""; quoted = false; continue; }
    current += character;
  }
  commands.push(current);
  const kept: string[] = [], refused: string[] = [];
  for (const command of commands) {
    const name = command.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
    if (name === "") continue;
    if (allowed.has(name)) kept.push(command.trim()); else refused.push(name);
  }
  return { text: kept.length === 0 ? "" : `${kept.join("\n")}\n`, refused };
}
