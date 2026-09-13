/* Official mission-pack weapon and item registration over shared Q1 authority. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Q1EntityServices } from "../foundation/entity-services.ts";
import type { Q1PlayerState, Q1Weapon } from "../foundation/types.ts";
import { fireHipnoticLaser, fireHipnoticMjolnir, fireHipnoticProximity, registerHipnoticWeaponCallbacks } from "./hipnotic-weapons.ts";
import { fireRogueLava, fireRogueMultiGrenade, fireRogueMultiRocket, fireRoguePlasma, registerRogueWeaponCallbacks } from "./rogue-weapons.ts";
import { registerMissionPackItems } from "./items.ts";
import { MissionPackPlayers } from "./player.ts";
import { RogueGrapple } from "./grapple.ts";
import { registerMissionPackPickupRules } from "./pickup-rules.ts";
import { missionWeaponImpulse } from "./selection.ts";
import { missionWeapons } from "./types.ts";
import type { MissionWeapon, Q1MissionPack } from "./types.ts";
import { registerRogueTossCallbacks, tossRogueBackpack, tossRogueWeapon } from "./backpacks.ts";

function fire(game: Q1EntityServices, player: Q1PlayerState, weapon: MissionWeapon): boolean {
  switch (weapon) {
    case "hipnotic:laser": return fireHipnoticLaser(game, player);
    case "hipnotic:mjolnir": return fireHipnoticMjolnir(game, player);
    case "hipnotic:proximity": return fireHipnoticProximity(game, player);
    case "rogue:lava-nailgun": case "rogue:lava-supernailgun": return fireRogueLava(game, player);
    case "rogue:multi-grenade": return fireRogueMultiGrenade(game, player);
    case "rogue:multi-rocket": return fireRogueMultiRocket(game, player);
    case "rogue:plasma": return fireRoguePlasma(game, player);
  }
}
function animate(game: Q1EntityServices, player: Q1PlayerState, seconds: number): undefined {
  if (player.continuousFiring || player.weaponAnimationAt < 0) return undefined;
  const step = Math.floor((seconds - player.weaponAnimationAt) / 0.1), frame = step >= 6 ? 0 : player.weapon === "hipnotic:mjolnir" ? Math.min(4, step + 1) : step + 1;
  if (frame !== player.weaponFrame) { player.weaponFrame = frame; game.host.emit({ kind: "weapon", player: player.actor.id, weapon: player.weapon, viewModel: game.weaponModel(player.weapon), frame, punch: 0 }); }
  if (step >= 6) player.weaponAnimationAt = -1; return undefined;
}
function registerWeaponDefinitions(game: Q1EntityServices, pack: Q1MissionPack): void {
  for (const weapon of missionWeapons) if (weapon.id.startsWith(`${pack}:`)) game.registerWeapon({
    id: weapon.id, ammo: weapon.ammo, model: weapon.model, rank: weapon.rank,
    bestAvailable: (runtime, player) => weapon.id !== "rogue:lava-supernailgun" || runtime.host.inventory.count(player.actor.id, "rogue:ammo/lava-nails") >= 2,
    fire: (runtime, player) => fire(runtime, player, weapon.id), animate,
  });
  const order: readonly Q1Weapon[] = pack === "hipnotic" ? ["lightning", "hipnotic:laser", "supernailgun", "supershotgun", "nailgun", "shotgun", "hipnotic:mjolnir", "axe"] :
    ["lightning", "rogue:lava-supernailgun", "supernailgun", "rogue:lava-nailgun", "nailgun", "supershotgun", "shotgun", "axe"];
  game.registerWeaponOrder(`q1:${pack}`, order);
}

export function registerHipnoticWeapons(game: Q1EntityServices): void {
  registerHipnoticWeaponCallbacks(game);
  registerWeaponDefinitions(game, "hipnotic");
}

export class MissionPackArsenal {
  readonly players: MissionPackPlayers;
  private charmer: ActorId | null = null;
  get hornCharmer(): ActorId | null { return this.charmer; }
  impulse(actor: ActorId, impulse: number): boolean {
    const player = this.game.player(actor); if (player === null) return false;
    if (this.pack === "rogue" && (impulse === 20 || impulse === 21)) { if (impulse === 20) tossRogueBackpack(this.game, player); else tossRogueWeapon(this.game, player); return true; }
    this.players.enableCombos(player); return missionWeaponImpulse(this.game, player, this.pack, impulse);
  }
  constructor(readonly game: Q1EntityServices, readonly pack: Q1MissionPack) {
    this.players = new MissionPackPlayers(game, pack);
    registerMissionPackPickupRules(game, pack, this.players);
    if (pack === "hipnotic") registerHipnoticWeapons(game);
    else {
      registerRogueWeaponCallbacks(game); registerRogueTossCallbacks(game, this.players); new RogueGrapple(game);
      registerWeaponDefinitions(game, pack);
    }
    registerMissionPackItems(game, {
      pack, powerup: (player, powerup, seconds) => this.players.powerup(player, powerup, seconds), sphere: (item, player) => this.players.sphere(item, player), enableCombos: player => this.players.enableCombos(player),
      horn: (item, player) => {
        const previous = this.charmer; this.charmer = player.actor.id;
        try { return game.useTargets(item, player.actor.id); } finally { this.charmer = previous; }
      },
    });
  }
}
export function registerMissionPackArsenal(game: Q1EntityServices, pack: Q1MissionPack): MissionPackArsenal { return new MissionPackArsenal(game, pack); }
