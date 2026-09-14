import { expect, test } from "bun:test";
import { UnifiedAudio } from "../../src/audio/engine.ts";
import type { SoundAsset, SoundOrigin } from "../../src/audio/types.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { ActorId } from "../../src/contracts/identity.ts";
import type { Axis, Vec3 } from "../../src/contracts/math.ts";

const identity = createIdentityOwner("rocket-spatial");
const actor = identity.actor(1, 0);
const listener: Vec3 = { x: 8192, y: -4096, z: 384 };
const axis: Axis = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
const sound: SoundAsset = { name: "private-rocket-tone", resource: "resource:private-rocket-tone",
  pcm: { samples: new Int16Array(64).fill(12000), sampleRate: 44100, channels: 1, frameCount: 64, loopStart: null } };
function play(source: SoundOrigin, owner: ActorId | null): readonly number[] {
  using audio = new UnifiedAudio({ milliseconds: () => 1000, random: () => 0 });
  audio.updateActor(actor, listener);
  audio.setListeners([{ actor, seat: identity.seat(0), origin: listener, axis, gain: 1, underwater: false }]);
  expect(audio.play({ family: "q3", sound, actor: owner, origin: source, audience: { kind: "world" }, channel: 2, volume: 1, attenuation: 1 })).toBe(1);
  audio.endLoopFrame();
  return [...audio.mix(1)];
}
function expected(volume: number): number { return Math.floor(Math.floor(12000 * volume * 178 / 256) / 256); }

test("Q3 firing actor is full volume at a nonzero listener and differs from fixed muzzle playback", () => {
  const firing = play({ kind: "actor", actor }, actor);
  expect(firing).toEqual([expected(127), expected(127)]);
  const muzzle = play({ kind: "fixed", position: { ...listener, x: listener.x + 14 } }, null);
  expect(muzzle).toEqual([expected(63), expected(63)]);
  expect(play({ kind: "fixed", position: { x: 0, y: 0, z: 0 } }, null)).toEqual([0, 0]);
});

test("Q3 impacts retain actual position, direction and source distance falloff", () => {
  for (const distance of [40, 80, 350, 1000, 1500]) {
    const attenuation = Math.fround(Math.fround(Math.max(0, distance - 80)) * Math.fround(0.0008));
    const volume = Math.max(0, Math.trunc(Math.fround(127 * Math.fround((1 - attenuation) * 0.5))));
    expect(play({ kind: "fixed", position: { ...listener, x: listener.x + distance } }, null)).toEqual([expected(volume), expected(volume)]);
  }
  const right = play({ kind: "fixed", position: { ...listener, y: listener.y - 350 } }, null);
  const left = play({ kind: "fixed", position: { ...listener, y: listener.y + 350 } }, null);
  expect(right[0]).toBe(0);
  expect(right[1]).toBeGreaterThan(0);
  expect(left).toEqual([...right].reverse());
});
