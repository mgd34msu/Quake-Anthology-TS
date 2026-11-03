// SPDX-License-Identifier: GPL-2.0-or-later
import { userDataDirectory } from "../../content/user-data.ts";
import { ConfigStore, type GlobalInputTuning, type SeatSettings } from "../../settings/config.ts";

const GLOBAL_TUNING = "input/global-tuning.json";

export function globalTuningStore(userContentRoot: string | undefined): ConfigStore {
  return new ConfigStore(userDataDirectory("settings", userContentRoot));
}

/** The first seat's saved profile with the tuning shared by every game laid over it, as the front end does when it opens a profile. */
export async function loadSeatProfile(settings: ConfigStore, userContentRoot: string | undefined, index: number): Promise<SeatSettings | null> {
  const saved = await settings.loadSeat(`input/seat-${index + 1}.json`);
  if (saved === null || index !== 0) return saved;
  let global: GlobalInputTuning | null;
  try {
    global = await globalTuningStore(userContentRoot).loadGlobalTuning(GLOBAL_TUNING);
  } catch {
    global = null; // an unreadable shared document leaves the product's own tuning in force
  }
  if (global === null) return saved;
  return {
    ...saved,
    mouse: global.mouse,
    rumble: global.rumble,
    ...(global.rumbleStrength === undefined ? {} : { rumbleStrength: global.rumbleStrength }),
    ...(global.alwaysRun === undefined ? {} : { alwaysRun: global.alwaysRun }),
  };
}

export async function saveSharedTuning(userContentRoot: string | undefined, seat: SeatSettings): Promise<void> {
  await globalTuningStore(userContentRoot).saveGlobalTuning(GLOBAL_TUNING, {
    version: 1,
    mouse: seat.mouse,
    rumble: seat.rumble,
    ...(seat.rumbleStrength === undefined ? {} : { rumbleStrength: seat.rumbleStrength }),
    ...(seat.alwaysRun === undefined ? {} : { alwaysRun: seat.alwaysRun }),
  });
}
