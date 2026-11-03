import type { CommandContext, CommandDialect } from "../../contracts/common.ts";
import type { InputBinding } from "../../contracts/ui.ts";
import { CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";
import { physicalInputKey } from "../../input/seat.ts";
import { namedPhysicalInput } from "../../input/bindings.ts";
import { asciiFold, commandSeparatorOffset, sourceCommandText, tokenizeCommand } from "../../core/commands/text.ts";

function operand(value: string): string {
  sourceCommandText(value);
  if (/["\r\n\0]/.test(value)) throw new Error("Startup argument cannot contain quotes or line breaks; use a quoted +command batch or exec a cfg file.");
  return `"${value}"`;
}

export function readStartupCommand(argv: readonly string[], index: number): { readonly text: string; readonly end: number } {
  const first = argv[index];
  if (first === undefined || !first.startsWith("+") || first.length === 1) throw new Error("Expected +command");
  let text = first.slice(1), end = index;
  while (end + 1 < argv.length) {
    const next = argv[end + 1];
    if (next === undefined || next.startsWith("+") || next.startsWith("--")) break;
    text += ` ${operand(next)}`; end++;
  }
  sourceCommandText(text);
  if (/[\r\n\0]/.test(text) || commandSeparatorOffset(text, "q3") < text.length) throw new Error("Use a separate +command for each startup command.");
  const tokens = tokenizeCommand(text, "q3").argv;
  if (tokens.length === 0) throw new Error("Expected +command");
  if (asciiFold(tokens[0] ?? "") === "connect") throw new Error("Ordered +connect startup is unsupported; use --connect-q1, --connect-qw, --connect-q2 or --connect-q3.");
  if (asciiFold(tokens[0] ?? "") === "set" && ["game", "fs_game", "basedir", "cddir", "fs_basepath", "fs_homepath", "fs_cdpath"].includes(asciiFold(tokens[1] ?? "")))
    throw new Error("Filesystem +set selection is unsupported; use --game with an installed catalog product and --content-root or --user-content-root.");
  return { text, end };
}

export function startupRequestsWorld(lines: readonly string[]): boolean {
  return lines.some(line => ["map", "devmap", "spmap", "spdevmap"].includes(tokenizeCommand(line, "q3").argv[0]?.toLowerCase() ?? ""));
}

export function startupCommandPhases(lines: readonly string[], dialect: CommandDialect): {
  readonly early: string; readonly late: string; readonly stuffed: string; readonly safe: boolean;
  readonly variables: readonly { readonly name: string; readonly value: string }[];
} {
  const early: string[] = [], late: string[] = [];
  const variables: { readonly name: string; readonly value: string }[] = [];
  const safeIndex = dialect === "q3" ? lines.findIndex(line => ["safe", "cvar_restart"].includes(asciiFold(tokenizeCommand(line, dialect).argv[0] ?? ""))) : -1;
  for (const [index, line] of lines.entries()) {
    if (index === safeIndex) continue;
    const argv = tokenizeCommand(line, dialect).argv, set = argv[0] === "set";
    if (dialect === "q3" && set) variables.push({ name: argv[1] ?? "", value: argv[2] ?? "" });
    if ((dialect === "q2-classic" || dialect === "q2-rerelease") && set) early.push(line);
    if (dialect === "q3" || !set || dialect === "q1-netquake" || dialect === "q1-quakeworld") late.push(line);
  }
  const text = (commands: readonly string[]): string => commands.length === 0 ? "" : `${commands.join("\n")}\n`;
  return { early: text(early), late: text(late), stuffed: text(lines), variables, safe: safeIndex !== -1 };
}

/** Q3 `set` lines from the launch command are applied as user-created variables to whichever registry owns each name. */
export function applyStartupVariables(variables: readonly { readonly name: string; readonly value: string }[],
  owner: (name: string, context: CommandContext) => CvarRegistry, context: CommandContext): void {
  for (const variable of variables) {
    const registry = owner(variable.name, context);
    registry.set(variable.name, variable.value, true);
    const registered = registry.register(variable.name, "");
    if (registered === undefined) throw new Error(`Q3 startup variable registration rejected: ${variable.name}`);
    registry.addFlags(registered.name, CvarFlag.UserCreated);
  }
}

/** The authored baseline a later seat inherits: the primary seat's authored bindings plus any default it lacks. */
export function inheritedBindingBaseline(primary: readonly InputBinding[], defaults: readonly InputBinding[]): InputBinding[] {
  const baseline = new Map(primary.map(binding => [physicalInputKey(binding.input), binding]));
  for (const binding of defaults) if (!baseline.has(physicalInputKey(binding.input))) baseline.set(physicalInputKey(binding.input), binding);
  return [...baseline.values()];
}

/** Replace a seat's weapon, impulse and use binds with the selected defaults; returns the seat's authored bindings. */
export function applySelectedBindingDefaults(seat: { readonly bindings: readonly InputBinding[]; unbind(input: InputBinding["input"]): unknown; bind(binding: InputBinding): unknown },
  defaults: readonly InputBinding[]): InputBinding[] {
  for (const binding of seat.bindings) if (binding.target.kind === "command" && /^(?:weapon|impulse|use)\s/i.test(binding.target.text)) seat.unbind(binding.input);
  const authored = new Map(seat.bindings.map(binding => [physicalInputKey(binding.input), binding]));
  for (const binding of defaults) {
    seat.bind(binding);
    if (!authored.has(physicalInputKey(binding.input))) authored.set(physicalInputKey(binding.input), binding);
  }
  return [...authored.values()];
}

/** Record what a bind, unbind or unbindall in a startup script chose, so selected defaults do not overwrite it. */
export function noteBindingCommand(tokens: readonly string[], choices: { all: boolean; readonly overridden: Set<string> }): void {
  const [rawName, key] = tokens, name = asciiFold(rawName ?? "");
  if (name === "unbindall") choices.all = true;
  if ((name === "bind" || name === "unbind") && key !== undefined) {
    const input = namedPhysicalInput(key); if (input !== null) choices.overridden.add(physicalInputKey(input));
  }
}
