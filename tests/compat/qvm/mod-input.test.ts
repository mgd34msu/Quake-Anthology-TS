import { expect, test } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { digestBytes } from "../../../src/content/mounts/index.ts";
import { QvmModule, QvmOpcode, rejectQvmSyscall, resolveQvmArtifact } from "../../../src/compat/qvm/index.ts";
import { QvmModInput } from "../../../src/compat/qvm/mod-input.ts";
import { readQvmPlayerState } from "../../../src/compat/qvm/player-record.ts";
import { writeQvmUserCommand } from "../../../src/compat/qvm/client-state-record.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { QvmModInputOutput } from "../../../src/contracts/qvm-mod-callbacks.ts";
import { ModClientApplications } from "../../../src/world/session/mod-client-applications.ts";

interface FixtureOptions {
  readonly fieldAddress?: number; readonly returnWord?: number;
  readonly returns?: { readonly encoding: "int32" | "float32"; readonly value: number };
  readonly outer?: { readonly up?: number };
}
function fixture(options: FixtureOptions = {}) {
  const inner: readonly (readonly [QvmOpcode, number?])[] = [
    [QvmOpcode.OP_ENTER, 0], [QvmOpcode.OP_CONST, options.fieldAddress ?? 64], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_LOCAL, 8], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_CONST, 23], [QvmOpcode.OP_ADD],
    [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_STORE1], [QvmOpcode.OP_CONST, options.returnWord ?? 1], [QvmOpcode.OP_LEAVE, 0],
  ];
  const outer: (readonly [QvmOpcode, number?])[] = options.outer === undefined ? [] : [[QvmOpcode.OP_ENTER, 0]];
  if (options.outer?.up !== undefined) outer.push([QvmOpcode.OP_CONST, 1047], [QvmOpcode.OP_CONST, options.outer.up], [QvmOpcode.OP_STORE1]);
  if (options.outer !== undefined) outer.push([QvmOpcode.OP_CONST, -1], [QvmOpcode.OP_CALL], [QvmOpcode.OP_POP], [QvmOpcode.OP_CONST, 1], [QvmOpcode.OP_LEAVE, 0]);
  const entry = outer.length, operations = [...outer, ...inner];
  let host: (() => void) | null = null;
  const code = new BinaryWriter(operations.length * 5);
  for (const [opcode, operand] of operations) { code.u8(opcode); if (operand !== undefined) code.i32(operand); }
  const instructions = code.finish(), file = new BinaryWriter(32 + instructions.length);
  for (const value of [0x12721444, operations.length, 32, instructions.length, 32 + instructions.length, 0, 0, 4096]) file.i32(value);
  file.bytes(instructions); const bytes = file.finish();
  const artifact = resolveQvmArtifact({ role: "qagame", bytes, module: { id: "mod:input", artifactPath: "vm/qagame.qvm", revision: "test", digest: digestBytes(bytes) } });
  if (artifact.kind !== "bytecode") throw new Error("Missing bytecode");
  const module = new QvmModule({ artifact, host: call => { if (host === null) return rejectQvmSyscall(call); host(); return 0; } }), ids = createIdentityOwner("qvm-input-output");
  const actor = ids.actor(0, 1), client = ids.client(0, 1);
  let live = true;
  const applications = new ModClientApplications(() => live), pointer = { kind: "argument", index: 1, indirections: [], offset: 0 } satisfies import("../../../src/contracts/qvm-mod-callbacks.ts").QvmModInputPointer;
  const outputs: readonly QvmModInputOutput[] = [
    { kind: "handler", entry, actor: { record: "client", pointer }, inputs: ["attack"], returns: options.returns ?? { encoding: "int32", value: 1 } },
    { kind: "command", entry, actor: { record: "client", pointer }, command: { ...pointer, index: 0 }, inputs: ["jump", "up-move"] },
    { kind: "field", record: "impulse", offset: 0, value: { input: "impulse", encoding: "int32", scale: 1 } },
  ];
  const selected: readonly QvmModInputOutput[] = options.outer === undefined ? outputs : [...outputs, ...outputs.flatMap(output => output.kind === "command" ? [{ ...output, entry: 0 }] : [])];
  const adapter = new QvmModInput({ module, abiProfile: "q3-modern", records: [
    { id: "client", address: 128, stride: 468, capacity: 1, fields: [] }, { id: "impulse", address: options.fieldAddress ?? 64, stride: 4, capacity: 1, fields: [] }],
    pointer: (_actor, record) => record === "client" ? 128 : options.fieldAddress ?? 64, live: () => live,
    playerState: () => readQvmPlayerState(module.memory.view(128, 468)),
  }, selected);
  const command = { kind: "q2-classic", milliseconds: 50, angleShorts: [0, 0, 0], forwardMove: 0,
    sideMove: 0, upMove: 200, buttons: 1, impulse: 9, lightLevel: 0 } satisfies import("../../../src/contracts/protocol.ts").UserCommand;
  const reset = () => {
    module.memory.dataView(options.fieldAddress ?? 64, 4).setInt32(0, 9, true);
    writeQvmUserCommand(module.memory.view(1024, 24), { serverTime: 50, angles: [0, 0, 0], buttons: 1, weapon: 3, forwardmove: 0, rightmove: 0, upmove: 127 });
  };
  const receipt = { time: { kind: "milliseconds", value: 50 }, input: { actor, source: { kind: "remote-client", client }, sequence: 7, command } } satisfies import("../../../src/world/session/mod-clients.ts").ModClientCommand;
  const begin = () => applications.begin({ identity: { actor, client }, scope: "client-command", command, accepted: receipt,
    absoluteAim: { x: 0, y: 0, z: 0 }, angleSpace: "absolute",
    frame: { frame: 1, time: { kind: "milliseconds", value: 50 }, elapsed: { kind: "milliseconds", value: 50 }, phase: "client-command" } });
  return { module, adapter, applications, command, receipt, outputs: selected, entry, reset, begin,
    setLive: (value: boolean) => { live = value; }, setHost: (callback: () => void) => { host = callback; },
    close: () => { adapter.close(); applications.close(); module.retire(); } };
}

test("QVM input captures original command writes and qualified handler returns without changing the receipt", async () => {
  const world = fixture(), { module, applications, adapter, command, outputs, reset } = world;
  const listener = applications.subscribe(event => {
    if (event.phase === "before") {
      const close = adapter.open(event.application);
      try { for (const output of adapter.output(outputs, event.application, () => { module.call([1024, 128]); })) event.output(output); }
      finally { close(); }
    }
    return undefined;
  });
  try {
    reset();
    const application = world.begin();
    expect(application?.command).toEqual({ ...command, buttons: 0, upMove: 0, impulse: 0 });
    expect(command).toMatchObject({ buttons: 1, upMove: 200, impulse: 9 });
    expect(application?.accepted).toBe(world.receipt); expect(world.receipt.input.command).toBe(command);
    applications.finish(application); listener();
    if (application === null) throw new Error("Missing live input application");
    const close = adapter.open(application);
    try {
      reset();
      expect(adapter.output(outputs, application, () => { module.call([1024, 596]); })).toEqual([{ kind: "set", input: "impulse", value: 0 }]);
      reset();
      expect(() => adapter.output(outputs, application, () => { module.call([1024, 128]); throw new Error("source failed"); })).toThrow("source failed");
      expect(module.memory.view(64, 4).getInt32(0, true)).toBe(0);
      reset();
      expect(adapter.output(outputs, application, () => { module.call([1024, 128]); world.setLive(false); })).toEqual([]);
      world.setLive(true); reset();
      // Async calls use the same original frame; no callback capture survives its declared scope.
      expect(await module.callAsync([1024, 128])).toBe(1);
      expect(adapter.output(outputs, application, () => {})).toEqual([]);
    } finally { close(); }
  } finally { listener(); world.close(); }
});

test.each([false, true])("nested source fields preserve only outer-authored changes (prior store %s)", prior => {
  const world = fixture(), { module, applications, adapter, outputs } = world;
  const listener = applications.subscribe(() => undefined);
  try {
    world.reset(); const outer = world.begin(); if (outer === null) throw new Error("Missing outer application");
    const endOuter = adapter.open(outer);
    const changes = adapter.output(outputs, outer, () => {
      if (prior) module.memory.dataView(64, 4).setInt32(0, 7, true);
      const inner = world.begin(); if (inner === null) throw new Error("Missing inner application");
      const endInner = adapter.open(inner);
      try { expect(adapter.output(outputs, inner, () => { module.call([1024, 128]); })).toContainEqual({ kind: "set", input: "impulse", value: 0 }); }
      finally { endInner(); applications.finish(inner); }
    });
    endOuter(); applications.finish(outer);
    expect(changes).toEqual(prior ? [{ kind: "set", input: "impulse", value: 7 }] : []);
  } finally { listener(); world.close(); }
});

test.each([undefined, 64])("nested original command frames do not consume the suspended command (prior move %s)", up => {
  const world = fixture({ outer: up === undefined ? {} : { up } }), { module, applications, adapter } = world;
  const outputs = world.outputs.filter(output => output.kind === "command"), listener = applications.subscribe(() => undefined);
  try {
    world.reset(); const outer = world.begin(); if (outer === null) throw new Error("Missing outer application");
    const endOuter = adapter.open(outer);
    world.setHost(() => {
      const inner = world.begin(); if (inner === null) throw new Error("Missing inner application");
      const endInner = adapter.open(inner);
      try { expect(adapter.output(outputs, inner, () => { module.call([1024, 128], world.entry); })).toContainEqual({ kind: "set", input: "up-move", value: 0 }); }
      finally { endInner(); applications.finish(inner); }
    });
    const changes = adapter.output(outputs, outer, () => { module.call([1024, 128]); });
    endOuter(); applications.finish(outer);
    expect(changes).toEqual(up === undefined ? [] : [{ kind: "set", input: "up-move", value: up / 127 }]);
  } finally { listener(); world.close(); }
});

test("absolute zero source storage and float32 handler predicates use their declared representations", () => {
  const world = fixture({ fieldAddress: 0, returnWord: 1036831949, returns: { encoding: "float32", value: 0.1 } });
  const listener = world.applications.subscribe(() => undefined);
  try {
    world.reset(); const application = world.begin(); if (application === null) throw new Error("Missing application");
    const close = world.adapter.open(application);
    try {
      const outputs = world.outputs.filter(output => output.kind !== "command");
      expect(world.adapter.output(outputs, application, () => { world.module.call([1024, 128]); })).toEqual([
        { kind: "set", input: "impulse", value: 0 }, { kind: "consume", inputs: ["attack"] },
      ]);
    } finally { close(); world.applications.finish(application); }
  } finally { listener(); world.close(); }
});
