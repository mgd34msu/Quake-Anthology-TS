import { readSavedNativeWeaponDeclaration } from "./native-weapon.ts";
import { readGameplayMod } from "./mods.ts";
import type { WeaponBehaviorCallback } from "../contracts/weapon-behavior.ts";
import type { ArchiveMount, EnvironmentSelection, CampaignSelection, CharacterSelection, ContentId, ContentMount, EnemySelection, MonsterSelectionTarget, EquipmentSelection, ExecutableRecipe, GrappleSelection, HandGrenadeSelection, MountId, MountPlanId, PresentationSelection, ProviderReference, RecipeId, ResolvedExecutionModule, ResolvedMountPlan, ResolvedResourceReference, ResourceProvenance, ResourceResolution } from "../contracts/content.ts";
import { createMountId, createMountPlanId, createRecipeId, createResourceId, isContentId } from "../contracts/content.ts";
import { readApi, readNativeAbi, readNativeCallAbi, readModule } from "./execution.ts";
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
  if (reader.field("kind").choice("map-defined", "replace") === "map-defined") return { kind: "map-defined" };
  const definition = (value: SaveReader): MonsterSelectionTarget => {
    if (value.field("kind").value !== undefined) {
      const kind = value.field("kind").literal("map-defined");
      if (value.value === null || typeof value.value !== "object" || Object.keys(value.value).some(key => key !== "kind")) return value.fail("expected only a native monster target kind");
      return { kind };
    }
    return { source: readProvider(value.field("source")), classname: value.field("classname").string() };
  };
  const overrides = reader.field("byClassname");
  if (overrides.value === null || typeof overrides.value !== "object" || Array.isArray(overrides.value) || overrides.value instanceof Uint8Array) return overrides.fail("expected authored classname replacements");
  return { kind: "replace", default: definition(reader.field("default")),
    byClassname: Object.fromEntries(Object.keys(overrides.value).map(name => [name, definition(overrides.field(name))])) };
}
function readEnvironment(reader: SaveReader): EnvironmentSelection {
  if (reader.value === undefined) return { kind: "audio-content" };
  const kind = reader.field("kind").choice("audio-content", "disabled", "selected");
  if (kind !== "selected") return { kind };
  const resource = reader.field("resource");
  return { kind, resource: { content: readContentId(resource.field("content")), path: resource.field("path").string() } };
}
function readPresentation(reader: SaveReader): PresentationSelection {
  const doppler = reader.field("doppler");
  return { doppler: { kind: doppler.value === undefined ? "source" : doppler.field("kind").choice("source", "disabled") }, environment: readEnvironment(reader.field("environment")), assets: readContentId(reader.field("assets")), hud: readProvider(reader.field("hud")), effects: readProvider(reader.field("effects")), audio: readProvider(reader.field("audio")) };
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
import { readQvmGrappleDefinition } from "./qvm-grapple.ts";
function readGrapple(reader: SaveReader): GrappleSelection {
  const kind = reader.field("kind").choice("disabled", "enabled");
  if (kind === "disabled") return { kind };
  const source = readProvider(reader.field("source")), binding = reader.field("binding").choice("slot", "offhand");
  switch (reader.field("mechanic").choice("q1-threewave", "q2-ctf", "q2-lmctf", "q3-qvm")) {
    case "q1-threewave": return { kind, source, binding, mechanic: "q1-threewave", edition: reader.field("edition").choice("classic", "rerelease") };
    case "q2-ctf": return { kind, source, binding, mechanic: "q2-ctf", edition: reader.field("edition").choice("classic", "rerelease") };
    case "q2-lmctf": return { kind, source, binding, mechanic: "q2-lmctf", edition: reader.field("edition").literal("classic") };
    case "q3-qvm": return { kind, source, binding, mechanic: "q3-qvm", edition: reader.field("edition").literal("classic"), profile: readQvmGrappleDefinition(reader.field("profile")) };
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
function readWeaponBehavior(reader: SaveReader): NonNullable<ExecutableRecipe["weaponBehaviors"]>[number] {
  const value = reader.field("definition"), module = readModule(value.field("module"));
  const callback = (entry: SaveReader): WeaponBehaviorCallback => {
    const kind = entry.field("kind").choice("quakec", "qvm", "native-artifact"), owner = readModule(entry.field("module"));
    if (owner.id !== module.id || owner.digest !== module.digest || owner.revision !== module.revision || owner.artifactPath !== module.artifactPath)
      return entry.fail("weapon behavior callback differs from selected module");
    switch (kind) {
      case "quakec": return { kind, module: owner, functionIndex: entry.field("functionIndex").integer(1) };
      case "qvm": return { kind, module: owner, instructionIndex: entry.field("instructionIndex").integer(0) };
      case "native-artifact": {
        const abi = readNativeCallAbi(entry.field("abi")), imageOffset = entry.field("imageOffset").bigint();
        const maximum = abi.pointerBytes === 4 ? 0xffffffffn : 0xffffffffffffffffn;
        if (imageOffset < 0n || imageOffset > maximum) return entry.fail("native behavior image offset is outside its ABI address width");
        return { kind, module: owner, imageOffset, abi };
      }
    }
  };
  const source = readProvider(reader.field("source")), artifact = readResource(reader.field("artifact"));
  if (source.provider !== module.id || artifact.digest !== module.digest || artifact.requestedPath !== module.artifactPath)
    return reader.fail("weapon behavior source differs from selected artifact");
  const fire = callback(value.field("fire")), activate = value.field("activate").nullable(callback), savedComponent = reader.field("component");
  const definition: NonNullable<ExecutableRecipe["weaponBehaviors"]>[number]["definition"] = {
    id: namespaced(value.field("id")), title: value.field("title").string(), module,
    role: value.field("role").choice("rocket", "grenade", "nail", "bolt", "plasma", "energy", "grapple"),
    aspect: value.field("aspect").literal("trajectory"), fire, activate };
  let component: NonNullable<ExecutableRecipe["weaponBehaviors"]>[number]["component"];
  const componentKind = savedComponent.value === undefined ? undefined : savedComponent.field("kind").choice("qvm", "rerelease-native");
  if (componentKind === "rerelease-native" || componentKind === undefined && fire.kind === "native-artifact") {
    component = { kind: "rerelease-native", declaration: readSavedNativeWeaponDeclaration(
      componentKind === undefined ? savedComponent : savedComponent.field("declaration"), definition) };
  } else if (componentKind === "qvm") {
    const layout = savedComponent.field("layout"), fields = layout.field("fields");
    const entityStride = layout.field("entityStride").integer(4), levelTime = layout.field("levelTime").integer(4);
    if (entityStride % 4 !== 0 || levelTime % 4 !== 0) return layout.fail("unaligned QVM behavior layout");
    const occupied = new Set<number>();
    const offset = (name: string): number => {
      const field = fields.field(name), result = field.integer(0);
      if (result % 4 !== 0 || result > entityStride - 4 || occupied.has(result)) return field.fail("overlapping or out-of-range QVM behavior field");
      occupied.add(result); return result;
    };
    component = {kind:"qvm",abiProfile:savedComponent.field("abiProfile").choice("q3-modern","q3-1.16n-base"),
      layout:{entityStride,levelTime,allocate:layout.field("allocate").integer(1),free:layout.field("free").integer(1),
        fields:{inuse:offset("inuse"),nextthink:offset("nextthink"),think:offset("think"),health:offset("health")},
        fireAbi:layout.field("fireAbi").literal("entity-pointer-start-direction")}};
  }
  if (fire.kind === "qvm" && (component?.kind !== "qvm" || activate !== null && activate.kind !== "qvm"))
    return reader.fail("QVM behavior requires its source layout and QVM callbacks");
  if (fire.kind === "native-artifact" && (component?.kind !== "rerelease-native" || activate !== null && activate.kind !== "native-artifact")
    || fire.kind === "quakec" && (component !== undefined || activate !== null && activate.kind !== "quakec"))
    return reader.fail("weapon behavior callbacks and component declaration do not match");
  return { source, artifact, ...(component === undefined ? {} : { component }), definition };
}
export function readRecipe(reader: SaveReader): ExecutableRecipe {
  return { ...(reader.field("mods").value === undefined ? {} : { mods: reader.field("mods").list(readGameplayMod) }),
    ...(reader.field("weaponBehaviors").value === undefined ? {} : { weaponBehaviors: reader.field("weaponBehaviors").list(readWeaponBehavior) }), schemaVersion: reader.field("schemaVersion").literal(3), id: readRecipeId(reader.field("id")), preset: readRecipeId(reader.field("preset")),
    map: { geometryContent: readContentId(reader.field("map").field("geometryContent")), geometry: readResource(reader.field("map").field("geometry")), entities: readProvider(reader.field("map").field("entities")) },
    campaign: readCampaign(reader.field("campaign")), movement: readProvider(reader.field("movement")), character: readCharacter(reader.field("character")),
    weapons: reader.field("weapons").list(readProvider), equipment: readEquipment(reader.field("equipment")), enemies: readEnemies(reader.field("enemies")), presentation: readPresentation(reader.field("presentation")),
    engineBehavior: readProvider(reader.field("engineBehavior")), combat: readProvider(reader.field("combat")), inventory: readProvider(reader.field("inventory")), match: readProvider(reader.field("match")), transition: readProvider(reader.field("transition")),
    execution: reader.field("execution").list(readExecution), mounts: readMountPlan(reader.field("mounts")), resources: reader.field("resources").list(readResource),
    timing: reader.field("timing").list(timing => ({ provider: namespaced(timing.field("provider")), clock: readClock(timing.field("clock")), numeric: readNumeric(timing.field("numeric")) })), ordering: readOrdering(reader.field("ordering")) };
}
