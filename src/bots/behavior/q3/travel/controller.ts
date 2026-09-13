// BotMoveInDirection/BotMoveToGoal and travel helpers from id Software be_ai_move.c.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import { add3, cross3, dot3, length3, normalize3, scale3, sub3, vec3 } from "../../../../core/math.ts";
import type { Bounds, Vec3 } from "../../../../contracts/math.ts";
import { finishCalls } from "../../library/call-steps.ts";
import type { CallSteps } from "../../library/call-steps.ts";
import type { BotGoal } from "../../library/goals.ts";
import { BotMoveFlag, BotMoveResult, BotMoveResultFlag, BotMoveResultType, BotMoveType } from "../movement-state.ts";
import type { BotMoveState, BotMoveVariable } from "../movement-state.ts";
import { TravelFlags, TravelType, travelFlagForType } from "../navigation-types.ts";
import type { BotMovementVariableName, BotTravelContext, SourceBotTravelHost, TravelReachability } from "./types.ts";
import { TravelGraph } from "./routing.ts";
import { finishTravelBarrierJump, finishTravelJump, finishTravelJumpPad, finishTravelWalkOffLedge, finishTravelWaterJump,
  travelBarrierJump, travelCrouch, travelJump, travelJumpPad, travelLadder, travelSwim, travelTeleport, travelWalk, travelWalkOffLedge, travelWaterJump } from "./ground.ts";
import { finishTravelElevator, finishTravelFuncBobbing, finishTravelWeaponJump, resetGrappleCalls, travelBFGJump,
  travelElevator, travelFuncBobbing, travelGrappleCalls, travelRocketJump } from "./special.ts";

const f = Math.fround, SOLID = 1, WATER = 32, PLAYERCLIP = 0x10000, BODY = 0x2000000;
const ZERO = vec3(0, 0, 0);
function ma(origin: Vec3, distance: number, direction: Vec3): Vec3 { return add3(origin, scale3(direction, distance)); }
function copyResult(target: BotMoveResult, source: BotMoveResult): void {
  target.failure = source.failure; target.type = source.type; target.blocked = source.blocked;
  target.blockEntity = source.blockEntity; target.travelType = source.travelType; target.flags = source.flags;
  target.weapon = source.weapon; target.moveDirection = source.moveDirection; target.idealViewAngles = source.idealViewAngles;
}
function vectorToAngles(value: Vec3): Vec3 {
  let yaw: number, pitch: number;
  if (value.y === 0 && value.x === 0) { yaw = 0; pitch = value.z > 0 ? 90 : 270; }
  else {
    yaw = value.x !== 0 ? f(Math.atan2(value.y, value.x) * 180 / Math.PI) : value.y > 0 ? 90 : 270;
    if (yaw < 0) yaw = f(yaw + 360);
    const forward = f(Math.sqrt(f(f(value.x * value.x) + f(value.y * value.y))));
    pitch = f(Math.atan2(value.z, forward) * 180 / Math.PI);
    if (pitch < 0) pitch = f(pitch + 360);
  }
  return vec3(-pitch, yaw, 0);
}
function reachabilityTime(reach: TravelReachability): number {
  switch (reach.travelType & TravelType.MASK) {
    case TravelType.WALK: case TravelType.CROUCH: case TravelType.BARRIERJUMP: case TravelType.WALKOFFLEDGE:
    case TravelType.JUMP: case TravelType.SWIM: case TravelType.WATERJUMP: case TravelType.TELEPORT: return 5;
    case TravelType.LADDER: case TravelType.ROCKETJUMP: case TravelType.BFGJUMP: return 6;
    case TravelType.ELEVATOR: case TravelType.JUMPPAD: case TravelType.FUNCBOB: return 10;
    case TravelType.GRAPPLEHOOK: return 8;
    default: return 8;
  }
}

/** One decision borrows the current actor runtime; all persistent state stays in BotMoveState. */
class TravelStep implements BotTravelContext {
  readonly graph: TravelGraph;
  readonly actions;
  constructor(readonly host: SourceBotTravelHost, readonly state: BotMoveState) {
    this.graph = new TravelGraph(host.runtime(state.client)); this.graph.time = f(host.time()); this.actions = host.actions;
  }
  time(): number { return this.host.time(); }
  print(severity: 1 | 3 | 4, text: string): void { this.host.moveStates.host.print(severity, text); }
  variable(name: BotMovementVariableName): BotMoveVariable {
    const value = this.host.moveStates[name];
    if (value === null) throw new Error(`Source bot travel variable ${name} requires move-state setup`);
    return value;
  }
  areaPresence(area: number): number {
    const presence = this.host.navigation.area(area).presenceType;
    if (this.graph.offset === 0 || presence !== 0) return presence;
    const node = this.graph.runtime.node(this.graph.node(area));
    return node?.source.kind === "nav3" && (node.flags & 512) !== 0 ? 4 : 2;
  }
  pointArea(point: Vec3): number { return this.host.navigation.pointArea(point); }
  pointContents(point: Vec3): number { return this.host.pointContents(point); }
  reachability(number: number): TravelReachability | null { return this.graph.reach(number); }
  modelInfo(model: number) { return this.host.modelInfo(model); }
  weapon(client: number, mode: "rocket-jump" | "bfg-jump" | "grapple"): number {
    const weapon = this.host.travelWeapon(client, mode);
    if (weapon === null) throw new Error(`Selected arsenal cannot execute ${mode}`);
    return weapon;
  }
  vectorToAngles(direction: Vec3): Vec3 { return vectorToAngles(direction); }
  bounds(presence: number): Bounds { return this.host.navigation.presenceBounds(presence === 2 ? 2 : 4); }
  traceBox(start: Vec3, end: Vec3, presence: number, entity: number) {
    return this.host.trace(start, end, this.bounds(presence), entity, SOLID | PLAYERCLIP | BODY);
  }
  onGround(): boolean {
    const state = this.state, trace = this.traceBox(state.origin, { ...state.origin, z: state.origin.z - 10 }, state.presenceType, state.entityNum);
    return trace.solidity === "clear" && trace.fraction < 1 && f(state.origin.z - trace.end.z) <= 10
      && trace.contact.kind === "plane" && trace.contact.plane.normal.z >= this.graph.runtime.graph.profile.minimumFloorNormal;
  }
  againstLadder(): boolean {
    if (!this.graph.runtime.graph.profile.capabilities.has("ladder")) return false;
    const asset = this.graph.runtime.graph.asset, origin = this.state.origin;
    if (asset?.kind !== "aas") {
      const query = this.graph.runtime.world.scene.pointContents({ point: origin, target: { kind: "world" },
        policy: this.graph.runtime.graph.profile.policy, numeric: this.graph.runtime.graph.profile.movement.numeric,
        passActor: this.graph.runtime.world.passActor });
      return query.kind === "q2" && (query.merged & 0x20000000) !== 0;
    }
    let number = 0;
    for (const offset of [ZERO, vec3(1, 0, 0), vec3(1, 1, 0), vec3(-1, 1, 0), vec3(-1, -1, 0)]) {
      number = this.pointArea(add3(origin, offset)); if (number !== 0) break;
    }
    const area = asset.areas[number], settings = asset.settings[number];
    if (number === 0 || area === undefined || settings === undefined || (settings.flags & 2) === 0 || (settings.presence & 2) === 0) return false;
    for (let index = area.firstFace; index < area.firstFace + area.faceCount; index++) {
      const signed = asset.faceIndexes[index];
      if (signed === undefined) throw new Error("Missing source ladder face index");
      const face = asset.faces[Math.abs(signed)];
      if (face === undefined) throw new Error("Missing source ladder face");
      if ((face.flags & 2) === 0) continue;
      const plane = asset.planes[face.plane ^ (signed < 0 ? 1 : 0)], edgePlane = asset.planes[face.plane];
      if (plane === undefined || edgePlane === undefined) throw new Error("Missing source ladder face plane");
      if (Math.abs(Math.trunc(f(dot3(plane.normal, origin) - plane.distance))) >= 3) continue;
      let inside = true;
      for (let edgeIndex = face.firstEdge; edgeIndex < face.firstEdge + face.edgeCount; edgeIndex++) {
        const signedEdge = asset.edgeIndexes[edgeIndex];
        if (signedEdge === undefined) throw new Error("Missing source ladder edge index");
        const edge = asset.edges[Math.abs(signedEdge)];
        if (edge === undefined) throw new Error("Missing source ladder edge");
        const first = asset.vertices[edge.vertices[signedEdge < 0 ? 1 : 0]], second = asset.vertices[edge.vertices[signedEdge < 0 ? 0 : 1]];
        if (first === undefined || second === undefined) throw new Error("Missing source ladder vertex");
        if (dot3(sub3(origin, first), cross3(sub3(second, first), edgePlane.normal)) < -f(0.1)) { inside = false; break; }
      }
      if (inside) return true;
    }
    return false;
  }
  onTopOfEntity(): number {
    const state = this.state, trace = this.traceBox(state.origin, { ...state.origin, z: state.origin.z - 3 }, state.presenceType, state.entityNum);
    return trace.solidity === "clear" && trace.entityNum !== 1022 && trace.entityNum !== 1023 ? trace.entityNum : -1;
  }
  onMover(state: BotMoveState, reach: TravelReachability): boolean {
    const model = this.modelInfo(reach.face & 0xffff);
    if (model === null) return false;
    const bounds = this.graph.runtime.graph.profile.shape.bounds;
    if (state.origin.x > model.origin.x + model.bounds.max.x - bounds.min.x || state.origin.x < model.origin.x + model.bounds.min.x - bounds.max.x
      || state.origin.y > model.origin.y + model.bounds.max.y - bounds.min.y || state.origin.y < model.origin.y + model.bounds.min.y - bounds.max.y) return false;
    const trace = this.host.trace({ ...state.origin, z: state.origin.z + 24 }, { ...state.origin, z: state.origin.z - 48 },
      { min: { ...bounds.min, z: -8 }, max: { ...bounds.max, z: 8 } }, state.entityNum, SOLID | PLAYERCLIP);
    return trace.solidity === "clear" && trace.entityNum !== 1023 && this.host.entityModelIndex(trace.entityNum) === (reach.face & 0xffff);
  }
  moverDown(reach: TravelReachability): boolean {
    const model = this.modelInfo(reach.face & 0xffff);
    return model !== null && f(model.origin.z + model.bounds.max.z) < reach.start.z;
  }
  gapDistance(origin: Vec3, direction: Vec3, entity: number): number {
    let trace = this.traceBox(origin, { ...origin, z: origin.z - 60 }, 4, entity);
    if (trace.fraction >= 1) return 1;
    let startZ = f(trace.end.z + 1);
    for (let distance = 8; distance <= 100; distance += 8) {
      const horizontal = ma(origin, distance, direction), start = vec3(horizontal.x, horizontal.y, startZ + 24);
      trace = this.traceBox(start, { ...start, z: start.z - f(48 + this.variable("svMaxBarrier").value) }, 4, entity);
      if (trace.solidity === "clear") {
        if (trace.end.z < f(f(startZ - this.variable("svMaxStep").value) - 8)) {
          if ((this.pointContents({ ...trace.end, z: trace.end.z - 20 }) & WATER) !== 0) break;
          return distance;
        }
        startZ = trace.end.z;
      }
    }
    return 0;
  }
  checkBarrierJump(state: BotMoveState, direction: Vec3, speed: number): boolean {
    if (!this.graph.runtime.graph.profile.capabilities.has("jump")) return false;
    let end = { ...state.origin, z: state.origin.z + this.variable("svMaxBarrier").value };
    let trace = this.traceBox(state.origin, end, 2, state.entityNum);
    if (trace.solidity !== "clear" || f(trace.end.z - state.origin.z) < this.variable("svMaxStep").value) return false;
    const horizontal = normalize3(vec3(direction.x, direction.y, 0)), distance = f(state.thinkTime * speed) * 0.5;
    end = vec3(state.origin.x + distance * horizontal.x, state.origin.y + distance * horizontal.y, trace.end.z);
    trace = this.traceBox(trace.end, end, 2, state.entityNum);
    if (trace.solidity !== "clear") return false;
    trace = this.traceBox(trace.end, { ...trace.end, z: state.origin.z }, 2, state.entityNum);
    if (trace.solidity !== "clear" || trace.fraction >= 1 || f(trace.end.z - state.origin.z) < this.variable("svMaxStep").value) return false;
    const admitted = this.graph.runtime.world.beginRoute(this.graph.runtime.graph.profile).admit({ from: state.origin, to: trace.end, mode: "jump", hint: null, entity: null });
    if (!admitted.admitted) return false;
    this.actions.jump(state.client); this.actions.move(state.client, horizontal, speed);
    state.moveFlags |= BotMoveFlag.BARRIERJUMP;
    return true;
  }
  checkBlocked(state: BotMoveState, direction: Vec3, bottom: boolean, result: BotMoveResult): void {
    let bounds = this.bounds(state.presenceType);
    if (Math.abs(direction.z) < 0.7) bounds = { min: { ...bounds.min, z: bounds.min.z + this.variable("svMaxStep").value }, max: { ...bounds.max, z: bounds.max.z - 10 } };
    let trace = this.host.trace(state.origin, ma(state.origin, 3, direction), bounds, state.entityNum, SOLID | PLAYERCLIP | BODY);
    if (trace.solidity === "clear" && trace.entityNum !== 1022 && trace.entityNum !== 1023) { result.blocked = true; result.blockEntity = trace.entityNum; }
    else if (bottom && this.host.navigation.area(state.area).reachableAreaCount === 0) {
      trace = this.host.trace(state.origin, { ...state.origin, z: state.origin.z - 3 }, this.bounds(state.presenceType), state.entityNum, SOLID | PLAYERCLIP);
      if (trace.solidity === "clear" && trace.entityNum !== 1022 && trace.entityNum !== 1023) {
        result.blocked = true; result.blockEntity = trace.entityNum; result.flags |= BotMoveResultFlag.ONTOPOFOBSTACLE;
      }
    }
  }
  jumpRunStart(state: BotMoveState, reach: TravelReachability): Vec3 {
    const direction = normalize3(vec3(reach.start.x - reach.end.x, reach.start.y - reach.end.y, 0)), start = { ...reach.start, z: reach.start.z + 1 };
    const result = this.host.predict({ entityNum: state.entityNum, origin: start, presence: 2, onGround: true, velocity: ZERO,
      commandMove: scale3(direction, 400), commandFrames: 1, maxFrames: 2, frameTime: f(0.1), stopEvents: 4 | 8 | 16 | 32 | 64, stopArea: 0, visualize: false });
    return (result.stopEvent & (8 | 16 | 32)) !== 0 ? start : result.end;
  }
  jumpSpeed(state: BotMoveState, start: Vec3, end: Vec3, initialVerticalVelocity: number) {
    const direction = normalize3(vec3(end.x - start.x, end.y - start.y, 0));
    const prediction = this.host.predict({ entityNum: state.entityNum, origin: start, presence: 2, onGround: false,
      velocity: vec3(state.velocity.x, state.velocity.y, initialVerticalVelocity), commandMove: scale3(direction, 400),
      commandFrames: 30, maxFrames: 30, frameTime: f(0.1), stopEvents: 1 | 8 | 16 | 32, stopArea: 0, visualize: false });
    if (!prediction.grounded || prediction.seconds <= 0) return { success: false, velocity: 400 };
    return { success: true, velocity: Math.min(400, f(length3(vec3(end.x - start.x, end.y - start.y, 0)) / prediction.seconds)) };
  }
  airControl(state: BotMoveState, goal: Vec3) {
    const prediction = this.host.predict({ entityNum: state.entityNum, origin: state.origin, presence: state.presenceType === 2 ? 2 : 4,
      onGround: false, velocity: state.velocity, commandMove: ZERO, commandFrames: 0, maxFrames: 50, frameTime: f(0.1), stopEvents: 0, stopArea: 0, visualize: false });
    let previous = state.origin;
    for (const next of prediction.trajectory) {
      if (next.z < previous.z && previous.z >= goal.z && next.z < goal.z) {
        const fraction = f((goal.z - previous.z) / (next.z - previous.z));
        const position = ma(previous, fraction, sub3(next, previous)), direction = sub3(goal, position), distance = Math.min(length3(direction), 32);
        return { controlled: true, direction: normalize3(direction), speed: f(400 - f(400 - f(13 * distance))) };
      }
      previous = next;
    }
    return { controlled: false, direction: ZERO, speed: 400 };
  }
  moveInDirection(direction: Vec3, speed: number, type: number): boolean {
    const state = this.state, capabilities = this.graph.runtime.graph.profile.capabilities;
    speed = f(speed);
    if (this.host.navigation.swimming(state.origin)) {
      if (!capabilities.has("swim")) return false;
      this.actions.move(state.client, normalize3(direction), speed); return true;
    }
    if (this.onGround()) state.moveFlags |= BotMoveFlag.ONGROUND;
    if ((state.moveFlags & BotMoveFlag.ONGROUND) !== 0) {
      if (this.checkBarrierJump(state, direction, speed)) return true;
      state.moveFlags &= ~BotMoveFlag.BARRIERJUMP;
      const presence = (type & BotMoveType.CROUCH) !== 0 && (type & BotMoveType.JUMP) === 0 ? 4 : 2;
      const horizontal = normalize3(vec3(direction.x, direction.y, 0));
      if ((type & BotMoveType.JUMP) === 0 && this.gapDistance(state.origin, horizontal, state.entityNum) > 0) type |= BotMoveType.JUMP;
      const jumping = (type & BotMoveType.JUMP) !== 0, crouching = (type & BotMoveType.CROUCH) !== 0;
      if (jumping && !capabilities.has("jump") || crouching && !capabilities.has("crouch")) return false;
      const move = scale3(horizontal, speed), maximumFrames = jumping ? 30 : 2;
      const prediction = this.host.predict({ entityNum: state.entityNum, origin: { ...state.origin, z: state.origin.z + 0.5 },
        presence, onGround: true, velocity: state.velocity,
        commandMove: jumping ? { ...move, z: 400 } : move, commandFrames: jumping ? 1 : 2, maxFrames: maximumFrames,
        frameTime: f(0.1), stopEvents: (jumping ? 1 : 0) | 32 | 4 | 8 | 16, stopArea: 0, visualize: false });
      if (jumping && prediction.frames >= maximumFrames || (prediction.stopEvent & (8 | 16 | 32)) !== 0) return false;
      if ((prediction.stopEvent & 1) !== 0 && (this.gapDistance(prediction.end, normalize3(prediction.velocity), state.entityNum) > 0
        || this.gapDistance(prediction.end, horizontal, state.entityNum) > 0)) return false;
      if (length3(vec3(prediction.end.x - state.origin.x, prediction.end.y - state.origin.y, 0)) < f(speed * state.thinkTime) * 0.5) return false;
      if (jumping) this.actions.jump(state.client);
      if (crouching) this.actions.crouch(state.client);
      this.actions.move(state.client, horizontal, speed); return true;
    }
    if ((state.moveFlags & BotMoveFlag.BARRIERJUMP) !== 0 && state.velocity.z < 50) this.actions.move(state.client, direction, speed);
    return true;
  }
  moveInGoalArea(goal: BotGoal): BotMoveResult {
    const state = this.state, result = new BotMoveResult(), swimming = (state.moveFlags & BotMoveFlag.SWIMMING) !== 0;
    const delta = vec3(goal.origin.x - state.origin.x, goal.origin.y - state.origin.y, swimming ? goal.origin.z - state.origin.z : 0);
    result.travelType = swimming ? TravelType.SWIM : TravelType.WALK;
    const direction = normalize3(delta), distance = Math.min(length3(delta), 100);
    let speed = f(400 - f(400 - f(4 * distance))); if (speed < 10) speed = 0;
    this.checkBlocked(state, direction, true, result); this.actions.move(state.client, direction, speed); result.moveDirection = direction;
    if (swimming) { result.idealViewAngles = vectorToAngles(direction); result.flags |= BotMoveResultFlag.SWIMVIEW; }
    state.lastReachability = 0; state.lastArea = 0; state.lastGoalArea = goal.area; state.lastOrigin = state.origin;
    return result;
  }
  *travel(reach: TravelReachability, airborne: boolean): CallSteps<BotMoveResult | null> {
    const state = this.state, mode = reach.graphEdge.mode;
    if (!this.graph.runtime.graph.profile.capabilities.has(mode)) { const result = new BotMoveResult(); result.failure = true; return result; }
    const weaponRequired = mode === "rocket-jump" || mode === "bfg-jump"
      || mode === "grapple" && Math.trunc(this.variable("offhandGrapple").value) === 0;
    if (weaponRequired && (mode === "grapple" || mode === "rocket-jump" || mode === "bfg-jump") && this.host.travelWeapon(state.client, mode) === null) {
      const result = new BotMoveResult(); result.failure = true; return result;
    }
    switch (reach.travelType & TravelType.MASK) {
      case TravelType.WALK: {
        const boarding = this.graph.runtime.boardingElevator(reach.graphEdge.to);
        if (!airborne && boarding !== null && boarding.platform.phase !== "bottom") {
          const elevator = this.graph.describe(boarding.edge);
          if (!this.onMover(state, elevator) && !this.moverDown(elevator)) return travelElevator(this, state, { ...elevator, start: reach.start });
        }
        return travelWalk(this, state, reach);
      }
      case TravelType.CROUCH: return airborne ? null : travelCrouch(this, state, reach);
      case TravelType.BARRIERJUMP: return airborne ? finishTravelBarrierJump(this, state, reach) : travelBarrierJump(this, state, reach);
      case TravelType.LADDER: return travelLadder(this, state, reach);
      case TravelType.WALKOFFLEDGE: return airborne ? finishTravelWalkOffLedge(this, state, reach) : travelWalkOffLedge(this, state, reach);
      case TravelType.JUMP: return airborne ? finishTravelJump(this, state, reach) : travelJump(this, state, reach);
      case TravelType.SWIM: return travelSwim(this, state, reach);
      case TravelType.WATERJUMP: return airborne ? finishTravelWaterJump(this, state, reach) : travelWaterJump(this, state, reach);
      case TravelType.TELEPORT: return airborne ? null : travelTeleport(this, state, reach);
      case TravelType.ELEVATOR: {
        const boarding = this.graph.runtime.boardingElevator(reach.graphEdge.from);
        const selected = boarding !== null && boarding.platform.phase !== "bottom" && !this.onMover(state, reach) && !this.moverDown(reach)
          ? { ...reach, start: reach.graphEdge.hint?.funnel ?? reach.start } : reach;
        return airborne ? finishTravelElevator(this, state, selected) : travelElevator(this, state, selected);
      }
      case TravelType.GRAPPLEHOOK: return yield* travelGrappleCalls(this, state, reach);
      case TravelType.ROCKETJUMP: return airborne ? finishTravelWeaponJump(this, state, reach) : travelRocketJump(this, state, reach);
      case TravelType.BFGJUMP: return airborne ? finishTravelWeaponJump(this, state, reach) : travelBFGJump(this, state, reach);
      case TravelType.JUMPPAD: return airborne ? finishTravelJumpPad(this, state, reach) : travelJumpPad(this, state, reach);
      case TravelType.FUNCBOB: return airborne ? finishTravelFuncBobbing(this, state, reach) : travelFuncBobbing(this, state, reach);
      default: throw new Error(`Source bot travel ${reach.travelType & TravelType.MASK} has no implemented action routine`);
    }
  }

  *moveToGoal(result: BotMoveResult, goal: BotGoal | null, travelFlags: number): CallSteps<undefined> {
    const state = this.state;
    yield* resetGrappleCalls(this, state);
    if (goal === null) { result.failure = true; return; }
    state.moveFlags &= ~(BotMoveFlag.SWIMMING | BotMoveFlag.AGAINSTLADDER);
    if (this.onGround()) state.moveFlags |= BotMoveFlag.ONGROUND;
    if ((state.moveFlags & BotMoveFlag.ONGROUND) !== 0) {
      const entity = this.onTopOfEntity();
      if (entity !== -1) {
        const modelNumber = this.host.entityModelIndex(entity), model = this.modelInfo(modelNumber);
        if (model?.kind === "elevator" || model?.kind === "bobbing") {
          const type = model.kind === "elevator" ? TravelType.ELEVATOR : TravelType.FUNCBOB;
          const prior = this.reachability(state.lastReachability);
          if (prior === null || (prior.travelType & TravelType.MASK) !== type || (prior.face & 0xffff) !== modelNumber) {
            const edge = this.graph.runtime.graph.edges.find(edge => edge.mode === "mover" && edge.entity?.model === modelNumber);
            if (edge === undefined) { result.blocked = true; result.blockEntity = entity; result.flags |= BotMoveResultFlag.ONTOPOFOBSTACLE; return; }
            state.lastReachability = this.graph.handle(edge); state.reachabilityTime = f(f(this.time()) + reachabilityTime(this.graph.describe(edge)));
          }
          result.flags |= model.kind === "elevator" ? BotMoveResultFlag.ONTOPOF_ELEVATOR : BotMoveResultFlag.ONTOPOF_FUNCBOB;
        } else if (model?.kind === "door" || model?.kind === "train") {
          state.area = this.host.navigation.fuzzyPointReachabilityArea(state.origin);
          if (this.host.navigation.area(state.area).reachableAreaCount === 0) {
            result.blocked = true; result.blockEntity = entity; result.flags |= BotMoveResultFlag.ONTOPOFOBSTACLE; return;
          }
        } else {
          result.blocked = true; result.blockEntity = entity; result.flags |= BotMoveResultFlag.ONTOPOFOBSTACLE; return;
        }
      }
    }
    if (this.host.navigation.swimming(state.origin)) state.moveFlags |= BotMoveFlag.SWIMMING;
    if (this.againstLadder()) state.moveFlags |= BotMoveFlag.AGAINSTLADDER;
    if ((state.moveFlags & (BotMoveFlag.ONGROUND | BotMoveFlag.SWIMMING | BotMoveFlag.AGAINSTLADDER)) !== 0) {
      state.area = this.host.navigation.fuzzyPointReachabilityArea(state.origin);
      const riding = this.reachability(state.lastReachability);
      if (riding?.graphEdge.source.kind === "nav3" && riding.graphEdge.sourceTravelType === 6 && this.onMover(state, riding)) {
        state.area = this.graph.area(riding.graphEdge.from);
        state.reachabilityTime = f(f(this.time()) + 5);
      }
      if (state.area === 0) { result.failure = true; result.blocked = true; result.blockEntity = 0; result.type = BotMoveResultType.INSOLIDAREA; return; }
      if (state.area === goal.area) { copyResult(result, this.moveInGoalArea(goal)); return; }
      let number = state.lastReachability, prior = this.reachability(number);
      if (prior === null) number = 0;
      else {
        const type = prior.travelType & TravelType.MASK;
        if ((travelFlagForType(prior.travelType) & travelFlags) === 0 || !this.graph.runtime.edgeAllowed(prior.graphEdge)) number = 0;
        else if (type === TravelType.GRAPPLEHOOK) { if (state.reachabilityTime < f(this.time()) || (state.moveFlags & BotMoveFlag.GRAPPLERESET) !== 0) number = 0; }
        else if (type === TravelType.ELEVATOR || type === TravelType.FUNCBOB) {
          if ((result.flags & BotMoveResultFlag.ONTOPOF_FUNCBOB) !== 0) state.reachabilityTime = f(f(this.time()) + 5);
          if (state.area === prior.area || state.reachabilityTime < f(this.time())) number = 0;
        } else if (state.lastGoalArea !== goal.area || state.reachabilityTime < f(this.time()) || state.lastArea !== state.area) number = 0;
      }
      let resultFlags = 0;
      if (number === 0) {
        state.walkProgress = null;
        const selected = this.graph.select(state, goal, travelFlags); number = selected.reachability; resultFlags = selected.flags;
        state.reachArea = state.area; state.jumpReach = 0; state.moveFlags &= ~BotMoveFlag.GRAPPLERESET;
        const reach = this.reachability(number);
        if (reach !== null) { state.reachabilityTime = f(f(this.time()) + reachabilityTime(reach)); this.host.moveStates.addToAvoidReach(state, number, 6); }
      }
      state.lastReachability = number; state.lastGoalArea = goal.area; state.lastArea = state.area;
      prior = this.reachability(number);
      if (prior === null) { result.failure = true; result.flags |= resultFlags; }
      else { const moved = yield* this.travel(prior, false); if (moved !== null) copyResult(result, moved); result.travelType = prior.travelType; result.flags |= resultFlags; }
    } else {
      const end = ma(state.origin, f(-2 * state.thinkTime), state.velocity), areas = this.host.navigation.traceAreas(state.origin, end, 16);
      for (const crossing of [...areas].reverse()) {
        if ((this.host.navigation.area(crossing.area).contents & 128) === 0) continue;
        const previousArea = state.area; state.area = crossing.area;
        const selected = this.graph.select(state, goal, travelFlags, TravelFlags.JUMPPAD); state.area = previousArea;
        const fallback = this.graph.outgoing(crossing.area).find(reach => (reach.travelType & TravelType.MASK) === TravelType.JUMPPAD);
        const number = selected.reachability || (fallback === undefined ? 0 : this.graph.handle(fallback.graphEdge));
        if (number !== 0) { state.lastReachability = number; state.lastArea = crossing.area; break; }
      }
      const reach = this.reachability(state.lastReachability);
      if (reach !== null) { const moved = yield* this.travel(reach, true); if (moved !== null) copyResult(result, moved); result.travelType = reach.travelType; }
    }
    if (result.blocked) state.reachabilityTime = f(state.reachabilityTime - f(10 * state.thinkTime));
    state.lastOrigin = state.origin;
  }
}

export class SourceBotTravel {
  constructor(readonly host: SourceBotTravelHost) {}
  moveInDirection(handle: number, direction: Vec3, speed: number, type: number): boolean {
    const state = this.host.moveStates.fromHandle(handle);
    return state !== null && new TravelStep(this.host, state).moveInDirection(direction, speed, type);
  }
  moveToGoal(result: BotMoveResult, handle: number, goal: BotGoal | null, travelFlags: number): void {
    finishCalls(this.moveToGoalCalls(result, handle, goal, travelFlags));
  }
  *moveToGoalCalls(result: BotMoveResult, handle: number, goal: BotGoal | null, travelFlags: number): CallSteps<undefined> {
    result.failure = false; result.type = 0; result.blocked = false; result.blockEntity = 0; result.travelType = 0; result.flags = 0;
    const state = this.host.moveStates.fromHandle(handle);
    if (state === null) { result.failure = true; return; }
    yield* new TravelStep(this.host, state).moveToGoal(result, goal, travelFlags);
  }
}
