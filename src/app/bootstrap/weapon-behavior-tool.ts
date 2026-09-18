import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { discoverInstalledContent } from "../../content/catalog/index.ts";
import { inspectQcTrajectoryBindings, discoverQcWeaponBehaviors, resolveQcWeaponBehavior, type SourceWeaponBehaviorMetadata } from "../../content/catalog/weapon-behaviors.ts";
import { readWeaponBehaviorDocument, weaponBehaviorEntryId } from "../../content/catalog/weapon-behavior-document.ts";
import { createMountPlanId } from "../../contracts/content.ts";
import type { ModuleIdentity } from "../../contracts/execution.ts";
import { openMountPlan } from "../../content/mounts/index.ts";
import { userProductDirectory } from "../../content/user-data.ts";
import { loadQcProgram } from "../../compat/qc/program.ts";
import { weaponBehaviorToolHelp, type WeaponBehaviorToolCommand } from "./weapon-behavior-tool-options.ts";

export async function runWeaponBehaviorTool(command: WeaponBehaviorToolCommand, print: (text: string) => void): Promise<void> {
  if (command.action === "help") { print(weaponBehaviorToolHelp); return; }
  const catalog = await discoverInstalledContent({ corpusRoot: command.corpusRoot, userContentRoot: command.userContentRoot, discoverMods: true });
  const product = catalog.require(command.product);
  if (product.expectation.family !== "q1") throw new Error("Behavior authoring currently supports QuakeC artifacts; native and QVM callback extraction is not implemented");
  const mounts = await catalog.mountsFor(product.id);
  using content = await openMountPlan({ id: createMountPlanId("weapon-authoring", Buffer.from(product.id).toString("hex")), mounts,
    defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
  const existing = await content.open("weapon-behaviors.json"), document = existing === null ? null : readWeaponBehaviorDocument(existing.bytes);
  const path = command.artifact ?? document?.artifactPath ?? (product.expectation.edition === "quakeworld" ? "qwprogs.dat" : "progs.dat");
  const artifact = await content.open(path);
  if (artifact === null) throw new Error(`Mounted behavior artifact is missing: ${path}`);
  const program = loadQcProgram(artifact.bytes), module: ModuleIdentity = {
    id: `weapon-behavior:${product.id}`, artifactPath: path, digest: artifact.reference.digest, revision: artifact.reference.digest };
  if (command.action === "inspect") {
    print(JSON.stringify({ product: product.expectation.id, artifact: path, digest: program.digest,
      scope: "Callback identities and statement positions apply only to this exact artifact digest; roles and activation gates require explicit selection.",
      callbacks: program.functions.filter(fn => fn.index !== 0 && fn.firstStatement >= 0 && fn.parameterSizes.length === 0)
        .map(fn => ({ name: fn.name, index: fn.index })),
      thinkAssignments: inspectQcTrajectoryBindings(program).map(binding => ({ producer: program.functions[binding.producerFunction]?.name,
        think: program.functions[binding.thinkFunction]?.name, statement: binding.statement })) }, null, 2) + "\n");
    return;
  }
  const declaration: SourceWeaponBehaviorMetadata = { id: command.id, title: command.title, artifactDigest: program.digest,
    role: command.role, aspect: "trajectory", fireFunction: command.fire,
    ...(command.activate === undefined ? {} : { activationFunction: command.activate }) };
  const validated = resolveQcWeaponBehavior(module, program, declaration);
  if (validated.kind === "unsupported") throw new Error(validated.reason);
  if (document !== null) {
    const oldPath = document.artifactPath ?? (product.expectation.edition === "quakeworld" ? "qwprogs.dat" : "progs.dat");
    if (oldPath !== path && document.behaviors.some(entry => weaponBehaviorEntryId(entry) !== command.id))
      throw new Error("Cannot change the artifact for unrelated existing behavior declarations");
    await discoverQcWeaponBehaviors(content, module, program);
  }
  const retained = document?.behaviors.filter(entry => weaponBehaviorEntryId(entry) !== command.id) ?? [];
  const bytes = JSON.stringify({ version: 1, artifactPath: path, behaviors: [...retained, declaration] }, null, 2) + "\n";
  const directory = userProductDirectory(command.userContentRoot, product.expectation.contentDirectory);
  await mkdir(directory, { recursive: true });
  const destination = join(directory, "weapon-behaviors.json"), temporary = join(directory, `.weapon-behaviors-${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(bytes, "utf8"); await file.sync(); } finally { await file.close(); }
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
  print(`Saved ${command.id} to ${destination}\nSelect with --weapon-behavior ${product.expectation.id}/${command.id}\n`);
}
