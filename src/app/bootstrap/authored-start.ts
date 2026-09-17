import type { AuthoredStartCatalog } from "../../content/catalog/start-maps.ts";
import { parseQ2StartItems } from "../../content/q2/foundation/start-items.ts";
import { parseQ2Travel, type Q2TravelTarget } from "./q2-travel.ts";

export interface AuthoredCampaignStart { readonly target: Q2TravelTarget; readonly startItems: string; }

/** Only a selected authored start runs its intro and starting inventory. Arbitrary maps remain direct. */
export function authoredCampaignStart(catalog: AuthoredStartCatalog | null, selectedMap: string): AuthoredCampaignStart | null {
  const normalized = `maps/${selectedMap.replace(/^maps\//, "").replace(/\.bsp$/, "")}.bsp`;
  const start = catalog?.starts.find(entry => entry.path === normalized);
  if (start === undefined) return null;
  parseQ2StartItems(start.startItems);
  return { target: parseQ2Travel(start.bsp), startItems: start.startItems };
}
