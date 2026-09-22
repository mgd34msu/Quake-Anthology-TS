import type { ArmorState } from "../contracts/gameplay.ts";
import type { OwnedActor, ProviderId } from "../contracts/identity.ts";
import type { ProviderCheckpoint, SaveImage, SavedActorId } from "../contracts/session.ts";
import type { SessionActorRegistry } from "../world/actors/registry.ts";
import type { GameplayAuthority } from "../world/gameplay/authority.ts";
import { readArmor, readSavedActor, savedActorId } from "./save-image.ts";
import { decodeCheckpointValue, encodeCheckpointValue, namespaced, SaveFormatError, SaveReader } from "./value.ts";

interface HiddenArmor {
  readonly actor: SavedActorId;
  readonly owner: ProviderId;
  readonly regular?: ArmorState["regular"];
  readonly powered?: ArmorState["powered"];
}

const schema = "world:primary-protection";

export function capturePrimaryProtection(actors: SessionActorRegistry, combat: GameplayAuthority): ProviderCheckpoint {
  combat.assertIdle();
  const entries: HiddenArmor[] = [];
  for (const observation of actors.observations()) {
    const actor = actors.resolveOwned(observation.id);
    if (actor === null) continue;
    const primary = combat.copiedPrimaryArmor(actor);
    if (primary === null) continue;
    const regular = combat.protectionOwner(actor, "regular") !== null, powered = combat.protectionOwner(actor, "powered") !== null;
    if (regular) combat.protectionInventoryItems(actor, "regular");
    if (powered) combat.protectionInventoryItems(actor, "powered");
    if (regular || powered) entries.push({ actor: savedActorId(actor.id), owner: actor.owner,
      ...(regular ? { regular: primary.regular } : {}), ...(powered ? { powered: primary.powered } : {}) });
  }
  return { provider: "world:gameplay", schema, version: 1, bytes: encodeCheckpointValue(entries) };
}

export function readPrimaryProtection(save: SaveImage, actors: SessionActorRegistry): {
  readonly recorded: boolean; readonly entries: ReadonlyMap<OwnedActor, HiddenArmor>;
} {
  const records = save.providers.filter(provider => provider.schema === schema);
  if (records.length > 1) throw new SaveFormatError(schema, "duplicate primary protection checkpoint");
  const record = records[0], entries = new Map<OwnedActor, HiddenArmor>();
  if (record === undefined) return { recorded: false, entries };
  if (record.provider !== "world:gameplay" || record.version !== 1) throw new SaveFormatError(schema, "unsupported primary protection checkpoint");
  new SaveReader(decodeCheckpointValue(record.bytes)).list(value => {
    const saved = readSavedActor(value.field("actor")), owner = namespaced(value.field("owner"));
    const actor = actors.resolveSaved(saved);
    if (actor === null || actor.owner !== owner || entries.has(actor)) return value.fail("missing or duplicate primary protection owner");
    const regular = value.field("regular"), powered = value.field("powered");
    if (regular.value === undefined && powered.value === undefined) return value.fail("empty hidden primary armor");
    const armor = readArmor(new SaveReader({ regular: regular.value ?? { kind: "none" }, powered: powered.value ?? { kind: "none" } }));
    if (armor.regular.kind === "source") return regular.fail("copied primary armor cannot own a source formula");
    const entry: HiddenArmor = { actor: saved, owner, ...(regular.value === undefined ? {} : { regular: armor.regular }),
      ...(powered.value === undefined ? {} : { powered: armor.powered }) };
    entries.set(actor, entry);
    return undefined;
  });
  return { recorded: true, entries };
}
