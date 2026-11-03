import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { ActorId } from "../../../../src/contracts/identity.ts";
import type { Vec3 } from "../../../../src/contracts/math.ts";
import type { TraceResult } from "../../../../src/contracts/scene.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { SharedInventoryTable, createQ2CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/index.ts";
import type { Q2TraceRequest } from "../../../../src/content/q2/foundation/host.ts";
import { Q2Foundation } from "../../../../src/content/q2/foundation/runtime.ts";
import { Q2Ballistics } from "../../../../src/content/q2/foundation/weapons/ballistics.ts";
import { Q2Monsters } from "../../../../src/content/q2/foundation/monsters/index.ts";
import { registerQ2ClassicBaseMonsters } from "../../../../src/content/q2/base/monsters/index.ts";
import { Q2MoverModule } from "../../../../src/content/q2/foundation/movers.ts";
import { Q2MissionPackProjectiles } from "../../../../src/content/q2/missionpacks/projectiles/index.ts";
import { registerQ2MissionPackMonsters } from "../../../../src/content/q2/missionpacks/monsters/index.ts";
import type { Q2MonsterMissionPack, Q2MissionPackMonsterServices } from "../../../../src/content/q2/missionpacks/monsters/types.ts";
import { inertAuthority } from "../../../support/authority.ts";
import { q2TestHost } from "../../../support/q2-host.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };

export function missionPackMonsterFixture(pack: Q2MonsterMissionPack) {
  const actors = new SessionActorRegistry(createIdentityOwner("q2-base-monsters")), callbacks = new ActorCallbackTable(actors);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const combat = inertAuthority(actors, callbacks);
  const inventory = new SharedInventoryTable(actors);
  const world = actors.allocateAtSource("q2:game", 0, "q2:worldspawn"), player = actors.allocate("q3:character", "q3:sarge");
  bodies.create(world, { origin: zero, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null });
  bodies.create(player, { origin: { x: 500, y: 0, z: 24 }, angles: zero, velocity: zero, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, ground: world.id });
  combat.create(player, { health: 1000, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  let now = 0, rayActor: ActorId = player.id;
  const random: number[] = [];
  const plane = { normal: { x: 0, y: 0, z: 1 }, distance: 0, type: 2, signbits: 0 };
  const trace = (request: Q2TraceRequest): TraceResult => {
    const clear: TraceResult = { kind: "q2", fraction: 1, startSolid: false, allSolid: false, end: request.end, hit: { kind: "none" }, contact: { kind: "none" }, contents: 0, surface: null, sourcePlane: plane, secondary: null };
    if (request.bounds !== null && request.end.z < request.start.z && request.end.z + request.bounds.min.z <= 0) {
      const z = -request.bounds.min.z;
      return { ...clear, fraction: Math.max(0, (request.start.z - z) / (request.start.z - request.end.z)), end: { ...request.end, z }, hit: { kind: "world", model: 0 }, contact: { kind: "plane", plane }, contents: 1 };
    }
    if (request.bounds === null && (request.mask & 0x2000000) !== 0 && request.ignore !== rayActor) return { ...clear, fraction: 0.8, hit: { kind: "actor", actor: rayActor } };
    return clear;
  };
  const { host, scheduled, events, diagnostics } = q2TestHost({ actors, callbacks, bodies, combat, inventory, world: world.id, players: () => [player.id], entity: actor => game.entity(actor) }, {
    now: () => now, random: () => random.shift() ?? 0.5, trace, pointContents: point => point.z < 0 ? 1 : 0, nearby: () => [...game.entities.values()].map(entity => entity.actor.id), });
  combat.register(createQ2CombatPolicy({ id: "q2:combat", armor: nativeVictimArmor(request => ({ arithmetic: "binary64", screenFacingDot: 1, q2: { product: "classic", ctf: false, alive: (combat.read(request.target)?.health ?? 0) > 0 } })),
    context: request => ({ arithmetic: "binary64", player: request.target === player.id, monster: host.isMonster(request.target), attackerPlayer: request.attack.attacker === player.id,
      hasEnemy: game.entity(request.target)?.enemy !== null, easySkill: false, deathmatch: false, defenderSphere: false, teamDamageEnabled: false, friendlyFire: false,
      nuke: false, noKnockback: true, movable: false, rejectTeamDamage: false, suppressPain: false }) }));
  const weapons = new Q2Ballistics({ emit: () => undefined, noise: () => undefined, dodge: () => undefined, lagCompensation: { kind: "current-world" }, ammoChanged: () => undefined, canTarget: () => true });
  const monsters = new Q2Monsters(weapons), baseModule = registerQ2ClassicBaseMonsters(monsters);
  const movers = new Q2MoverModule({ pathCorner: (corner, game, actor) => monsters.touchPathCorner(corner, game, actor), combatPoint: (point, game, actor) => monsters.touchCombatPoint(point, game, actor) });
  const bolts = new Q2MissionPackProjectiles({ base: weapons, monster: actor => monsters.context(actor), playerEffect: () => undefined });
  const services: Q2MissionPackMonsterServices = { movers, gravity: () => 800, badArea: actor => bolts.badArea(actor, game), badAreaEntity: (actor, origin) => bolts.badAreaEntity(actor, game, origin), markTeslaArea: (self, tesla) => bolts.markTeslaArea(self, game, tesla), powerups: () => ({ quadUntil: 0, doubleUntil: 0, invulnerabilityUntil: 0 }) };
  const module = registerQ2MissionPackMonsters(monsters, pack, bolts, services);
  const game = new Q2Foundation(host, { edition: "classic", mapName: "base1", skill: 1, mode: "singleplayer", deathmatchFlags: 0, maxClients: 1, provider: "q2:game", campaign: "q2:base", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q1:movement" }, [module, baseModule]);
  const playerEntity = game.attachPlayer(player);
  return { module, bolts, services, actors, callbacks, bodies, combat, inventory, player, playerEntity, game, monsters, events, random, diagnostics,
    rayHit(actor: ActorId) { rayActor = actor; },
    spawn(classname: string, values: ReadonlyMap<string, string> = new Map([["origin", "0 0 24"]])) {
      const entity = game.spawn({ classname, ordinal: -1, values });
      const context = monsters.context(entity.actor.id);
      if (context === null) throw new Error(`Missing source monster ${classname}`);
      return context;
    },
    advance(seconds: number) {
      now = seconds; monsters.beginFrame(game);
      for (const [actor, due] of [...scheduled].sort(([a], [b]) => a.id.slot - b.id.slot)) {
        if (due > now + 1e-9 || !actors.isLive(actor.id)) continue;
        scheduled.delete(actor);
        callbacks.think(actor, { frame: Math.round(now * 10), time: { kind: "seconds", value: now }, elapsed: { kind: "seconds", value: 0.1 }, phase: "entity-think" });
      }
    },
  };
}
