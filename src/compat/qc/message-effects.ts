import type { ActorId } from "../../contracts/identity.ts";
import type { Q1Event } from "../../content/q1/foundation/types.ts";
import type { TemporaryEntity } from "../../network/q1/netquake.ts";

/** The decoded QW blood opcodes differ from NetQuake explosion2/beam opcodes. */
export function quakeTemporaryEvent(effect: TemporaryEntity, actor: ActorId | null, quakeworld: boolean): Extract<Q1Event, { readonly kind: "effect" | "beam" | "colored-explosion" | "particles" }> {
  if (effect.kind === "explosion-colors") return { kind: "colored-explosion", origin: effect.origin, colorStart: effect.colorStart, colorLength: effect.colorLength };
  if (effect.kind === "beam") {
    if (actor === null) throw new Error(`QC beam entity ${effect.entity} had no owned actor when written`);
    const style = effect.type === 5 ? "lightning1" : effect.type === 6 ? "lightning2" : effect.type === 9 ? "lightning3" : effect.type === 13 && !quakeworld ? "grapple" : null;
    if (style === null) throw new Error(`Unsupported QC beam ${effect.type}`);
    return { kind: "beam", style, actor, start: effect.start, end: effect.end };
  }
  if (quakeworld && (effect.type === 2 || effect.type === 12 || effect.type === 13))
    return { kind: "particles", origin: effect.origin, direction: { x: 0, y: 0, z: 0 },
      color: effect.type === 2 ? 0 : effect.type === 12 ? 73 : 225, count: effect.type === 13 ? 50 : 20 * effect.count };
  let name: Extract<Q1Event, { readonly kind: "effect" }>["effect"];
  switch (effect.type) {
    case 0: name = "spike"; break;
    case 1: name = "superspike"; break;
    case 2: name = "gunshot"; break;
    case 3: name = "explosion"; break;
    case 4: name = "tar-explosion"; break;
    case 7: name = "wizard-spike"; break;
    case 8: name = "knight-spike"; break;
    case 10: name = "lava-splash"; break;
    case 11: name = "teleport"; break;
    default: throw new Error(`Unsupported QC point effect ${effect.type}`);
  }
  return { kind: "effect", effect: name, actor: null, origin: effect.origin, amount: effect.count };
}
