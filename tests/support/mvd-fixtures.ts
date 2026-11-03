// SPDX-License-Identifier: GPL-2.0-or-later
import { MvdPlayback } from "../../src/network/q2/mvd-playback.ts";
import { createMessage, messageBytes, MSG_WriteByte, MSG_WriteShort, MSG_WriteLong, MSG_WriteString } from "../../src/network/q2/message.ts";
import { PlayerStateT } from "../../src/network/q2/state.ts";
import { MSG_WriteDeltaMvdPlayerstate } from "../../src/network/q2/codecs/mvd.ts";
export function gamestate(): Uint8Array {
  const message = createMessage();
  MSG_WriteByte(message, 4);
  MSG_WriteLong(message, 37);
  MSG_WriteShort(message, 2010);
  MSG_WriteLong(message, 12);
  MSG_WriteString(message, "baseq2");
  MSG_WriteShort(message, -1);
  for (const [index, text] of [
    [0, "Arena"],
    [30, "2"],
    [33, "maps/q2dm1.bsp"],
  ] satisfies readonly (readonly [number, string])[]) {
    MSG_WriteShort(message, index);
    MSG_WriteString(message, text);
  }
  MSG_WriteShort(message, 2080);
  MSG_WriteByte(message, 1);
  MSG_WriteByte(message, 0x55);
  const first = new PlayerStateT();
  first.fov = 90;
  first.pmove.origin[0] = 800;
  first.viewangles[1] = 90;
  const second = new PlayerStateT();
  second.fov = 100;
  second.pmove.origin[0] = -1600;
  MSG_WriteDeltaMvdPlayerstate(message, null, first, 0, true);
  MSG_WriteDeltaMvdPlayerstate(message, null, second, 1, true);
  MSG_WriteByte(message, 255);
  // Native first-person MVD entities omit position; it is reconstructed from player state.
  MSG_WriteByte(message, 0);
  MSG_WriteByte(message, 1);
  MSG_WriteByte(message, 0);
  MSG_WriteByte(message, 2);
  MSG_WriteShort(message, 0);
  return messageBytes(message);
}
export function playback(): MvdPlayback {
  return new MvdPlayback({
    entities: entities => entities,
    soundAudible: () => true,
    visible: (_leaf, _channel, _player, portals) => portals[0] === 0x55,
    areaBits: (_player, portals) => Uint8Array.of(portals[0] === 0x55 ? 7 : 0),
    soundOrigin: entity => [entity.origin[0] ?? 0, entity.origin[1] ?? 0, entity.origin[2] ?? 0],
  });
}
