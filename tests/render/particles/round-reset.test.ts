import { expect, test } from "bun:test";
import { ParticleSystem, loadParticleAnimations } from "../../../src/render/scene/particles/q3-system.ts";
import { GameRandom } from "../../../src/core/game-numeric.ts";
import { anglesToAxis } from "../../../src/core/math.ts";

test("particle round reset clears active entries and retains registered animation handles", async () => {
  let registrations = 0, time = 0;
  const animations = await loadParticleAnimations({ registerShader: async name => { registrations++; return { name }; } });
  const system = new ParticleSystem({ get time() { return time; }, refdef: { viewAxis: anglesToAxis({ x: 0, y: 0, z: 0 }) }, snap: { playerState: { origin: { x: -100, y: 0, z: 0 } } } }, {
    animations, media: { tracerShader: null, smokePuffShader: null, waterBubbleShader: null }, random: new GameRandom(7), hardwareType: "generic",
    prediction: { trace: (_start, end) => ({ end, fraction: 1, solidity: "clear", entityNum: 1022 }) }, configString: () => "", print: () => undefined });
  const explode = () => system.explosion({ animation: "explode1", origin: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, duration: 1000, sizeStart: 4, sizeEnd: 16 });
  explode(); const shader = system.addParticles()[0]?.shader, count = registrations;
  expect(shader).toBeDefined(); expect(system.activeCount).toBe(1);
  for (let round = 0; round < 3; round++) {
    system.resetRound(); expect(system.activeCount).toBe(0); expect(system.addParticles()).toEqual([]);
    time += 400; explode(); expect(system.addParticles()[0]?.shader).toBe(shader); expect(registrations).toBe(count);
  }
});
