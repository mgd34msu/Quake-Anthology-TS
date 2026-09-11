import type { Q2NoiseCheckpoint, Q2WeaponsCheckpoint } from "../content/q2/foundation/weapons/checkpoint.ts";
import type { Q2WeaponInput, Q2WeaponState } from "../content/q2/foundation/weapons/types.ts";
import { readSavedActor } from "./save-image.ts";
import { readVector } from "./shared.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "./value.ts";

function noise(reader: SaveReader): Q2NoiseCheckpoint {
  return { actor: readSavedActor(reader.field("actor")), origin: readVector(reader.field("origin")), time: reader.field("time").number(), secondary: reader.field("secondary").boolean() };
}
export function readQ2WeaponInput(reader: SaveReader): Q2WeaponInput {
  const n = (key: string): number => reader.field(key).number(), b = (key: string): boolean => reader.field(key).boolean();
  return { attack: b("attack"), latchedAttack: b("latchedAttack"), holster: b("holster"), angles: readVector(reader.field("angles")), ducked: b("ducked"), spectator: b("spectator"), notarget: b("notarget"), hand: reader.field("hand").choice("right", "left", "center"),
    animatePlayer: b("animatePlayer"), quadUntil: n("quadUntil"), doubleUntil: n("doubleUntil"), quadFireUntil: n("quadFireUntil"), haste: b("haste"), noStackDouble: b("noStackDouble"), instantSwitch: b("instantSwitch"), quickSwitch: b("quickSwitch"), infiniteAmmo: b("infiniteAmmo"), playersCollide: b("playersCollide"), gravity: n("gravity"), weaponThunk: b("weaponThunk") };
}
export function readQ2WeaponState(reader: SaveReader): Readonly<Q2WeaponState> {
  const n = (key: string): number => reader.field(key).number(), b = (key: string): boolean => reader.field(key).boolean(), name = (key: string): string | null => reader.field(key).nullable(value => value.string());
  return { sourceFiring: b("sourceFiring"), weapon: name("weapon"), lastWeapon: name("lastWeapon"), pending: name("pending"), phase: reader.field("phase").choice("activating", "ready", "firing", "dropping"), frame: n("frame"), thinkTime: n("thinkTime"), fireFinished: n("fireFinished"), fireBuffered: b("fireBuffered"), latchedAttack: b("latchedAttack"),
    machinegunShots: n("machinegunShots"), silencerShots: n("silencerShots"), emptySoundTime: n("emptySoundTime"), grenadeTime: n("grenadeTime"), grenadeFinished: n("grenadeFinished"), grenadeBlewUp: b("grenadeBlewUp"), kickOrigin: readVector(reader.field("kickOrigin")), kickAngles: readVector(reader.field("kickAngles")), kickUntil: n("kickUntil"), kickDuration: n("kickDuration"), loopSound: reader.field("loopSound").string(), viewModel: name("viewModel"), viewSkin: n("viewSkin"), lastFiringTime: n("lastFiringTime"), gunRate: n("gunRate") };
}
export function readQ2WeaponsCheckpoint(reader: SaveReader): Q2WeaponsCheckpoint {
  return { sourceRules: reader.field("sourceRules").choice("base", "ctf", "lmctf"), registered: reader.field("registered").list(value => value.string()), fallbackOrder: reader.field("fallbackOrder").nullable(value => value.list(name => name.string())),
    states: reader.field("states").list(value => ({ actor: readSavedActor(value.field("actor")), state: readQ2WeaponState(value.field("state")) })), inputs: reader.field("inputs").list(value => ({ actor: readSavedActor(value.field("actor")), input: readQ2WeaponInput(value.field("input")) })),
    noises: reader.field("noises").list(value => ({ actor: readSavedActor(value.field("actor")), primary: value.field("primary").nullable(noise), secondary: value.field("secondary").nullable(noise) })), soundEntity: reader.field("soundEntity").nullable(noise), sound2Entity: reader.field("sound2Entity").nullable(noise),
    blasterCauses: reader.field("blasterCauses").list(value => ({ actor: readSavedActor(value.field("actor")), meansOfDeath: value.field("meansOfDeath").integer() })) };
}
export function encodeQ2WeaponsCheckpoint(checkpoint: Q2WeaponsCheckpoint): Uint8Array { return encodeCheckpointValue(checkpoint); }
export function decodeQ2WeaponsCheckpoint(bytes: Uint8Array): Q2WeaponsCheckpoint { return readQ2WeaponsCheckpoint(new SaveReader(decodeCheckpointValue(bytes), "q2-weapons")); }
