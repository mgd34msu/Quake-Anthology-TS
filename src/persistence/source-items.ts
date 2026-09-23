import { isDeepStrictEqual } from "node:util";
import type { ProviderCheckpoint, SaveImage, SavedActorId } from "../contracts/session.ts";
import type { SourceItemAdmission, SourceItemDefinition } from "../contracts/source-items.ts";
import type { InventoryEntry } from "../contracts/gameplay.ts";
import type { ProviderId } from "../contracts/identity.ts";
import type { SessionActorRegistry } from "../world/actors/registry.ts";
import type { SharedInventoryTable } from "../world/gameplay/inventory.ts";
import { readProvider } from "./recipe.ts";
import { readInventoryEntry, readSavedActor, savedActorId } from "./save-image.ts";
import { decodeCheckpointValue, encodeCheckpointValue, namespaced, SaveFormatError, SaveReader } from "./value.ts";

interface SourceItems {
  readonly actor: SavedActorId;
  readonly owner: ProviderId;
  readonly primary: readonly InventoryEntry[];
  readonly groups: readonly { readonly owner: ProviderId; readonly items: readonly SourceItemAdmission[] }[];
}
const schema = "world:source-items";
const key = (actor: SavedActorId): string => `${actor.slot}/${actor.generation}`;

export function captureSourceItems(actors: SessionActorRegistry, inventory: SharedInventoryTable): ProviderCheckpoint {
  const entries: SourceItems[] = [];
  for (const observation of actors.observations()) {
    const actor = actors.resolveOwned(observation.id); if (actor === null) continue;
    const source = inventory.sourceItems(actor);
    if (source !== null) entries.push({ actor: savedActorId(actor.id), owner: actor.owner, ...source });
  }
  return { provider: "world:gameplay", schema, version: 1, bytes: encodeCheckpointValue(entries) };
}
function definition(reader: SaveReader): SourceItemDefinition {
  const common = { item: namespaced(reader.field("item")), label: reader.field("label").string(), source: readProvider(reader.field("source")) };
  if (common.label.length === 0) return reader.fail("source item label is empty");
  switch (reader.field("kind").choice("counter", "weapon")) {
    case "counter": return { ...common, kind: "counter" };
    case "weapon": return { ...common, kind: "weapon", ammo: reader.field("ammo").value === null ? null : namespaced(reader.field("ammo")) };
  }
}
export function readSourceItems(save: SaveImage): readonly SourceItems[] {
  const records = save.providers.filter(provider => provider.schema === schema), record = records[0];
  if (records.length > 1 || record !== undefined && (record.provider !== "world:gameplay" || record.version !== 1)) throw new SaveFormatError(schema, "unsupported or duplicate source item checkpoint");
  if (record === undefined) return [];
  const actors = new Set<string>();
  return new SaveReader(decodeCheckpointValue(record.bytes), schema).list(reader => {
    const actor = readSavedActor(reader.field("actor")), owner = namespaced(reader.field("owner")), primary = reader.field("primary").list(readInventoryEntry);
    const primaryItems = new Set(primary.map(entry => entry.item)), items = new Set<string>();
    if (actors.has(key(actor)) || primaryItems.size !== primary.length) return reader.fail("duplicate primary inventory or actor"); actors.add(key(actor));
    const groups = reader.field("groups").list(group => {
      const provider = namespaced(group.field("owner"));
      const admissions = group.field("items").list(entry => {
        const item = definition(entry.field("definition")), admission = entry.field("admission").choice("add", "replace-primary");
        if (item.source.provider !== provider || items.has(item.item) || (admission === "add" ? primaryItems.has(item.item) : !primaryItems.has(item.item))) return entry.fail("source item admission differs from primary ownership");
        items.add(item.item); return { definition: item, admission };
      });
      if (admissions.length === 0) return group.fail("empty source item group");
      return { owner: provider, items: admissions };
    });
    const effective = save.inventories.filter(entry => key(entry.actor) === key(actor));
    if (groups.length === 0 || effective.length !== 1) return reader.fail("source items have no distinct effective inventory");
    const rows = effective[0]?.entries; if (rows === undefined) return reader.fail("missing effective inventory");
    if (new Set(rows.map(entry => entry.item)).size !== rows.length || [...items].some(item => !rows.some(entry => entry.item === item))
      || !isDeepStrictEqual(rows.filter(entry => !items.has(entry.item)), primary.filter(entry => !items.has(entry.item)))) return reader.fail("source item coverage differs from effective inventory");
    return { actor, owner, primary, groups };
  });
}

/** Existing source restore still validates primary rows against its original guest checkpoint. */
export function prepareSourceItemRestore(save: SaveImage): {
  readonly primary: SaveImage;
  effective(inventories: SaveImage["inventories"]): SaveImage["inventories"];
  finish(actors: SessionActorRegistry, inventory: SharedInventoryTable): undefined;
} {
  const records = readSourceItems(save), byActor = new Map(records.map(entry => [key(entry.actor), entry]));
  return {
    primary: records.length === 0 ? save : { ...save, inventories: save.inventories.map(entry => ({ ...entry, entries: byActor.get(key(entry.actor))?.primary ?? entry.entries })) },
    effective: inventories => records.length === 0 ? inventories : inventories.map(entry => {
      if (!byActor.has(key(entry.actor))) return entry;
      const original = save.inventories.find(value => key(value.actor) === key(entry.actor));
      if (original === undefined) throw new SaveFormatError(schema, "missing saved effective inventory"); return original;
    }),
    finish: (actors, inventory) => {
      const restored = new Set<string>();
      for (const observation of actors.observations()) {
        const actor = actors.resolveOwned(observation.id); if (actor === null) continue;
        const source = inventory.sourceItems(actor), saved = records.find(entry => actors.resolveSaved(entry.actor) === actor);
        if (source === null ? saved !== undefined : saved === undefined || saved.owner !== actor.owner || !isDeepStrictEqual(source, { primary: saved.primary, groups: saved.groups }))
          throw new SaveFormatError(schema, "restored source item ownership or hidden inventory differs");
        if (saved !== undefined) {
          const effective = save.inventories.find(entry => key(entry.actor) === key(saved.actor));
          if (effective === undefined || !isDeepStrictEqual(inventory.entries(actor.id), effective.entries)) throw new SaveFormatError(schema, "restored source inventory differs from its committed state");
          restored.add(key(saved.actor));
        }
      }
      if (restored.size !== records.length) throw new SaveFormatError(schema, "saved source item actor was not restored");
      return undefined;
    },
  };
}
