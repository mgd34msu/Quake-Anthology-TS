// SPDX-License-Identifier: GPL-2.0-or-later
import { SdlControllers } from "../../src/platform/controller.ts";

function versionAtLeast(version: string, floor: string): boolean {
  const actual = version.split(".").map(Number),
    required = floor.split(".").map(Number);
  for (let index = 0; index < Math.max(actual.length, required.length); index++) {
    const difference = (actual[index] ?? 0) - (required[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

/**
 * SDL2-compat 2.32.70+ forwards SDL2's int-success virtual-controller callbacks to SDL3 bool without conversion,
 * so virtual controllers drop their injected input. The paired failure-behavior test in controller.test.ts fails
 * loudly once SDL fixes the callback.
 * https://github.com/libsdl-org/sdl2-compat/blob/release-2.32.70/src/sdl2_compat.c
 */
export const sdlVirtualCallbackMismatch = versionAtLeast(SdlControllers.runtime.version, "2.32.70");
