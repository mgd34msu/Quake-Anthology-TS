/** SP_worldspawn character precaches and player environment/death callbacks. */
export const Q2_CHARACTER_SOUNDS: readonly string[] = [
  ...[1, 2, 3, 4].map(index => `*death${index}.wav`), "*fall1.wav", "*fall2.wav", "*gurp1.wav", "*gurp2.wav", "*jump1.wav",
  ...[25, 50, 75, 100].flatMap(health => [1, 2].map(index => `*pain${health}_${index}.wav`)),
  "player/fry.wav", "player/lava1.wav", "player/lava2.wav", "player/lava_in.wav", "player/burn1.wav", "player/burn2.wav", "player/drown1.wav",
  "player/gasp1.wav", "player/gasp2.wav", "player/watr_in.wav", "player/watr_out.wav", "player/watr_un.wav", "player/u_breath1.wav", "player/u_breath2.wav",
  "player/land1.wav", "misc/udeath.wav", "misc/h2ohit1.wav", "world/land.wav",
  ...[1, 2, 3, 4].map(index => `player/step${index}.wav`),
];
export const Q2_CHARACTER_MODELS: readonly string[] = ["sm_meat", "arm", "bone", "bone2", "chest", "skull", "head2"].map(name => `models/objects/gibs/${name}/tris.md2`);
