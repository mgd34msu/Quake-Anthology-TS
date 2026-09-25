import type { ResolvedExecutionModule } from "../../contracts/content.ts";
import type { MountedContent } from "../../content/mounts/index.ts";
import { normalizeResourcePath } from "../../content/mounts/paths.ts";
import { readDigest } from "../../persistence/shared.ts";
import { SaveReader } from "../../persistence/value.ts";
import type { NativePrimaryDeclaration, NativePrimaryProfile } from "./native-primary.ts";
import { readNativePrimaryWeapons, readNativePrimaryPlayer, readNativePrimaryCommands, readNativePrimaryInventory, readNativePrimaryDrop, readNativePrimaryPickups } from "./native-primary-profiles.ts";
import { readClassicPrimaryWorldProfile } from "./classic/world-profile.ts";
import { readRereleasePrimaryWorldProfile } from "./rerelease/world-profile.ts";

type NativeExecution = Extract<ResolvedExecutionModule, { readonly kind: "native" }>;
export function parseNativeCompatibility(value: unknown, execution: NativeExecution): NativePrimaryProfile | null {
  const root = new SaveReader(value, "native-compatibility.json"); root.field("version").literal(1);
  let selected: NativePrimaryProfile | null = null;
  const seen = new Set<string>();
  for (const entry of root.field("modules").list(value => value)) {
    const path = normalizeResourcePath(entry.field("artifactPath").string()), key = path.toLowerCase();
    if (seen.has(key)) entry.fail("duplicate native module declaration"); seen.add(key);
    const digest = readDigest(entry.field("artifactDigest")), api = entry.field("apiVersion").choice(3, 2023);
    if (key !== execution.artifact.requestedPath.toLowerCase()) continue;
    if (digest !== execution.artifact.digest || api !== execution.api.version) entry.fail("native primary declaration differs from the selected artifact or API");
    const reader = entry.field("primary"), abi = execution.profile;
    const common = { weapons: readNativePrimaryWeapons(reader.field("weapons"), digest, abi), player: readNativePrimaryPlayer(reader.field("player"), digest),
      commands: readNativePrimaryCommands(reader.field("commands"), digest, abi), inventory: readNativePrimaryInventory(reader.field("inventory"), digest, abi),
      drop: readNativePrimaryDrop(reader.field("drop"), digest, abi), pickups: readNativePrimaryPickups(reader.field("pickups"), digest, abi) };
    if (common.weapons.entity.client !== common.inventory.client || common.commands.client.pointer !== common.inventory.client || common.drop.client.pointer !== common.inventory.client || common.pickups.supply.client !== common.inventory.client
      || common.commands.client.inventory !== common.inventory.inventory || common.drop.client.inventory !== common.inventory.inventory || common.pickups.supply.inventory !== common.inventory.inventory
      || common.commands.items.table !== common.pickups.items.table || common.commands.items.stride !== common.pickups.items.stride || common.commands.items.count !== common.pickups.items.count
      || common.commands.items.count > common.inventory.count) reader.fail("primary services disagree about their source client or item storage");
    selected = api === 3 ? { ...common, edition: "classic", world: readClassicPrimaryWorldProfile(reader.field("world"), digest) }
      : { ...common, edition: "rerelease", world: readRereleasePrimaryWorldProfile(reader.field("world"), digest) };
  }
  return selected;
}
export async function readNativeCompatibility(mounts: Pick<MountedContent, "open">, execution: NativeExecution): Promise<NativePrimaryDeclaration | null> {
  const opened = await mounts.open("native-compatibility.json", mount => mount.identity.content === execution.owner.content);
  if (opened === null) return null;
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(opened.bytes));
  const profile = parseNativeCompatibility(value, execution);
  return profile === null ? null : { declaration: opened.reference, profile };
}
