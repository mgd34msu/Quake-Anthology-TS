import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ProjectileRole } from "../../contracts/weapon-behavior.ts";
import { defaultUserContentRoot } from "../../content/user-data.ts";
import { normalizeResourcePath } from "../../content/mounts/paths.ts";

interface ToolContent {
  readonly product: string;
  readonly corpusRoot: string;
  readonly userContentRoot: string;
  readonly artifact?: string;
}
export type WeaponBehaviorToolCommand = { readonly action: "help" }
  | ToolContent & ({ readonly action: "declare-qvm"; readonly profile: string } | { readonly action: "inspect" } | { readonly action: "declare"; readonly id: `${string}:${string}`;
      readonly title: string; readonly role: ProjectileRole; readonly fire: string; readonly activate?: string });
export const weaponBehaviorToolHelp = `Usage:
  quake-typescript weapon-behavior inspect PRODUCT [options]
  quake-typescript weapon-behavior declare-qvm PRODUCT --profile MOUNTED_PROFILE_JSON [options]
  quake-typescript weapon-behavior declare PRODUCT --id NAMESPACE:ID --role ROLE --fire CALLBACK [options]

  --content PATH        Installed content root
  --user-content PATH   Writable user content root
  --artifact PATH       Mounted program (QC descriptor/progs.dat/qwprogs.dat, or vm/qagame.qvm)
  --profile PATH        Author-written mounted QVM profile with exact digest, entries and entity layout
  --title TEXT          Display title (defaults to declaration ID)
  --activate CALLBACK   Optional source activation callback
  --role ROLE           rocket, grenade, nail, bolt, plasma, energy, grapple
  --help                Show this help

Inspection reports actual bytecode callbacks and think assignments. It does not infer
projectile roles or activation gates. Declare only callbacks whose behavior you have
established from the source. Declarations bind the exact current program digest.
`;
function behaviorId(value: string): value is `${string}:${string}` { return /^[^:\s]+:[^\s]+$/.test(value); }
function role(value: string): ProjectileRole {
  switch (value) {
    case "rocket": case "grenade": case "nail": case "bolt": case "plasma": case "energy": case "grapple": return value;
    default: throw new Error(`Invalid projectile role: ${value}`);
  }
}
export function parseWeaponBehaviorTool(argv: readonly string[]): WeaponBehaviorToolCommand {
  if (argv.includes("--help") || argv.includes("-h")) return { action: "help" };
  const action = argv[0], product = argv[1];
  if ((action !== "inspect" && action !== "declare" && action !== "declare-qvm") || product === undefined || product.startsWith("--"))
    throw new Error(weaponBehaviorToolHelp);
  const flags = new Map<string, string>();
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (key === undefined || !["--content", "--user-content", "--artifact", "--id", "--title", "--role", "--fire", "--activate", "--profile"].includes(key)) throw new Error(`Unknown behavior option: ${key}`);
    if (value === undefined || value.startsWith("--") || value.length === 0 || value.includes("\0")) throw new Error(`Missing or invalid value for ${key}`);
    if (flags.has(key)) throw new Error(`Repeated behavior option: ${key}`);
    flags.set(key, value);
  }
  const artifact = flags.get("--artifact"), content: ToolContent = { product,
    corpusRoot: resolve(flags.get("--content") ?? resolve(homedir(), "Projects/qfiles")),
    userContentRoot: resolve(flags.get("--user-content") ?? defaultUserContentRoot()),
    ...(artifact === undefined ? {} : { artifact: normalizeResourcePath(artifact) }) };
  if (action === "declare-qvm") {
    const profile = flags.get("--profile");
    if (profile === undefined || ["--id","--title","--role","--fire","--activate"].some(key=>flags.has(key)))
      throw new Error("declare-qvm requires --profile and takes identity, role and callbacks from that declaration");
    return {...content,action,profile:normalizeResourcePath(profile)};
  }
  if (flags.has("--profile")) throw new Error("--profile requires declare-qvm");
  if (action === "inspect") {
    if (["--id", "--title", "--role", "--fire", "--activate"].some(key => flags.has(key))) throw new Error("Declaration options require the declare action");
    return { ...content, action };
  }
  const id = flags.get("--id"), fire = flags.get("--fire"), selectedRole = flags.get("--role"), activate = flags.get("--activate");
  if (id === undefined || !behaviorId(id) || fire === undefined || selectedRole === undefined) throw new Error("Declare requires --id NAMESPACE:ID, --role ROLE and --fire CALLBACK");
  return { ...content, action, id, title: flags.get("--title") ?? id, role: role(selectedRole), fire,
    ...(activate === undefined ? {} : { activate }) };
}
