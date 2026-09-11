/* Original Rogue g_phys.c SV_Physics_NewToss and rerelease rogue/g_rogue_phys.cpp.
 * Copyright (C) 1997-2001 Id Software and ZeniMax Media Inc. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { NumericOperations } from "../../../contracts/numeric.ts";
import type { TraceResult } from "../../../contracts/scene.ts";
import type { Q2Motion } from "../../../content/q2/foundation/host.ts";
import type { SessionActorRegistry, SharedBodyTable } from "../../../world/actors/index.ts";

export interface Q2NewTossServices {
  readonly actors: SessionActorRegistry;
  readonly bodies: SharedBodyTable;
  readonly numeric: NumericOperations;
  readonly edition: "classic" | "rerelease";
  readonly worldGravity: number;
  readonly maxVelocity: number;
  readonly stopSpeed: number;
  readonly teamSlave: boolean;
  water(): { readonly waterLevel: number; readonly waterType: number };
  /** Uses this actor's exact source clipmask, including zero. */
  trace(start: Vec3, end: Vec3): TraceResult;
  hitActor(trace: TraceResult): ActorId | null;
  flyMove(elapsed: number): undefined;
  writeAngularVelocity(velocity: Vec3): undefined;
  touchTriggers(): undefined;
  pointContents(origin: Vec3): number;
  writeWater(waterLevel: number, waterType: number): undefined;
  waterSound(origin: Vec3): undefined;
}

/** Source thinking precedes this call. The caller moves team followers only after a moved result. */
export function stepQ2NewToss(actor: OwnedActor, elapsed: number, motion: Q2Motion, host: Q2NewTossServices): "moved" | "stopped" | "team-slave" | "removed" {
  const { actors, bodies, numeric: n } = host;
  let body = bodies.read(actor.id);
  if (body === null) return "removed";
  if (host.teamSlave) return "team-slave";
  const vector = (x: number, y: number, z: number): Vec3 => ({ x: n.store(x), y: n.store(y), z: n.store(z) });
  const scale = (value: Vec3, amount: number): Vec3 => vector(n.multiply(value.x, amount), n.multiply(value.y, amount), n.multiply(value.z, amount));
  const add = (left: Vec3, right: Vec3): Vec3 => vector(n.add(left.x, right.x), n.add(left.y, right.y), n.add(left.z, right.z));
  const length = (value: Vec3): number => n.store(n.squareRoot(n.add(n.add(n.multiply(value.x, value.x), n.multiply(value.y, value.y)), n.multiply(value.z, value.z))));
  const moving = (value: Vec3): boolean => value.x !== 0 || value.y !== 0 || value.z !== 0;
  const trace = host.trace(body.origin, vector(body.origin.x, body.origin.y, n.subtract(body.origin.z, 0.25)));
  const ground = body.ground !== null && actors.isLive(body.ground) ? host.hitActor(trace) : null;
  body = { ...body, ground };
  bodies.write(actor, body);
  const normal = trace.contact.kind === "plane" ? trace.contact.plane.normal : trace.sourcePlane.normal;
  if (ground !== null && normal.z === 1 && !moving(body.velocity)) return "stopped";

  const oldOrigin = body.origin;
  let velocity = body.velocity;
  if (host.edition === "rerelease") {
    const speed = length(velocity);
    if (speed > host.maxVelocity) velocity = scale(vector(n.divide(velocity.x, speed), n.divide(velocity.y, speed), n.divide(velocity.z, speed)), host.maxVelocity);
  } else {
    const clamp = (value: number): number => value > host.maxVelocity ? host.maxVelocity : value < -host.maxVelocity ? -host.maxVelocity : value;
    velocity = vector(clamp(velocity.x), clamp(velocity.y), clamp(velocity.z));
  }
  const gravity = n.multiply(n.multiply(motion.gravity, host.worldGravity), elapsed);
  velocity = host.edition === "rerelease" || motion.gravityVector.z > 0 ? add(velocity, scale(motion.gravityVector, gravity))
    : vector(velocity.x, velocity.y, n.subtract(velocity.z, gravity));
  bodies.write(actor, { ...body, velocity });

  if (moving(motion.angularVelocity)) {
    const angles = add(body.angles, scale(motion.angularVelocity, elapsed));
    const adjustment = n.store(n.multiply(n.multiply(elapsed, host.stopSpeed), 6));
    const friction = (value: number): number => value > 0 ? Math.max(0, n.store(n.subtract(value, adjustment))) : Math.min(0, n.store(n.add(value, adjustment)));
    bodies.write(actor, { ...body, velocity, angles });
    host.writeAngularVelocity(vector(friction(motion.angularVelocity.x), friction(motion.angularVelocity.y), friction(motion.angularVelocity.z)));
  }
  const speed = length(velocity), waterLevel = host.water().waterLevel;
  const loss = waterLevel !== 0 ? n.multiply(6, waterLevel) : ground === null ? 6 : 36;
  const newspeed = n.store(n.divide(Math.max(0, n.store(n.subtract(speed, loss))), speed));
  body = bodies.read(actor.id);
  if (body === null) return "removed";
  bodies.write(actor, { ...body, velocity: scale(velocity, newspeed) });
  host.flyMove(elapsed);
  if (!actors.isLive(actor.id)) return "removed";
  bodies.link(actor);
  host.touchTriggers();
  body = bodies.read(actor.id);
  if (body === null) return "removed";
  const wasInWater = (host.water().waterType & 56) !== 0;
  const waterType = host.pointContents(body.origin), inWater = (waterType & 56) !== 0;
  host.writeWater(inWater ? 1 : 0, waterType);
  if (wasInWater !== inWater) host.waterSound(inWater ? oldOrigin : body.origin);
  return actors.isLive(actor.id) ? "moved" : "removed";
}
