import type { Vec3 } from "../../contracts/math.ts";
import type { BotMovementStop } from "../behavior/prediction.ts";
import { aasTraceAreas, type AasAsset } from "./aas.ts";

/** Source area-stop order from AAS_PredictClientMovement, before final ground/liquid tests. */
export function aasPredictionStop(asset: AasAsset, start: Vec3, end: Vec3, frame: number, events: number, stopArea: number): BotMovementStop | null {
  if ((events & (512 | 128 | 256 | 4096)) === 0) return null;
  for (const crossing of aasTraceAreas(asset, start, end, 20)) {
    const contents = asset.settings[crossing.area]?.contents ?? 0;
    if ((events & 512) !== 0 && crossing.area === stopArea) return { events: 512, origin: crossing.point, area: crossing.area };
    if ((events & 128) !== 0 && frame !== 0 && (contents & 128) !== 0) return { events: 128, origin: crossing.point, area: crossing.area };
    if ((events & 256) !== 0 && (contents & 64) !== 0) return { events: 256, origin: crossing.point, area: crossing.area };
    if ((events & 4096) !== 0 && (contents & 8) !== 0) return { events: 4096, origin: crossing.point, area: crossing.area };
  }
  return null;
}
