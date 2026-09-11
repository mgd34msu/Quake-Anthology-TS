import { rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ArmorState, CombatState, InventoryEntry } from "../contracts/gameplay.ts";
import type { ActorSlotCheckpoint, ProviderCheckpoint, SaveImage, SavedActorId } from "../contracts/session.ts";
import type { ActorId } from "../contracts/identity.ts";
import type { SourceActorCheckpoint } from "../world/actors/registry.ts";
import { readGuest } from "./execution.ts";
import { readCharacter, readProvider, readRecipe } from "./recipe.ts";
import { readBounds, readFrame, readRandom, readTime, readVector } from "./shared.ts";
import { decodeCheckpointValue, encodeCheckpointValue, namespaced, SaveFormatError, SaveReader } from "./value.ts";

const MAGIC = new TextEncoder().encode("QTSAVE1\n");
export function savedActorId(actor: ActorId): SavedActorId { return { slot: actor.slot, generation: actor.generation }; }
export function readSavedActor(reader: SaveReader): SavedActorId { return { slot: reader.field("slot").integer(0), generation: reader.field("generation").integer(0) }; }
function readActorSlot(reader: SaveReader): ActorSlotCheckpoint {
  const actor = readSavedActor(reader);
  const lifetime = reader.field("lifetime");
  return { ...actor, lifetime: lifetime.field("kind").choice("active", "free") === "free" ? { kind: "free", freedAt: lifetime.field("freedAt").nullable(readTime) }
    : { kind: "active", owner: namespaced(lifetime.field("owner")), definition: namespaced(lifetime.field("definition")) } };
}
export function readArmor(reader: SaveReader): ArmorState {
  switch (reader.field("kind").choice("none", "q1", "q2", "q3")) {
    case "none": return { kind: "none" };
    case "q1": return { kind: "q1", points: reader.field("points").number(), absorption: reader.field("absorption").number(), item: namespaced(reader.field("item")) };
    case "q3": return { kind: "q3", points: reader.field("points").number(), protection: reader.field("protection").number() };
    case "q2": {
      const power = reader.field("powerArmor");
      const kind = power.field("kind").choice("none", "screen", "shield");
      return { kind: "q2", points: reader.field("points").number(), normalProtection: reader.field("normalProtection").number(), energyProtection: reader.field("energyProtection").number(), item: namespaced(reader.field("item")),
        powerArmor: kind === "none" ? { kind } : { kind, cells: power.field("cells").number() } };
    }
  }
}
function readCombat(reader: SaveReader): CombatState { return { health: reader.field("health").number(), armor: readArmor(reader.field("armor")), mass: reader.field("mass").number(), canTakeDamage: reader.field("canTakeDamage").boolean(), invulnerable: reader.field("invulnerable").boolean(), team: reader.field("team").nullable(value => value.string()), ...(reader.field("noKnockback").value === undefined ? {} : { noKnockback: reader.field("noKnockback").boolean() }) }; }
function readInventory(reader: SaveReader): InventoryEntry { return { item: namespaced(reader.field("item")), count: reader.field("count").number(), capacity: reader.field("capacity").number() }; }

export function parseSaveImage(value: unknown): SaveImage {
  const reader = new SaveReader(value);
  return { schemaVersion: reader.field("schemaVersion").literal(1), recipe: readRecipe(reader.field("recipe")), frame: readFrame(reader.field("frame")), nextEventSequence: reader.field("nextEventSequence").integer(0),
    clocks: reader.field("clocks").list(entry => ({ provider: namespaced(entry.field("provider")), time: readTime(entry.field("time")) })),
    random: reader.field("random").list(entry => ({ provider: namespaced(entry.field("provider")), state: readRandom(entry.field("state")) })), actors: reader.field("actors").list(readActorSlot),
    bodies: reader.field("bodies").list(entry => { const body = entry.field("body"); return { actor: readSavedActor(entry.field("actor")), body: {
      origin: readVector(body.field("origin")), angles: readVector(body.field("angles")), velocity: readVector(body.field("velocity")), bounds: readBounds(body.field("bounds")), ground: body.field("ground").nullable(readSavedActor) } }; }),
    combat: reader.field("combat").list(entry => ({ actor: readSavedActor(entry.field("actor")), state: readCombat(entry.field("state")) })),
    inventories: reader.field("inventories").list(entry => ({ actor: readSavedActor(entry.field("actor")), entries: entry.field("entries").list(readInventory) })),
    configurations: reader.field("configurations").list(entry => ({ actor: readSavedActor(entry.field("actor")), movement: readProvider(entry.field("movement")), character: readCharacter(entry.field("character")), weapons: entry.field("weapons").list(readProvider), inventory: readProvider(entry.field("inventory")) })),
    thinks: reader.field("thinks").list(entry => ({ actor: readSavedActor(entry.field("actor")), callback: namespaced(entry.field("callback")), due: readTime(entry.field("due")), boundary: entry.field("boundary").choice("before-physics", "during-physics", "after-physics"), provider: namespaced(entry.field("provider")), sequence: entry.field("sequence").integer(0) })),
    providers: reader.field("providers").list(entry => ({ provider: namespaced(entry.field("provider")), schema: namespaced(entry.field("schema")), version: entry.field("version").integer(0), bytes: entry.field("bytes").bytes() })),
    guests: reader.field("guests").list(readGuest) };
}

export function encodeSaveImage(image: SaveImage): Uint8Array {
  const payload = encodeCheckpointValue(image);
  const output = new Uint8Array(MAGIC.length + payload.length);
  output.set(MAGIC); output.set(payload, MAGIC.length);
  return output;
}
export function decodeSaveImage(bytes: Uint8Array): SaveImage {
  if (!MAGIC.every((value, index) => bytes[index] === value)) throw new SaveFormatError("save", "unsupported unified save signature/version");
  return parseSaveImage(decodeCheckpointValue(bytes.subarray(MAGIC.length)));
}
export async function readSaveImage(path: string): Promise<SaveImage> { return decodeSaveImage(new Uint8Array(await Bun.file(path).arrayBuffer())); }
/** Rename commits the completed sibling file; failed writes leave the previous save intact. */
export async function writeSaveImage(path: string, image: SaveImage): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${crypto.randomUUID()}.tmp`);
  try { await Bun.write(temporary, encodeSaveImage(image)); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

export function sourceActorsCheckpoint(sources: readonly SourceActorCheckpoint[]): ProviderCheckpoint {
  return { provider: "world:actors", schema: "world:source-slots", version: 1, bytes: encodeCheckpointValue(sources) };
}
export function readSourceActorsCheckpoint(checkpoint: ProviderCheckpoint): readonly SourceActorCheckpoint[] {
  if (checkpoint.provider !== "world:actors" || checkpoint.schema !== "world:source-slots" || checkpoint.version !== 1) throw new SaveFormatError("source-slots", "unsupported source actor checkpoint");
  return new SaveReader(decodeCheckpointValue(checkpoint.bytes), "source-slots").list(entry => ({ provider: namespaced(entry.field("provider")), sourceSlot: entry.field("sourceSlot").integer(0), actor: readSavedActor(entry.field("actor")) }));
}
