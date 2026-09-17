import { readStartupCommand, startupRequestsWorld } from "./startup-commands.ts";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { GameFamily } from "../../contracts/content.ts";
import type { Q1ProtocolIdentity, Q2ProtocolIdentity } from "../../contracts/protocol.ts";
import { defaultNetQuakeProfile } from "../../network/q1/profile.ts";
import { normalizeResourcePath } from "../../content/mounts/paths.ts";

export interface ApplicationOptions {
  readonly q3MapLaunch?: import("./q3-map-command.ts").Q3MapLaunch;
  readonly q3Product?: import("../../core/q3-product-policy.ts").Q3ApplicationProduct;
  readonly authoredCampaignStart?: true;
  readonly startupCommands?: readonly string[];
  readonly explicitRules?: { readonly skill?: boolean; readonly mode?: boolean; readonly capacity?: boolean };
  readonly teamArenaSkirmish?: import("./team-arena-skirmish.ts").TeamArenaSkirmish;
  readonly remoteContent?: import("../../content/catalog/index.ts").RemoteContentSelection;
  readonly q1Protocol?: Q1ProtocolIdentity;
  readonly q2Protocol?: Exclude<Q2ProtocolIdentity, { kind: "q2-kex" | "q2-kex-demo" }>;
  readonly serverProfile?: import("../../settings/server/types.ts").ServerProfile;
  readonly serverProfilePath?: string;
  readonly corpusRoot: string;
  readonly userContentRoot?: string;
  readonly product: string;
  readonly map: string;
  readonly quakeCProgram?: string;
  readonly q2GameLibrary?: string;
  readonly movement: GameFamily;
  readonly character: GameFamily;
  readonly characterModel: string;
  readonly renderer: "cpu" | "gl";
  readonly rendererSelection?: "default" | "explicit";
  readonly gamma: number;
  readonly displayOverrides?: { readonly width?: number; readonly height?: number; readonly gamma?: number };
  readonly dedicated: boolean;
  readonly width: number;
  readonly height: number;
  readonly seats: number;
  readonly skill: 0 | 1 | 2 | 3;
  readonly botSkill?: 1 | 2 | 3 | 4 | 5;
  readonly mode: "singleplayer" | "coop" | "deathmatch";
  readonly rules?: "standard" | "ctf" | "lmctf" | "tag" | "deathball" | "horde";
  readonly seed: number;
  readonly frameLimit: number | null;
  readonly hidden: boolean;
  readonly network: { readonly kind: "offline" } | { readonly kind: "native-server" | "q2-server"; readonly host: string; readonly port: number }
    | { readonly kind: "q1-client" | "qw-client" | "q2-client" | "q3-client"; readonly remote: string };
}

export type ApplicationCommand = { readonly kind: "help" }
  | { readonly kind: "list-content"; readonly corpusRoot: string }
  | { readonly kind: "run" | "menu"; readonly options: ApplicationOptions };

export const applicationHelp = `Quake

Usage: bun run src/main.ts [options]

  +command [arguments]       Run source startup command (use '+bind x "+attack"' as one shell argument)
  --menu                     Open the startup menu (default without launch selections)
  --preset q2-q1-q3|q1-q2     Select an initial mixed-game profile
  --content-root PATH        Game data root (default ~/Projects/qfiles)
  --user-content-root PATH   Writable user content root (default ~/.local/share/quake-typescript/content)
  --game PRODUCT             Installed catalog product, e.g. q2-classic-baseq2
  --map NAME                 Map name or maps/path.bsp
  --progs MOUNTED_PATH       Validated mounted QuakeC .dat artifact
  --q2-game MOUNTED_PATH     Explicit classic Quake II Windows i386 game DLL
  --movement q1|q2|q3        Player movement provider
  --character q1|q2|q3       Player character provider
  --model NAME               Character model (e.g. sarge or male)
  --renderer cpu|gl          Renderer (default gl)
  --gamma N                 Display gamma, 0.5 through 3 (default 1; higher is brighter)
  --width N --height N       Window dimensions (default 960 by 600)
  --seats N                  Local seats, 1 through 4
  --mode singleplayer|coop|deathmatch
  --server-profile PATH      Load validated shared server settings from JSON
  --rules standard|ctf|lmctf|tag|deathball|horde Source match rules
  --skill 0|1|2|3            Quake I/II gameplay difficulty
  --bot-skill 1|2|3|4|5      Quake III bot difficulty (default 2)
  --dedicated                Run without a window or local seats
  --listen PORT              Host the selected game's native source protocol
  --q1-protocol 15|666|999    NetQuake host protocol (default 15; RMQ flags 130)
  --listen-q2 PORT           Host the native Quake II source protocol
  --bind ADDRESS             Server IP (default 0.0.0.0)
  --connect-q1 ADDRESS       Join a native Quake server (id1, protocols 15/666/999)
  --connect-qw ADDRESS       Join a base QuakeWorld protocol 28 server
  --connect-q3 ADDRESS       Join a baseq3 protocol 68 server (sv_pure 0)
  --q2-protocol 34|35[:1904|1905]|36[:revision]|4038|1038 Q2 client/server protocol (35 defaults to 1904; 36 to 1026)
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
    movement: "q1", character: "q3", characterModel: "sarge", renderer: "gl", rendererSelection: "default", gamma: 1, dedicated: false,
    width: 960, height: 600, seats: 1, skill: 1, mode: "singleplayer", seed: 1, frameLimit: null, hidden: false, network: { kind: "offline" },
  };
  const startupCommands: string[] = [];
  let list = false, menu = false, explicitLaunch = false;
  let listenKind: "native-server" | "q2-server" = "q2-server";
  let remoteKind: "q1-client" | "qw-client" | "q2-client" | "q3-client" = "q2-client";
  let bind = "0.0.0.0", listen: number | null = null, remote: string | null = null;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag?.startsWith("+")) {
      const command = readStartupCommand(argv, index); startupCommands.push(command.text); index = command.end; continue;
    }
    if (flag === "--menu") { menu = true; continue; }
    if (flag !== undefined && !["--content-root", "--user-content-root", "--renderer", "--gamma", "--width", "--height", "--hidden", "--list-content"].includes(flag)) explicitLaunch = true;
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
      case "--user-content-root": options = { ...options, userContentRoot: resolve(value) }; break;
      case "--content-root": options = { ...options, corpusRoot: resolve(value) }; break;
      case "--game": options = { ...options, product: value }; break;
      case "--map": options = { ...options, map: mapResourcePath(value) }; break;
      case "--q2-game": {
        const path = normalizeResourcePath(value);
        if (!path.endsWith(".dll")) throw new Error("--q2-game requires a mounted .dll artifact");
        options = { ...options, q2GameLibrary: path }; break;
      }
      case "--progs": {
        const path = normalizeResourcePath(value);
        if (!path.endsWith(".dat")) throw new Error("--progs requires a mounted .dat artifact");
        options = { ...options, quakeCProgram: path }; break;
      }
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
        options = { ...options, renderer: value, rendererSelection: "explicit" }; break;
      case "--width": {
        const width = integer(value, flag, 64, 16384);
        options = { ...options, width, displayOverrides: { ...options.displayOverrides, width } }; break;
      }
      case "--gamma": {
        const gamma = Number(value);
        if (!Number.isFinite(gamma) || gamma < 0.5 || gamma > 3) throw new RangeError("Display gamma must be between 0.5 and 3");
        options = { ...options, gamma, displayOverrides: { ...options.displayOverrides, gamma } }; break;
      }
      case "--height": {
        const height = integer(value, flag, 64, 16384);
        options = { ...options, height, displayOverrides: { ...options.displayOverrides, height } }; break;
      }
      case "--seats": options = { ...options, seats: integer(value, flag, 1, 4), explicitRules: { ...options.explicitRules, capacity: true } }; break;
      case "--seed": options = { ...options, seed: integer(value, flag, 0, 0xffffffff) }; break;
      case "--frames": options = { ...options, frameLimit: integer(value, flag, 1, Number.MAX_SAFE_INTEGER) }; break;
      case "--listen": case "--listen-q2": {
        const kind = flag === "--listen" ? "native-server" : "q2-server";
        if (listen !== null && listenKind !== kind) throw new Error("Choose either --listen or --listen-q2");
        listenKind = kind; listen = integer(value, flag, 0, 65535); break;
      }
      case "--q2-protocol":
        options = { ...options, q2Protocol: parseApplicationQ2Protocol(value) };
        break;
      case "--q1-protocol": options = { ...options, q1Protocol: defaultNetQuakeProfile(integer(value, flag, 15, 999)) }; break;
      case "--connect-qw": case "--connect-q1": case "--connect-q2": case "--connect-q3":
        if (remote !== null) throw new Error("Choose one native remote connection");
        remoteKind = flag === "--connect-qw" ? "qw-client" : flag === "--connect-q1" ? "q1-client" : flag === "--connect-q3" ? "q3-client" : "q2-client"; remote = value; break;
      case "--bind": bind = value; break;
      case "--skill": {
        const skill = integer(value, flag, 0, 3);
        if (skill !== 0 && skill !== 1 && skill !== 2 && skill !== 3) throw new RangeError("Invalid skill");
        options = { ...options, skill, explicitRules: { ...options.explicitRules, skill: true } }; break;
      }
      case "--bot-skill": {
        const botSkill = integer(value, flag, 1, 5);
        if (botSkill !== 1 && botSkill !== 2 && botSkill !== 3 && botSkill !== 4 && botSkill !== 5) throw new RangeError("Invalid bot skill");
        options = { ...options, botSkill }; break;
      }
      case "--server-profile": options = { ...options, serverProfilePath: resolve(value) }; break;
      case "--rules":
        if (value !== "standard" && value !== "ctf" && value !== "lmctf" && value !== "tag" && value !== "deathball" && value !== "horde") throw new Error(`Unknown match rules: ${value}`);
        options = { ...options, rules: value }; break;
      case "--mode":
        if (value !== "singleplayer" && value !== "coop" && value !== "deathmatch") throw new Error(`Unknown game mode: ${value}`);
        options = { ...options, mode: value, explicitRules: { ...options.explicitRules, mode: true } }; break;
      default: throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (options.rules === "ctf" || options.rules === "lmctf" || options.rules === undefined && (options.product === "q2-classic-ctf" || options.product === "q2-classic-lmctf")) options = { ...options, mode: "deathmatch" };
  if (startupCommands.length > 0) options = { ...options, startupCommands };
  explicitLaunch ||= startupRequestsWorld(startupCommands);
  if (list) return { kind: "list-content", corpusRoot: options.corpusRoot };
  if (listen !== null && remote !== null) throw new Error("Choose a native server listener or --connect-q2");
  if (listen !== null) options = { ...options, network: { kind: listenKind, host: bind, port: listen } };
  else if (bind !== "0.0.0.0") throw new Error("--bind requires --listen or --listen-q2");
  if (remote !== null) {
    if (options.botSkill !== undefined) throw new Error("--bot-skill is not a native Quake II client setting");
    options = { ...options, network: { kind: remoteKind, remote } };
  }
  if (options.q2Protocol !== undefined && options.network.kind !== "q2-client" && options.network.kind !== "q2-server") throw new Error("--q2-protocol requires --connect-q2 or --listen-q2");
  if (options.q1Protocol !== undefined && options.network.kind !== "native-server") throw new Error("--q1-protocol requires --listen for a Quake I host");
  if (options.q1Protocol !== undefined && options.product === "q1-quakeworld") throw new Error("--q1-protocol selects NetQuake; QuakeWorld uses native protocol 28");
  if (options.network.kind !== "offline" && options.mode === "singleplayer") options = { ...options, mode: options.network.kind === "native-server" && (options.product.startsWith("q3-") || options.product === "q1-quakeworld") ? "deathmatch" : "coop" };
  if (options.seats > 1 && options.mode === "singleplayer") options = { ...options, mode: "coop" };
  if (menu && (options.dedicated || options.network.kind !== "offline")) throw new Error("--menu requires a local, non-dedicated application");
  return { kind: menu || !explicitLaunch ? "menu" : "run", options };
}

function parseApplicationQ2Protocol(value: string): NonNullable<ApplicationOptions['q2Protocol']> {
  switch (value) {
    case '34': return { kind: 'q2-classic', version: 34 };
    case '35': case '35:1904': return { kind: 'q2-r1q2', version: 35, revision: 1904 };
    case '35:1905': return { kind: 'q2-r1q2', version: 35, revision: 1905 };
    case '4038': return { kind: 'q2-private-classic', version: 4038 };
    case '1038': return { kind: 'q2-rerelease', version: 1038 };
  }
  const revision = value === '36' ? 1026 : value.startsWith('36:') ? Number(value.slice(3)) : 0;
  switch (revision) {
    case 1015: case 1017: case 1018: case 1019: case 1020: case 1021: case 1022: case 1023: case 1024: case 1025: case 1026:
      return { kind: 'q2-q2pro', version: 36, revision };
    default: throw new Error('--q2-protocol requires 34, 35:1904/1905, 36:1015/1017..1026, 4038 or 1038');
  }
}
