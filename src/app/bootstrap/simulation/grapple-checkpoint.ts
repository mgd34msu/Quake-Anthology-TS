import { readQ1FoundationCheckpoint } from "../../../persistence/q1-foundation.ts";
import { readQ2FoundationCheckpoint } from "../../../persistence/q2-foundation.ts";
import { readSavedActor } from "../../../persistence/save-image.ts";
import { readRandom, readVector } from "../../../persistence/shared.ts";
import type { SaveReader } from "../../../persistence/value.ts";
import type { GrappleRuntimeCheckpoint } from "./grapple-runtime.ts";
import { readGrappleWeaponState } from "./weapon-slot-checkpoint.ts";

export function readGrappleRuntimeCheckpoint(reader: SaveReader): GrappleRuntimeCheckpoint {
  const random = readRandom(reader.field("random"));
  if (random.kind !== "glibc-random" && random.kind !== "q2-rerelease-mt19937") return reader.field("random").fail("Unsupported grapple random stream");
  const common = { version: reader.field("version").literal(2), random,
    weaponAnimations: reader.field("weaponAnimations").list(entry => ({ actor: readSavedActor(entry.field("actor")),
      state: readGrappleWeaponState(entry.field("state")), nextFrameAt: entry.field("nextFrameAt").finite(),
      kickOrigin: readVector(entry.field("kickOrigin")), kickPitch: entry.field("kickPitch").finite() })),
    controls: reader.field("controls").list(entry => ({ actor: readSavedActor(entry.field("actor")), held: entry.field("held").boolean(), jump: entry.field("jump").boolean(), teleportBit: entry.field("teleportBit").nullable(value => value.choice(0, 4)),
      pressed: entry.field("pressed").boolean(), released: entry.field("released").boolean(), previousVelocity: readVector(entry.field("previousVelocity")),
      predictionSuppressed: entry.field("predictionSuppressed").boolean() })) };
  const source = reader.field("source"), kind = source.field("kind").choice("q1-threewave", "q2-ctf", "q2-lmctf");
  switch (kind) {
    case "q1-threewave": return { ...common, source: { kind, entities: readQ1FoundationCheckpoint(source.field("entities")) } };
    case "q2-ctf": return { ...common, source: { kind, entities: readQ2FoundationCheckpoint(source.field("entities")),
      states: source.field("states").list(entry => { const state = entry.field("state"); return { actor: readSavedActor(entry.field("actor")),
        state: { grapple: state.field("grapple").nullable(readSavedActor), grappleState: state.field("grappleState").choice("fly", "pull", "hang"),
          grappleReleaseTime: state.field("grappleReleaseTime").finite(), grappleNoKnockback: state.field("grappleNoKnockback").value === undefined ? null : state.field("grappleNoKnockback").nullable(value => value.boolean()) } }; }) } };
    case "q2-lmctf": return { ...common, source: { kind, entities: readQ2FoundationCheckpoint(source.field("entities")),
      states: source.field("states").list(entry => { const state = entry.field("state"); return { actor: readSavedActor(entry.field("actor")),
        state: { hook: state.field("hook").nullable(readSavedActor), hookState: state.field("hookState").choice(0, 1, 2), hookLength: state.field("hookLength").finite(), hookHeld: state.field("hookHeld").boolean() } }; }) } };
  }
}
