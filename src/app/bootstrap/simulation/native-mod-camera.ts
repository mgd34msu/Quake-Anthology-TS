import type { Q2PlayerState, Q2RereleasePlayerState } from "../../../contracts/protocol.ts";
import type { NativeModCameraView } from "../../../world/session/mod-client-presentation.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { PlayerView } from "./types.ts";
import { classicGuestPlayerView } from "./classic-guest-player.ts";
import { rereleaseGuestPlayerView } from "./rerelease-guest-player.ts";

/** Public API3/API2023 prediction flags decide whether source or selected movement controls the view. */
export function nativeModCamera(state: Q2PlayerState | Q2RereleasePlayerState): NativeModCameraView {
  const classic = state.kind === "q2-classic", movement = state.movement;
  const origin = movement.kind === "q2-classic" ? { x: movement.originEighths[0] / 8, y: movement.originEighths[1] / 8, z: movement.originEighths[2] / 8 } : movement.origin;
  return { ...(state.kind === "q2-classic" ? classicGuestPlayerView(state) : rereleaseGuestPlayerView(state)), native: {
    edition: classic ? "classic" : "rerelease", movementOrigin: origin, renderFlags: state.renderFlags,
    positionPrediction: movement.type !== (classic ? 4 : 6) && (movement.flags & 64) === 0,
    angularPrediction: movement.type < (classic ? 2 : 4) && (classic || (movement.flags & 256) === 0),
    weaponVisible: state.gunIndex !== 0 && (!classic || state.fov <= 90),
  } };
}

export function resolveNativeModCamera(view: NativeModCameraView, origin: Vec3 | null, angles: Vec3): PlayerView {
  const source = view.native;
  return { ...view, origin: !source.positionPrediction || origin === null ? view.origin : {
    x: origin.x + view.origin.x - source.movementOrigin.x,
    y: origin.y + view.origin.y - source.movementOrigin.y,
    z: origin.z + view.origin.z - source.movementOrigin.z,
  }, angles: source.angularPrediction ? angles : view.angles };
}
