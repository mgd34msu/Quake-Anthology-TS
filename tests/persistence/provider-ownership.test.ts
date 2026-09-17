import { expect, test } from "bun:test";
import type { ProviderCheckpoint } from "../../src/contracts/session.ts";
import { CAMPAIGN_UNIT_CHECKPOINT, saveProviderContract, validateSaveProviderOwner } from "../../src/persistence/provider-ownership.ts";
import { readSaveImage } from "../../src/persistence/save-image.ts";
import { validateSimulationSave, simulationProviderCheckpoint } from "../../src/app/bootstrap/simulation/save.ts";
import { CampaignUnit } from "../../src/app/bootstrap/campaign-unit.ts";

const bytes = new Uint8Array(0);
test("reserved host schemas require their exact provider and version", () => {
  expect(saveProviderContract("session:campaign-unit", "q2:official")).toEqual(CAMPAIGN_UNIT_CHECKPOINT);
  expect(() => validateSaveProviderOwner({ ...CAMPAIGN_UNIT_CHECKPOINT, bytes }, "q2:official")).not.toThrow();
  expect(() => validateSaveProviderOwner({ provider: "world:actors", schema: "world:source-slots", version: 1, bytes }, "q2:official")).not.toThrow();
  for (const record of [
    { ...CAMPAIGN_UNIT_CHECKPOINT, provider: "q2:official" },
    { ...CAMPAIGN_UNIT_CHECKPOINT, version: 2 },
    { provider: "session:campaign-unit", schema: "q2:foundation", version: 1 },
    { provider: "session:unknown", schema: "session:unknown", version: 1 },
    { provider: "q1:official", schema: "q2:foundation", version: 1 },
  ] satisfies readonly Omit<ProviderCheckpoint, "bytes">[]) expect(() => validateSaveProviderOwner({ ...record, bytes }, "q2:official")).toThrow();
});

const fixture = process.env["QTS_SAVE_PROVIDER_FIXTURE"];
test.skipIf(fixture === undefined)("actual public save campaign envelope passes source validation without weakening foreign-provider checks", async () => {
  if (fixture === undefined) throw new Error("Missing public save fixture");
  const image = await readSaveImage(fixture);
  expect(image.providers.some(record => record.schema === "session:campaign-unit")).toBe(true);
  const campaign = simulationProviderCheckpoint(image, "session:campaign-unit");
  expect(campaign.provider).toBe("session:campaign-unit");
  expect(() => validateSimulationSave(image)).not.toThrow();
  const unit = new CampaignUnit();
  expect(() => unit.restore(image)).not.toThrow();
  expect(() => validateSimulationSave(unit.attach(image))).not.toThrow();
  const changed = (record: ProviderCheckpoint) => ({ ...image, providers: image.providers.map(value => value === campaign ? record : value) });
  for (const invalid of [{ ...campaign, provider: image.recipe.map.entities.provider }, { ...campaign, schema: "q2:foundation" }, { ...campaign, version: 2 }] satisfies readonly ProviderCheckpoint[]) {
    expect(() => validateSimulationSave(changed(invalid))).toThrow();
    expect(() => unit.restore(changed(invalid))).toThrow();
    expect(() => unit.attach(changed(invalid))).toThrow();
  }
  expect(() => validateSimulationSave({ ...image, providers: [...image.providers, campaign] })).toThrow("Duplicate");
  const foundation = simulationProviderCheckpoint(image, "q2:foundation");
  expect(() => validateSimulationSave({ ...image, providers: image.providers.map(record => record === foundation ? { ...record, provider: "q1:official" } : record) })).toThrow("different owner");
});
