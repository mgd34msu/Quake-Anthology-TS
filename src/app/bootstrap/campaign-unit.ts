import type { ResourceRequest } from "../../contracts/content.ts";
import { isContentId } from "../../contracts/content.ts";
import type { ProviderCheckpoint, SaveImage } from "../../contracts/session.ts";
import { decodeSaveImage, encodeSaveImage } from "../../persistence/save-image.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "../../persistence/value.ts";

import { CAMPAIGN_UNIT_CHECKPOINT, validateSaveProviderOwner } from "../../persistence/provider-ownership.ts";

const provider = CAMPAIGN_UNIT_CHECKPOINT.provider;
function campaignEntries(image: SaveImage): readonly ProviderCheckpoint[] {
  const entries = image.providers.filter(entry => entry.provider === provider || entry.schema === CAMPAIGN_UNIT_CHECKPOINT.schema);
  if (entries.length > 1) throw new Error("Duplicate campaign unit checkpoint");
  for (const entry of entries) validateSaveProviderOwner(entry, image.recipe.map.entities.provider);
  return entries;
}
function path(value: string): string { return value.replace(/^maps\//, "").replace(/\.bsp$/, ""); }
function key(map: ResourceRequest): string { return `${map.content}/${path(map.path)}`; }
function location(image: SaveImage): ResourceRequest {
  return { content: image.recipe.map.geometryContent, path: image.recipe.map.geometry.requestedPath };
}
function worldOnly(image: SaveImage): SaveImage {
  campaignEntries(image);
  return { ...image, providers: image.providers.filter(entry => entry.schema !== CAMPAIGN_UNIT_CHECKPOINT.schema) };
}

export interface CampaignUnitVisit {
  readonly restore: SaveImage | null;
  /** Publish only after the destination world has been admitted successfully. */
  commit(): void;
}

/** A unit owns departed worlds; the active world remains owned by the simulation. */
export class CampaignUnit {
  private current: ResourceRequest | null = null;
  private worlds = new Map<string, Uint8Array>();
  private revision = 0;

  stage(destination: ResourceRequest, newUnit: boolean, departure: SaveImage | null): CampaignUnitVisit {
    const revision = this.revision;
    if (departure !== null && this.current !== null && key(location(departure)) !== key(this.current)) throw new Error("Campaign departure does not match the active map");
    const reset = newUnit || this.current !== null && this.current.content !== destination.content;
    const worlds = reset ? new Map<string, Uint8Array>() : new Map(this.worlds);
    if (!reset && departure !== null) worlds.set(key(location(departure)), encodeSaveImage(worldOnly(departure)));
    const saved = worlds.get(key(destination));
    const restore = saved === undefined ? null : decodeSaveImage(saved);
    worlds.delete(key(destination));
    return { restore, commit: () => {
      if (revision !== this.revision) throw new Error("Campaign visit was superseded");
      this.current = { ...destination }; this.worlds = worlds; this.revision++;
    } };
  }

  checkpoint(current: ResourceRequest | null = this.current): ProviderCheckpoint {
    return { ...CAMPAIGN_UNIT_CHECKPOINT,
      bytes: encodeCheckpointValue({ current, worlds: [...this.worlds].map(([map, bytes]) => ({ map, bytes })) }) };
  }

  attach(image: SaveImage): SaveImage {
    const current = location(image), world = worldOnly(image);
    if (this.current !== null && key(this.current) !== key(current)) throw new Error("Campaign save does not match the active map");
    return { ...world, providers: [...world.providers, this.checkpoint(current)] };
  }

  restore(image: SaveImage): void {
    const entries = campaignEntries(image);
    const checkpoint = entries[0];
    let current: ResourceRequest | null = location(image);
    const worlds = new Map<string, Uint8Array>();
    if (checkpoint !== undefined) {
      const reader = new SaveReader(decodeCheckpointValue(checkpoint.bytes), "campaign-unit");
      current = reader.field("current").nullable(entry => {
        const content = entry.field("content").string();
        if (!isContentId(content)) throw new Error("Invalid campaign content identity");
        return { content, path: entry.field("path").string() };
      });
      if (current === null || key(current) !== key(location(image))) throw new Error("Campaign checkpoint active map does not match its world");
      for (const entry of reader.field("worlds").list(value => ({ map: value.field("map").string(), bytes: value.field("bytes").bytes() }))) {
        const saved = decodeSaveImage(entry.bytes), map = location(saved);
        if (entry.map !== key(map) || map.content !== current.content || entry.map === key(current) || worlds.has(entry.map)
          || campaignEntries(saved).length !== 0) throw new Error("Invalid campaign unit world checkpoint");
        worlds.set(entry.map, entry.bytes.slice());
      }
    }
    this.current = current; this.worlds = worlds; this.revision++;
  }
}
