import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createContentId, createMountId, createMountIdentity, createMountPlanId } from "../../../../src/contracts/content.ts";
import type { ArchiveMount } from "../../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { WeaponStepInput } from "../../../../src/contracts/movement.ts";
import { digestFile, openMountPlan } from "../../../../src/content/mounts/index.ts";
import { loadQ3Character, Q3CharacterPresenter, Q3CharacterActor, Q3DeathAnimationSequence, q3InitialCombat,
  Q3_CHARACTER_BOUNDS, q3SpawnAnimation, q3SpawnLoadout, q3SpawnArsenalRuntime, stepQ3Arsenal,
  Q3CharacterEventPresenter, createPlayerPoseState } from "../../../../src/content/q3/foundation/index.ts";
import type { Q3CharacterEvent } from "../../../../src/content/q3/foundation/index.ts";
import { identityMat4 } from "../../../../src/core/math.ts";
import { qvmAnglesToAxis } from "../../../../src/core/qvm-math.ts";
import { GameRandom } from "../../../../src/core/game-numeric.ts";
import { EntityEvent, Weapon } from "../../../../src/movement/q3/constants.ts";
import { prepareSceneEntity } from "../../../../src/render/scene/models/index.ts";
import { SessionActorRegistry } from "../../../../src/world/actors/registry.ts";
import { SharedBodyTable, translatedBodyBounds } from "../../../../src/world/actors/body.ts";
import { ActorCallbackTable } from "../../../../src/world/actors/callbacks.ts";
import { GameplayAuthority } from "../../../../src/world/gameplay/authority.ts";
import { SharedInventoryTable } from "../../../../src/world/gameplay/inventory.ts";
import { createQ3CombatPolicy, nativeVictimArmor } from "../../../../src/world/gameplay/policies.ts";

const zero = { x: 0, y: 0, z: 0 };
const archivePath = resolve(import.meta.dir, "../../../../../qfiles/q3a/baseq3/pak0.pk3");

describe("permanent Q3 character foundation", () => {
  test.skipIf(!existsSync(archivePath))("loads and animates real Sarge parts through MD3 tags", async () => {
    const mount: ArchiveMount = { kind: "archive", identity: createMountIdentity(createMountId("q3-foundation", "base"),
      createContentId({ family: "q3", edition: "retail", package: "baseq3", revision: "local" }), 0),
      archivePath, format: "pk3", archiveDigest: await digestFile(archivePath) };
    using resources = await openMountPlan({ id: createMountPlanId("q3-foundation", "test"), mounts: [mount],
      defaultOrder: [mount.identity.id], prefixOrders: [] });
    const assets = await loadQ3Character(resources, { model: "sarge", skin: "default", headModel: "sarge", headSkin: "default", team: null, teamName: "" });
    expect(assets.lower.model.frames.length).toBeGreaterThan(100);
    expect(assets.upper.surfaces.length).toBeGreaterThan(0);
    expect(assets.lower.model.tags[0]?.some(tag => tag.name === "tag_torso")).toBe(true);
    const actors = new SessionActorRegistry(createIdentityOwner("q3-model"));
    const actor = actors.allocate("q3:character", "q3:character/sarge");
    const presenter = new Q3CharacterPresenter(assets);
    const view = { actor: actor.id, origin: zero, angles: zero, velocity: { x: 180, y: 0, z: 0 }, movementDirection: 0,
      animation: { ...q3SpawnAnimation(), legs: 15 }, sourceFlags: 0, powerups: 0, team: null, color: { x: 1, y: 1, z: 1, w: 1 } };
    presenter.reset(view, 1000);
    const passes = presenter.frame(view, { timeMilliseconds: 1100, frameMilliseconds: 100,
      shaderTime: { kind: "milliseconds", value: 1100 }, swingSpeed: 0.3, noPlayerAnimations: false,
      personalModel: false, shadowPlane: null, weapon: [] });
    expect(passes.length).toBe(1);
    const pass = passes[0];
    if (pass === undefined) throw new Error("Missing player render pass");
    const prepared = prepareSceneEntity(pass.entity, { camera: { origin: { x: -200, y: 0, z: 24 }, axis: qvmAnglesToAxis(zero),
      projection: identityMat4(), viewport: { x: 0, y: 0, width: 640, height: 480 }, clip: { kind: "none" } },
      timeSeconds: 1.1, noCull: true, options: pass.options });
    expect(prepared.surfaces.length).toBeGreaterThan(0);
    expect(prepared.missingAttachments).toEqual([]);
    const torso = prepared.attachments[0];
    expect(torso?.missingAttachments).toEqual([]);
    expect(torso?.attachments[0]?.surfaces.length).toBeGreaterThan(0);
    expect(prepared.surfaces.some(surface => surface.image.kind === "external")).toBe(true);
  });

  test("Q1 command timing drives the selected Q3 weapon without changing Q1 command words", () => {
    const actors = new SessionActorRegistry(createIdentityOwner("q3-arsenal"));
    const actor = actors.allocate("q3:character", "q3:character/sarge");
    const input: WeaponStepInput = { actor, command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: 0,
      viewAngles: zero, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 1, impulse: 0 },
      frame: { frame: 1, time: { kind: "seconds", value: 0.016 }, elapsed: { kind: "seconds", value: 0.016 }, phase: "client-command" },
      arsenal: q3SpawnLoadout("q3:arsenal", "baseq3", false), animation: { provider: "q3:character", state: q3SpawnAnimation() },
      environment: { health: 125, flight: false, haste: false, invulnerable: false, gravityMultiplier: 1 }, gauntletHit: false };
    const spawned = q3SpawnArsenalRuntime("baseq3", 100);
    const released = stepQ3Arsenal(input, spawned, { attack: false, useHoldable: false, requestedWeapon: Weapon.WP_MACHINEGUN });
    const fired = stepQ3Arsenal({ ...input, arsenal: released.arsenal, animation: released.animation }, released.runtime,
      { attack: true, useHoldable: false, requestedWeapon: Weapon.WP_MACHINEGUN });
    expect(fired.arsenal.ammo.find(entry => entry.item === "q3:ammo/machinegun")?.count).toBe(99);
    expect(fired.effects.some(effect => effect.kind === "event" && effect.value.event === EntityEvent.EV_FIRE_WEAPON)).toBe(true);
    expect(fired.arsenal.state).toEqual({ kind: "q3", sourceWeapon: 2, state: 3, timeMilliseconds: 100 });
    expect(fired.animation.state.kind).toBe("q3");
    expect(input.command.kind).toBe("q1-netquake");
  });

  test("shared damage invokes Q3 death and its respawn delay", () => {
    const actors = new SessionActorRegistry(createIdentityOwner("q3-life"));
    const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
    const callbacks = new ActorCallbackTable(actors);
    const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
    const inventory = new SharedInventoryTable(actors);
    const actor = actors.allocate("q3:character", "q3:character/sarge");
    const events: Q3CharacterEvent[] = [];
    let time = 1000;
    const player = new Q3CharacterActor(actor, "q3:character", "baseq3", { bodies, callbacks, combat, inventory,
      timeMilliseconds: () => time, emit: event => { events.push(event); return undefined; }, spawnTargets: () => undefined, killBox: () => undefined,
      deathContext: () => ({ blood: true, noDrop: false, suicide: false, killerSourceSlot: 1022 }) }, new Q3DeathAnimationSequence());
    const spawn = { body: { origin: zero, angles: zero, velocity: zero, bounds: Q3_CHARACTER_BOUNDS, ground: null },
      combat: q3InitialCombat("100", null), inventory: q3SpawnLoadout("q3:arsenal", "baseq3", false).ammo };
    player.spawn(spawn);
    combat.register(createQ3CombatPolicy({ id: "q3:combat", armor: nativeVictimArmor(() => ({ screenFacingDot: 1, arithmetic: "binary32" })),
      context: () => ({ product: "baseq3", player: true, attackerPlayer: false, attackerMaxHealth: 100, attackerGuard: false,
        intermission: false, noclip: false, missionpackInvulnerability: false, noKnockback: true, knockbackScale: 1000,
        friendlyFire: false, battlesuit: false, falling: false, juiced: false, proximityProtected: false }) }));
    combat.apply({ target: actor.id, amount: 140, knockback: 0, direction: zero, point: zero, normal: zero, delivery: "direct",
      attack: { sequence: 1, time: { kind: "milliseconds", value: time }, attacker: null, inflictor: null, weapon: null,
        weaponProvider: "q2:arsenal", combatProvider: "q3:combat", inventoryProvider: "q3:inventory", movementProvider: "q1:movement",
        cause: { kind: "q2", meansOfDeath: 1, damageFlags: 0 } } });
    expect(combat.read(actor.id)?.health).toBe(-15);
    expect(events.at(-1)?.event).toBe(EntityEvent.EV_DEATH1);
    expect(bodies.read(actor.id)?.bounds.max.z).toBe(-8);
    expect(player.wantsRespawn(2700, true, false)).toBe(false);
    expect(player.wantsRespawn(2701, true, false)).toBe(true);
    time = 2800;
    player.spawn(spawn);
    expect(combat.read(actor.id)?.health).toBe(125);
    expect(events.at(-1)?.event).toBe(EntityEvent.EV_PLAYER_TELEPORT_IN);
    expect(inventory.count(actor.id, "q3:ammo/machinegun")).toBe(100);
  });

  test("character pain sounds share the source pose debounce", () => {
    const pose = createPlayerPoseState();
    const events = new Q3CharacterEventPresenter(pose, "boot", new GameRandom(1));
    expect(events.pain(1000, 20)).toEqual([{ kind: "custom-sound", channel: "voice", name: "*pain25_1.wav" }]);
    expect(events.pain(1300, 10)).toEqual([]);
    expect(events.pain(1500, 80)).toEqual([{ kind: "custom-sound", channel: "voice", name: "*pain100_1.wav" }]);
    expect(pose.painDirection).toBe(false);
  });
});
