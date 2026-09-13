/* Cinematic traps from id Software cl_cgame.c/cl_ui.c. GPL-2.0-or-later. */
import type { Rect } from "../../contracts/render.ts";
import type { Draw2D } from "../../text/draw2d.ts";
import type { QvmHostCall, QvmHostResult } from "./syscalls.ts";

export interface QvmClientCinematics {
  playGuest(path: string, rect: Rect, bits: number): Promise<number>;
  runGuest(handle: number): number;
  stopGuest(handle: number): number;
  drawGuest(handle: number, draw: Draw2D): void;
  setExtents(handle: number, rect: Rect): void;
}

export interface QvmClientCinematicServices {
  readonly cinematics: QvmClientCinematics;
  readonly draw: Draw2D;
  developerPrint(text: string): void;
}

export function qvmClientCinematicSyscall(call: QvmHostCall, services: QvmClientCinematicServices): QvmHostResult | null {
  if (call.kind !== "engine" || call.role === "qagame") return null;
  const play = call.role === "ui" ? 75 : 74, trap = call.code;
  if (trap < play || trap > play + 4) return null;
  const { words, guest } = call, { cinematics } = services;
  if (trap === play) {
    const path = guest.readString(words.getInt32(4, true));
    const rect = { x: words.getInt32(8, true), y: words.getInt32(12, true), width: words.getInt32(16, true), height: words.getInt32(20, true) };
    const bits = words.getInt32(24, true);
    if (call.role === "ui") services.developerPrint("UI_CIN_PlayCinematic\n");
    return cinematics.playGuest(path, rect, bits);
  }
  const handle = words.getInt32(4, true);
  if (trap === play + 1) return cinematics.stopGuest(handle);
  if (trap === play + 2) return cinematics.runGuest(handle);
  if (trap === play + 3) cinematics.drawGuest(handle, services.draw);
  else cinematics.setExtents(handle, { x: words.getInt32(8, true), y: words.getInt32(12, true), width: words.getInt32(16, true), height: words.getInt32(20, true) });
  return 0;
}
