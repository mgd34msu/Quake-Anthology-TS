// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { nativeFixture } from "./native.test.ts";
import { guestPointer, RereleaseSourceClient, retailRereleaseClientProfile } from "../../../../src/compat/q2/rerelease/index.ts";

const available = await Bun.file(new URL("../../../../../qfiles/q2/rerelease/baseq2/game_x64.dll", import.meta.url)).exists();

test.skipIf(!available)("retail protection deadline follows native give/use and remains absolute across a frame", async () => {
  let commands: readonly string[] = [];
  const { source, host, guest, core, memory, world, cvars, sounds } = await nativeFixture(undefined, false, () => commands);
  try {
    host.preInit(); source.init();
    host.spawnEntities("base1", `{
"classname" "worldspawn"
}
{
"classname" "info_player_start"
"origin" "${world.origin}"
}
`, "");
    expect(host.clientConnect(1, "\\name\\Protection\\skin\\male/grunt\\ip\\127.0.0.1", "protection", false).accepted).toBe(true);
    host.clientBegin(1);
    const entity = guest.entities().atSlot(1).address;
    const address = memory.readPointer(memory.offset(entity, 120n));
    if (address === null) throw new Error("Native player has no client state");
    const client = new RereleaseSourceClient(address, guest, retailRereleaseClientProfile);
    const deadline = client.at("invincible_time");
    expect(deadline.byteOffset - address.byteOffset).toBe(6672n);
    expect(memory.readInt64(deadline)).toBe(0n);
    expect(guest.callGame("Bot_GetItemID", [guestPointer(core.string("item_invulnerability"))])).toEqual({ kind: "int32", value: 40 });
    cvars.set("cheats", "1", true); core.refreshCvars();
    const command = (arguments_: readonly string[]): void => {
      commands = arguments_; guest.callGame("ClientCommand", [guestPointer(entity)]);
    };
    command(["give", "Invulnerability"]);
    expect(memory.readInt32(memory.offset(client.at("pers.inventory"), 40n * 4n))).toBe(1);
    command(["use", "Invulnerability"]);
    expect(memory.readInt32(memory.offset(client.at("pers.inventory"), 40n * 4n))).toBe(0);
    expect(memory.readInt64(deadline)).toBe(30000n);
    command(["give", "Invulnerability"]); command(["use", "Invulnerability"]);
    expect(memory.readInt64(deadline)).toBe(60000n);
    expect(sounds.length).toBeGreaterThan(0);
    host.runFrame(true);
    expect(memory.readInt64(deadline)).toBe(60000n);
  } finally { source.close(); }
});
