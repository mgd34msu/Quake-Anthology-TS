import type { NativeWeaponBehaviorDeclaration } from "../../contracts/native-weapon-behavior.ts";
import { discoverNativeWeaponBehaviors, loadNativeWeaponBehavior, readNativeWeaponBehaviorDocument } from "../../content/catalog/native-weapon-behaviors.ts";
import { parsePe } from "../../guest/pe/index.ts";
import { discoverQvmWeaponBehaviors, loadQvmWeaponBehavior, readQvmWeaponBehaviorDocument } from "../../content/catalog/qvm-weapon-behaviors.ts";
import { parseQvm, QvmOpcode } from "../../compat/qvm/image.ts";
import { SaveReader } from "../../persistence/value.ts";
import type { MountedContent } from "../../content/mounts/index.ts";
import type { ProviderId } from "../../contracts/identity.ts";
import type { CatalogProduct } from "../../content/catalog/index.ts";
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
  if (product.expectation.family === "q2" && product.expectation.edition !== "rerelease")
    throw new Error("Native weapon declarations currently require the Q2 rerelease API2023 Windows x64 adapter");
  const mounts = await catalog.mountsFor(product.id);
  using content = await openMountPlan({ id: createMountPlanId("weapon-authoring", Buffer.from(product.id).toString("hex")), mounts,
    defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
  if (product.expectation.family === "q2") { await runNativeBehaviorTool(command, product, content, print); return; }
  if (product.expectation.family === "q3") { await runQvmBehaviorTool(command,product,content,print); return; }
  if (command.action === "declare-qvm" || command.action === "declare-native") throw new Error(`${command.action} requires its matching Q3 or Q2 rerelease provider`);
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
  const destination = await writeBehaviorDocument(directory,"weapon-behaviors.json",bytes);
  print(`Saved ${command.id} to ${destination}\nSelect with --weapon-behavior ${product.expectation.id}/${command.id}\n`);
}

async function writeBehaviorDocument(directory: string, name: string, bytes: string): Promise<string> {
  await mkdir(directory,{recursive:true});
  const destination=join(directory,name),temporary=join(directory,`.weapon-behaviors-${randomUUID()}.tmp`);
  try {
    const file=await open(temporary,"wx",0o600);
    try {await file.writeFile(bytes,"utf8");await file.sync();} finally {await file.close();}
    await rename(temporary,destination);
  } finally {await rm(temporary,{force:true});}
  return destination;
}
async function runQvmBehaviorTool(command: Exclude<WeaponBehaviorToolCommand,{readonly action:"help"}>, product: CatalogProduct,
  content: MountedContent, print:(text:string)=>void): Promise<void> {
  const provider: ProviderId = `weapon-behavior:${product.id}`;
  if(command.action === "inspect") {
    const path=command.artifact ?? "vm/qagame.qvm",opened=await content.open(path);
    if(opened === null)throw new Error(`Mounted QVM artifact is missing: ${path}`);
    const image=parseQvm(opened.bytes,path),declarations=await discoverQvmWeaponBehaviors(content,provider);
    print(JSON.stringify({product:product.expectation.id,artifact:path,digest:opened.reference.digest,
      scope:"Instruction entries are exact bytecode boundaries, not inferred symbols or trajectory features. Author-declared ABI and private layout are required.",
      instructionCount:image.instructions.length,dataBytes:image.dataLength+image.literalLength+image.bssLength,
      entries:image.instructions.flatMap((instruction,index)=>instruction.opcode === QvmOpcode.OP_ENTER ? [{instructionIndex:index}] : []),
      declared:declarations?.map(entry=>({id:entry.profile.definition.id,artifact:entry.resource.requestedPath,digest:entry.resource.digest})) ?? []},null,2)+"\n");
    return;
  }
  if(command.action !== "declare-qvm")throw new Error("QVM declarations require declare-qvm --profile MOUNTED_PROFILE_JSON; function names alone do not establish a private layout");
  const opened=await content.open(command.profile);if(opened === null)throw new Error(`Mounted QVM author profile is missing: ${command.profile}`);
  const declaration:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(opened.bytes));
  const entry=await loadQvmWeaponBehavior(content,provider,declaration);
  if(command.artifact !== undefined && command.artifact !== entry.resource.requestedPath)throw new Error("--artifact differs from the authored QVM profile");
  const existing=await content.open("qvm-weapon-behaviors.json"),retained:unknown[]=[];
  for(const old of existing === null ? [] : readQvmWeaponBehaviorDocument(existing.bytes)) {
    if(`qvm:${new SaveReader(old,"profile").field("id").string()}` === entry.profile.definition.id)continue;
    await loadQvmWeaponBehavior(content,provider,old);retained.push(old);
  }
  const directory=userProductDirectory(command.userContentRoot,product.expectation.contentDirectory);
  const destination=await writeBehaviorDocument(directory,"qvm-weapon-behaviors.json",JSON.stringify({version:1,profiles:[...retained,declaration]},null,2)+"\n");
  print(`Saved ${entry.profile.definition.id} to ${destination}\nSelect with --weapon-behavior ${product.expectation.id}/${entry.profile.definition.id}\n`);
}

async function runNativeBehaviorTool(command: Exclude<WeaponBehaviorToolCommand, { readonly action: "help" }>, product: CatalogProduct,
  content: MountedContent, print: (text: string) => void): Promise<void> {
  const provider: ProviderId = `weapon-behavior:${product.id}`;
  if (command.action === "inspect") {
    const declarations = await discoverNativeWeaponBehaviors(content, provider);
    const path = command.artifact ?? declarations?.[0]?.resource.requestedPath ?? "game_x64.dll", opened = await content.open(path);
    if (opened === null) throw new Error(`Mounted native artifact is missing: ${path}`);
    const image = parsePe(opened.bytes);
    print(JSON.stringify({ product: product.expectation.id, artifact: path, digest: opened.reference.digest, abi: image.abi.kind,
      scope: "PE sections identify image ranges only. Private weapon layout, callback signatures and provisioning require an explicit source-backed declaration pinned to this artifact.",
      entryPointRva: image.entryPointRva, sections: image.sections.map(section => ({ name: section.name, rva: section.rva, byteLength: section.mappedSize, permissions: section.permissions })),
      declared: declarations?.map(entry => entry.declaration) ?? [] }, null, 2) + "\n");
    return;
  }
  if (command.action !== "declare-native") throw new Error("Native declarations require declare-native --profile MOUNTED_PROFILE_JSON");
  const opened = await content.open(command.profile);
  if (opened === null) throw new Error(`Mounted native author profile is missing: ${command.profile}`);
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(opened.bytes));
  const entry = await loadNativeWeaponBehavior(content, provider, value);
  if (command.artifact !== undefined && command.artifact !== entry.resource.requestedPath) throw new Error("--artifact differs from the authored native profile");
  const existing = await content.open("native-weapon-behaviors.json"), retained: NativeWeaponBehaviorDeclaration[] = [];
  for (const old of existing === null ? [] : readNativeWeaponBehaviorDocument(existing.bytes)) {
    if (new SaveReader(old, "native-profile").field("id").string() === entry.definition.id) continue;
    retained.push((await loadNativeWeaponBehavior(content, provider, old)).declaration);
  }
  const directory = userProductDirectory(command.userContentRoot, product.expectation.contentDirectory);
  const destination = await writeBehaviorDocument(directory, "native-weapon-behaviors.json", JSON.stringify({ version: 1, profiles: [...retained, entry.declaration] }, null, 2) + "\n");
  print(`Saved ${entry.definition.id} to ${destination}\nSelect with --weapon-behavior ${product.expectation.id}/${entry.definition.id}\n`);
}
