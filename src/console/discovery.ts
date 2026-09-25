import type { CommandContext } from "../contracts/common.ts";
import type { CommandBuffer } from "../core/commands/index.ts";
import { asciiFold } from "../core/commands/text.ts";
import type { CommandDocumentation } from "../core/commands/documentation.ts";

interface EntryHelp {
  readonly name: string;
  readonly summary: string | undefined;
  readonly usage: string | undefined;
  readonly examples: readonly string[];
  readonly allowedValues: readonly string[] | undefined;
}
export type ConsoleDiscoveryEntry = EntryHelp & (
  | { readonly kind: "command" }
  | { readonly kind: "alias"; readonly value: string }
  | { readonly kind: "cvar"; readonly value: string; readonly resetValue: string; readonly latchedValue: string | undefined }
);
function help(name: string, documentation: CommandDocumentation | undefined): EntryHelp {
  return { name, summary: documentation?.summary, usage: documentation?.usage, examples: documentation?.examples ?? [], allowedValues: documentation?.allowedValues };
}
export function queryConsoleEntries(commands: CommandBuffer, source?: CommandContext): readonly ConsoleDiscoveryEntry[] {
  const entries = new Map<string, ConsoleDiscoveryEntry>();
  for (const name of commands.registeredNames()) entries.set(asciiFold(name), { kind: "command", ...help(name, commands.commandDocumentation(name)) });
  for (const name of commands.aliasNames()) if (!entries.has(asciiFold(name))) entries.set(asciiFold(name), { kind: "alias", ...help(name, undefined), usage: name, value: commands.aliasValue(name) ?? "" });
  for (const variable of commands.cvarSnapshots(source)) if (!entries.has(asciiFold(variable.name))) entries.set(`cvar:${variable.name}`, {
    kind: "cvar", ...help(variable.name, commands.cvarDocumentation(variable.name, source)),
    usage: commands.cvarDocumentation(variable.name, source)?.usage ?? `${variable.name} [value]`,
    value: variable.value, resetValue: variable.resetValue, latchedValue: variable.latchedValue,
  });
  return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
}
export function findConsoleEntries(commands: CommandBuffer, text: string, source?: CommandContext): readonly ConsoleDiscoveryEntry[] {
  const query = asciiFold(text);
  return queryConsoleEntries(commands, source).filter(entry => asciiFold(`${entry.name} ${entry.summary ?? ""} ${entry.usage ?? ""}`).includes(query));
}
export function consoleEntryHelp(entry: ConsoleDiscoveryEntry): readonly string[] {
  const lines = [`${entry.name} (${entry.kind})`, entry.summary ?? "No description registered.", `Usage: ${entry.usage ?? "not documented"}`];
  if (entry.kind === "cvar") {
    lines.push(`Current: ${JSON.stringify(entry.value)}`, `Default: ${JSON.stringify(entry.resetValue)}`);
    if (entry.latchedValue !== undefined) lines.push(`Pending: ${JSON.stringify(entry.latchedValue)}`);
  } else if (entry.kind === "alias") lines.push(`Expands to: ${entry.value.trimEnd()}`);
  if (entry.allowedValues !== undefined) lines.push(`Allowed values: ${entry.allowedValues.join(", ")}`);
  for (const example of entry.examples) lines.push(`Example: ${example}`);
  return lines;
}
export function registerDiscoveryCommands(commands: CommandBuffer, print: (text: string) => void): () => void {
  const names: string[] = [];
  if (commands.registerEngine("find", invocation => {
    const query = invocation.argv[1], pageText = invocation.argv[2] ?? "1", page = Number(pageText);
    if (query === undefined || invocation.argv.length > 3 || !/^[1-9][0-9]*$/.test(pageText) || !Number.isSafeInteger(page)) { print("Usage: find <text> [page]\nExample: find mouse\n"); return; }
    const entries = findConsoleEntries(commands, query, invocation.source), pages = Math.max(1, Math.ceil(entries.length / 30));
    if (page > pages) { print(`Page ${page} is out of range; ${pages} page(s).\n`); return; }
    for (const entry of entries.slice((page - 1) * 30, page * 30)) print(`${entry.name} (${entry.kind})${entry.summary === undefined ? "" : ` - ${entry.summary}`}\n`);
    print(`${entries.length} match(es), page ${page}/${pages}. Use help <name> for details.\n`);
    if (page < pages) print(`Next page: find ${JSON.stringify(query)} ${page + 1}\n`);
  }, { summary: "Search command and setting names and descriptions.", usage: "find <text> [page]", examples: ["find r_", "find mouse"] })) names.push("find");
  if (commands.registerEngine("help", invocation => {
    const name = invocation.argv[1];
    if (name === undefined || invocation.argv.length !== 2) { print("Usage: help <name>\nUse find <text> to search commands and settings.\n"); return; }
    const entries = queryConsoleEntries(commands, invocation.source);
    const entry = entries.find(candidate => candidate.name === name) ?? entries.find(candidate => asciiFold(candidate.name) === asciiFold(name));
    print(entry === undefined ? `No command, setting, or alias named ${JSON.stringify(name)}. Use find <text>.\n` : `${consoleEntryHelp(entry).join("\n")}\n`);
  }, { summary: "Show usage and available documentation for a command, setting, or alias.", usage: "help <name>", examples: ["help echo"] })) names.push("help");
  return () => { for (const name of names) commands.unregister(name); };
}
