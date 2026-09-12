export { Q1Foundation, ammoItem } from "./runtime.ts";
export type { Q1SpawnReport } from "./runtime.ts";
export { Q1Actor, parseVector, sourceAngles, moveDirection } from "./entity.ts";
export type { Q1Monster, Q1Move } from "./entity.ts";
export type { Q1FoundationHost, Q1FoundationOptions, Q1PlayerState, Q1Event, Q1Presentation, Q1Weapon, Q1Powerup, Q1Trace, Q1TraceRequest, Q1Solid, Q1MoveType } from "./types.ts";
export { Q1_PROVIDER, PLAYER_BOUNDS, WEAPONS, weaponItem } from "./types.ts";
export { fireBullets, bestWeapon, fireWeapon, weaponModel } from "./weapons.ts";
export { spawnMapActor, linkDoors } from "./spawns.ts";
export { spawnPickup, observeQ1Supply } from "./pickups.ts";

export type { Q1CallbackHandlers, Q1StateExtension } from "./callbacks.ts";
export { callbackName } from "./callbacks.ts";
export type { Q1FoundationCheckpoint, Q1SavedEntity, Q1SavedPlayer, Q1EntitySourceState, Q1SavedCallbacks } from "./checkpoint.ts";
export { saveQ1Actor } from "./checkpoint.ts";

export type { Q1WeaponDefinition, Q1PlayerExtension } from "./extensions.ts";
export type { Q1BaseWeapon } from "./types.ts";
export { Q1_WEAPON_IDS, Q1_POWERUP_IDS, isQ1BaseWeapon } from "./types.ts";
export type { Q1MonsterSpecies } from "./entity.ts";
export { Q1_MONSTER_SPECIES } from "./entity.ts";

export type { Q1SoundChannel } from "./types.ts";

export type { Q1PickupRules } from "./extensions.ts";

export type { Q1Basis } from "./types.ts";

export type { Q1WeaponRules } from "./extensions.ts";

export { fireBaseWeapon } from "./weapons.ts";

export { spawnTeleportFog, spawnTeledeath } from "./spawns.ts";

export { Q1EntityServices } from "./entity-services.ts";
