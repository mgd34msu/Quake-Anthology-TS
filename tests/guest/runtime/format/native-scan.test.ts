// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { nativeFixture } from "../../../compat/q2/rerelease/native.test.ts";
import { edictLayout, fieldOffset } from "../../../../src/compat/q2/rerelease/layouts.ts";
import { readString } from "../../../../src/guest/runtime/common/memory.ts";

const available = await Bun.file(new URL("../../../../../qfiles/q2/rerelease/baseq2/game_x64.dll", import.meta.url)).exists();
test.skipIf(!available)("scanner native ReadLevelJson restores guest numeric fields", async () => {
  const { source, host, guest, memory, runtime, world } = await nativeFixture();
  host.preInit(); source.init();
  host.spawnEntities("base1", `{ "classname" "worldspawn" } { "classname" "info_player_start" "origin" "${world.origin}" }`);
  const origin = memory.offset(guest.entities().atSlot(17).address, BigInt(fieldOffset(edictLayout, "s.origin")));
  memory.writeFloat32(origin, -123.125); memory.writeFloat32(memory.offset(origin, 4n), 0.0625);
  const saved = host.writeSave("level", false);
  memory.writeFloat32(origin, 99); memory.writeFloat32(memory.offset(origin, 4n), 99);
  const scanner = runtime.resolveAddress("api-ms-win-crt-stdio-l1-1-0.dll", "__stdio_common_vsscanf");
  if (scanner === null) throw new Error("Missing native scanner import");
  const formats = new Set<string>(), inputs = new Set<string>();
  const stop = guest.options.runner.options.callbacks.observeEntry(scanner, () => {
    const registers = guest.options.runner.options.cpu.state.registers;
    const input = memory.pointer(registers.read("rdx", 64)), format = memory.pointer(registers.read("r9", 64));
    if (input === null || format === null) throw new Error("Native scanner passed a null string");
    expect(registers.read("rcx", 64)).toBe(2n);
    expect(registers.read("r8", 64)).toBe(0xffffffffffffffffn);
    formats.add(readString(memory, format)); inputs.add(readString(memory, input));
  });
  try {
    host.readSave("level", saved);
    expect(formats).toEqual(new Set(["%lf"]));
    expect(inputs.has("-123.125")).toBe(true); expect(inputs.has("0.0625")).toBe(true);
    expect(memory.readFloat32(origin)).toBe(-123.125); expect(memory.readFloat32(memory.offset(origin, 4n))).toBe(0.0625);
  } finally { stop(); source.close(); }
}, 120000);
