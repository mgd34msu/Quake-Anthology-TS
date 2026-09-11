import type { GameApiIdentity, GuestCheckpoint, GuestLayout, GuestPrivateState, GuestValueLayout, ModuleIdentity, NativeAbi, NativeCallAbi, SavedGuestCallbackBinding, SavedGuestCallbackReference } from "../contracts/execution.ts";
import { namespaced, SaveReader } from "./value.ts";
import { readDigest, readRandom } from "./shared.ts";

export function readModule(reader: SaveReader): ModuleIdentity { return { id: namespaced(reader.field("id")), artifactPath: reader.field("artifactPath").string(), digest: readDigest(reader.field("digest")), revision: reader.field("revision").string() }; }
export function readApi(reader: SaveReader): GameApiIdentity {
  switch (reader.field("kind").choice("q1-netquake", "q1-quakeworld", "q2-classic-game", "q2-rerelease-game", "q2-rerelease-cgame", "q3-qagame", "q3-cgame", "q3-ui")) {
    case "q1-netquake": return { kind: "q1-netquake", programVersion: reader.field("programVersion").literal(6), systemCrc: reader.field("systemCrc").literal(5927) };
    case "q1-quakeworld": return { kind: "q1-quakeworld", programVersion: reader.field("programVersion").literal(6), systemCrc: reader.field("systemCrc").literal(54730) };
    case "q2-classic-game": return { kind: "q2-classic-game", version: reader.field("version").literal(3) };
    case "q2-rerelease-game": return { kind: "q2-rerelease-game", version: reader.field("version").literal(2023) };
    case "q2-rerelease-cgame": return { kind: "q2-rerelease-cgame", version: reader.field("version").literal(2022) };
    case "q3-qagame": return { kind: "q3-qagame", version: reader.field("version").literal(8) };
    case "q3-cgame": return { kind: "q3-cgame", version: reader.field("version").literal(4) };
    case "q3-ui": return { kind: "q3-ui", version: reader.field("version").choice(4, 6) };
  }
}
export function readNativeCallAbi(reader: SaveReader): NativeCallAbi {
  switch (reader.field("kind").choice("windows-i386", "windows-x86-64", "linux-i386", "linux-x86-64")) {
    case "windows-i386": return { kind: "windows-i386", image: reader.field("image").literal("pe32"), pointerBytes: reader.field("pointerBytes").literal(4), call: reader.field("call").choice("cdecl", "stdcall", "thiscall", "fastcall") };
    case "windows-x86-64": return { kind: "windows-x86-64", image: reader.field("image").literal("pe32+"), pointerBytes: reader.field("pointerBytes").literal(8), call: reader.field("call").literal("microsoft-x64") };
    case "linux-i386": return { kind: "linux-i386", image: reader.field("image").literal("elf32"), pointerBytes: reader.field("pointerBytes").literal(4), call: reader.field("call").literal("system-v-i386") };
    case "linux-x86-64": return { kind: "linux-x86-64", image: reader.field("image").literal("elf64"), pointerBytes: reader.field("pointerBytes").literal(8), call: reader.field("call").literal("system-v-x86-64") };
  }
}
export function readNativeAbi(reader: SaveReader): NativeAbi {
  const abi = readNativeCallAbi(reader);
  if (abi.kind === "windows-i386") {
    if (abi.call !== "cdecl") return reader.fail("module entry requires cdecl");
    return { ...abi, call: "cdecl" };
  }
  return abi;
}
function readStorage(reader: SaveReader): GuestValueLayout & { readonly kind: "scalar" } {
  return { kind: "scalar", storage: reader.choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64", "pointer") };
}
export function readLayout(reader: SaveReader): GuestLayout {
  return { id: namespaced(reader.field("id")), byteLength: reader.field("byteLength").integer(0), alignment: reader.field("alignment").integer(1),
    pointerBytes: reader.field("pointerBytes").choice(4, 8), byteOrder: reader.field("byteOrder").literal("little-endian"), fields: reader.field("fields").list(field => ({
      name: field.field("name").string(), byteOffset: field.field("byteOffset").integer(0), storage: readStorage(field.field("storage")).storage, count: field.field("count").integer(0) })) };
}
function readValueLayout(reader: SaveReader): GuestValueLayout {
  return reader.field("kind").choice("scalar", "aggregate") === "scalar" ? readStorage(reader.field("storage")) : { kind: "aggregate", layout: readLayout(reader.field("layout")) };
}
function readCallbackReference(reader: SaveReader): SavedGuestCallbackReference {
  switch (reader.field("kind").choice("typescript", "quakec", "qvm", "native-guest")) {
    case "typescript": return { kind: "typescript", provider: namespaced(reader.field("provider")), callback: namespaced(reader.field("callback")) };
    case "quakec": return { kind: "quakec", module: readModule(reader.field("module")), functionIndex: reader.field("functionIndex").integer(0) };
    case "qvm": return { kind: "qvm", module: readModule(reader.field("module")), instructionIndex: reader.field("instructionIndex").integer(0) };
    case "native-guest": return { kind: "native-guest", module: readModule(reader.field("module")), byteOffset: reader.field("byteOffset").bigint(), abi: readNativeCallAbi(reader.field("abi")) };
  }
}
function readCallback(reader: SaveReader): SavedGuestCallbackBinding {
  return { id: namespaced(reader.field("id")), reference: readCallbackReference(reader.field("reference")), parameters: reader.field("parameters").list(readValueLayout),
    result: reader.field("result").value === "void" ? "void" : readValueLayout(reader.field("result")) };
}
function readPrivate(reader: SaveReader): GuestPrivateState { return { module: readModule(reader.field("module")), format: namespaced(reader.field("format")), bytes: reader.field("bytes").bytes() }; }
export function readGuest(reader: SaveReader): GuestCheckpoint {
  const common = { module: readModule(reader.field("module")), random: reader.field("random").list(readRandom), callbacks: reader.field("callbacks").list(readCallback) };
  switch (reader.field("kind").choice("typescript", "quakec", "qvm", "native-guest")) {
    case "typescript": return { ...common, kind: "typescript", api: readApi(reader.field("api")), state: readPrivate(reader.field("state")) };
    case "quakec": {
      const api = readApi(reader.field("api"));
      if (api.kind !== "q1-netquake" && api.kind !== "q1-quakeworld") return reader.fail("QuakeC checkpoint requires a Q1 API");
      return { ...common, kind: "quakec", api, globals: reader.field("globals").bytes(), entities: reader.field("entities").bytes(), entityStrideBytes: reader.field("entityStrideBytes").integer(1),
        entityCount: reader.field("entityCount").integer(0), strings: reader.field("strings").bytes(), statement: reader.field("statement").integer(), functionIndex: reader.field("functionIndex").integer(0),
        argumentCount: reader.field("argumentCount").integer(0), callStack: reader.field("callStack").list(frame => ({ statement: frame.field("statement").integer(), functionIndex: frame.field("functionIndex").integer(0) })),
        locals: reader.field("locals").bytes(), hostState: readPrivate(reader.field("hostState")) };
    }
    case "qvm": {
      const api = readApi(reader.field("api"));
      if (api.kind !== "q3-qagame" && api.kind !== "q3-cgame" && api.kind !== "q3-ui") return reader.fail("QVM checkpoint requires a Q3 API");
      return { ...common, kind: "qvm", api, data: reader.field("data").bytes(), instructionIndex: reader.field("instructionIndex").integer(), programStack: reader.field("programStack").integer(0),
        operandStack: reader.field("operandStack").list(value => value.integer()), hostState: readPrivate(reader.field("hostState")) };
    }
    case "native-guest": return { ...common, kind: "native-guest", abi: readNativeAbi(reader.field("abi")), regions: reader.field("regions").list(region => ({
      base: region.field("base").bigint(), permissions: region.field("permissions").choice("read", "read-write", "read-execute", "read-write-execute"), bytes: region.field("bytes").bytes() })),
      processorLayout: readLayout(reader.field("processorLayout")), processorState: reader.field("processorState").bytes(), runtimeState: readPrivate(reader.field("runtimeState")) };
  }
}
