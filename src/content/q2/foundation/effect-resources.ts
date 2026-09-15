// Q2 CL_RegisterTEntModels resources consumed by the common effect renderer.
export const Q2_TRANSIENT_MODELS = Object.freeze({
  cable: "models/ctf/segment/tris.md2",
  parasite: "models/monsters/parasite/segment/tris.md2",
  explosion: "models/objects/explode/tris.md2",
  flash: "models/objects/flash/tris.md2",
  rocketExplosion: "models/objects/r_explode/tris.md2",
  smoke: "models/objects/smoke/tris.md2",
  lightning: "models/proj/lightning/tris.md2",
  bfgExplosion: "sprites/s_bfg2.sp2",
});

// CL_RegisterTEntSounds, shared by native and selected Q2 effect producers.
export const Q2_TRANSIENT_SOUNDS: readonly string[] = [
  "world/ric1.wav", "world/ric2.wav", "world/ric3.wav", "weapons/lashit.wav",
  "world/spark5.wav", "world/spark6.wav", "world/spark7.wav", "weapons/railgf1a.wav",
  "weapons/rocklx1a.wav", "weapons/grenlx1a.wav", "weapons/xpld_wat.wav",
  "player/land1.wav", "player/fall2.wav", "player/fall1.wav", "weapons/tesla.wav", "weapons/disrupthit.wav",
];
