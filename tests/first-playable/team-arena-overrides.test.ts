import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore } from "../../src/settings/config.ts";
import { loadCvarArchive, saveCvarArchive } from "../../src/app/bootstrap/cvar-archives.ts";
import { CvarFlag, CvarRegistry } from "../../src/core/cvars/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { encodeCheckpointValue, decodeCheckpointValue } from "../../src/persistence/value.ts";
import { captureTeamArenaOverrides, decodeTeamArenaOverrides, applyTeamArenaOverrides, releaseTeamArenaOverrides, teamArenaArchiveEntries, type OverrideRegistry } from "../../src/app/bootstrap/team-arena-overrides.ts";

function seats(baselines: readonly string[], fov: string): readonly OverrideRegistry[] {
  const identity = createIdentityOwner("override-test");
  return baselines.map((baseline, index) => {
    const cvars = new CvarRegistry({ dialect: "q3", context: { session: identity.session, origin: { kind: "local-seat", seat: identity.seat(index), client: identity.client(index, 0) } } });
    cvars.register("cg_drawTimer", "1", CvarFlag.Archive); cvars.register("ui_drawTimer", baseline);
    cvars.register("cg_fov", fov, CvarFlag.Archive);
    return { seat: index, client: index, cvars };
  });
}
test("temporary timer saves preserve distinct seats and current preferences, then release once", () => {
  const original = seats(["2", "3"], "90"), active = captureTeamArenaOverrides(original);
  const destination = seats(["7", "8"], "115");
  const decoded = decodeTeamArenaOverrides(decodeCheckpointValue(encodeCheckpointValue(active)), destination);
  applyTeamArenaOverrides(decoded, destination);
  expect(destination.map(row => row.cvars.variableString("ui_drawTimer"))).toEqual(["2", "3"]);
  expect(destination.map(row => row.cvars.variableString("cg_drawTimer"))).toEqual(["1", "1"]);
  expect(destination.map(row => row.cvars.variableString("cg_fov"))).toEqual(["115", "115"]);
  for (const row of destination) expect(teamArenaArchiveEntries(row.cvars, decoded, row.seat)).toEqual([
    { name: "cg_fov", value: "115" }, { name: "cg_drawTimer", value: String(row.seat + 2) },
  ]);
  expect(destination.map(row => row.cvars.variableString("cg_drawTimer"))).toEqual(["1", "1"]);
  const released = releaseTeamArenaOverrides(decoded, destination);
  expect(destination.map(row => row.cvars.variableString("cg_drawTimer"))).toEqual(["2", "3"]);
  const later = seats(["9", "9"], "120");
  for (const row of later) row.cvars.set("cg_drawTimer", "4", true);
  applyTeamArenaOverrides(released, later); releaseTeamArenaOverrides(released, later);
  expect(later.map(row => row.cvars.variableString("cg_drawTimer"))).toEqual(["4", "4"]);
});
test("override identity rejection is atomic and missing legacy state does not reset timers", () => {
  const destination = seats(["2", "3"], "100"), active = captureTeamArenaOverrides(destination);
  const [first] = active.seats;
  if (first === undefined) throw new Error("Missing fixture seat");
  expect(() => decodeTeamArenaOverrides({ ...active, seats: [first, first] }, destination)).toThrow("do not match");
  expect(() => applyTeamArenaOverrides({ ...active, seats: [first] }, destination)).toThrow("do not match");
  expect(() => decodeTeamArenaOverrides({ ...active, phase: "other" }, destination)).toThrow("phase");
  expect(() => decodeTeamArenaOverrides({ ...active, seats: [{ ...first, baseline: null }] }, destination)).toThrow();
  applyTeamArenaOverrides(null, destination); releaseTeamArenaOverrides(null, destination);
  expect(destination.map(row => row.cvars.variableString("ui_drawTimer"))).toEqual(["2", "3"]);
  expect(destination.map(row => row.cvars.variableString("cg_drawTimer"))).toEqual(["1", "1"]);
});
test("active source archive projection retains baselines without modifying flags or live values", () => {
  const rows = seats(["2"], "100"), active = captureTeamArenaOverrides(rows), first = rows[0];
  if (first === undefined) throw new Error("Missing fixture seat");
  const source = first.cvars;
  source.register("capturelimit", "5", CvarFlag.Archive | CvarFlag.ServerInfo);
  source.register("ui_saveCaptureLimit", "9");
  const before = source.captureSaveState();
  expect(teamArenaArchiveEntries(source, active).find(row => row.name === "capturelimit")?.value).toBe("9");
  expect(source.captureSaveState()).toEqual(before);
  expect(teamArenaArchiveEntries(source, { ...active, phase: "released" }).find(row => row.name === "capturelimit")?.value).toBe("5");
});
test("active archive writes keep original per-seat preferences without changing live forced timers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ta-override-archive-"));
  try {
    const store = new ConfigStore(directory), rows = seats(["2", "3"], "115"), active = captureTeamArenaOverrides(rows);
    for (const row of rows) {
      await saveCvarArchive(store, ["client", String(row.seat)], row.cvars, teamArenaArchiveEntries(row.cvars, active, row.seat));
      const archive = await loadCvarArchive(store, ["client", String(row.seat)], "q3");
      expect(archive.find(entry => entry.name === "cg_drawTimer")?.value).toBe(String(row.seat + 2));
      expect(archive.find(entry => entry.name === "cg_fov")?.value).toBe("115");
      expect(row.cvars.variableString("cg_drawTimer")).toBe("1");
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("present empty cvar baselines roundtrip as strings and restore native numeric zero", () => {
  const original = seats([""], "100"), first = original[0];
  if (first === undefined) throw new Error("Missing fixture seat");
  const captured = captureTeamArenaOverrides(original);
  const emptyEffective = { ...captured, seats: captured.seats.map(row => ({ ...row, effective: "" })) };
  const decoded = decodeTeamArenaOverrides(decodeCheckpointValue(encodeCheckpointValue(emptyEffective)), original);
  applyTeamArenaOverrides(decoded, original);
  expect(first.cvars.variableString("ui_drawTimer")).toBe("");
  expect(first.cvars.variableString("cg_drawTimer")).toBe("");
  expect(first.cvars.variableValue("cg_drawTimer")).toBe(0);
  expect(teamArenaArchiveEntries(first.cvars, decoded, 0).find(row => row.name === "cg_drawTimer")?.value).toBe("");
  first.cvars.register("capturelimit", "5", CvarFlag.Archive);
  first.cvars.register("ui_saveCaptureLimit", "");
  expect(teamArenaArchiveEntries(first.cvars, decoded).find(row => row.name === "capturelimit")?.value).toBe("");
  releaseTeamArenaOverrides(decoded, original);
  expect(first.cvars.variableString("cg_drawTimer")).toBe("");
});
