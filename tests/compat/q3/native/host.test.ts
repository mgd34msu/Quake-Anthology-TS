// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openMountPlan } from "../../../../src/content/mounts/index.ts";
import { createMountIdentity } from "../../../../src/contracts/content.ts";
import type { ResolvedExecutionModule } from "../../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import { prepareQ3Native, Q3NativeGuestSource } from "../../../../src/app/bootstrap/simulation/q3/native-guest-source.ts";
import type { NativeQ3GameServices } from "../../../../src/compat/q3/native/index.ts";
import { qvmClientGameSyscall } from "../../../../src/compat/qvm/client-game-syscalls.ts";
import { qvmCommonSyscall } from "../../../../src/compat/qvm/common-syscalls.ts";
import { qvmServerInformationSyscall } from "../../../../src/compat/qvm/server-info-syscalls.ts";
import { rejectQvmSyscall } from "../../../../src/compat/qvm/syscalls.ts";
import { CodeBuilder, SYNTHETIC_ELF, syntheticElfModule } from "../../../support/elf-modules.ts";
import { authoredQ3Pe, Q3_DATA, Q3_ENTITIES, Q3_ENTITY_STRIDE, Q3_MODULE_BASE } from "../../../support/q3-modules.ts";
import { trackedTempDirectories } from "../../../support/temp-directories.ts";
import { runGuestModule } from "../../../../tools/check-guest-module.ts";

const tempDirectory = trackedTempDirectories();
type NativeExecution = Extract<ResolvedExecutionModule, { readonly kind: "native" }>;

interface Harness { readonly source: Q3NativeGuestSource; readonly events: string[]; readonly cvars: CvarRegistry; readonly configstrings: Map<number, string>; arguments: readonly string[]; close(): Promise<void> }

/** Mounts the module bytes, admits them as the selected native server game, and boots the host with recording engine services. */
async function host(bytes: Uint8Array, name: string, profile: NativeExecution["profile"]): Promise<Harness> {
  const directory = await tempDirectory("native-q3-host-");
  await writeFile(join(directory, name), bytes);
  const identity = createMountIdentity("mount:test:native-q3", "q3:native:synthetic:installed", 1);
  const mounts = await openMountPlan({ id: "mount-plan:test:native-q3", mounts: [{ kind: "loose", identity, rootPath: directory }], defaultOrder: [identity.id], prefixOrders: [] });
  try {
    const artifact = await mounts.open(name);
    if (artifact === null) throw new Error("Synthetic Q3 module was not mounted");
    const execution: NativeExecution = { kind: "native", owner: { provider: "q3:native-test", content: identity.content }, role: "server-game", api: { kind: "q3-qagame", version: 8 }, profile, artifact: artifact.reference };
    const prepared = await prepareQ3Native(execution, mounts);
    const events: string[] = [], configstrings = new Map<number, string>(), arguments_ = { current: [] as readonly string[] };
    const cvars = new CvarRegistry({ dialect: "q3", context: { session: createIdentityOwner("native-q3-host").session, origin: { kind: "server-console" } }, print: text => events.push(text) });
    const services: NativeQ3GameServices = { cvars, commandArguments: () => arguments_.current, milliseconds: () => 12345,
      configstrings: { get: index => configstrings.get(index) ?? "", set: (index, value) => { configstrings.set(index, value); } },
      engine: { print: text => events.push(text), log: text => events.push(`log:${text}`), appendConsoleCommand: text => events.push(`append:${text}`), executeConsoleNow: text => events.push(`now:${text}`),
        sendServerCommand: (client, text) => events.push(`${client}:${text}`), dropClient: () => { throw new Error("No admitted client"); }, getUserinfo: () => { throw new Error("No admitted client"); },
        setUserinfo: () => { throw new Error("No admitted client"); }, getUserCommand: () => { throw new Error("No admitted client"); } } };
    // The shared server trap table's handlers, over recording services: the module's traps decode exactly as an interpreted module's do.
    const common = { role: "qagame" as const, cvars, print: (text: string) => events.push(text), milliseconds: () => 12345, arguments: () => arguments_.current, realTime: () => 0,
      commands: { executeNow: (text: string | null) => { events.push(`now:${text ?? ""}`); }, insert: (text: string) => { events.push(`insert:${text}`); }, append: (text: string) => { events.push(`append:${text}`); } } };
    const client = { abiProfile: "q3-modern" as const, maxClients: 4, getUserinfo: () => "", setUserinfo: () => undefined, getUserCommand: () => ({ serverTime: 0, angles: [0, 0, 0] as [number, number, number], buttons: 0, weapon: 0, forwardmove: 0, rightmove: 0, upmove: 0 }),
      dropClient: async () => undefined, sendServerCommand: (slot: number, text: string) => { events.push(`${slot}:${text}`); } };
    const traps: Parameters<typeof Q3NativeGuestSource.create>[0]["traps"] = call => qvmCommonSyscall(call, common) ?? qvmClientGameSyscall(call, client)
      ?? qvmServerInformationSyscall(call, { abiProfile: "q3-modern", cvars, configstrings: services.configstrings }) ?? rejectQvmSyscall(call);
    const source = Q3NativeGuestSource.create({ prepared, services, traps, instructionBudget: 2_000_000 });
    return { source, events, cvars, configstrings, get arguments() { return arguments_.current; }, set arguments(value) { arguments_.current = value; }, close: async () => { try { await source.close(); } finally { await mounts.close(); } } };
  } catch (error) { await mounts.close(); throw error; }
}

test("a native Q3 1.32 PE module runs GAME_INIT, frames, console commands and connects through the shared trap table", async () => {
  const bytes = authoredQ3Pe();
  const harness = await host(bytes, "qagamex86.dll", { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" });
  const { source, events, cvars, configstrings } = harness;
  try {
    expect(source.profile).toBe("q3-pe");
    const word = (offset: number) => { const address = source.memory.pointer(BigInt(Q3_MODULE_BASE + 0x3000 + offset)); if (address === null) throw new Error("image is not mapped"); return address; };
    await expect(source.runFrameAsync(1)).rejects.toThrow("has not run GAME_INIT");
    await source.initializeAsync(1000, 7);
    // Traps reach the engine services with decoded guest strings and records.
    expect(events).toContain("hello from the Q3 test module\n");
    expect(source.memory.readInt32(word(Q3_DATA.levelTime))).toBe(1000);
    expect(cvars.variableString("g_synthetic")).toBe("42");
    expect(source.memory.readInt32(word(Q3_DATA.cvar + 12))).toBe(42);
    expect(configstrings.get(3)).toBe("synthetic");
    // G_LOCATE_GAME_DATA registered the module's own tables, which the server reads through the shared record view.
    expect(source.data.numEntities).toBe(Q3_ENTITIES); expect(source.data.entityStrideBytes).toBe(Q3_ENTITY_STRIDE);
    expect(source.data.numberFromPointer(Q3_MODULE_BASE + 0x3000 + Q3_DATA.entities + 3 * Q3_ENTITY_STRIDE)).toBe(3);
    expect(() => source.data.numberFromPointer(Q3_MODULE_BASE + 0x3000 + Q3_DATA.entities + 8)).toThrow();
    await expect(source.initializeAsync(1000, 7)).rejects.toThrow("fresh game");

    // A cvar changed by the engine reaches the module's record at the next trap_Cvar_Update.
    cvars.set("g_synthetic", "77", true); await source.runFrameAsync(1100);
    expect(source.memory.readInt32(word(Q3_DATA.frameTime))).toBe(1100);
    expect(source.data.entity(0).s.time).toBe(1100);

    // trap_Argc and trap_Argv read the call's own arguments.
    expect(await source.consoleCommandAsync(["give", "all"])).toBe(true);
    expect(events).toContain("all");
    expect(await source.consoleCommandAsync(["quit"])).toBe(false);

    // ClientConnect returns a pointer to a guest string, or null.
    expect(await source.clientConnectAsync(3, true, false)).toBe("denied by the Q3 test module");
    expect(await source.clientConnectAsync(1, true, false)).toBeNull();
    expect(source.data.copyPlayerState(1).clientNumber).toBe(1);

    // A trap the table cannot serve fails explicitly instead of returning success.
    await expect(source.clientBeginAsync(1)).rejects.toThrow("Unbound qagame QVM syscall");
  } finally { await harness.close(); }
  expect(events.at(-1)).toBe("bye\n");
  expect(source.memory.mappings()).toHaveLength(0);
  await expect(source.runFrameAsync(1)).rejects.toThrow("closed");
});

test("native Q3 admission refuses artifacts that are not an i386 PE or an ELF image", async () => {
  const bytes = new Uint8Array(64);
  await expect(host(bytes, "bad.dll", { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" })).rejects.toThrow("Windows PE or a Linux ELF");
});

// ---- A Quake Live API 10 x86-64 ELF: the same host, the other profile. ----
const ql = { table: SYNTHETIC_ELF.data, imports: SYNTHETIC_ELF.data + 0x80, time: SYNTHETIC_ELF.data + 0x90, text: SYNTHETIC_ELF.data + 0xc0 } as const;
function quakeLiveElf(): Uint8Array {
  const c = new CodeBuilder(), table: Record<string, number> = {};
  const fn = (name: string): void => { table[name] = c.mark(name); };
  fn("Shutdown"); c.raw(0xc3);
  fn("RunFrame"); c.raw(0x89, 0x3d).rip(ql.time).raw(0xc3);
  fn("RegisterCvars"); c.raw(0x48, 0x83, 0xec, 0x08, 0x48, 0x8d, 0x3d).rip(ql.text).raw(0x48, 0x8b, 0x05).rip(ql.imports).raw(0xff, 0x90).u32(2 * 8).raw(0x48, 0x83, 0xc4, 0x08, 0xc3);
  fn("Init"); c.raw(0x89, 0x3d).rip(ql.time).raw(0xc3);
  fn("ConsoleCommand"); c.raw(0x48, 0x83, 0xec, 0x08, 0x48, 0x8b, 0x05).rip(ql.imports).raw(0xff, 0x90).u32(20 * 8).raw(0x48, 0x83, 0xc4, 0x08, 0xc3);
  // ClientBegin, ClientCommand, ClientThink, ClientConnect, ClientUserinfoChanged and ClientDisconnect each report their client number as a server command.
  const clientExports = ["ClientBegin", "ClientCommand", "ClientThink", "ClientConnect", "ClientUserinfoChanged", "ClientDisconnect"];
  clientExports.forEach((name, index) => {
    fn(name);
    if (name === "ClientConnect") { c.raw(0x31, 0xc0, 0xc3); return; }
    c.raw(0x48, 0x83, 0xec, 0x08, 0x48, 0x8d, 0x35).rip(ql.text + 0x30 * (index + 1)).raw(0x48, 0x8b, 0x05).rip(ql.imports).raw(0xff, 0x90).u32(24 * 8).raw(0x48, 0x83, 0xc4, 0x08, 0xc3);
  });
  const slots = ["Shutdown", "RunFrame", "RegisterCvars", "Init", "ConsoleCommand", "ClientBegin", "ClientCommand", "ClientThink", "ClientConnect", "ClientUserinfoChanged", "ClientDisconnect"];
  // dllEntry builds the eleven-word export table itself: the synthetic ELF's relocation area holds only eight entries.
  fn("dllEntry");
  c.raw(0xc7, 0x02).u32(10).raw(0x48, 0x8d, 0x05).rip(ql.table).raw(0x48, 0x89, 0x07).raw(0x48, 0x89, 0x35).rip(ql.imports);
  slots.forEach((name, index) => { c.raw(0x48, 0x8d, 0x05).rip(SYNTHETIC_ELF.code + c.offsetOf(name)).raw(0x48, 0x89, 0x05).rip(ql.table + index * 8); });
  c.raw(0xc3);
  const bytes = syntheticElfModule({ width: 8, code: c.finish(), exports: [{ name: "dllEntry", offset: table["dllEntry"] ?? 0 }] });
  bytes.set(new TextEncoder().encode("hello from the synthetic Quake Live module\0"), ql.text);
  clientExports.forEach((name, index) => bytes.set(new TextEncoder().encode(`${name}\0`), ql.text + 0x30 * (index + 1)));
  return bytes;
}

test("a native Quake Live ELF module runs through the same host and engine services", async () => {
  const bytes = quakeLiveElf();
  const harness = await host(bytes, "qagamex64.so", { kind: "linux-x86-64", image: "elf64", pointerBytes: 8, call: "system-v-x86-64" });
  const { source, events } = harness;
  try {
    expect(source.profile).toBe("quake-live-elf");
    await source.initializeAsync(500, 3);
    expect(events).toContain("hello from the synthetic Quake Live module");
    await source.runFrameAsync(750);
    harness.arguments = ["say", "hi"];
    expect(await source.consoleCommandAsync(["say", "hi"])).toBe(true);
    expect(await source.consoleCommandAsync([])).toBe(false);
    expect(await source.clientConnectAsync(2, true, false)).toBeNull();
    events.length = 0;
    await source.clientBeginAsync(1);
    harness.arguments = ["team", "red"];
    await source.clientCommandAsync(2, ["team", "red"]);
    source.clientCommand(2, ["team", "blue"]);
    await source.clientThinkAsync(3);
    await source.clientUserinfoChangedAsync(1);
    await source.clientDisconnectAsync(3);
    await source.botFrameAsync(800);
    expect(events).toEqual(["1:ClientBegin", "2:ClientCommand", "2:ClientCommand", "3:ClientThink", "1:ClientUserinfoChanged", "3:ClientDisconnect"]);
    expect(source.coverage.map(call => call.name)).toEqual(expect.arrayContaining(["Printf", "Argc"]));
  } finally { await harness.close(); }
});

test("the module check tool boots a native module through the game host and reports its output or its first failing service", async () => {
  const pe = await runGuestModule(authoredQ3Pe(), "qagamex86.dll");
  expect(pe).toEqual({ profile: "q3-pe", outcome: "ok", output: ["hello from the Q3 test module\n", "bye\n"], detail: null });
  const elf = await runGuestModule(quakeLiveElf(), "qagamex64.so");
  expect(elf.profile).toBe("quake-live-elf"); expect(elf.outcome).toBe("ok"); expect(elf.output).toEqual(["hello from the synthetic Quake Live module"]);
  const refused = await runGuestModule(new Uint8Array(64), "junk.bin");
  expect(refused.outcome).toBe("failed"); expect(refused.profile).toBeNull(); expect(refused.detail).toContain("Windows PE or a Linux ELF");
});
