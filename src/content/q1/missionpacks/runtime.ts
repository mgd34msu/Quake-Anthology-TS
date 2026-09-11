import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import type { Q1Foundation } from "../foundation/runtime.ts";
import type { Q1Base } from "../base/provider.ts";
import { MissionPackArsenal } from "./arsenal.ts";
import { becomeDecoy, registerMissionPackMonsters } from "./monsters/index.ts";
import type { Q1MissionPackMonsters } from "./monsters/index.ts";
import { registerMissionpackWorld } from "./world/index.ts";
import type { MissionpackWorldHooks, Q1MissionpackWorld } from "./world/index.ts";
import type { Q1MissionPack } from "./types.ts";
import type { Q1TravelState } from "../base/travel.ts";
import { admitMissionPackTravel, captureMissionPackTravel, decodeMissionPackTravel, newMissionPackTravel } from "./travel.ts";
import { dropMissionPackBackpack } from "./backpacks.ts";
import { dumpMissionPackCoordinates, missionPackCommand } from "./commands.ts";
import type { MissionPackCommandOptions } from "./commands.ts";
import type { Q1CharacterPresentation, Q1CharacterSourcePose } from "../base/player.ts";
import { MissionPackCharacterEffects, missionPackCharacterPose } from "./presentation.ts";
import { missionPackObituary } from "./obituaries.ts";
import type { Q1MissionPackObituaryInput } from "./obituaries.ts";
import type { Q1Obituary } from "../base/rules.ts";

export type Q1MissionPackOptions = Omit<MissionpackWorldHooks, "charmer" | "charm" | "becomeDecoy"> & MissionPackCommandOptions & { readonly footsteps?: () => boolean; };
export class Q1MissionPackRuntime {
  readonly arsenal: MissionPackArsenal;
  readonly monsters: Q1MissionPackMonsters;
  readonly world: Q1MissionpackWorld;
  private readonly characterEffects: MissionPackCharacterEffects;
  constructor(readonly game: Q1Foundation, readonly base: Q1Base, readonly pack: Q1MissionPack, readonly options: Q1MissionPackOptions = {}) {
    this.arsenal = new MissionPackArsenal(game, pack);
    this.characterEffects = new MissionPackCharacterEffects(game, pack, options.footsteps ?? (() => false));
    this.monsters = registerMissionPackMonsters(game, base, pack, { charmer: () => this.arsenal.hornCharmer });
    this.world = registerMissionpackWorld(game, pack, { ...options, charmer: () => this.arsenal.hornCharmer, charm: (entity, charmer) => this.monsters.charm(entity, charmer), becomeDecoy: (target, origin) => becomeDecoy(this.monsters, target, origin) });
    game.registerPlayerExtension({ id: `q1:${pack}:world-postthink`, afterPhysics: (_runtime, player, seconds) => this.world.afterPhysics(player.actor.id, seconds) });
    if (pack === "hipnotic") game.registerPlayerExtension({ id: "q1:hipnotic:coordinate-dump", frame: (runtime, player) => dumpMissionPackCoordinates(runtime, player) });
  }
  impulse(actor: ActorId, impulse: number): boolean {
    const player = this.game.player(actor); if (player === null) return false;
    return missionPackCommand(this.game, this.base, this.arsenal.players, player, this.pack, impulse, this.options) || this.arsenal.impulse(actor, impulse) || this.world.impulse(actor, impulse);
  }
  playerSpawned(actor: ActorId): undefined { return this.world.playerSpawned(actor); }
  confirmedDamage(target: ActorId, attacker: ActorId | null): undefined { return this.world.confirmedDamage(target, attacker); }
  playerDied(actor: ActorId, attacker: ActorId | null = null): undefined {
    const source = this.game.entity(attacker);
    return this.world.playerDied(actor, this.pack === "rogue" && source?.classname === "power_shield" ? source.owner : attacker);
  }
  newTravel(): Q1TravelState { return newMissionPackTravel(this.game, this.pack); }
  captureTravel(actor: OwnedActor): Q1TravelState { return captureMissionPackTravel(this.game, actor, this.pack); }
  decodeTravel(state: Q1TravelState, serverFlags: number): Q1TravelState { return decodeMissionPackTravel(this.game, state, serverFlags, this.pack); }
  admitTravel(actor: OwnedActor, state: Q1TravelState): undefined { return admitMissionPackTravel(this.game, actor, state, this.pack); }
  dropBackpack(actor: OwnedActor): Q1Actor | null { return dropMissionPackBackpack(this.game, actor, this.pack); }
  characterPose(actor: ActorId): Q1CharacterSourcePose { return missionPackCharacterPose(this.game, actor, this.pack); }
  characterFrame(actor: ActorId, presentation: Q1CharacterPresentation): undefined { return this.characterEffects.frame(actor, presentation); }
  selectSpawn(actor: ActorId): Q1Actor | undefined { return this.world.selectSpawn(actor); }
  obituary(input: Q1MissionPackObituaryInput, inflictor: ActorId | null): Q1Obituary {
    return missionPackObituary(input, { pack: this.pack, inflictorClassname: inflictor === null ? "" : this.game.host.classname(inflictor),
      attackerDeathType: this.game.entity(input.attacker?.actor ?? null)?.text("deathtype") ?? "", victimSavedTeam: this.world.savedTeam(input.victim.actor), gamecfg: this.options.gamecfg?.() ?? 0,
      tagScore: () => input.attacker === null ? 1 : this.world.tagScore(input.victim.actor, input.attacker.actor),
    });
  }
}
export function registerQ1MissionPack(game: Q1Foundation, base: Q1Base, pack: Q1MissionPack, options: Q1MissionPackOptions = {}): Q1MissionPackRuntime {
  return new Q1MissionPackRuntime(game, base, pack, options);
}
