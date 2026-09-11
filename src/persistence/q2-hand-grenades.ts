import type { HandGrenadeLoadout, HandGrenadesCheckpoint } from "../content/q2/equipment/hand-grenades.ts";
import type { HandAction } from "../content/q2/foundation/weapons/hand-action.ts";
import { readSavedActor } from "./save-image.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "./value.ts";

function loadout(reader: SaveReader): HandGrenadeLoadout {
  const initialAmmo = reader.field("initialAmmo").integer(0), capacity = reader.field("capacity").integer(0);
  if (initialAmmo > capacity) reader.fail("initial hand grenade allowance exceeds capacity");
  return { enabled: reader.field("enabled").boolean(), initialAmmo, capacity, infiniteAmmo: reader.field("infiniteAmmo").boolean() };
}

function action(reader: SaveReader): HandAction {
  const kind = reader.field("kind").choice("idle", "disarmed", "preparing", "cooking", "releasing", "recovering");
  switch (kind) {
    case "idle": case "disarmed": return { kind };
    case "preparing": {
      const frame = reader.field("frame").integer(1);
      if (frame > 11) reader.field("frame").fail("hand grenade preparation exceeds hold frame");
      return { kind, frame, nextAt: reader.field("nextAt").finite(), releaseQueued: reader.field("releaseQueued").boolean() };
    }
    case "cooking": return { kind, expiresAt: reader.field("expiresAt").finite() };
    case "releasing": return { kind, expiresAt: reader.field("expiresAt").finite(), throwAt: reader.field("throwAt").finite() };
    case "recovering": return { kind, readyAt: reader.field("readyAt").finite(), requireRelease: reader.field("requireRelease").boolean() };
  }
}

export function readHandGrenadesCheckpoint(reader: SaveReader): HandGrenadesCheckpoint {
  return { version: reader.field("version").literal(1), edition: reader.field("edition").choice("classic", "rerelease"),
    actors: reader.field("actors").list(entry => ({ actor: readSavedActor(entry.field("actor")),
      state: { config: loadout(entry.field("state").field("config")), action: action(entry.field("state").field("action")) } })) };
}

export function encodeHandGrenadesCheckpoint(checkpoint: HandGrenadesCheckpoint): Uint8Array { return encodeCheckpointValue(checkpoint); }
export function decodeHandGrenadesCheckpoint(bytes: Uint8Array): HandGrenadesCheckpoint {
  return readHandGrenadesCheckpoint(new SaveReader(decodeCheckpointValue(bytes), "q2-hand-grenades"));
}
