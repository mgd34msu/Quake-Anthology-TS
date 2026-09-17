import { publishQ3CharacterMovementEvent } from "../player-jump.ts";
import { relativeQ3SourceCommand } from "../q3-commands.ts";
import type { ActorId, SeatId } from "../../../../contracts/identity.ts";
import type { ActorCommand } from "../../../../contracts/session.ts";
import type { SceneQueries } from "../../../../contracts/scene.ts";
import type { SourcePlayerState, UserCommand } from "../../../../content/q3/base/shared/player-state.ts";
import type { PresentationMovementHost, PresentationMovementOptions } from "../../../../content/q3/presentation/movement-host.ts";
import { updateQ3PredictionView } from "../../../../movement/q3/prediction.ts";
import { Q2RereleaseMovementContext } from "../../../../movement/q2/index.ts";
import type { SharedSimulation } from "../runtime.ts";
import type { Q3SourcePresentationState } from "../q3/presentation.ts";
import type { MovementPredictionOptions, MovementPredictionSnapshot, PredictionCommand } from "./types.ts";
import { copyPredictionSnapshot, predictMovementCommand } from "./step.ts";
import { copyPredictionCommand } from "./runtime.ts";
import { predictionSourceHit, readPredictionSourceState, writePredictionSourceState } from "./source-state.ts";
import type { PredictionSourceEntities } from "./source-state.ts";
import { resolveQ3ArsenalControls } from "../arsenal-intent.ts";

export interface PresentationPredictionOptions {
  readonly movement: MovementPredictionOptions;
  readonly initial: MovementPredictionSnapshot;
  readonly entities: PredictionSourceEntities;
}

/** Foreign commands are retained separately; this representation feeds the source cgame clock. */
export function presentationSourceCommand(input: ActorCommand, milliseconds: number, weapon: number): UserCommand {
  const c = input.command;
  if (c.kind === "q3") return { serverTime: c.serverTimeMilliseconds, angles: { x: c.angleWords[0], y: c.angleWords[1], z: c.angleWords[2] },
    buttons: input.arsenal === undefined ? c.buttons : (c.buttons & ~4) | (input.arsenal.useHoldable ? 4 : 0),
    weapon: input.arsenal === undefined ? c.weapon : weapon, forwardmove: c.forwardMove, rightmove: c.rightMove, upmove: c.upMove };
  const angles = c.kind === "q2-classic" ? { x: c.angleShorts[0], y: c.angleShorts[1], z: c.angleShorts[2] }
    : (() => { const a = c.kind === "q1-netquake" ? c.viewAngles : c.angles;
      return { x: Math.trunc(a.x * 65536 / 360) & 65535, y: Math.trunc(a.y * 65536 / 360) & 65535, z: Math.trunc(a.z * 65536 / 360) & 65535 }; })();
  const speed = c.kind === "q1-netquake" || c.kind === "q1-quakeworld" ? 320 : 200;
  const axis = (value: number): number => Math.trunc(Math.max(-127, Math.min(127, value * 127 / speed)));
  return { serverTime: Math.trunc(milliseconds), angles, buttons: (c.buttons & 1) | (input.arsenal?.useHoldable === true ? 4 : 0), weapon,
    forwardmove: axis(c.forwardMove), rightmove: axis(c.sideMove),
    upmove: c.kind === "q2-rerelease" ? (c.buttons & 8) !== 0 ? 127 : (c.buttons & 16) !== 0 ? -127 : 0
      : (c.kind === "q1-netquake" || c.kind === "q1-quakeworld") && (c.buttons & 2) !== 0 ? 127 : axis(c.upMove) };
}

/** One instance belongs to one cgame seat and one world lifetime. */
export class PresentationPredictionAdapter implements PresentationMovementHost {
  private readonly rereleaseMovement = new Q2RereleaseMovementContext();
  get commandTiming(): "q3" | "provider" { return this.options.movement.profile.kind === "q3" ? "q3" : "provider"; }
  private readonly snapshots = new Map<number, MovementPredictionSnapshot>();
  private readonly commands = new Map<number, PredictionCommand>();
  private states = new WeakMap<SourcePlayerState, MovementPredictionSnapshot>();
  private latest: MovementPredictionSnapshot;
  constructor(readonly options: PresentationPredictionOptions) {
    if (options.movement.actor.id.session !== options.movement.seat.session) throw new Error("Prediction actor and seat belong to different sessions");
    this.latest = copyPredictionSnapshot(options.initial);
    this.capture(this.latest);
  }
  capture(snapshot: MovementPredictionSnapshot): undefined {
    if (snapshot.state.kind !== this.options.movement.profile.kind) throw new Error("Cgame prediction snapshot changed selected movement");
    this.latest = copyPredictionSnapshot(snapshot);
    this.states = new WeakMap();
    this.snapshots.set(snapshot.commandTimeMilliseconds, this.latest);
    if (this.snapshots.size > 64) { const first = this.snapshots.keys().next(); if (!first.done) this.snapshots.delete(first.value); }
    return undefined;
  }
  submit(input: ActorCommand, milliseconds: number): UserCommand {
    if (!input.actor.equals(this.options.movement.actor.id)) throw new Error("Cgame prediction command belongs to another actor");
    const arsenal = this.latest.arsenal, runtime = this.latest.q3Arsenal;
    const weapon = arsenal.state.kind === "q3" && runtime !== null
      ? resolveQ3ArsenalControls(arsenal, input.arsenal, input.command, runtime.product).requestedWeapon : 0;
    if (input.arsenal !== undefined && (arsenal.state.kind !== "q3" || runtime === null)) throw new Error("Cgame has no selected arsenal owner for this intent");
    const presented = presentationSourceCommand(input, milliseconds, weapon), state = this.latest.state;
    const source = state.kind === "q3" ? relativeQ3SourceCommand(input.source, input.command.kind, presented,
      { x: state.deltaAngleWords[0], y: state.deltaAngleWords[1], z: state.deltaAngleWords[2] }) : presented;
    this.commands.set(source.serverTime, { sequence: input.sequence, timeMilliseconds: source.serverTime, command: copyPredictionCommand(input.command),
      ...(input.arsenal === undefined ? {} : { arsenal: { ...input.arsenal } }) });
    if (this.commands.size > 64) { const first = this.commands.keys().next(); if (!first.done) this.commands.delete(first.value); }
    return source;
  }
  private seed(ps: SourcePlayerState): MovementPredictionSnapshot {
    const prior = this.states.get(ps);
    const baseline = this.options.movement.profile.kind === "q3" ? this.latest
      : prior?.commandTimeMilliseconds === ps.commandTime ? prior : this.snapshots.get(ps.commandTime);
    if (baseline === undefined) throw new Error(`No selected movement snapshot for source command time ${ps.commandTime}`);
    return readPredictionSourceState(baseline, ps, this.options.entities);
  }
  private scene(ps: SourcePlayerState, movement: PresentationMovementOptions): SceneQueries {
    const base = this.options.movement.scene;
    if (this.options.movement.profile.kind !== "q3") return base;
    return { ...base,
      trace: query => {
        if (query.policy.kind !== "q3" || query.target.kind !== "world") return base.trace(query);
        const bounds = query.shape.kind === "point" ? { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } } : query.shape.bounds;
        const result = movement.trace(query.start, query.end, bounds, ps.clientNum, query.policy.contentsMask);
        const plane = result.contact.kind === "plane" ? result.contact.plane : { normal: { x: 0, y: 0, z: 0 }, distance: 0 };
        const normal = plane.normal;
        const sourcePlane = { ...plane, type: normal.x === 1 ? 0 : normal.y === 1 ? 1 : normal.z === 1 ? 2 : 3,
          signbits: (normal.x < 0 ? 1 : 0) | (normal.y < 0 ? 2 : 0) | (normal.z < 0 ? 4 : 0) };
        return { kind: "q3", fraction: result.fraction, end: result.end, allSolid: result.solidity === "all-solid",
          startSolid: result.solidity !== "clear", sourcePlane, contact: result.contact.kind === "none" ? result.contact : { kind: "plane", plane: sourcePlane },
          hit: predictionSourceHit(result.entityNum, this.options.entities), contents: result.contents, surfaceFlags: result.surfaceFlags };
      },
      pointContents: query => query.policy.kind === "q3" && query.target.kind === "world"
        ? { kind: "q3", contents: movement.pointContents(query.point, ps.clientNum) } : base.pointContents(query),
      boxLeaves: (bounds, limit) => base.boxLeaves(bounds, limit), areasConnected: (a, b) => base.areasConnected(a, b),
      clusterVisible: (a, b, kind) => base.clusterVisible(a, b, kind),
    };
  }
  movePlayer(ps: SourcePlayerState, command: UserCommand, movement: PresentationMovementOptions) {
    const seed = this.seed(ps), original = this.commands.get(movement.originalServerTime ?? command.serverTime);
    const entry: PredictionCommand = this.options.movement.profile.kind !== "q3"
      ? original ?? (() => { throw new Error(`No original selected command for cgame time ${command.serverTime}`); })()
      : { sequence: original?.sequence ?? command.serverTime, timeMilliseconds: command.serverTime,
        ...(original?.arsenal === undefined ? {} : { arsenal: original.arsenal }),
        command: { kind: "q3", serverTimeMilliseconds: command.serverTime, angleWords: [command.angles.x, command.angles.y, command.angles.z],
          buttons: command.buttons, weapon: command.weapon, forwardMove: command.forwardmove, rightMove: command.rightmove, upMove: command.upmove } };
    const output = predictMovementCommand(this.options.movement, seed, entry, { scene: this.scene(ps, movement),
      rereleaseMovement: this.rereleaseMovement,
      fixedMilliseconds: movement.fixedMsec, noFootsteps: movement.noFootsteps, gauntletHit: movement.gauntletHit,
      traceMask: movement.traceMask, firstCommand: !this.states.has(ps) || this.states.get(ps)?.commandTimeMilliseconds !== ps.commandTime });
    writePredictionSourceState(ps, output.player, this.options.entities);
    for (const effect of output.result.effects) if (effect.effect.kind === "event" && effect.effect.value.provider.startsWith("q3:")
      && publishQ3CharacterMovementEvent(output.player.animation.state.kind, effect.effect.value.event)) ps.addEvent(effect.effect.value.event, effect.effect.value.parameter);
    this.states.set(ps, copyPredictionSnapshot(output.player));
    return { bounds: output.result.bounds };
  }
  updateViewAngles(ps: SourcePlayerState, command: UserCommand): void {
    const seed = this.seed(ps);
    if (seed.state.kind !== "q3") {
      const original = this.commands.get(command.serverTime)?.command, state = seed.state;
      if (original?.kind === "q1-netquake" && state.kind === "q1-netquake") ps.viewangles = state.fixAngle ? state.viewAngles : original.viewAngles;
      else if (original?.kind === "q1-quakeworld") ps.viewangles = original.angles;
      else if (original?.kind === "q2-rerelease" && state.kind === "q2-rerelease") ps.viewangles = {
        x: original.angles.x + state.deltaAngles.x, y: original.angles.y + state.deltaAngles.y, z: original.angles.z + state.deltaAngles.z };
      else if (original?.kind === "q2-classic" && state.kind === "q2-classic") {
        const angle = (word: number, delta: number): number => (word + delta << 16 >> 16) * 360 / 65536;
        ps.viewangles = { x: angle(original.angleShorts[0], state.deltaAngleShorts[0]),
          y: angle(original.angleShorts[1], state.deltaAngleShorts[1]), z: angle(original.angleShorts[2], state.deltaAngleShorts[2]) };
      }
      return;
    }
    const state = updateQ3PredictionView(seed.state, ps.health, { kind: "q3", serverTimeMilliseconds: command.serverTime,
      angleWords: [command.angles.x, command.angles.y, command.angles.z], buttons: command.buttons, weapon: command.weapon,
      forwardMove: command.forwardmove, rightMove: command.rightmove, upMove: command.upmove });
    ps.viewangles = state.viewAngles; ps.deltaAngles = { x: state.deltaAngleWords[0], y: state.deltaAngleWords[1], z: state.deltaAngleWords[2] };
  }
}

export function createPresentationMovementHost(options: PresentationPredictionOptions): PresentationPredictionAdapter {
  return new PresentationPredictionAdapter(options);
}

export function createSimulationPredictionHost(simulation: SharedSimulation, actor: ActorId, seat: SeatId) {
  const player = simulation.movementPlayer(actor);
  const source = simulation.q3Source();
  if (player === null || source === null) throw new Error("Cgame prediction requires an admitted source player");
  const entities: PredictionSourceEntities = {
    actorAt: number => source.records.get(number)?.actor.id ?? null,
    numberOf: id => source.records.byActor(id)?.slot ?? null,
  };
  const capture = (published: Q3SourcePresentationState): MovementPredictionSnapshot => {
    const ps = published.clients.find(value => value.actor.equals(actor))?.state;
    if (ps === undefined) throw new Error("Prediction snapshot has no matching source client");
    const base: MovementPredictionSnapshot = { sequence: player.lastSequence, commandTimeMilliseconds: ps.commandTime,
      state: player.state, arsenal: player.arsenal, animation: player.animation,
      environment: player.sourceEnvironment ?? { health: ps.health, flight: false, haste: false, invulnerable: false, gravityMultiplier: player.gravityMultiplier },
      bounds: player.bounds, viewAngles: player.viewAngles, viewHeight: player.viewHeight, viewOffset: { x: 0, y: 0, z: player.viewHeight },
      contact: { ground: player.ground, waterLevel: player.waterLevel, waterType: player.waterType }, q3Arsenal: null };
    return readPredictionSourceState(base, ps, entities);
  };
  const adapter = createPresentationMovementHost({ movement: { actor: player.actor, seat, recipe: simulation.recipe,
    get profile() { return player.profile.kind === "q1-netquake" || player.profile.kind === "q1-quakeworld"
      ? { ...player.profile, parameters: { ...player.profile.parameters, gravity: player.worldGravity } } : player.profile; },
    standingBounds: player.standingBounds, standingViewHeight: player.character === "q3" ? 26 : 22,
    scene: simulation.scene, isBrush: hit => hit.kind === "world" || hit.kind === "actor" && source.records.byActor(hit.actor)?.r.model.kind === "inline" },
    initial: capture(source.sourceState()), entities });
  return Object.assign(adapter, { captureSource: (published: Q3SourcePresentationState): undefined => adapter.capture(capture(published)) });
}
