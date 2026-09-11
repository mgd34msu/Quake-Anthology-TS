import { expect, test } from "bun:test";
import { ApplicationAudio } from "../../src/app/bootstrap/audio.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import type { SimulationPresentationEvent } from "../../src/app/bootstrap/simulation/types.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { AudioListener } from "../../src/audio/types.ts";
import { EntityEvent } from "../../src/movement/q3/constants.ts";
import { q2MuzzleSounds } from "../../src/app/bootstrap/audio/q2-events.ts";

// Run with SDL_AUDIODRIVER=dummy; this exercises the normal shared mixer/device path.
test("bootstrap plays source player events, filters a wet listener, replaces music and closes world audio", async () => {
  const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--character", "q2", "--movement", "q2"]);
  if (command.kind !== "run") throw new Error("Expected run options");
  const content = await loadApplicationContent(command.options);
  const identity = createIdentityOwner("bootstrap-audio");
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 });
  const player = simulation.admitPlayer(identity.client(0, 0));
  const snapshot = simulation.step({ elapsedMilliseconds: 100, commands: [] }).snapshot;
  const events = simulation.drainPresentationEvents();
  const playerView = events.find(event => event.kind === "q2-player" && event.event.kind === "view");
  if (playerView?.kind !== "q2-player" || playerView.event.kind !== "view") throw new Error("Player source did not publish a view");
  const actor = player.actor, seat = identity.seat(0), origin = simulation.playerView(actor).origin;
  const listener: AudioListener = { actor, seat, origin, axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], gain: 1, underwater: false };
  const messages: string[] = [];
  const createAudio = (): ApplicationAudio => new ApplicationAudio(content, () => 1000, 1, "missing-custom-model", text => { messages.push(text); return undefined; });
  const source = { content: content.recipe.character.definition.content, sequence: 100, seconds: 1 };
  const loop: SimulationPresentationEvent = { ...source, kind: "q2", event: { kind: "sound", actor, origin,
    path: "weapons/rg_hum.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "start" } };
  let dry: Int16Array = new Int16Array();
  try {
    const audio = createAudio();
    try {
      await audio.frame(snapshot, [listener], [loop]);
      expect(audio.engine.outputState).toBe("playing");
      dry = audio.engine.mix(1024);
      expect(dry.some(sample => sample !== 0)).toBe(true);
      await audio.frame({ ...snapshot, actors: [], bodies: [] }, [listener], []);
      expect(audio.engine.mix(1024).every(sample => sample === 0)).toBe(true);
    } finally { audio.close(); }
    const audioWet = createAudio();
    try {
      await audioWet.frame(snapshot, [listener], [loop, { ...playerView, event: { ...playerView.event, view: { ...playerView.event.view, underwater: true } } }]);
      const wet = audioWet.engine.mix(1024);
      expect(wet.some(sample => sample !== 0)).toBe(true);
      expect(wet).not.toEqual(dry);
      audioWet.engine.stopAll();
      await audioWet.receive([
        { ...source, kind: "q2-player", event: { kind: "userinfo", actor, slot: 0, name: "player", skin: "missing-model/default" } },
        { ...source, kind: "q2", event: { kind: "sound", actor, origin, path: "*pain25_1.wav", channel: 2, volume: 1, attenuation: 1, reliable: false, loop: "once" } },
      ]);
      expect(audioWet.engine.mix(4096).some(sample => sample !== 0)).toBe(true);
      audioWet.engine.stopAll();
      const q3 = content.catalog.require("q3-baseq3").id;
      await audioWet.receive([{ ...source, content: q3, kind: "q3-character", event: { actor: identity.ownedActor(actor, "q3:character"),
        sequence: 1, timeMilliseconds: 1000, event: EntityEvent.EV_PAIN, parameter: 20 } }]);
      expect(audioWet.engine.mix(4096).some(sample => sample !== 0)).toBe(true);
      audioWet.engine.stopAll();
      await audioWet.receive([{ ...source, content: q3, kind: "q3-character", event: { actor: identity.ownedActor(actor, "q3:character"),
        sequence: 2, timeMilliseconds: 1200, event: EntityEvent.EV_PAIN, parameter: 20 } }]);
      expect(audioWet.engine.mix(128).every(sample => sample === 0)).toBe(true);
      await audioWet.playMusic(source.content, "2");
      expect(audioWet.engine.mix(22050).some(sample => sample !== 0)).toBe(true);
      await audioWet.playMusic(source.content, "03.ogg");
      expect(audioWet.engine.mix(22050).some(sample => sample !== 0)).toBe(true);
      await audioWet.playMusic(source.content, "2");
      expect(audioWet.engine.mix(22050).some(sample => sample !== 0)).toBe(true);
      await audioWet.playMusic(source.content, "0");
      expect(audioWet.engine.mix(128).every(sample => sample === 0)).toBe(true);
      expect(q2MuzzleSounds(5, true, () => 2).map(sound => [sound.volume, sound.delaySeconds])).toEqual([[0.2, 0], [0.2, 0.033], [0.2, 0.066]]);
    } finally { audioWet.close(); }
    expect(audioWet.engine.outputState).toBe("closed");
    expect(messages).toEqual([]);
  } finally { simulation.close(); await content.close(); }
}, 120000);
