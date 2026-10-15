import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SoundBank } from "../../../../src/audio/bank.ts";
import type { LoopSound, PlaySound, SoundAsset } from "../../../../src/audio/types.ts";
import { createMountIdentity } from "../../../../src/contracts/content.ts";
import type { ActorId } from "../../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { openMountPlan } from "../../../../src/content/mounts/index.ts";
import { Q3PresentationAudio, Q3PresentationSoundBank } from "../../../../src/content/q3/presentation/audio.ts";

test("Q3 presentation audio ignores entities released after snapshot capture", async () => {
  const root = await mkdtemp(join(tmpdir(), "q3-audio-stale-"));
  const content = "q3:classic:baseq3:installed";
  const mount = { kind: "loose", identity: createMountIdentity("mount:q3-audio:stale", content, 0), rootPath: root } satisfies Parameters<typeof openMountPlan>[0]["mounts"][number];
  using mounts = await openMountPlan({ id: "mount-plan:q3-audio:stale", mounts: [mount], defaultOrder: [mount.identity.id], prefixOrders: [] });
  try {
    const asset: SoundAsset = {
      resource: "resource:q3-audio-stale", name: "sound/test.wav",
      pcm: { samples: new Int16Array([1]), channels: 1, sampleRate: 22050, frameCount: 1, loopStart: null },
    };
    const sounds = new Q3PresentationSoundBank(new SoundBank(mounts), null, () => asset);
    const pcm = sounds.sound("sound/test.wav", false);
    if (pcm === null) throw new Error("Missing fake sound");
    const identity = createIdentityOwner("q3-audio-stale"), seat = identity.seat(0);
    const played: PlaySound[] = [], looped: LoopSound[] = [], positions: { actor: ActorId; position: unknown }[] = [], stopped: ActorId[] = [];
    const audio = new Q3PresentationAudio({
      seat, sounds, actor: () => null, frameNumber: () => 1,
      play: sound => { played.push(sound); },
      loop: sound => { looped.push(sound); },
      updateActor: (actor, position) => { positions.push({ actor, position }); },
      stopLoop: (_seat, actor) => { stopped.push(actor); },
    });
    const origin = { x: 1, y: 2, z: 3 };

    expect(() => audio.updateSoundPosition(64, origin)).not.toThrow();
    expect(positions).toEqual([]);
    expect(() => audio.stopLoopingSound(64)).not.toThrow();
    expect(stopped).toEqual([]);
    expect(() => audio.addLoopSound(64, origin, origin, pcm, true)).not.toThrow();
    expect(looped).toEqual([]);
    expect(() => audio.startSound(null, 64, 0, pcm)).not.toThrow();
    expect(played).toEqual([]);

    audio.startSound(origin, 64, 0, pcm);
    expect(played).toHaveLength(1);
    expect(played[0]?.actor).toBeNull();
    expect(played[0]?.origin).toEqual({ kind: "fixed", position: origin });

    played.length = 0;
    expect(() => audio.startSourceSound(pcm, { entity: 64, channel: 0, origin: { kind: "entity", entity: 64 }, volume: 127 })).not.toThrow();
    expect(played).toEqual([]);
    audio.startSourceSound(pcm, { entity: 64, channel: 0, origin: { kind: "fixed", position: origin }, volume: 127 });
    expect(played).toHaveLength(1);
    expect(played[0]?.actor).toBeNull();
    expect(played[0]?.origin).toEqual({ kind: "fixed", position: origin });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
