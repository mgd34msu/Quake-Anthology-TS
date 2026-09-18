import type { Bounds, Vec3 } from '../../../contracts/math.ts';
import type { Q2PlayerState, Q2RereleasePlayerState, Q2UserCommand, Q2RereleaseUserCommand } from '../../../contracts/protocol.ts';
import { KexPmTypeT, PmTypeT, PMF_DUCKED } from '../../../movement/q2/types.ts';
import { fromQ2Command } from '../../../network/q2/adapters.ts';
import { readElement, type UsercmdT } from '../../../network/q2/state.ts';

type Player = Q2PlayerState | Q2RereleasePlayerState;
export function q2RemoteViewHeight(player: Player): number {
  return player.kind === 'q2-rerelease' ? player.movement.viewHeight : player.viewOffset.z;
}

/** Classic includes stance in viewoffset; rerelease carries it separately in pmove. */
export function q2RemoteViewPosition(player: Player, origin: Vec3, offset: Vec3, viewHeight: number): { readonly origin: Vec3; readonly viewHeight: number } {
  return { origin: { x: origin.x + offset.x, y: origin.y + offset.y, z: origin.z + (player.kind === 'q2-rerelease' ? offset.z : 0) }, viewHeight };
}

export function q2RemoteBodyBounds(player: Player): Bounds {
  const movement = player.movement;
  const gib = movement.type === (player.kind === 'q2-rerelease' ? KexPmTypeT.PM_GIB : PmTypeT.PM_GIB);
  const dead = movement.type === (player.kind === 'q2-rerelease' ? KexPmTypeT.PM_DEAD : PmTypeT.PM_DEAD);
  return { min: { x: -16, y: -16, z: gib ? 0 : -24 }, max: { x: 16, y: 16, z: gib ? 16 : dead || (movement.flags & PMF_DUCKED) !== 0 ? 4 : 32 } };
}

/** Subtract source delta angles before encoding the selected command wire format. */
export function q2RemoteCommand(command: Q2UserCommand | Q2RereleaseUserCommand, player: Player): UsercmdT {
  if (command.kind === 'q2-rerelease' && player.kind === 'q2-rerelease') {
    const delta = player.movement.deltaAngles;
    return fromQ2Command({ ...command, angles: { x: Math.fround(command.angles.x - delta.x), y: Math.fround(command.angles.y - delta.y), z: Math.fround(command.angles.z - delta.z) } });
  }
  if (command.kind !== 'q2-classic' || player.kind !== 'q2-classic') throw new Error('Q2 command and server movement editions differ');
  const wire = fromQ2Command(command);
  for (let index = 0; index < 3; index++) wire.angles[index] = (readElement(wire.angles, index) - readElement(player.movement.deltaAngleShorts, index)) & 65535;
  return wire;
}

/** Source camera state: reversal starts from the previous target, not the sampled height. */
export class Q2RereleaseViewHeight {
  private state: { previous: number; current: number; changedAt: number } | null = null;
  reset(): void { this.state = null; }
  sample(height: number, timeMilliseconds: number): number {
    let state = this.state;
    if (state === null) this.state = state = { previous: height, current: height, changedAt: timeMilliseconds };
    else if (state.current !== height) {
      state.previous = state.current;
      state.current = height;
      state.changedAt = timeMilliseconds;
    }
    const elapsed = Math.max(0, Math.min(timeMilliseconds - state.changedAt, 100));
    return state.current + (state.previous - state.current) * (100 - elapsed) * 0.01;
  }
}

/** Rerelease check_player_lerp duplicates state after discontinuities, without resetting stance smoothing. */
export function q2RereleaseViewContinuous(previous: Q2RereleasePlayerState, current: Q2RereleasePlayerState, previousFrame: number, currentFrame: number, event: number): boolean {
  const before = previous.movement.origin, after = current.movement.origin;
  return currentFrame === previousFrame + 1 && event !== 6 && event !== 7
    && Math.max(Math.abs(before.x - after.x), Math.abs(before.y - after.y), Math.abs(before.z - after.z)) <= 256
    && ((previous.renderFlags ^ current.renderFlags) & 16) === 0;
}
