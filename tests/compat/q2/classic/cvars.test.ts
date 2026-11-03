// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../../../src/contracts/execution.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { CvarRegistry, Q2CvarFlag } from "../../../../src/core/cvars/index.ts";
import { SparseGuestMemory } from "../../../../src/guest/core/index.ts";
import { ClassicQ2Cvars } from "../../../../src/compat/q2/classic/cvars.ts";
import { readClassicString } from "../../../../src/compat/q2/classic/records.ts";
import { SessionActorRegistry } from "../../../../src/world/actors/index.ts";

const identity: ModuleIdentity = { id: "test:classic-cvars", artifactPath: "authored", revision: "1", digest: createContentDigest("6b".repeat(32)) };

test("guest cvar records hide private values, follow changes in place and relink only when the set changes", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("classic-cvars"));
  try {
    const registry = new CvarRegistry({ dialect: "q2-classic", context: { session: actors.session, origin: { kind: "server-console" } } });
    registry.register("rcon_password", "hunter2", Q2CvarFlag.Private);
    registry.register("skill", "1");
    const memory = new SparseGuestMemory({ module: identity, pointerBytes: 4 });
    const cvars = new ClassicQ2Cvars(memory, registry);
    const rcon = cvars.pointer("rcon_password"),
      skill = cvars.pointer("skill");
    if (rcon === null || skill === null) throw new Error("Missing guest cvar records");
    const text = (record: typeof rcon) => readClassicString(memory, memory.readPointer(memory.offset(record, 4n)));
    expect(text(rcon)).toBe("");
    expect(text(skill)).toBe("1");
    const stringAddress = memory.readPointer(memory.offset(skill, 4n))?.byteOffset;
    registry.set("skill", "3");
    cvars.refresh();
    expect(text(skill)).toBe("3");
    expect(memory.readPointer(memory.offset(skill, 4n))?.byteOffset).toBe(stringAddress);
    registry.register("deathmatch", "0");
    cvars.refresh();
    const deathmatch = cvars.pointer("deathmatch");
    if (deathmatch === null) throw new Error("Missing guest cvar record");
    const names: string[] = [];
    for (let node: typeof rcon | null = deathmatch, hops = 0; node !== null && hops < 8; hops++) {
      names.push(readClassicString(memory, memory.readPointer(node)));
      node = memory.readPointer(memory.offset(node, 24n));
    }
    expect(names).toEqual(["deathmatch", "skill", "rcon_password"]);
  } finally {
    actors.close();
  }
});
