import type { QuakeCSource } from "../app/bootstrap/simulation/quakec-source.ts";
import type { Q1SaveData } from "./q1.ts";
import { captureQ1QuakeCSave, restoreQ1QuakeCSave, type Q1SaveHeader, type Q1UnknownSaveFields } from "./q1-quakec.ts";

export function captureQ1SourceSave(source: QuakeCSource, format: Q1SaveData["format"], comment: string,
  spawnParameters: readonly number[], extensionText = ""): Q1SaveData {
  source.checkpoint();
  if (source.kind !== "netquake" || source.options.maxClients !== 1 || source.options.mode !== "singleplayer")
    throw new Error("Original Quake saves require a singleplayer NetQuake source");
  return captureQ1QuakeCSave(source.machine, { format, comment: comment.replace(/\s/g, "_"), spawnParameters,
    skill: source.options.skill, map: source.options.recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, ""),
    time: source.timeSeconds, lightStyles: Array.from({ length: 64 }, (_, index) => source.options.events.lightStyle(index) || "m"), extensionText },
  slot => source.slots.options.storage.read(slot).free);
}

/** Called only on a staged, precached map with its one local client already bound. */
export function restoreQ1SourceSave(source: QuakeCSource, save: Q1SaveData, finish: (header: Q1SaveHeader) => undefined): Q1UnknownSaveFields {
  if (source.kind !== "netquake" || source.options.maxClients !== 1 || source.options.mode !== "singleplayer" || source.loading)
    throw new Error("Original Quake restoration requires a precached singleplayer NetQuake candidate");
  const map = source.options.recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, "");
  if (save.map !== map || save.skill !== source.options.skill || save.entities.length < 2 || save.entities[0]?.length === 0 || save.entities[1]?.length === 0)
    throw new Error("Original Quake save does not match the candidate map, skill or player");
  source.checkpoint();
  return restoreQ1QuakeCSave(source.machine, save, {
    begin: count => {
      for (let slot = 0; slot < source.entities.count; slot++) {
        const actor = source.slots.at(slot);
        if (actor === null) continue;
        source.options.physics.bodies.unlink(actor);
        if (slot > source.reservedClientSlots) source.options.actors.release(actor);
      }
      source.entities.setCount(count);
      for (let slot = 0; slot < count; slot++) {
        const pairs = save.entities[slot];
        if (pairs === undefined) throw new Error("Missing source edict");
        if (pairs.length === 0) source.slots.options.storage.clearFreed(slot, { kind: "seconds", value: save.time });
        else {
          const actor = source.slots.bindExisting(slot, "quakec:edict");
          source.slots.options.storage.initialize(slot, actor);
        }
      }
      return undefined;
    },
    entity: (slot, free) => { if (!free) source.worldHost.link(slot); return undefined; },
    finish: header => {
      for (const [style, pattern] of header.lightStyles.entries()) source.options.events.emit(source.prepared.execution.owner.content,
        { kind: "q1", event: { kind: "lightstyle", style, pattern } });
      return finish(header);
    },
  });
}
