import { readWeaponBehaviorDocument } from "../../content/catalog/weapon-behavior-document.ts";
import { type CvarRegistry } from "../../core/cvars/index.ts";
import type { ApplicationOptions } from "./options.ts";
import type { ExecutableRecipe, ResolvedWeaponBehaviorSelection, ContentId } from "../../contracts/content.ts";
import { createMountPlanId } from "../../contracts/content.ts";
import type { ModuleIdentity } from "../../contracts/execution.ts";
import { sameWeaponBehavior } from "../../contracts/weapon-behavior.ts";
import { discoverQcWeaponBehaviors } from "../../content/catalog/weapon-behaviors.ts";
import { discoverInstalledContent, type InstalledCatalog } from "../../content/catalog/index.ts";
import { openMountPlan, type MountedContent } from "../../content/mounts/index.ts";
import { loadQcProgram } from "../../compat/qc/program.ts";
import type { QcProgram } from "../../compat/qc/program.ts";
import { prepareQuakeCResources, type PreparedQuakeCSource } from "./simulation/quakec-source.ts";

export interface WeaponBehaviorRequest { readonly product: string; readonly id: string }
export interface ApplicationWeaponBehaviorChoice {
  readonly id: string; readonly title: string; readonly unavailable: string | null;
  readonly selection: ResolvedWeaponBehaviorSelection | null;
}
export interface PreparedWeaponBehavior {
  readonly selection: ResolvedWeaponBehaviorSelection;
  readonly program: QcProgram;
  readonly resources: PreparedQuakeCSource["resources"];
  readonly mounts: MountedContent;
}
export function readWeaponBehaviorRequest(value: string): WeaponBehaviorRequest {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1 || /\s/.test(value) || !value.slice(slash + 1).includes(":"))
    throw new Error("Weapon behavior must be PRODUCT/DECLARED_ID");
  return { product: value.slice(0, slash), id: value.slice(slash + 1) };
}
export function configuredWeaponBehaviorOptions(options: ApplicationOptions, cvars: CvarRegistry): ApplicationOptions {
  if (options.weaponBehavior !== undefined) return options;
  const value = cvars.find("qts_weaponBehavior")?.value ?? "";
  return value === "" ? options : { ...options, weaponBehavior: readWeaponBehaviorRequest(value) };
}
function behaviorModule(content: ContentId, path: string, digest: ModuleIdentity["digest"]): ModuleIdentity {
  return { id: `weapon-behavior:${content}`, artifactPath: path, digest, revision: digest };
}
async function choicesFromMounts(catalog: InstalledCatalog, productId: string, mounts: MountedContent): Promise<readonly ApplicationWeaponBehaviorChoice[]> {
  const product = catalog.require(productId), title = product.expectation.title;
  const unavailable = (reason: string): readonly ApplicationWeaponBehaviorChoice[] => [{ id: `${productId}/unavailable`, title, unavailable: reason, selection: null }];
  if (product.expectation.family !== "q1") return unavailable("This provider has no declared QuakeC trajectory adapter");
  const descriptor = await mounts.open("weapon-behaviors.json");
  if (descriptor === null) return unavailable("No authored weapon-behaviors.json trajectory declaration; use weapon-behavior inspect to inspect source callbacks");
  const document = readWeaponBehaviorDocument(descriptor.bytes);
  const path = document.artifactPath ?? (product.expectation.edition === "quakeworld" ? "qwprogs.dat" : "progs.dat"), artifact = await mounts.open(path);
  if (artifact === null) return unavailable(`Declared behavior requires mounted ${path}`);
  const program = loadQcProgram(artifact.bytes), module = behaviorModule(product.id, path, artifact.reference.digest);
  const discovered = await discoverQcWeaponBehaviors(mounts, module, program);
  if (discovered.kind === "undeclared") return unavailable(discovered.reason);
  if (discovered.declarations.length === 0) return unavailable("The source declares no trajectory behaviors");
  return discovered.declarations.map((value, index) => value.kind === "unsupported"
    ? { id: `${productId}/unsupported-${index}`, title, unavailable: value.reason, selection: null }
    : { id: `${productId}/${value.definition.id}`, title: `${title} — ${value.definition.title} (${value.definition.role})`, unavailable: null,
        selection: { source: { provider: module.id, content: product.id }, artifact: artifact.reference, definition: value.definition } });
}
export async function applicationWeaponBehaviorChoices(catalog: InstalledCatalog, productId: string): Promise<readonly ApplicationWeaponBehaviorChoice[]> {
  const product = catalog.require(productId), mounts = await catalog.mountsFor(product.id);
  using mounted = await openMountPlan({ id: createMountPlanId("weapon-behavior", Buffer.from(product.id).toString("hex")), mounts,
    defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
  return await choicesFromMounts(catalog, productId, mounted);
}
export async function selectApplicationWeaponBehavior(catalog: InstalledCatalog, recipe: ExecutableRecipe, request: WeaponBehaviorRequest): Promise<ExecutableRecipe> {
  if (recipe.execution.some(module => module.role === "server-game" && module.kind !== "typescript"))
    throw new Error("Selected native or bytecode game has no shared projectile behavior hook; choose a TypeScript launcher provider");
  const choices = await applicationWeaponBehaviorChoices(catalog, request.product), selected = choices.find(value => value.selection?.definition.id === request.id);
  if (selected?.selection === undefined || selected.selection === null)
    throw new Error(`Weapon behavior ${request.product}/${request.id}: ${choices.find(value => value.unavailable !== null)?.unavailable ?? "No such declared compatible behavior"}`);
  return { ...recipe, weaponBehaviors: [selected.selection] };
}
export async function prepareConfiguredApplicationRecipe(catalog: InstalledCatalog, options: ApplicationOptions,
  recipe: ExecutableRecipe): Promise<{ readonly catalog: InstalledCatalog; readonly recipe: ExecutableRecipe }> {
  const request = options.weaponBehavior;
  if (request === undefined) return { catalog, recipe };
  if (!catalog.products.some(product => product.expectation.id === request.product || product.id === request.product))
    catalog = await discoverInstalledContent({ corpusRoot: catalog.corpusRoot, generation: catalog.generation, discoverMods: true,
      ...(catalog.userContentRoot === null ? {} : { userContentRoot: catalog.userContentRoot }) });
  return { catalog, recipe: await selectApplicationWeaponBehavior(catalog, recipe, request) };
}
export async function prepareApplicationWeaponBehavior(catalog: InstalledCatalog, selection: ResolvedWeaponBehaviorSelection,
  forContent: (id: ContentId) => Promise<MountedContent>): Promise<PreparedWeaponBehavior> {
  const product = catalog.product(selection.source.content), mounts = await forContent(product.id);
  const choices = await choicesFromMounts(catalog, product.expectation.id, mounts), current = choices.find(value => value.selection?.definition.id === selection.definition.id)?.selection;
  if (current === undefined || current === null || current.artifact.requestedPath !== selection.artifact.requestedPath || current.artifact.digest !== selection.artifact.digest
    || current.source.provider !== selection.source.provider || !sameWeaponBehavior(current.definition, selection.definition))
    throw new Error("Selected weapon behavior differs from its mounted declaration or artifact");
  const artifact = await mounts.open(selection.artifact.requestedPath);
  if (artifact === null) throw new Error("Selected weapon behavior program is missing");
  const program = loadQcProgram(artifact.bytes);
  return { selection, program, resources: await prepareQuakeCResources(program, mounts), mounts };
}

