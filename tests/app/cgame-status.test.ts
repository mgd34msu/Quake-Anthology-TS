import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarFlag, CvarRegistry } from "../../src/core/cvars/index.ts";
import { QvmMemory } from "../../src/compat/qvm/memory.ts";
import { CgameStatusView } from "../../src/app/bootstrap/q3-client/status.ts";
import { ClientConfiguration } from "../../src/content/q3/presentation/config.ts";
import { ClientGameState, ClientGameStaticState } from "../../src/content/q3/presentation/state.ts";

test("component status masking restores actual vmCvar bytes without archived changes", async () => {
  const identity = createIdentityOwner("effective-status"), cvars = new CvarRegistry({ dialect: "q3",
    context: { session: identity.session, origin: { kind: "server-console" } } });
  let visible = true, notifications = 0;
  cvars.register("cg_drawStatus", "1", CvarFlag.Archive);
  cvars.bindValue("cg_drawStatus", { validate: () => null, changed: () => { notifications++; } });
  const effective = new CgameStatusView(cvars, () => visible), memory = new QvmMemory(new Uint8Array(2048));
  memory.writeString(32, "cg_drawStatus", 32); memory.writeString(64, "1", 4);
  const words = new DataView(new ArrayBuffer(20));
  [3, 128, 32, 64, CvarFlag.Archive].forEach((value, index) => words.setInt32(index * 4, value, true));
  effective.syscall(words, memory);
  const record = memory.view(128, 272), original = cvars.get("cg_drawStatus"), archive = cvars.archiveEntries(), beforeNotifications = notifications;
  expect(record.getInt32(12, true)).toBe(1);
  const firstVersion = record.getInt32(4, true);
  visible = false; words.setInt32(0, 4, true); effective.syscall(words, memory);
  expect(record.getInt32(12, true)).toBe(0); expect(memory.readString(144)).toBe("0");
  expect(record.getInt32(4, true)).toBeGreaterThan(firstVersion);
  const maskedVersion = record.getInt32(4, true); effective.syscall(words, memory);
  expect(record.getInt32(4, true)).toBe(maskedVersion);
  expect(cvars.get("cg_drawStatus")).toEqual(original); expect(cvars.archiveEntries()).toEqual(archive);
  expect(notifications).toBe(beforeNotifications);
  visible = true; effective.refresh();
  expect(record.getInt32(12, true)).toBe(1); expect(memory.readString(144)).toBe("1");
  expect(record.getInt32(4, true)).toBeGreaterThan(maskedVersion);
  visible = false; effective.syscall(words, memory); cvars.set("cg_drawStatus", "2"); effective.syscall(words, memory);
  expect(record.getInt32(12, true)).toBe(0);
  visible = true; effective.refresh(); expect(record.getInt32(12, true)).toBe(2);
  expect(cvars.archiveEntries()).toContainEqual({ name: "cg_drawStatus", value: "2" });

  for (const product of ["baseq3", "missionpack"] satisfies readonly ("baseq3" | "missionpack")[]) {
    const configuration = new ClientConfiguration(product, { cvars, state: new ClientGameState(product, 0, 0),
      staticState: new ClientGameStaticState(product), clients: { newClientInfo: async () => {} }, configString: () => "", statusVisible: () => visible });
    configuration.registerCvars(); await configuration.updateCvars();
    visible = false; expect(configuration.readVmCvar("cg_drawStatus").integerValue).toBe(0);
    expect(configuration.readVmCvar("cg_draw2D").integerValue).toBe(1);
    visible = true; expect(configuration.readVmCvar("cg_drawStatus").integerValue).toBe(2);
  }
  memory.close();
});
