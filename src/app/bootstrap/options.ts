import { homedir } from "node:os";
import { resolve } from "node:path";
import type { GameFamily } from "../../contracts/content.ts";

export interface ApplicationOptions {
  readonly corpusRoot: string;
  readonly product: string;
  readonly map: string;
  readonly movement: GameFamily;
  readonly character: GameFamily;
  readonly characterModel: string;
  readonly renderer: "cpu" | "gl";
  readonly dedicated: boolean;
  readonly width: number;
  readonly height: number;
  readonly seats: number;
  readonly skill: 0 | 1 | 2 | 3;
  readonly botSkill?: 1 | 2 | 3 | 4 | 5;
  readonly mode: "singleplayer" | "coop" | "deathmatch";
  readonly rules?: "standard" | "ctf" | "lmctf";
  readonly seed: number;
  readonly frameLimit: number | null;
  readonly hidden: boolean;
  readonly network: { readonly kind: "offline" } | { readonly kind: "q2-server"; readonly host: string; readonly port: number }
    | { readonly kind: "q2-client"; readonly remote: string };
}

export type ApplicationCommand = { readonly kind: "help" }
  | { readonly kind: "list-content"; readonly corpusRoot: string }
  | { readonly kind: "run"; readonly options: ApplicationOptions };

export const applicationHelp = `Quake TypeScript

Usage: bun run src/main.ts [options]

  --preset q2-q1-q3|q1-q2     Select an initial mixed-game profile
  --content-root PATH        Game data root (default ~/Projects/qfiles)
  --game PRODUCT             Installed catalog product, e.g. q2-classic-baseq2
  --map NAME                 Map name or maps/path.bsp
  --movement q1|q2|q3        Player movement provider
  --character q1|q2|q3       Player character provider
  --model NAME               Character model (e.g. sarge or male)
  --renderer cpu|gl          Renderer (default gl)
  --width N --height N       Window dimensions (default 960 by 600)
  --seats N                  Local seats, 1 through 4
  --mode singleplayer|coop|deathmatch
  --rules standard|ctf|lmctf Q2 match rules, independent of map and movement
  --skill 0|1|2|3            Quake I/II gameplay difficulty
  --bot-skill 1|2|3|4|5      Quake III bot difficulty (default 2)
  --dedicated                Run without a window or local seats
  --listen-q2 PORT           Host the native Quake II source protocol
  --bind ADDRESS             Server IP (default 0.0.0.0)
  --connect-q2 ADDRESS       Join a native Quake II server
  --seed N                   Gameplay random seed
  --frames N                 Close after N simulation steps
  --hidden                   Start a hidden native window
  --list-content             Show installed games and expansions
  --help                     Show these options
`;

function integer(value: string, label: string, minimum: number, maximum: number): number {
  if (!/^[0-9]+$/.test(value)) throw new RangeError(`${label} must be an integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum)
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}`);
  return number;
}

function family(value: string): GameFamily {
  if (value === "q1" || value === "q2" || value === "q3") return value;
  throw new RangeError(`Unknown game family: ${value}`);
}

export function mapResourcePath(name: string): string {
  const normalized = name.replaceAll("\\", "/");
  if (!/^(?:maps\/)?[a-zA-Z0-9_/-]+(?:\.bsp)?$/.test(normalized) || normalized.split("/").includes(".."))
    throw new RangeError(`Invalid map name: ${name}`);
  return `${normalized.startsWith("maps/") ? "" : "maps/"}${normalized.endsWith(".bsp") ? normalized : `${normalized}.bsp`}`;
}

export function parseApplicationCommand(argv: readonly string[]): ApplicationCommand {
  let options: ApplicationOptions = {
    corpusRoot: resolve(homedir(), "Projects/qfiles"), product: "q2-classic-baseq2", map: "maps/base1.bsp",
    movement: "q1", character: "q3", characterModel: "sarge", renderer: "gl", dedicated: false,
    width: 960, height: 600, seats: 1, skill: 1, mode: "singleplayer", seed: 1, frameLimit: null, hidden: false, network: { kind: "offline" },
  };
  let list = false;
  let bind = "0.0.0.0", listen: number | null = null, remote: string | null = null;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return { kind: "help" };
    if (flag === "--dedicated") { options = { ...options, dedicated: true }; continue; }
    if (flag === "--hidden") { options = { ...options, hidden: true }; continue; }
    if (flag === "--list-content") { list = true; continue; }
    const value = argv[++index];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    switch (flag) {
      case "--preset":
        if (value === "q2-q1-q3") options = { ...options, product: "q2-classic-baseq2", map: "maps/base1.bsp", movement: "q1", character: "q3", characterModel: "sarge" };
        else if (value === "q1-q2") options = { ...options, product: "q1-rerelease-id1", map: "maps/e1m1.bsp", movement: "q2", character: "q2", characterModel: "male" };
        else throw new Error(`Unknown launch preset: ${value}`);
        break;
      case "--content-root": options = { ...options, corpusRoot: resolve(value) }; break;
      case "--game": options = { ...options, product: value }; break;
      case "--map": options = { ...options, map: mapResourcePath(value) }; break;
      case "--movement": options = { ...options, movement: family(value) }; break;
      case "--character": {
        const selected = family(value);
        options = { ...options, character: selected, characterModel: selected === "q3" ? "sarge" : selected === "q2" ? "male" : "player" };
        break;
      }
      case "--model":
        if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`Invalid character model: ${value}`);
        options = { ...options, characterModel: value }; break;
      case "--renderer":
        if (value !== "cpu" && value !== "gl") throw new Error(`Unknown renderer: ${value}`);
        options = { ...options, renderer: value }; break;
      case "--width": options = { ...options, width: integer(value, flag, 64, 16384) }; break;
      case "--height": options = { ...options, height: integer(value, flag, 64, 16384) }; break;
      case "--seats": options = { ...options, seats: integer(value, flag, 1, 4) }; break;
      case "--seed": options = { ...options, seed: integer(value, flag, 0, 0xffffffff) }; break;
      case "--frames": options = { ...options, frameLimit: integer(value, flag, 1, Number.MAX_SAFE_INTEGER) }; break;
      case "--listen-q2": listen = integer(value, flag, 0, 65535); break;
      case "--connect-q2": remote = value; break;
      case "--bind": bind = value; break;
      case "--skill": {
        const skill = integer(value, flag, 0, 3);
        if (skill !== 0 && skill !== 1 && skill !== 2 && skill !== 3) throw new RangeError("Invalid skill");
        options = { ...options, skill }; break;
      }
      case "--bot-skill": {
        const botSkill = integer(value, flag, 1, 5);
        if (botSkill !== 1 && botSkill !== 2 && botSkill !== 3 && botSkill !== 4 && botSkill !== 5) throw new RangeError("Invalid bot skill");
        options = { ...options, botSkill }; break;
      }
      case "--rules":
        if (value !== "standard" && value !== "ctf" && value !== "lmctf") throw new Error(`Unknown match rules: ${value}`);
        options = { ...options, rules: value }; break;
      case "--mode":
        if (value !== "singleplayer" && value !== "coop" && value !== "deathmatch") throw new Error(`Unknown game mode: ${value}`);
        options = { ...options, mode: value }; break;
      default: throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (options.rules === "ctf" || options.rules === "lmctf" || options.rules === undefined && (options.product === "q2-classic-ctf" || options.product === "q2-classic-lmctf")) options = { ...options, mode: "deathmatch" };
  if (list) return { kind: "list-content", corpusRoot: options.corpusRoot };
  if (listen !== null && remote !== null) throw new Error("Choose either --listen-q2 or --connect-q2");
  if (listen !== null) options = { ...options, network: { kind: "q2-server", host: bind, port: listen } };
  else if (bind !== "0.0.0.0") throw new Error("--bind requires --listen-q2");
  if (remote !== null) {
    if (options.botSkill !== undefined) throw new Error("--bot-skill is not a native Quake II client setting");
    options = { ...options, network: { kind: "q2-client", remote } };
  }
  if (options.network.kind !== "offline" && options.mode === "singleplayer") options = { ...options, mode: "coop" };
  if (options.seats > 1 && options.mode === "singleplayer") options = { ...options, mode: "coop" };
  return { kind: "run", options };
}
