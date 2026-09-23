import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareMountedQvmMod, prepareQvmMod } from "../../../src/app/bootstrap/simulation/qvm-mod.ts";
import { QvmOpcode } from "../../../src/compat/qvm/image.ts";
import { readQvmModCallbacks } from "../../../src/content/mods/qvm-callbacks.ts";
import { digestBytes, openMountPlan } from "../../../src/content/mounts/index.ts";
import { createMountIdentity } from "../../../src/contracts/content.ts";
import type { ModDescription } from "../../../src/contracts/mods.ts";
import type { QvmModCallbackDeclaration } from "../../../src/contracts/qvm-mod-callbacks.ts";
import type { QvmModPresentationDeclaration } from "../../../src/contracts/qvm-mod-presentation.ts";
import { BinaryWriter } from "../../../src/core/binary/index.ts";

function executable(value: number): Uint8Array {
  const code = new BinaryWriter(15);
  code.u8(QvmOpcode.OP_ENTER); code.i32(8);
  code.u8(QvmOpcode.OP_CONST); code.i32(value);
  code.u8(QvmOpcode.OP_LEAVE); code.i32(8);
  const instructions = code.finish(), output = new BinaryWriter(32 + instructions.length);
  for (const word of [0x12721444, 3, 32, instructions.length, 32 + instructions.length, 0, 0, 131072]) output.i32(word);
  output.bytes(instructions); return output.finish();
}
const program = executable(0), presentationProgram = executable(1);
const description: ModDescription = { selection: { product: "source", id: "presentation" },
  source: { provider: "q3:source", content: "q3:classic:source:test" }, title: "Source", sourceTitle: "Source",
  purpose: "addition", requires: [], conflicts: [], availability: { kind: "available" } };
const gameplay = { path: "vm/qagame.qvm", digest: digestBytes(program), abiProfile: "q3-modern" } satisfies QvmModPresentationDeclaration["gameplay"];
const presentation: QvmModPresentationDeclaration = { version: 1, runtime: "qvm-player-events", gameplay,
  cgame: { path: "vm/cgame.qvm", digest: digestBytes(presentationProgram), abiProfile: "q3-modern" },
  storage: { gameState: 0, playerState: 20104,
    snapshot: { kind: "synthetic-player-event", address: 22000, pointers: [81004] },
    centities: { address: 80000, stride: 256, capacity: 2, state: 0, origin: 220 }, time: [81000], frameTime: [], viewOrigin: [] },
  initialize: [{ entry: 0, arguments: [] }], refresh: [], project: [], frame: [], event: { entry: 0, arguments: [] } };
const declaration: QvmModCallbackDeclaration = { version: 1, runtime: "qvm", program: gameplay, abiProfile: "q3-modern",
  actorRecords: [], entityRecord: null, initialize: [], callbacks: [] };
const declarationDigest = digestBytes(new TextEncoder().encode(JSON.stringify({ ...declaration, presentation })));
function prepare(value: QvmModPresentationDeclaration = presentation) {
  return prepareQvmMod({ description, declaration: { ...declaration, presentation: value }, declarationDigest, program, presentationProgram });
}

test("inline source presentation prepares independently of the gameplay checkpoint identity", () => {
  const parsed = readQvmModCallbacks(new TextEncoder().encode(JSON.stringify({ ...declaration, presentation })));
  expect(parsed.presentation).toEqual(presentation);
  const prepared = prepareQvmMod({ description, declaration: parsed, declarationDigest, program, presentationProgram });
  expect(prepared.identity.modules).toHaveLength(1);
  expect(prepared.identity.modules[0]?.artifactPath).toBe(gameplay.path);
  expect(prepared.presentation?.source).toBe(prepared.identity.modules[0]);
  expect(prepared.presentation?.artifact.role).toBe("cgame");
  expect(prepared.presentation?.artifact.module.digest).toBe(presentation.cgame.digest);
  expect(prepared.presentation?.artifact.module.revision).toBe(declarationDigest);
  expect(prepared.presentation?.declaration).toBe(parsed.presentation);
  expect(prepareQvmMod({ description, declaration, declarationDigest, program }).presentation).toBeUndefined();
});

test("presentation admission requires explicit bytes, exact source identity, ABI and original caller layout", () => {
  expect(() => prepareQvmMod({ description, declaration: { ...declaration, presentation }, declarationDigest, program })).toThrow("requires its authored cgame bytes");
  expect(() => prepareQvmMod({ description, declaration, declarationDigest, program, presentationProgram })).toThrow("require a declaration");
  expect(() => prepareQvmMod({ description, declaration: { ...declaration, presentation }, declarationDigest, program,
    presentationProgram: executable(2) })).toThrow("bytes do not match");
  expect(() => prepare({ ...presentation, gameplay: { ...gameplay, path: "vm/other.qvm" } })).toThrow("declared gameplay/cgame artifacts");
  expect(() => prepare({ ...presentation, gameplay: { ...gameplay, digest: presentation.cgame.digest } })).toThrow("declared gameplay/cgame artifacts");
  expect(() => prepare({ ...presentation, gameplay: { ...gameplay, abiProfile: "q3-1.16n-base" } })).toThrow("gameplay ABI");
  expect(() => prepare({ ...presentation, cgame: { ...presentation.cgame, abiProfile: "q3-1.16n-base" } })).toThrow("matching player-state ABI");
  expect(() => prepare({ ...presentation, event: { entry: 1, arguments: [] } })).toThrow("original function entry");
  expect(() => prepare({ ...presentation, storage: { ...presentation.storage, gameState: 131072 } })).toThrow("original data image");
});

test("mounted preparation resolves cgame from the same component mounts and rejects missing or changed bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "qvm-component-presentation-"));
  try {
    await mkdir(join(root, "vm")); await writeFile(join(root, gameplay.path), program);
    const identity = createMountIdentity("mount:source:presentation", description.source.content, 0);
    using mounts = await openMountPlan({ id: "mount-plan:source:presentation", mounts: [{ kind: "loose", rootPath: root, identity }],
      defaultOrder: [identity.id], prefixOrders: [] });
    const options = { description, declaration: { ...declaration, presentation }, declarationDigest, mounts };
    await expect(prepareMountedQvmMod(options)).rejects.toThrow("presentation differs from its resolved artifact");
    await writeFile(join(root, presentation.cgame.path), presentationProgram);
    const prepared = await prepareMountedQvmMod(options);
    expect(prepared.presentation?.artifact.module.artifactPath).toBe(presentation.cgame.path);
    expect(prepared.identity.modules).toHaveLength(1);
    await writeFile(join(root, presentation.cgame.path), executable(2));
    await expect(prepareMountedQvmMod(options)).rejects.toThrow("presentation differs from its resolved artifact");
  } finally { await rm(root, { recursive: true, force: true }); }
});
