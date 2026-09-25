import { createHash } from 'node:crypto';
import type { ContentId, ContentMount, ExecutableRecipe, MountId, MountPlanId, ResolvedMountPlan, ResolvedResourceReference, ResourceId } from '../../../contracts/content.ts';
import { createMountId, createMountPlanId, createResourceId } from '../../../contracts/content.ts';
import type { InstalledCatalog } from '../../../content/catalog/index.ts';
import { openMountPlan } from '../../../content/mounts/index.ts';
import { normalizeResourcePath } from '../../../content/mounts/paths.ts';
import { compositionIdentity } from '../../../network/common/session.ts';
import type { CompositionIdentity, SessionComposition } from '../../../network/common/session.ts';
import { readRecipe, readContentId } from '../../../persistence/recipe.ts';
import { readDigest } from '../../../persistence/shared.ts';
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from '../../../persistence/value.ts';
import { applicationOptionsForRecipe, loadApplicationContent } from '../content.ts';
import type { LoadedApplicationContent } from '../content.ts';
import type { ApplicationOptions } from '../options.ts';
import type { UnifiedResourceKey } from './unified-frame-codec.ts';

export interface UnifiedMapSidecar { readonly content: ContentId; readonly path: string; readonly resource: UnifiedResourceKey | null; }
export interface UnifiedCompositionIdentity extends CompositionIdentity {
  readonly composition: SessionComposition & { readonly sidecars: readonly UnifiedMapSidecar[] };
}
function path(value: string): string {
  if (normalizeResourcePath(value) !== value) throw new Error('Unified paths must use forward slashes');
  return value;
}
function resourceKey(value: ResolvedResourceReference): UnifiedResourceKey {
  return { content: value.provenance.mount.identity.content, path: value.requestedPath, digest: value.digest, byteLength: value.byteLength };
}
function readKey(reader: SaveReader): UnifiedResourceKey {
  return { content: readContentId(reader.field('content')), path: path(reader.field('path').string()), digest: readDigest(reader.field('digest')), byteLength: reader.field('byteLength').integer(0) };
}
function readSidecars(reader: SaveReader): readonly UnifiedMapSidecar[] {
  return reader.list(entry => ({ content: readContentId(entry.field('content')), path: path(entry.field('path').string()), resource: entry.field('resource').nullable(readKey) }));
}
function observedSidecars(content: LoadedApplicationContent): readonly UnifiedMapSidecar[] {
  return content.mapSidecars.map(value => ({ content: value.content, path: value.path, resource: value.resource === null ? null : resourceKey(value.resource) }));
}
export async function buildUnifiedComposition(content: LoadedApplicationContent): Promise<UnifiedCompositionIdentity> {
  return createUnifiedComposition(content.recipe, observedSidecars(content));
}

export function unifiedResourceId(value: UnifiedResourceKey | ResolvedResourceReference): ResourceId {
  const key = 'provenance' in value ? resourceKey(value) : value;
  path(key.path);
  if (!Number.isSafeInteger(key.byteLength) || key.byteLength < 0) throw new RangeError('Invalid unified resource length');
  return `resource:unified:${createHash('sha256').update(JSON.stringify([key.content, key.path, key.digest, key.byteLength])).digest('hex')}`;
}

function resourceWithMount(resource: ResolvedResourceReference, mount: ContentMount, plan: MountPlanId): ResolvedResourceReference {
  normalizeResourcePath(resource.requestedPath); normalizeResourcePath(resource.provenance.memberPath);
  const provenance = resource.provenance.kind === 'archive' && mount.kind === 'archive' ? { ...resource.provenance, mount }
    : resource.provenance.kind === 'loose' && mount.kind === 'loose' ? { ...resource.provenance, mount } : null;
  if (provenance === null) throw new Error('Unified resource mount kind differs');
  if (resource.resolution.kind === 'link') { normalizeResourcePath(resource.resolution.sourcePrefix.replace(/\/$/, '')); normalizeResourcePath(resource.resolution.targetPath); }
  const value = { ...resource, provenance, resolution: { ...resource.resolution, plan } };
  return { ...value, id: createResourceId(value) };
}

function rebindRecipe(recipe: ExecutableRecipe, mounts: ResolvedMountPlan, resource: (value: ResolvedResourceReference) => ResolvedResourceReference): ExecutableRecipe {
  return { ...recipe, mounts, map: { ...recipe.map, geometry: resource(recipe.map.geometry) }, resources: recipe.resources.map(resource),
    execution: recipe.execution.map(module => module.kind === 'typescript' ? module : { ...module, artifact: resource(module.artifact) }) };
}

/** Machine paths, mount generations and resource IDs are never part of peer authority. */
export function createUnifiedComposition(recipe: ExecutableRecipe, sidecars: readonly UnifiedMapSidecar[] = []): UnifiedCompositionIdentity {
  const mounts = new Map<MountId, ContentMount>(), plans = new Map<MountPlanId, MountPlanId>();
  const plan = (id: MountPlanId): MountPlanId => {
    const existing = plans.get(id); if (existing !== undefined) return existing;
    const logical = createMountPlanId('unified', String(plans.size)); plans.set(id, logical); return logical;
  };
  const id = plan(recipe.mounts.id);
  for (const [index, mount] of recipe.mounts.mounts.entries()) {
    if (mounts.has(mount.identity.id)) throw new Error('Repeated unified mount identity');
    const identity = { id: createMountId('unified', String(index)), content: mount.identity.content, generation: 0 };
    mounts.set(mount.identity.id, mount.kind === 'archive' ? { ...mount, identity, archivePath: `unified/${index}.${mount.format}` }
      : { ...mount, identity, rootPath: `unified/${index}` });
  }
  const mountFor = (id: MountId): ContentMount => { const mount = mounts.get(id); if (mount === undefined) throw new Error('Unified reference uses an undeclared mount'); return mount; };
  const order = (values: readonly MountId[]): readonly MountId[] => {
    if (new Set(values).size !== values.length || values.length !== mounts.size) throw new Error('Unified mount order must include every mount once');
    return values.map(value => mountFor(value).identity.id);
  };
  const normalized = rebindRecipe(recipe, { id, mounts: [...mounts.values()], defaultOrder: order(recipe.mounts.defaultOrder),
    prefixOrders: recipe.mounts.prefixOrders.map(value => { normalizeResourcePath(value.prefix.replace(/\/$/, '')); return { prefix: value.prefix, mounts: order(value.mounts) }; }) },
    resource => resourceWithMount(resource, mountFor(resource.provenance.mount.identity.id), plan(resource.resolution.plan)));
  const sidecarKeys = new Set<string>();
  const checked = readSidecars(new SaveReader(sidecars, 'unified.sidecars'));
  for (const entry of checked) {
    const key = `${entry.content}/${entry.path}`;
    if (sidecarKeys.has(key)) throw new Error('Repeated unified map sidecar');
    sidecarKeys.add(key);
  }
  const composition = { schemaVersion: 1, recipe: normalized, snapshotSchema: 'qts:snapshot-v8', actorConfigurations: [], sidecars: checked } satisfies UnifiedCompositionIdentity['composition'];
  const identity = compositionIdentity(composition);
  return { ...identity, composition: { ...identity.composition, sidecars: checked } };
}

export function readUnifiedComposition(value: unknown): UnifiedCompositionIdentity {
  const reader = new SaveReader(value, 'unified.composition'), composition = reader.field('composition');
  composition.field('schemaVersion').literal(1); composition.field('snapshotSchema').literal('qts:snapshot-v8');
  if (composition.field('actorConfigurations').list(entry => entry.value).length !== 0) return composition.fail('actor configurations are negotiated by frame');
  const recipe = readRecipe(composition.field('recipe')), sidecars = readSidecars(composition.field('sidecars')), identity = createUnifiedComposition(recipe, sidecars);
  const parsed = compositionIdentity({ ...identity.composition, recipe });
  if (parsed.digest !== identity.digest || readDigest(reader.field('digest')) !== identity.digest) return reader.fail('noncanonical or mismatched unified composition');
  return identity;
}
export function encodeUnifiedComposition(identity: CompositionIdentity): Uint8Array { return encodeCheckpointValue(readUnifiedComposition(identity)); }
export function decodeUnifiedComposition(bytes: Uint8Array): UnifiedCompositionIdentity { return readUnifiedComposition(decodeCheckpointValue(bytes)); }

/** Reconstruct a local plan exclusively from installed catalog mounts, preserving offered precedence. */
export async function resolveUnifiedComposition(offered: CompositionIdentity, catalog: InstalledCatalog): Promise<ExecutableRecipe> {
  const identity = readUnifiedComposition(offered), recipe = identity.composition.recipe;
  const available = new Map<string, readonly ContentMount[]>();
  for (const content of new Set(recipe.mounts.mounts.map(mount => mount.identity.content))) available.set(content, await catalog.mountsFor(content));
  const mounts = new Map<MountId, ContentMount>(), used = new Set<MountId>();
  for (const mount of recipe.mounts.mounts) {
    const candidates = available.get(mount.identity.content) ?? [];
    const local = candidates.find(candidate => !used.has(candidate.identity.id) && candidate.identity.content === mount.identity.content
      && (mount.kind === 'archive' ? candidate.kind === 'archive' && candidate.format === mount.format && candidate.archiveDigest === mount.archiveDigest : candidate.kind === 'loose'));
    if (local === undefined) throw new Error(`Installed content lacks unified mount ${mount.identity.content}/${mount.identity.id}`);
    used.add(local.identity.id); mounts.set(mount.identity.id, local);
  }
  const mountFor = (id: MountId): ContentMount => { const mount = mounts.get(id); if (mount === undefined) throw new Error('Unknown unified mount'); return mount; };
  const plan: ResolvedMountPlan = { id: recipe.mounts.id, mounts: [...mounts.values()], defaultOrder: recipe.mounts.defaultOrder.map(id => mountFor(id).identity.id),
    prefixOrders: recipe.mounts.prefixOrders.map(value => ({ prefix: value.prefix, mounts: value.mounts.map(id => mountFor(id).identity.id) })) };
  const local = rebindRecipe(recipe, plan, resource => resourceWithMount(resource, mountFor(resource.provenance.mount.identity.id), resource.resolution.plan));
  using opened = await openMountPlan(plan);
  const references = [local.map.geometry, ...local.resources, ...local.execution.flatMap(module => module.kind === 'typescript' ? [] : [module.artifact])];
  for (const resource of new Map(references.map(resource => [resource.id, resource])).values()) {
    await opened.read(resource);
    if (resource.resolution.plan === plan.id) {
      const resolved = await opened.resolve(resource.requestedPath);
      if (resolved?.id !== resource.id) throw new Error(`Unified resource precedence differs: ${resource.requestedPath}`);
    } else if (resource.resolution.kind !== 'link' && resource.resolution.rank >= plan.mounts.length) throw new Error('Unified resource precedence is outside its mount plan');
  }
  if (createUnifiedComposition(local, identity.composition.sidecars).digest !== identity.digest) throw new Error('Local unified recipe differs from admitted composition');
  return local;
}

export async function loadUnifiedContent(options: ApplicationOptions, identity: CompositionIdentity, catalog: InstalledCatalog): Promise<LoadedApplicationContent> {
  const recipe = await resolveUnifiedComposition(identity, catalog), configured = applicationOptionsForRecipe(options, { catalog, recipe });
  const product = catalog.product(recipe.map.entities.content).expectation;
  const family = product.family === 'q1' && product.edition === 'quakeworld' ? 'qw' : product.family;
  const loaded = await loadApplicationContent(configured, recipe, undefined, catalog, { kind: 'unified', family });
  try {
    if ((await buildUnifiedComposition(loaded)).digest !== identity.digest) throw new Error('Unified map sidecars differ from the authoritative world');
    return loaded;
  } catch (error) { await loaded.close(); throw error; }
}

export async function resolveUnifiedResource(content: LoadedApplicationContent, key: UnifiedResourceKey): Promise<ResolvedResourceReference> {
  path(key.path);
  const mounted = await content.forContent(key.content), opened = await mounted.open(key.path);
  if (opened === null || opened.reference.provenance.mount.identity.content !== key.content || opened.reference.digest !== key.digest || opened.reference.byteLength !== key.byteLength)
    throw new Error(`Unified resource is absent or differs: ${key.content}/${key.path}`);
  return opened.reference;
}
