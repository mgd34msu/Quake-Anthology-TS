import { createQ1SourceComposition, type Q1SourceComposition } from "../../../content/composition/q1/index.ts";
import type { Q1CompositionServices, Q1SourceProgram } from "../../../content/composition/q1/types.ts";
import type { Q1CampaignBinding } from "../../../content/q1/base/index.ts";
import type { Q1Foundation } from "../../../content/q1/foundation/runtime.ts";
import type { Q1FoundationHost, Q1FoundationOptions } from "../../../content/q1/foundation/types.ts";

export interface ForeignQ1WorldModules {
  readonly game: Q1Foundation;
  readonly composition: Q1SourceComposition;
}

/** A full Q1 world (base entities, mission packs, campaign addons,
 * monsters) hosted as an adjunct for a Q1-authored map whose primary
 * source is another family's program. Mirrors the primary Q1 composition;
 * player/match ownership stays with the primary source, so player-facing
 * services route to shared runtime services and no clients attach here. */
export function createForeignQ1WorldModules(options: {
  readonly host: Q1FoundationHost;
  readonly foundation: Omit<Q1FoundationOptions, "precacheProgram">;
  readonly program: Q1SourceProgram;
  readonly campaign: Q1CampaignBinding;
  readonly services: Q1CompositionServices;
}): ForeignQ1WorldModules {
  const composition = createQ1SourceComposition(options.host, options.foundation,
    { program: options.program, campaign: options.campaign, registered: true, officialCampaign: options.program === "id1" },
    options.services);
  return { game: composition.game, composition };
}
