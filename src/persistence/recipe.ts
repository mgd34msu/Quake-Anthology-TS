import type { ArchiveMount, CampaignSelection, CharacterSelection, ContentId, ContentMount, EnemySelection, EquipmentSelection, ExecutableRecipe, GrappleSelection, HandGrenadeSelection, MountId, MountPlanId, PresentationSelection, ProviderReference, RecipeId, ResolvedExecutionModule, ResolvedMountPlan, ResolvedResourceReference, ResourceProvenance, ResourceResolution } from "../contracts/content.ts";
import { createMountId, createMountPlanId, createRecipeId, createResourceId, isContentId } from "../contracts/content.ts";
import { readApi, readNativeAbi } from "./execution.ts";
import { readClock, readDigest, readNumeric, readOrdering } from "./shared.ts";
import { namespaced, SaveReader } from "./value.ts";

function identityParts(reader: SaveReader, prefix: string): readonly [string, string] {
  const parts = reader.string().split(":");
  if (parts.length !== 3 || parts[0] !== prefix || parts[1] === undefined || parts[2] === undefined) return reader.fail(`expected a ${prefix} identity`);
  return [parts[1], parts[2]];
}
function readRecipeId(reader: SaveReader): RecipeId { const [name, revision] = identityParts(reader, "recipe"); return createRecipeId(name, revision); }
function readMountId(reader: SaveReader): MountId { const [namespace, name] = identityParts(reader, "mount"); return createMountId(namespace, name); }
function readMountPlanId(reader: SaveReader): MountPlanId { const [name, revision] = identityParts(reader, "mount-plan"); return createMountPlanId(name, revision); }
export function readContentId(reader: SaveReader): ContentId { if (!isContentId(reader.value)) return reader.fail("expected a content identity"); return reader.value; }
export function readProvider(reader: SaveReader): ProviderReference { return { provider: namespaced(reader.field("provider")), content: readContentId(reader.field("content")) }; }
function readMount(reader: SaveReader): ContentMount {
  const identity = reader.field("identity");
  const common = { identity: { id: readMountId(identity.field("id")), content: readContentId(identity.field("content")), generation: identity.field("generation").integer(0) } };
  return reader.field("kind").choice("archive", "loose") === "loose"
    ? { ...common, kind: "loose", rootPath: reader.field("rootPath").string() }
    : { ...common, kind: "archive", format: reader.field("format").choice("pak", "pk3", "kpf", "zip"), archivePath: reader.field("archivePath").string(), archiveDigest: readDigest(reader.field("archiveDigest")) };
}
function readArchive(reader: SaveReader): ArchiveMount { const mount = readMount(reader); return mount.kind === "archive" ? mount : reader.fail("expected an archive mount"); }
function readProvenance(reader: SaveReader): ResourceProvenance {
  const memberPath = reader.field("memberPath").string();
  if (reader.field("kind").choice("archive", "loose") === "archive") return { kind: "archive", memberPath, mount: readArchive(reader.field("mount")), memberIndex: reader.field("memberIndex").integer(0) };
  const mount = readMount(reader.field("mount"));
  if (mount.kind !== "loose") return reader.fail("expected a loose mount");
  return { kind: "loose", memberPath, mount };
}
function readResolution(reader: SaveReader): ResourceResolution {
  const plan = readMountPlanId(reader.field("plan"));
  switch (reader.field("kind").choice("default-order", "prefix-order", "link")) {
    case "default-order": return { kind: "default-order", plan, rank: reader.field("rank").integer(0) };
    case "prefix-order": return { kind: "prefix-order", plan, rank: reader.field("rank").integer(0), prefix: reader.field("prefix").string() };
    case "link": return { kind: "link", plan, sourcePrefix: reader.field("sourcePrefix").string(), targetPath: reader.field("targetPath").string() };
  }
}
export function readResource(reader: SaveReader): ResolvedResourceReference {
  const resource = { requestedPath: reader.field("requestedPath").string(), provenance: readProvenance(reader.field("provenance")), digest: readDigest(reader.field("digest")), byteLength: reader.field("byteLength").integer(0), resolution: readResolution(reader.field("resolution")) };
  const id = createResourceId(resource);
  if (reader.field("id").string() !== id) return reader.fail("resource identity differs from its provenance");
  return { id, ...resource };
}
function readMountPlan(reader: SaveReader): ResolvedMountPlan {
  return { id: readMountPlanId(reader.field("id")), mounts: reader.field("mounts").list(readMount), defaultOrder: reader.field("defaultOrder").list(readMountId),
    prefixOrders: reader.field("prefixOrders").list(order => ({ prefix: order.field("prefix").string(), mounts: order.field("mounts").list(readMountId) })) };
}
function readCampaign(reader: SaveReader): CampaignSelection {
  return reader.field("kind").choice("none", "campaign") === "none" ? { kind: "none" } : { kind: "campaign", mission: readProvider(reader.field("mission")), gamecode: readProvider(reader.field("gamecode")) };
}
export function readCharacter(reader: SaveReader): CharacterSelection { return { definition: readProvider(reader.field("definition")), appearance: readProvider(reader.field("appearance")) }; }
function readEnemies(reader: SaveReader): EnemySelection {
  return reader.field("kind").choice("map-defined", "replace") === "map-defined" ? { kind: "map-defined" } : { kind: "replace", definitions: reader.field("definitions").list(readProvider) };
}
function readPresentation(reader: SaveReader): PresentationSelection {
  return { assets: readContentId(reader.field("assets")), hud: readProvider(reader.field("hud")), effects: readProvider(reader.field("effects")), audio: readProvider(reader.field("audio")) };
}
function readExecution(reader: SaveReader): ResolvedExecutionModule {
  const owner = readProvider(reader.field("owner"));
  const api = readApi(reader.field("api"));
  const role = reader.field("role").choice("server-game", "client-game", "ui");
  const kind = reader.field("kind").choice("typescript", "quakec", "qvm", "native");
  if (kind === "typescript") {
    const implementation = namespaced(reader.field("implementation"));
    switch (api.kind) {
      case "q1-netquake": case "q1-quakeworld":
        if (role !== "server-game") return reader.fail("game API requires server-game role");
        return { kind, owner, implementation, role, api };
      case "q2-classic-game": case "q2-rerelease-game":
        if (role !== "server-game") return reader.fail("game API requires server-game role");
        return { kind, owner, implementation, role, api };
      case "q3-qagame":
        if (role !== "server-game") return reader.fail("game API requires server-game role");
        return { kind, owner, implementation, role, api };
      case "q2-rerelease-cgame":
        if (role !== "client-game") return reader.fail("cgame API requires client-game role");
        return { kind, owner, implementation, role, api };
      case "q3-cgame":
        if (role !== "client-game") return reader.fail("cgame API requires client-game role");
        return { kind, owner, implementation, role, api };
      case "q3-ui":
        if (role !== "ui") return reader.fail("UI API requires ui role");
        return { kind, owner, implementation, role, api };
    }
  }
  const artifact = readResource(reader.field("artifact"));
  if (kind === "quakec") {
    if (role !== "server-game" || (api.kind !== "q1-netquake" && api.kind !== "q1-quakeworld")) return reader.fail("QuakeC requires a Q1 server-game API");
    return { kind, owner, artifact, role, api };
  }
  if (kind === "qvm") {
    switch (api.kind) {
      case "q3-qagame": if (role !== "server-game") return reader.fail("qagame requires server-game role"); return { kind, owner, artifact, role, api };
      case "q3-cgame": if (role !== "client-game") return reader.fail("cgame requires client-game role"); return { kind, owner, artifact, role, api };
      case "q3-ui": if (role !== "ui") return reader.fail("UI requires ui role"); return { kind, owner, artifact, role, api };
      default: return reader.fail("QVM requires a Q3 API");
    }
  }
  const profile = readNativeAbi(reader.field("profile"));
  switch (api.kind) {
    case "q2-classic-game": case "q2-rerelease-game":
      if (role !== "server-game") return reader.fail("game API requires server-game role");
      return { kind, owner, artifact, profile, role, api };
    case "q3-qagame":
      if (role !== "server-game") return reader.fail("game API requires server-game role");
      return { kind, owner, artifact, profile, role, api };
    case "q2-rerelease-cgame":
      if (role !== "client-game") return reader.fail("cgame API requires client-game role");
      return { kind, owner, artifact, profile, role, api };
    case "q3-cgame":
      if (role !== "client-game") return reader.fail("cgame API requires client-game role");
      return { kind, owner, artifact, profile, role, api };
    case "q3-ui": if (role !== "ui") return reader.fail("UI API requires ui role"); return { kind, owner, artifact, profile, role, api };
    default: return reader.fail("native game module cannot use a QuakeC API");
  }
}
function readGrapple(reader: SaveReader): GrappleSelection {
  const kind = reader.field("kind").choice("disabled", "enabled");
  if (kind === "disabled") return { kind };
  const source = readProvider(reader.field("source")), binding = reader.field("binding").choice("slot", "offhand");
  switch (reader.field("mechanic").choice("q1-threewave", "q2-ctf", "q2-lmctf")) {
    case "q1-threewave": return { kind, source, binding, mechanic: "q1-threewave", edition: reader.field("edition").literal("rerelease") };
    case "q2-ctf": return { kind, source, binding, mechanic: "q2-ctf", edition: reader.field("edition").choice("classic", "rerelease") };
    case "q2-lmctf": return { kind, source, binding, mechanic: "q2-lmctf", edition: reader.field("edition").literal("classic") };
  }
}
function readHandGrenades(reader: SaveReader): HandGrenadeSelection {
  const kind = reader.field("kind").choice("disabled", "enabled");
  if (kind === "disabled") return { kind };
  const initialAmmo = reader.field("initialAmmo").integer(0), capacity = reader.field("capacity").integer(0);
  if (initialAmmo > capacity) return reader.fail("hand grenade allowance exceeds capacity");
  return { kind, source: readProvider(reader.field("source")), binding: reader.field("binding").literal("offhand"),
    edition: reader.field("edition").choice("classic", "rerelease"), initialAmmo, capacity };
}
export function readEquipment(reader: SaveReader): EquipmentSelection {
  return { grapple: readGrapple(reader.field("grapple")), handGrenades: readHandGrenades(reader.field("handGrenades")) };
}
export function readRecipe(reader: SaveReader): ExecutableRecipe {
  return { schemaVersion: reader.field("schemaVersion").literal(1), id: readRecipeId(reader.field("id")), preset: readRecipeId(reader.field("preset")),
    map: { geometry: readResource(reader.field("map").field("geometry")), entities: readProvider(reader.field("map").field("entities")) },
    campaign: readCampaign(reader.field("campaign")), movement: readProvider(reader.field("movement")), character: readCharacter(reader.field("character")),
    weapons: reader.field("weapons").list(readProvider), equipment: readEquipment(reader.field("equipment")), enemies: readEnemies(reader.field("enemies")), presentation: readPresentation(reader.field("presentation")),
    engineBehavior: readProvider(reader.field("engineBehavior")), combat: readProvider(reader.field("combat")), inventory: readProvider(reader.field("inventory")), match: readProvider(reader.field("match")), transition: readProvider(reader.field("transition")),
    execution: reader.field("execution").list(readExecution), mounts: readMountPlan(reader.field("mounts")), resources: reader.field("resources").list(readResource),
    timing: reader.field("timing").list(timing => ({ provider: namespaced(timing.field("provider")), clock: readClock(timing.field("clock")), numeric: readNumeric(timing.field("numeric")) })), ordering: readOrdering(reader.field("ordering")) };
}
