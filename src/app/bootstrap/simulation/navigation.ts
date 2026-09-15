import { SaveReader } from "../../../persistence/value.ts";
import type { NavigationRuntimeCheckpoint } from "../../../bots/navigation/runtime.ts";
import type { SelectedBotNavigation } from "../../../bots/behavior/index.ts";
import { projectBotMovement } from "../../../bots/behavior/prediction.ts";
import type { BotMovementPrediction } from "../../../bots/behavior/q3/navigation-types.ts";
import { createMovementAdmission, createMovementRouteAdmission, loadNavigation, NavigationRuntime } from "../../../bots/navigation/index.ts";
import type { NavigationPredictionDriver, NavigationProfile, NavigationWorld } from "../../../bots/navigation/index.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { LoadedApplicationContent } from "../content.ts";
import { movementOrigin } from "./players.ts";
import type { MovementPlayer } from "./players.ts";
import type { SharedSimulation } from "./runtime.ts";
import { capturePlayerLocomotion, playerLocomotionMatches, createPlayerMovementPrediction, locomotionTemplate, movementObservation, playerCrouchedBounds, playerTracePolicy, selectedMovementProfile } from "./player-movement.ts";
import type { LocomotionPlayer } from "./player-movement.ts";
import { MoverState } from "../../../content/q3/base/game/state.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
function profileFor(player: LocomotionPlayer): NavigationProfile {
  const movement = selectedMovementProfile(player);
  const crouches = movement.kind === "q2-classic" || movement.kind === "q2-rerelease" || movement.kind === "q3";
  return { movement, shape: { kind: "box", bounds: player.standingBounds },
    ...(crouches ? { crouchedShape: { kind: "box", bounds: playerCrouchedBounds(player) } } satisfies Pick<NavigationProfile, "crouchedShape"> : {}),
    policy: playerTracePolicy(player),
    capabilities: new Set(crouches ? ["walk", "crouch", "jump", "drop", "swim", "water-jump", "ladder", "mover"]
      : ["walk", "jump", "drop", "swim", "water-jump", "ladder", "mover"]),
    maximumStep: 18, minimumFloorNormal: 0.7, maximumDrop: 128, team: null, monster: false };
}

export interface ApplicationBotNavigationCheckpoint {
  readonly version: 1;
  readonly base: NavigationRuntimeCheckpoint;
  readonly clients: readonly { readonly client: number; readonly reusable: boolean; readonly runtime: NavigationRuntimeCheckpoint }[];
}
export interface ApplicationBotNavigation extends SelectedBotNavigation {
  restartRound(): void;
  checkpoint(): ApplicationBotNavigationCheckpoint;
  restoreCheckpoint(value: unknown, remapClient?: (saved: number) => number): void;
}
export interface ApplicationBotNavigationOptions { readonly content: LoadedApplicationContent; readonly simulation: SharedSimulation; }
export async function createApplicationBotNavigation({ content, simulation }: ApplicationBotNavigationOptions): Promise<ApplicationBotNavigation> {
  if (content.recipe !== simulation.recipe) throw new Error("Navigation and simulation must use the same loaded recipe");
  const firstPlayer = () => simulation.players().map(actor => simulation.movementPlayer(actor)).find(player => player !== null) ?? null;
  const first = firstPlayer() ?? locomotionTemplate(content.recipe);
  const playerFor = (client: number): Readonly<MovementPlayer> => {
    const player = simulation.players().map(actor => simulation.movementPlayer(actor)).find(value => value?.client.slot === client);
    if (player === undefined || player === null) throw new Error(`Navigation client ${client} is not admitted`);
    return player;
  };
  const worldFor = (selectedPlayer: Readonly<MovementPlayer> | null): NavigationWorld => {
    const driver: NavigationPredictionDriver = { begin: (request, selected) => {
      const player = selectedPlayer ?? firstPlayer();
      if (player === null) return null;
      const projection = createPlayerMovementPrediction(simulation, player, request.from, zero, 16, false, selected.movement);
      return { ...projection, input(previous, index, action) {
        const at = previous?.status === "active" ? movementOrigin(previous.state) : request.from;
        const x = action.to.x - at.x, y = action.to.y - at.y, distance = Math.hypot(x, y);
        const scale = distance === 0 ? 0 : Math.min(400, distance * 20) / distance;
        return projection.input(previous, index, { x: x * scale, y: y * scale,
          z: action.mode === "jump" || action.mode === "water-jump" || action.mode === "ladder" ? 400 : action.mode === "crouch" ? -400 : 0 });
      } };
    } };
    return { scene: simulation.scene, passActor: selectedPlayer?.actor.id ?? null, get revision() { return simulation.timeSeconds * 1000; },
      admit: createMovementAdmission(driver), beginRoute: selected => createMovementRouteAdmission(driver, selected),
      entity: binding => {
        for (const { body, collision } of simulation.scene.queryActors(simulation.scene.modelBounds(0))) {
          if (collision.shape.kind !== "model" || collision.shape.model !== binding.model) continue;
          const common = { actor: body.actor, bounds: body.absoluteBounds, velocity: body.state.velocity };
          const q1 = simulation.q1Source()?.game.entity(body.actor);
          if (q1 !== undefined && q1 !== null) {
            const master = q1.doorGroup[0] ?? q1;
            const key = (master.spawnflags & 8) !== 0 ? "q1:key/gold" : (master.spawnflags & 16) !== 0 ? "q1:key/silver" : null;
            const player = selectedPlayer ?? firstPlayer();
            const needsKey = key !== null && master.touch !== null && (player === null || simulation.inventory.count(player.actor.id, key) === 0);
            return { ...common, enabled: q1.solid === "bsp", destination: q1.move?.destination ?? null,
              locked: q1.classname === "func_plat" ? !q1.activated : q1.classname === "func_door"
                && (master.state === "bottom" || master.state === "down")
                && (master.targetname !== "" || master.maxHealth > 0 || (master.spawnflags & 4) !== 0 || needsKey) };
          }
          const q2 = simulation.q2Source(), entity = q2?.game.entity(body.actor);
          if (q2 !== null && entity !== undefined && entity !== null) {
            const platform = q2.baseEntities.platformState(entity);
            return { ...common, enabled: entity.solid === "brush", ...(q2.baseEntities.moverTraversal(entity) ?? q2.movers.traversal(entity)),
              ...(platform === null ? {} : { elevator: { ...platform, origin: body.state.origin } }) };
          }
          const q3 = simulation.q3Source()?.records.nativeByActor(body.actor);
          if (q3 !== undefined && q3 !== null) {
            const master = q3.teammaster ?? q3;
            const source = simulation.q3Source();
            const automatic = simulation.scene.queryActors(simulation.scene.modelBounds(0), "trigger").some(({ body: trigger }) => {
              const entity = source?.records.nativeByActor(trigger.actor);
              return entity?.classname === "door_trigger" && entity.parent === master && entity.r.linked && entity.touch !== null;
            });
            return { ...common, enabled: q3.r.linked,
              locked: master.moverState === MoverState.POS1 && (q3.classname === "func_door" && !automatic
                || q3.classname === "func_plat" && master.targetname !== null),
              destination: q3.moverState === MoverState.ONE_TO_TWO ? q3.pos2 : q3.moverState === MoverState.TWO_TO_ONE ? q3.pos1 : null };
          }
          return null;
        }
        return null;
      }, hazard: bounds => {
        for (const { body } of simulation.scene.queryActors(bounds)) {
          const q1 = simulation.q1Source()?.game.entity(body.actor);
          if (q1?.classname === "trigger_hurt" && q1.solid === "trigger" && q1.damage > 0 && q1.touch !== null) return true;
          const q2 = simulation.q2Source(), entity = q2?.game.entity(body.actor);
          if (entity?.classname === "trigger_hurt" && entity.solid === "trigger" && entity.damage > 0 && entity.touch !== null
            && q2 !== null && entity.timestamp <= q2.game.host.now()) return true;
          const q3 = simulation.q3Source(), native = q3?.records.nativeByActor(body.actor);
          if (native?.classname === "trigger_hurt" && native.r.linked && native.damage > 0 && native.touch !== null
            && q3 !== null && native.timestamp <= q3.level.time) return true;
        }
        return false;
      } };
  };
  const profile = profileFor(first), world = worldFor(firstPlayer());
  const loaded = await loadNavigation({ geometry: simulation.options.world, map: { name: content.recipe.map.geometry.requestedPath,
    format: simulation.options.world.kind, digest: content.recipe.map.geometry.digest }, profile, world,
    resources: await content.forContent(content.recipe.map.geometry.provenance.mount.identity.content),
    navigationContent: content.recipe.map.geometry.provenance.mount.identity.content,
    mapBytes: await content.mounts.read(content.recipe.map.geometry) });
  let baseRuntime = loaded.runtime;
  type CachedNavigation = { readonly player: Readonly<MovementPlayer> | null; readonly runtime: NavigationRuntime; readonly locomotion: LocomotionPlayer };
  const clients = new Map<number, CachedNavigation>();
  const forClient = (client: number): NavigationRuntime => {
    const player = playerFor(client), cached = clients.get(client);
    if (cached?.player === player && playerLocomotionMatches(player, cached.locomotion)) return cached.runtime;
    const runtime = new NavigationRuntime({ ...loaded.runtime.graph, profile: profileFor(player) }, worldFor(player));
    clients.set(client, { player, runtime, locomotion: capturePlayerLocomotion(player) }); return runtime;
  };
  return { get runtime() { return baseRuntime; }, forClient,
    restartRound() {
      const selected = firstPlayer() ?? locomotionTemplate(content.recipe);
      baseRuntime = new NavigationRuntime({ ...loaded.runtime.graph, profile: profileFor(selected) }, worldFor(null));
      clients.clear();
    },
    checkpoint() {
      return { version: 1, base: baseRuntime.checkpoint(), clients: Array.from(clients, ([client, cached]) => {
        const current = simulation.players().map(actor => simulation.movementPlayer(actor)).find(player => player?.client.slot === client);
        return { client, reusable: current !== undefined && current !== null && current === cached.player
          && playerLocomotionMatches(current, cached.locomotion), runtime: cached.runtime.checkpoint() };
      }) };
    },
    restoreCheckpoint(value, remapClient = client => client) {
      const reader = new SaveReader(value, "applicationNavigation");
      reader.field("version").literal(1);
      const base = new NavigationRuntime(baseRuntime.graph, baseRuntime.world);
      base.restoreCheckpoint(reader.field("base").value);
      const restored = new Map<number, CachedNavigation>();
      const savedClients = new Set<number>();
      reader.field("clients").list(entry => {
        const saved = entry.field("client").integer(0), client = remapClient(saved);
        if (!Number.isSafeInteger(client) || client < 0 || savedClients.has(saved) || restored.has(client)) entry.fail("invalid or duplicate navigation client mapping");
        savedClients.add(saved);
        const reusable = entry.field("reusable").boolean();
        const player = reusable ? playerFor(client) : null;
        const locomotion = capturePlayerLocomotion(player ?? first);
        const runtime = new NavigationRuntime({ ...loaded.runtime.graph, profile: profileFor(locomotion) }, worldFor(player));
        runtime.restoreCheckpoint(entry.field("runtime").value);
        restored.set(client, { player, locomotion, runtime });
      });
      baseRuntime.restoreCheckpoint(base.checkpoint());
      clients.clear(); for (const [client, cached] of restored) clients.set(client, cached);
    }, crouchedBounds: profile.crouchedShape?.bounds ?? first.standingBounds,
    travelWeapon: () => null,
    predictClientMovement(query: BotMovementPrediction) {
      const player = playerFor(query.entityNum), projection = createPlayerMovementPrediction(simulation, player, query.origin, query.velocity, Math.round(query.frameTime * 1000), query.presence === 4);
      return projectBotMovement(query, { ...projection,
        input(previous, index, command) {
          return projection.input(previous, index, query.presence === 4 ? { ...command, z: -400 } : command);
        },
        stopEvents(previous, result) {
          if (result.status !== "active") throw new Error("Navigation projection removed its actor");
          const observation = movementObservation(result), grounded = observation.grounded;
          const wasGrounded = previous?.status === "active" ? movementObservation(previous).grounded : query.onGround;
          let flags = !wasGrounded && grounded ? 1 : wasGrounded && !grounded ? 2 : 0;
          if (observation.medium !== "dry") flags |= observation.medium === "slime" ? 8 : observation.medium === "lava" ? 16 : 4;
          if (query.stopArea !== 0 && forClient(query.entityNum).areaAt(observation.origin) === query.stopArea) flags |= 512 | (!wasGrounded && grounded ? 1024 : 0);
          if (observation.damagingFall) flags |= 32;
          return flags;
        } });
    } };
}
