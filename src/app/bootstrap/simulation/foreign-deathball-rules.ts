// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { parseEntities } from "../../../formats/q3-map/index.ts";
import { balancedTeam, entityOrigin, foreignMatchMode, mapFamily, zeroVelocity, type ForeignMatchHost, type ForeignMatchSpawns, type ForeignMatchStrategy } from "./foreign-match-host.ts";

type Team = 1 | 2;

/** DeathBall on a foreign world (match provider q2:deathball); Q2 worlds keep the native composition module. */
export class DeathballRules implements ForeignMatchStrategy {
  #ball: OwnedActor | null = null;
  readonly #teams = new Map<ActorId, Team>();
  #spots: { readonly ball: Vec3 | null; readonly goals: ReadonlyMap<Team, Vec3> } | null = null;
  #prepared = false;
  #resetAt: number | null = null;

  constructor(private readonly host: ForeignMatchHost, private readonly spawns: ForeignMatchSpawns) {}

  get ball(): OwnedActor | null { return this.#ball; }
  team(actor: ActorId): Team | undefined { return this.#teams.get(actor); }
  goal(team: Team): Vec3 | undefined { return this.#spots?.goals.get(team); }

  active(): boolean { return foreignMatchMode(this.host, "q2:deathball"); }
  blocksCheckpoint(): boolean { return this.active(); }
  release(actor: ActorId): void { this.#teams.delete(actor); }

  /** Native DeathBall: the ball takes 1 damage from every hit; shared combat knockback against its 50 mass does the pushing. */
  registerCombat(): void {
    if (!this.active()) return;
    this.host.combat.damageOperation.register({ provider: "q2:deathball", id: "q2:deathball/ball", order: 0, kind: "transform",
      transform: request => this.#ball !== null && request.target.equals(this.#ball.id) && request.amount !== 1
        ? { ...request, amount: 1 } : request });
  }

  /** DeathBall origins come from the retained entity lump; authored goals are
   * brushes, so foreign play uses their origins with a proximity radius and
   * synthesizes both from deathmatch spawns when a map has none. */
  #origins(): { readonly ball: Vec3 | null; readonly goals: ReadonlyMap<Team, Vec3> } {
    if (this.#spots !== null) return this.#spots;
    const host = this.host;
    let ball: Vec3 | null = null;
    const goals: Vec3[] = [], teamStarts = new Map<string, Vec3>();
    for (const entity of parseEntities(host.entityLump)) {
      const classname = entity.get("classname") ?? "";
      const origin = entityOrigin(entity);
      if (origin === null) continue;
      if (classname === "dm_dball_ball_start" && ball === null) ball = origin;
      else if (classname === "dm_dball_goal") goals.push(origin);
      else if ((classname === "dm_dball_team1_start" || classname === "dm_dball_team2_start") && !teamStarts.has(classname)) teamStarts.set(classname, origin);
    }
    const spots = this.spawns.origins();
    const assigned = new Map<Team, Vec3>();
    if (goals.length >= 2) {
      const [first, second] = goals;
      if (first !== undefined && second !== undefined) {
        const team1Start = teamStarts.get("dm_dball_team1_start");
        const firstIsTeam1 = team1Start === undefined ? first.x <= second.x
          : Math.hypot(first.x - team1Start.x, first.y - team1Start.y, first.z - team1Start.z)
            <= Math.hypot(second.x - team1Start.x, second.y - team1Start.y, second.z - team1Start.z);
        assigned.set(1, firstIsTeam1 ? first : second); assigned.set(2, firstIsTeam1 ? second : first);
      }
    } else if (spots.length >= 2) {
      const a = spots[0] ?? null;
      let b: Vec3 | null = null, best = -1;
      for (const spot of spots) {
        if (a === null) break;
        const distance = Math.hypot(spot.x - a.x, spot.y - a.y, spot.z - a.z);
        if (distance > best) { best = distance; b = spot; }
      }
      if (a !== null && b !== null) {
        let c: Vec3 | null = null; best = -1;
        for (const spot of spots) {
          const distance = Math.hypot(spot.x - b.x, spot.y - b.y, spot.z - b.z);
          if (distance > best) { best = distance; c = spot; }
        }
        if (c !== null) { assigned.set(1, c); assigned.set(2, b); }
      }
    }
    if (ball === null) {
      // A synthesized ball start must clear both synthesized goals or the
      // match would score itself at spawn.
      // A ball spawned inside a player starts solid in that actor, and the Q1 trace rules then let it fall through the world.
      const occupied = host.players().flatMap(actor => host.physics.bodies.read(actor)?.origin ?? []);
      let best: Vec3 | null = null, bestClearance = -1;
      for (const spot of spots) {
        if (occupied.some(origin => Math.hypot(spot.x - origin.x, spot.y - origin.y) < 64 && Math.abs(spot.z - origin.z) < 64)) continue;
        let clearance = Infinity;
        for (const goal of assigned.values()) clearance = Math.min(clearance, Math.hypot(spot.x - goal.x, spot.y - goal.y, spot.z - goal.z));
        if (clearance > bestClearance) { bestClearance = clearance; best = spot; }
      }
      ball = best ?? this.spawns.farthest();
    }
    this.#spots = { ball, goals: assigned };
    return this.#spots;
  }

  #spawn(origin: Vec3): void {
    const host = this.host;
    const actor = host.actors.allocate(host.recipe.match.provider, "q2:dm_dball_ball");
    const bounds = { min: { x: -15, y: -15, z: -15 }, max: { x: 15, y: 15, z: 15 } };
    host.physics.bodies.create(actor, { origin: { x: origin.x, y: origin.y, z: origin.z + 16 }, velocity: zeroVelocity, angles: zeroVelocity, bounds, ground: null });
    host.physics.setSolid(actor, "box", null, mapFamily(host));
    host.physics.setMotion({ actor, velocity: zeroVelocity, angularVelocity: zeroVelocity, kind: "toss", gravity: 1, gravityVector: { x: 0, y: 0, z: -1 }, clipMask: 3, owner: null });
    host.combat.create(actor, { health: 50000, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 50, canTakeDamage: true, invulnerable: false, team: null });
    host.bindModel(actor, { content: host.recipe.match.content, path: "models/objects/dball/tris.md2" });
    host.physics.bodies.link(actor);
    this.#ball = actor;
  }

  #prepare(): void {
    this.#prepared = true;
    const { ball } = this.#origins();
    if (ball !== null) this.#spawn(ball);
  }

  tick(): void {
    if (!this.active()) return;
    if (!this.#prepared) this.#prepare();
    const host = this.host, players = host.players(), now = host.timeSeconds, bodies = host.physics.bodies;
    for (const actor of players) {
      if (this.#teams.has(actor)) continue;
      const team = balancedTeam(this.#teams);
      this.#teams.set(actor, team);
      const owned = host.actors.resolveOwned(actor);
      if (owned !== null) host.combat.setTraits(owned, { team: team === 1 ? "red" : "blue" });
    }
    if (this.#resetAt !== null && now >= this.#resetAt) {
      this.#resetAt = null;
      const { ball: home } = this.#origins();
      const ball = this.#ball, body = ball === null ? null : bodies.read(ball.id);
      if (ball !== null && body !== null && home !== null) { bodies.write(ball, { ...body, origin: { x: home.x, y: home.y, z: home.z + 16 }, velocity: zeroVelocity }); bodies.link(ball); }
    }
    const ball = this.#ball;
    if (ball === null || this.#resetAt !== null) return;
    const body = bodies.read(ball.id);
    if (body === null) return;
    const floor = host.scene.geometry.models[0]?.bounds.min.z;
    if (floor !== undefined && body.origin.z < floor - 256) { this.#resetAt = now; return; }
    for (const [team, goal] of this.#origins().goals) {
      if (Math.hypot(body.origin.x - goal.x, body.origin.y - goal.y, body.origin.z - goal.z) > 64) continue;
      // Native DeathBall: the whole scoring team gains a point, then the
      // ball returns to its start after a two second pause.
      const scoring: Team = team === 1 ? 2 : 1;
      for (const [actor, member] of this.#teams) if (member === scoring) host.addScore(actor, 1);
      this.#resetAt = now + 2;
      return;
    }
  }
}
