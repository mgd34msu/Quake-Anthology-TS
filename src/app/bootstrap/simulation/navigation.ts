import type { SelectedBotNavigation } from "../../../bots/behavior/index.ts";
import { projectBotMovement } from "../../../bots/behavior/prediction.ts";
import type { BotMovementPrediction } from "../../../bots/behavior/q3/navigation-types.ts";
import { createMovementAdmission, createMovementRouteAdmission, loadNavigation, NavigationRuntime } from "../../../bots/navigation/index.ts";
import type { NavigationPrediction, NavigationPredictionDriver, NavigationProfile, NavigationWorld } from "../../../bots/navigation/index.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { MovementInput, MovementProfile, MovementProvider, MovementState } from "../../../contracts/movement.ts";
import type { TracePolicy } from "../../../contracts/scene.ts";
import { createQ1MovementProvider, createQwMovementProvider } from "../../../movement/q1/index.ts";
import { createQ2ClassicMovementProvider, createQ2RereleaseMovementProvider, Q2RereleaseMovementContext } from "../../../movement/q2/index.ts";
import { createQ3MovementProvider, EntityEvent, Q3_SOURCE_POSTURES } from "../../../movement/q3/index.ts";
import { createQ3SourceMovementHooks } from "../../../content/q3/foundation/movement-hooks.ts";
import { q3SpawnArsenalRuntime } from "../../../content/q3/foundation/arsenal.ts";
import { readQ3ArsenalRuntime, readQ3MovementState } from "./q3/player-state.ts";
import type { LoadedApplicationContent } from "../content.ts";
import { movementOrigin, movementProfile } from "./players.ts";
import type { MovementPlayer } from "./players.ts";
import type { SharedSimulation } from "./runtime.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
function relocated(state: MovementState, origin: Vec3, velocity: Vec3): MovementState {
  if (state.kind === "q2-classic") return { ...state,
    originEighths: [Math.trunc(origin.x * 8), Math.trunc(origin.y * 8), Math.trunc(origin.z * 8)],
    velocityEighths: [Math.trunc(velocity.x * 8), Math.trunc(velocity.y * 8), Math.trunc(velocity.z * 8)] };
  return { ...state, origin, velocity };
}
type ProfilePlayer = Pick<MovementPlayer, "profile" | "standingBounds" | "sourceMovement" | "character">;
function policy(player: ProfilePlayer): TracePolicy {
  switch (player.profile.kind) {
    case "q1-netquake": case "q1-quakeworld": return { kind: "q1", move: "normal", hull: null };
    case "q2-classic": return { kind: "q2", contentsMask: 0x02010003, leafContents: "stored" };
    case "q2-rerelease": return { kind: "q2", contentsMask: 0x02010003, leafContents: "merged" };
    case "q3": return { kind: "q3", contentsMask: player.sourceMovement?.traceMask ?? 0x02010001, curves: true, playerCurveClip: true };
  }
}
function profileFor(player: ProfilePlayer): NavigationProfile {
  return { movement: player.profile, shape: { kind: "box", bounds: player.standingBounds },
    crouchedShape: { kind: "box", bounds: { min: player.standingBounds.min, max: { ...player.standingBounds.max, z: player.character === "q3" ? 16 : 4 } } },
    policy: policy(player), capabilities: new Set(["walk", "crouch", "jump", "drop", "swim", "water-jump", "ladder"]),
    maximumStep: 18, minimumFloorNormal: 0.7, maximumDrop: 128, team: null, monster: false };
}

/** Providers receive detached movement and hook state, while all traces read the active shared scene. */
function prediction(simulation: SharedSimulation, player: Readonly<MovementPlayer>, origin: Vec3, velocity: Vec3,
  milliseconds: number, presence = 2, selectedProfile: MovementProfile = player.profile): NavigationPrediction {
  const profile = selectedProfile, source = simulation.q3Source(), entity = source?.pool.at(player.client.slot);
  const baseline = entity !== undefined && source !== null && profile.kind === "q3" ? readQ3MovementState(entity, source.records) : player.state;
  let initial = relocated(baseline, origin, velocity);
  if (initial.kind === "q3") initial = { ...initial, movementFlags: (initial.movementFlags & ~2) | (presence === 4 ? 1 : 0) };
  let runtime = entity !== undefined && source !== null ? readQ3ArsenalRuntime(entity, q3SpawnArsenalRuntime(source.options.product, 100)) : q3SpawnArsenalRuntime("baseq3", 100);
  let provider: MovementProvider;
  switch (profile.kind) {
    case "q1-netquake": provider = createQ1MovementProvider(profile.id, { viewHeight: player.viewHeight }); break;
    case "q1-quakeworld": provider = createQwMovementProvider(profile.id, { viewHeight: player.viewHeight }); break;
    case "q2-classic": provider = createQ2ClassicMovementProvider(profile.id); break;
    case "q2-rerelease": provider = createQ2RereleaseMovementProvider(profile.id, new Q2RereleaseMovementContext()); break;
    case "q3": provider = createQ3MovementProvider({ id: profile.id,
      postures: () => ({ standingViewHeight: player.viewHeight,
        crouched: { bounds: { min: player.standingBounds.min, max: { ...player.standingBounds.max, z: player.character === "q3" ? 16 : 4 } }, viewHeight: -2 },
        dead: { bounds: { min: player.standingBounds.min, max: { ...player.standingBounds.max, z: -8 } }, viewHeight: -16 },
        invulnerabilityExpanded: Q3_SOURCE_POSTURES.invulnerabilityExpanded }),
      hooks: createQ3SourceMovementHooks({ read: () => runtime, write: (_actor, _execution, next) => { runtime = next; return undefined; }, gauntletHit: () => false }) }); break;
  }
  return { provider, services: { scene: simulation.scene, numeric: player.services.numeric,
    touch: (_contact, state) => ({ kind: "continue", state }),
    weaponStep: input => ({ arsenal: input.arsenal, animation: input.animation, effects: [] }),
    animationStep: input => ({ animation: input.animation, effects: [] }) },
    input(previous, index, request): MovementInput {
      if (previous?.status === "actor-removed") throw new Error("Navigation prediction removed its actor");
      const state = previous?.state ?? initial, at = movementOrigin(state), yaw = Math.atan2(request.to.y - at.y, request.to.x - at.x);
      const horizontal = Math.min(400, Math.hypot(request.to.x - at.x, request.to.y - at.y) * 20);
      const up = request.mode === "jump" || request.mode === "water-jump" || request.mode === "ladder" ? 400 : request.mode === "crouch" ? -400 : 0;
      const angles = { x: 0, y: yaw * 180 / Math.PI, z: 0 }, words: readonly [number, number, number] = [0, Math.round(yaw * 65536 / (Math.PI * 2)) & 65535, 0];
      const time = (baseline.kind === "q3" ? baseline.commandTimeMilliseconds : simulation.timeSeconds * 1000) + (index + 1) * milliseconds;
      const base = { actor: player.actor, commandSequence: index, execution: "prediction", shape: { kind: "box", bounds: player.standingBounds },
        frame: { frame: index, time: { kind: "milliseconds", value: time }, elapsed: { kind: "milliseconds", value: milliseconds }, phase: "client-command" },
        environment: player.sourceEnvironment ?? { health: 100, flight: false, haste: false, invulnerable: false, gravityMultiplier: player.gravityMultiplier },
        arsenal: previous?.arsenal ?? player.arsenal, animation: previous?.animation ?? player.animation } satisfies Omit<MovementInput, "kind" | "profile" | "state" | "command">;
      if (profile.kind === "q1-netquake" && state.kind === profile.kind) return { ...base, kind: profile.kind, profile, state,
        command: { kind: profile.kind, acknowledgedServerTimeSeconds: time / 1000, viewAngles: angles, forwardMove: horizontal, sideMove: 0, upMove: up, buttons: up > 0 ? 2 : 0, impulse: 0 } };
      if (profile.kind === "q1-quakeworld" && state.kind === profile.kind) return { ...base, kind: profile.kind, profile, state,
        command: { kind: profile.kind, milliseconds, angles, forwardMove: horizontal, sideMove: 0, upMove: up, buttons: up > 0 ? 2 : 0, impulse: 0 } };
      if (profile.kind === "q2-classic" && state.kind === profile.kind) return { ...base, kind: profile.kind, profile, state,
        command: { kind: profile.kind, milliseconds, angleShorts: [words[0] - state.deltaAngleShorts[0], words[1] - state.deltaAngleShorts[1], words[2] - state.deltaAngleShorts[2]], forwardMove: horizontal, sideMove: 0, upMove: up, buttons: 0, impulse: 0, lightLevel: 0 } };
      if (profile.kind === "q2-rerelease" && state.kind === profile.kind) return { ...base, kind: profile.kind, profile, state,
        viewOffset: { x: 0, y: 0, z: player.viewHeight }, snapInitial: true,
        command: { kind: profile.kind, milliseconds, angles: { x: -state.deltaAngles.x, y: angles.y - state.deltaAngles.y, z: -state.deltaAngles.z }, forwardMove: horizontal, sideMove: 0, buttons: up > 0 ? 8 : up < 0 ? 16 : 0, serverFrame: index } };
      if (profile.kind === "q3" && state.kind === profile.kind) return { ...base, kind: profile.kind, profile, state,
        command: { kind: profile.kind, serverTimeMilliseconds: time, angleWords: [-state.deltaAngleWords[0], (words[1] - state.deltaAngleWords[1]) & 65535, -state.deltaAngleWords[2]],
          forwardMove: Math.round(horizontal * 127 / 400), rightMove: 0, upMove: Math.round(up * 127 / 400), buttons: 0, weapon: entity?.client?.ps.weapon ?? 0 } };
      throw new Error("Navigation state differs from selected movement");
    } };
}

export interface ApplicationBotNavigationOptions { readonly content: LoadedApplicationContent; readonly simulation: SharedSimulation; }
export async function createApplicationBotNavigation({ content, simulation }: ApplicationBotNavigationOptions): Promise<SelectedBotNavigation> {
  if (content.recipe !== simulation.recipe) throw new Error("Navigation and simulation must use the same loaded recipe");
  const firstPlayer = () => simulation.players().map(actor => simulation.movementPlayer(actor)).find(player => player !== null) ?? null;
  const first: ProfilePlayer = firstPlayer() ?? { character: content.recipe.character.definition.provider.startsWith("q3:") ? "q3" : content.recipe.character.definition.provider.startsWith("q2:") ? "q2" : "q1", profile: movementProfile(simulation.recipe), sourceMovement: null,
    standingBounds: simulation.recipe.character.definition.provider.startsWith("q3:")
      ? { min: { x: -15, y: -15, z: -24 }, max: { x: 15, y: 15, z: 32 } }
      : { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } } };
  const playerFor = (client: number): Readonly<MovementPlayer> => {
    const player = simulation.players().map(actor => simulation.movementPlayer(actor)).find(value => value?.client.slot === client);
    if (player === undefined || player === null) throw new Error(`Navigation client ${client} is not admitted`);
    return player;
  };
  const worldFor = (selectedPlayer: Readonly<MovementPlayer> | null): NavigationWorld => {
    const driver: NavigationPredictionDriver = { begin: (request, selected) => {
      const player = selectedPlayer ?? firstPlayer();
      return player === null ? null : prediction(simulation, player, request.from, zero, 16, 2, selected.movement);
    } };
    return { scene: simulation.scene, passActor: selectedPlayer?.actor.id ?? null, get revision() { return simulation.timeSeconds * 1000; },
      admit: createMovementAdmission(driver), beginRoute: selected => createMovementRouteAdmission(driver, selected),
      entity: binding => {
        const source = simulation.q3Source();
        if (source === null) return null;
        for (let slot = 0; slot < source.pool.numEntities; slot++) {
          const entity = source.pool.at(slot);
          if (!entity.inuse || entity.r.model.kind !== "inline" || entity.r.model.index !== binding.model) continue;
          const body = simulation.bodies.read(entity.actor.id);
          if (body === null) return null;
          return { actor: entity.actor.id, enabled: entity.r.linked, locked: false, bounds: { min: entity.r.absmin, max: entity.r.absmax }, velocity: body.velocity, destination: null };
        }
        return null;
      }, hazard: () => false };
  };
  const profile = profileFor(first), world = worldFor(firstPlayer());
  const loaded = await loadNavigation({ geometry: simulation.options.world, map: { name: content.recipe.map.geometry.requestedPath,
    format: simulation.options.world.kind, digest: content.recipe.map.geometry.digest }, profile, world,
    resources: await content.forContent(content.recipe.map.geometry.provenance.mount.identity.content), mapBytes: await content.mounts.read(content.recipe.map.geometry) });
  const clients = new Map<number, { readonly player: Readonly<MovementPlayer>; readonly runtime: NavigationRuntime }>();
  const forClient = (client: number): NavigationRuntime => {
    const player = playerFor(client), cached = clients.get(client);
    if (cached?.player === player) return cached.runtime;
    const runtime = new NavigationRuntime({ ...loaded.runtime.graph, profile: profileFor(player) }, worldFor(player));
    clients.set(client, { player, runtime }); return runtime;
  };
  return { runtime: loaded.runtime, forClient, crouchedBounds: profile.crouchedShape?.bounds ?? first.standingBounds,
    travelWeapon: () => null,
    predictClientMovement(query: BotMovementPrediction) {
      const player = playerFor(query.entityNum), projection = prediction(simulation, player, query.origin, query.velocity, Math.round(query.frameTime * 1000), query.presence);
      return projectBotMovement(query, { ...projection,
        input(previous, index, command) {
          const origin = previous?.status === "active" ? movementOrigin(previous.state) : query.origin;
          return projection.input(previous, index, { from: origin, to: { x: origin.x + command.x / 20, y: origin.y + command.y / 20, z: origin.z + command.z / 20 },
            mode: query.presence === 4 ? "crouch" : command.z > 0 ? "jump" : "walk", hint: null, entity: null });
        },
        stopEvents(previous, result) {
          if (result.status !== "active") throw new Error("Navigation projection removed its actor");
          const grounded = result.ground.kind !== "none", wasGrounded = previous?.status === "active" ? previous.ground.kind !== "none" : query.onGround;
          let flags = !wasGrounded && grounded ? 1 : wasGrounded && !grounded ? 2 : 0;
          if (result.waterLevel > 0) flags |= result.kind === "q1-netquake" || result.kind === "q1-quakeworld"
            ? result.waterType === -4 ? 8 : result.waterType === -5 ? 16 : 4
            : result.waterType & 16 ? 8 : result.waterType & 8 ? 16 : 4;
          if (query.stopArea !== 0 && forClient(query.entityNum).areaAt(movementOrigin(result.state)) === query.stopArea) flags |= 512 | (!wasGrounded && grounded ? 1024 : 0);
          for (const { effect } of result.effects) if (effect.kind === "event"
            && (effect.value.event === EntityEvent.EV_FALL_MEDIUM || effect.value.event === EntityEvent.EV_FALL_FAR)) flags |= 32;
          return flags;
        } });
    } };
}
