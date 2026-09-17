import type { ActorId } from "../../../contracts/identity.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { BotKnowledge } from "../../../bots/behavior/rerelease/data/knowledge.ts";
import { BotContents, BotEntityKind, type BotWorldT, type BotEntityT, type BotSoundT } from "../../../bots/behavior/rerelease/world.ts";
import { SourceRereleaseNavigation } from "../../../bots/behavior/rerelease/nav.ts";
import type { ApplicationBotNavigation } from "./navigation.ts";
import type { SharedSimulation } from "./runtime.ts";
import type { BotGameModeT } from "../../../bots/behavior/rerelease/data/knowledge.ts";
export interface RereleaseBotObjectives {
  admit(actor: ActorId): void;
  mode(): BotGameModeT;
  team(actor: ActorId): number;
  carrying(actor: ActorId): boolean;
  goal(actor: ActorId): Vec3 | null;
}
export interface RereleaseWorldOptions {
  readonly simulation: SharedSimulation;
  readonly navigation: ApplicationBotNavigation;
  readonly knowledge: BotKnowledge;
  readonly objectives: RereleaseBotObjectives;
  isBot(actor: ActorId): boolean;
  identify(actor: ActorId): number;
  elapsed(): number;
  sounds(): readonly BotSoundT[];
}
function normalized(name: string): string { return name.replace(/^.*:/, "").replace(/^.*weapon[/_]/, "").replaceAll("_", "").replaceAll("/", ""); }
export function nativeWeaponItem(simulation: SharedSimulation, actor: ActorId, knowledge: BotKnowledge, number: number): ItemId | null {
  const weapon = knowledge.weaponByNumber(number);
  return weapon === undefined ? null : simulation.playerUi(actor).items.find(item => item.kind === "weapon" && normalized(item.id) === normalized(weapon.name))?.id ?? null;
}
export function createRereleaseBotWorld(options: RereleaseWorldOptions, actor: ActorId): BotWorldT {
  const { simulation, knowledge, objectives } = options;
  const numeric = simulation.recipe.timing.find(entry => entry.provider === simulation.recipe.engineBehavior.provider)?.numeric;
  if (numeric === undefined) throw new Error("Native bot world requires source numeric policy");
  const policy = { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true } satisfies import("../../../contracts/scene.ts").TracePolicy;
  const player = () => { const value = simulation.movementPlayer(actor); if (value === null) throw new Error("Native bot lost shared player"); return value; };
  const nav = new SourceRereleaseNavigation(options.navigation.forClient(player().client.slot));
  const trace = (start: Vec3, end: Vec3, shape: import("../../../contracts/scene.ts").TraceShape) => {
    const result = simulation.scene.trace({ start, end, shape, target: { kind: "world" }, policy, numeric, passActor: actor });
    return { fraction: result.fraction, endpos: result.end, startsolid: result.startSolid || result.allSolid, hitId: result.hit.kind === "actor" ? options.identify(result.hit.actor) : -1 };
  };
  return {
    time: () => simulation.timeSeconds, frameTime: () => options.elapsed() / 1000,
    self: () => {
      const movement = player(), body = simulation.bodies.read(actor), ui = simulation.playerUi(actor);
      if (body === null) throw new Error("Native bot lost shared body");
      let items = 0, currentWeapon = 0;
      const ammo: Record<string, number> = {};
      for (const weapon of knowledge.weapons) {
        const item = nativeWeaponItem(simulation, actor, knowledge, weapon.number);
        if (item !== null && simulation.inventory.count(actor, item) > 0) items |= weapon.number;
        if (item === ui.activeWeapon) currentWeapon = weapon.number;
        const ammoName = weapon.ammoName;
        const match = ui.inventory.find(entry => normalized(entry.item) === normalized(ammoName));
        if (ammoName !== "") ammo[ammoName] = match?.count ?? 0;
      }
      return { id: options.identify(actor), origin: body.origin, velocity: body.velocity, viewAngles: movement.viewAngles,
        eye: { ...body.origin, z: body.origin.z + movement.viewHeight }, health: ui.health,
        armor: ui.armor.kind === "none" ? 0 : ui.armor.points, items, ammo, currentWeapon,
        onGround: body.ground !== null, waterLevel: movement.waterLevel, team: objectives.team(actor), dead: ui.health <= 0,
        hasProtection: simulation.combat.read(actor)?.invulnerable ?? false, carryingObjective: objectives.carrying(actor) };
    },
    traceLine: (start, end) => trace(start, end, { kind: "point" }),
    traceBox: (start, min, max, end) => trace(start, end, { kind: "box", bounds: { min, max } }),
    pointContents: point => {
      const result = simulation.scene.pointContents({ point, target: { kind: "world" }, policy, numeric, passActor: actor });
      if (result.kind !== "q3") throw new Error("Native bot contents projection lost its selected policy");
      return (result.contents & 8) !== 0 ? BotContents.Lava : (result.contents & 16) !== 0 ? BotContents.Slime
        : (result.contents & 32) !== 0 ? BotContents.Water : (result.contents & 1) !== 0 ? BotContents.Solid : BotContents.Empty;
    },
    entities: () => {
      const entities: BotEntityT[] = [];
      for (const observation of simulation.actors.observations()) {
        const target = observation.id, body = simulation.bodies.read(target);
        if (body === null || !simulation.bodies.linked(target)) continue;
        const movement = simulation.movementPlayer(target), combat = simulation.combat.read(target);
        const entity = simulation.botEntity(target);
        if (entity?.hidden === true || entity === null && movement === null) continue;
        const classname = movement !== null ? "player" : entity?.classname ?? "";
        const kind = movement !== null ? BotEntityKind.Player : classname.startsWith("monster_") ? BotEntityKind.Monster
          : knowledge.item(classname) !== undefined ? BotEntityKind.Item : BotEntityKind.Interactable;
        entities.push({ id: options.identify(target), kind, classname, origin: body.origin, velocity: body.velocity,
          center: { x: body.origin.x + (body.bounds.min.x + body.bounds.max.x) / 2, y: body.origin.y + (body.bounds.min.y + body.bounds.max.y) / 2, z: body.origin.z + (body.bounds.min.z + body.bounds.max.z) / 2 },
          head: { ...body.origin, z: body.origin.z + body.bounds.max.z }, feet: { ...body.origin, z: body.origin.z + body.bounds.min.z },
          health: combat?.health ?? entity?.health ?? 0, team: objectives.team(target), dead: combat !== null && combat.health <= 0,
          invisible: false, waterLevel: movement?.waterLevel ?? 0, isBot: options.isBot(target), spawnflags: entity?.spawnflags ?? 0,
          hasHealth: (combat?.health ?? entity?.health ?? 0) > 0, hasTargetname: entity !== null && entity.targetname !== "", carryingObjective: objectives.carrying(target) });
      }
      return entities;
    },
    hearing: options.sounds, nav: () => nav,
  };
}
