import type { ContentId, GrappleSelection } from "../../contracts/content.ts";
import { isDeepStrictEqual } from "node:util";
import { createMountPlanId } from "../../contracts/content.ts";
import type { ModuleIdentity } from "../../contracts/execution.ts";
import type { InstalledCatalog } from "../../content/catalog/index.ts";
import { openMountPlan, type MountedContent, type MountPlanOpener } from "../../content/mounts/index.ts";
import { resolveQvmArtifact } from "../../compat/qvm/artifacts.ts";
import type { QvmModuleOptions } from "../../compat/qvm/module.ts";
import { LRCTF_GRAPPLE_DIGEST } from "../../content/q3/equipment/lrctf-grapple-profile.ts";
import { THREEWAVE_GRAPPLE_DIGEST } from "../../content/q3/equipment/threewave-grapple-profile.ts";
import { q3GrappleProfile } from "../../content/q3/equipment/grapple-profiles.ts";
import { qvmGrappleProfileDeclaration } from "../../compat/qvm/grapple-profile.ts";

export type QvmGrappleSelection = Extract<GrappleSelection, { readonly mechanic: "q3-qvm" }>;
export interface PreparedQvmGrapple {
  readonly selection: QvmGrappleSelection;
  readonly artifact: QvmModuleOptions["artifact"];
  readonly mounts: MountedContent;
}
async function fromMounts(content: ContentId, mounts: MountedContent): Promise<PreparedQvmGrapple | null> {
  const resource = await mounts.open("vm/qagame.qvm");
  if (resource === null) return null;
  if (resource.reference.digest !== LRCTF_GRAPPLE_DIGEST && resource.reference.digest !== THREEWAVE_GRAPPLE_DIGEST) return null;
  const module: ModuleIdentity = { id: `q3:grapple/${content}`, artifactPath: resource.reference.requestedPath, digest: resource.reference.digest, revision: resource.reference.digest };
  const artifact = resolveQvmArtifact({ module, bytes: resource.bytes, role: "qagame" });
  if (artifact.kind !== "bytecode") return null;
  const profile = q3GrappleProfile(artifact);
  return profile === null ? null : { selection: { kind: "enabled", mechanic: "q3-qvm", edition: "classic", binding: "offhand", source: { provider: module.id, content }, profile }, artifact, mounts };
}
/** Only exact installed executables with grounded callback declarations become choices. */
export async function applicationQvmGrappleSelection(catalog: InstalledCatalog, content: ContentId, openPlan: MountPlanOpener = openMountPlan): Promise<QvmGrappleSelection | null> {
  if (catalog.product(content).expectation.family !== "q3") return null;
  const mounts = await catalog.mountsFor(content);
  using opened = await openPlan({ id: createMountPlanId("qvm-grapple", Buffer.from(content).toString("hex")), mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
  return (await fromMounts(content, opened))?.selection ?? null;
}
export async function prepareApplicationQvmGrapple(selection: QvmGrappleSelection, forContent: (content: ContentId) => Promise<MountedContent>): Promise<PreparedQvmGrapple> {
  const mounted = await fromMounts(selection.source.content, await forContent(selection.source.content));
  if (mounted === null || mounted.selection.source.provider !== selection.source.provider
    || !isDeepStrictEqual(qvmGrappleProfileDeclaration(mounted.selection.profile), qvmGrappleProfileDeclaration(selection.profile)))
    throw new Error("Selected grapple differs from its installed source executable or declaration");
  return { ...mounted, selection };
}
