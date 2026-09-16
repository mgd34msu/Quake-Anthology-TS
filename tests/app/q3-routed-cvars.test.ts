import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarFlag, CvarRegistry, Q2CvarFlag } from "../../src/core/cvars/index.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { ApplicationConsoleRouting } from "../../src/app/bootstrap/console.ts";
import { Q3ClientCvars } from "../../src/app/bootstrap/q3-client/cvars.ts";
import { QvmUiImport } from "../../src/compat/qvm/abi.ts";
import { QvmMemory } from "../../src/compat/qvm/memory.ts";
import { qvmCommonSyscall } from "../../src/compat/qvm/common-syscalls.ts";
import type { QvmHostCall } from "../../src/compat/qvm/syscalls.ts";
import type { CommandDialect } from "../../src/contracts/common.ts";

for (const dialect of ["q1-netquake", "q2-classic", "q3"] satisfies readonly CommandDialect[]) test(`Q3 guest cvars route through ${dialect} shared owner before and after publication`, () => {
  const id = createIdentityOwner("routed-guest");
  const context = { session: id.session, origin: { kind: "local-seat", seat: id.seat(0), client: id.client(0, 0) } } satisfies CvarRegistry["context"];
  const live = new CvarRegistry({ dialect, context }), staged = new CvarRegistry({ dialect, context });
  for (const owner of [live, staged]) {
    owner.register("r_gamma", "2", CvarFlag.Archive);
    owner.registerAlias({ name: "brightness", target: "r_gamma", documentation: { summary: "Inverse gamma", usage: "brightness", examples: [] },
      conversion: { kind: "converted", read: value => String(1 / Number(value)), write: value => ({ kind: "value", value: String(1 / Number(value)) }) } });
  }
  const transfer = live.prepareTransfer(staged);
  const seat = new CvarRegistry({ dialect: "q3", context });
  let shared = staged;
  const routing = new ApplicationConsoleRouting({ fallback: seat, sourceDialect: () => "q3", server: () => null,
    seat: () => seat, shared: () => shared });
  const service = new Q3ClientCvars({ owner: name => routing.owner(name, context), visible: () => routing.visible(context),
    current: owner => owner === staged ? shared : owner, print: () => {} });
  const commands = new CommandBuffer({ dialect: "q3", context, cvars: seat, cvarRouting: routing });
  const guest = new QvmMemory(new Uint8Array(4096));
  const call = (code: QvmUiImport, args: readonly number[]): number | Promise<number> | null => {
    const words = new DataView(new ArrayBuffer(4 * (args.length + 1))); words.setInt32(0, code, true);
    args.forEach((value, index) => words.setInt32(4 * (index + 1), value, true));
    const request: QvmHostCall = { kind: "engine", role: "ui", code, guest, words, memory: guest.bytes, commandArguments: null,
      invoke: () => { throw new Error("Unexpected invocation"); }, invokeAsync: async () => { throw new Error("Unexpected invocation"); } };
    return qvmCommonSyscall(request, { role: "ui", cvars: service, print: () => {}, milliseconds: () => 0, arguments: () => [], commands: {
      executeNow: text => { commands.executeNow(text); }, insert: text => commands.insert(text), append: text => commands.append(text) } });
  };
  guest.writeString(128, "brightness", 64); guest.writeString(256, "0.5", 64);
  expect(call(QvmUiImport.UI_CVAR_REGISTER, [1024, 128, 256, CvarFlag.Cheat])).toBe(0);
  const aliasHandle = guest.view(1024, 272).getInt32(0, true);
  for (const flags of [CvarFlag.UserInfo, CvarFlag.ServerInfo, CvarFlag.SystemInfo]) {
    expect(() => call(QvmUiImport.UI_CVAR_REGISTER, [1536, 128, 256, flags])).toThrow("explicit protocol info-key mapping");
    expect(() => call(QvmUiImport.UI_CVAR_CREATE, [128, 256, flags])).toThrow("explicit protocol info-key mapping");
  }
  expect(call(QvmUiImport.UI_CVAR_REGISTER, [1536, 128, 256, CvarFlag.Cheat])).toBe(0);
  expect(guest.view(1536, 272).getInt32(0, true)).toBe(aliasHandle);
  guest.writeString(320, "guest_private", 64); guest.writeString(384, "7", 64);
  expect(call(QvmUiImport.UI_CVAR_REGISTER, [2048, 320, 384, 0])).toBe(0);
  expect(guest.view(2048, 272).getInt32(0, true)).not.toBe(aliasHandle);
  guest.writeString(512, "brightness 0.25", 64);
  expect(call(QvmUiImport.UI_CMD_EXECUTETEXT, [0, 512])).toBe(0);
  expect(call(QvmUiImport.UI_CVAR_VARIABLESTRINGBUFFER, [128, 768, 64])).toBe(0);
  expect(guest.readString(768)).toBe("0.25");
  expect(call(QvmUiImport.UI_CVAR_UPDATE, [1024])).toBe(0);
  expect(guest.readString(1040)).toBe("0.25");
  expect(live.variableString("r_gamma")).toBe("2");
  expect(seat.variableString("r_gamma")).toBe("");
  expect(staged.find("r_gamma")?.flags).toBe(CvarFlag.Archive);
  transfer.publish(); shared = live;
  guest.writeString(256, "0.125", 64);
  expect(call(QvmUiImport.UI_CVAR_SET, [128, 256])).toBe(0);
  expect(call(QvmUiImport.UI_CVAR_UPDATE, [1024])).toBe(0);
  expect(guest.readString(1040)).toBe("0.125");
  expect(live.variableString("r_gamma")).toBe("8");
  expect(staged.variableString("r_gamma")).toBe("4");
  expect(service.readVm(guest.view(2048, 272).getInt32(0, true))?.value).toBe("7");
});

test("routed info strings use canonical ownership and foreign info flag meaning", () => {
  const context = { session: createIdentityOwner("routed-info").session, origin: { kind: "local-console" } } satisfies CvarRegistry["context"];
  const shared = new CvarRegistry({ dialect: "q2-classic", context }), seat = new CvarRegistry({ dialect: "q3", context });
  shared.register("duplicate", "shared", Q2CvarFlag.ServerInfo);
  shared.register("protected", "hidden", Q2CvarFlag.NoSet);
  shared.register("private", "secret", Q2CvarFlag.ServerInfo | Q2CvarFlag.Private);
  seat.register("duplicate", "seat", CvarFlag.ServerInfo);
  const service = new Q3ClientCvars({ owner: name => shared.find(name) === undefined ? seat : shared,
    visible: () => [shared, seat], current: owner => owner, print: () => {} });
  expect(service.infoString(CvarFlag.ServerInfo)).toBe("\\duplicate\\shared");
  expect(service.infoString(CvarFlag.SystemInfo)).toBe("");
});
