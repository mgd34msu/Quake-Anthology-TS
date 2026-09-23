import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { SessionActorRegistry } from "../../src/world/actors/index.ts";
import { projectWeaponSlot } from "../../src/app/bootstrap/simulation/weapon-slot-projection.ts";
import type { EquipmentWeaponProjection, PrimaryWeaponProjection } from "../../src/app/bootstrap/simulation/weapon-slot-projection.ts";
import type { SimulationPresentation } from "../../src/app/bootstrap/simulation/types.ts";
import { readGrappleWeaponState, readWeaponSlots } from "../../src/app/bootstrap/simulation/weapon-slot-checkpoint.ts";
import type { WeaponSlotState } from "../../src/app/bootstrap/simulation/weapon-slot.ts";
import { createGrappleWeaponState } from "../../src/content/q2/equipment/grapple-weapon.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "../../src/persistence/value.ts";

test("slot projection retains outgoing source presentation, pending selection and stored primary ammo", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("slot-projection"));
  const actor = actors.allocate("q3:character", "q3:sarge").id;
  const model: SimulationPresentation = { actor, content: "q3:classic:baseq3:fixture", family: "q3", path: "models/weapons2/rocketl/rocketl.md3",
    frame: 4, oldFrame: 3, skin: 0, effects: 0, renderFlags: 0, origin: { x: 1, y: 2, z: 3 }, angles: { x: 4, y: 5, z: 6 }, scale: 1, visible: true, viewWeapon: true };
  const primary: PrimaryWeaponProjection = { active: { provider: "q3:weapons", item: "q3:weapon/rocketlauncher" },
    pending: { provider: "q3:weapons", item: "q3:weapon/railgun" }, model,
    ui: { powerups: [{ item: "q2:item_quad", label: "Quad Damage", remainingSeconds: 12.5 }], weaponStatus: { source: { provider: "q3:weapons", content: "q3:classic:baseq3:fixture" }, item: "q3:weapon/rocketlauncher", label: "rocketlauncher", ammo: { kind: "finite", item: "q3:ammo/rocketlauncher", count: 17, hasAmmoToStart: true, low: false } }, arsenalWarning: "none", health: 90, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, activeWeapon: "q3:weapon/rocketlauncher", ammo: { item: "q3:ammo/rocketlauncher", count: 17 }, inventory: [], items: [] } };
  const equipment: EquipmentWeaponProjection = { source: { provider: "q2:equipment/ctf-grapple", content: "q2:classic:ctf:fixture" }, weapon: { provider: "q2:equipment/ctf-grapple", item: "q2:weapon_grapple" },
    item: { id: "q2:weapon_grapple", label: "Grapple", kind: "weapon", sourceOrdinal: 12, owned: true, hasAmmo: true, count: null, warningCount: 0 },
    model: { ...model, content: "q2:classic:ctf:fixture", family: "q2", path: "models/weapons/grapple/tris.md2", frame: 32 } };
  const native = projectWeaponSlot({ kind: "active", provider: "q3:weapons" }, primary, equipment);
  expect(native.ui.powerups).toBe(primary.ui.powerups); expect(native.pending).toBe(primary.pending); expect(native.model).toBe(model); expect(native.ui.ammo).toBe(primary.ui.ammo);
  const dropping = projectWeaponSlot({ kind: "switching", from: "q3:weapons", next: equipment.weapon }, primary, equipment);
  expect(dropping.ui.weaponStatus).toBe(primary.ui.weaponStatus); expect(dropping.model).toBe(model); expect(dropping.active).toBe(primary.active); expect(dropping.pending).toBe(equipment.weapon);
  const selected = projectWeaponSlot({ kind: "active", provider: "q2:equipment/ctf-grapple" }, primary, equipment);
  expect(selected.ui.powerups).toBe(primary.ui.powerups); expect(selected.model).toBe(equipment.model); expect(selected.active).toBe(equipment.weapon); expect(selected.ui.ammo).toBeNull();
  expect(selected.ui.inventory).toBe(primary.ui.inventory); expect(primary.ui.ammo?.count).toBe(17);
  expect(selected.ui.items).toEqual([equipment.item]);
  const returning = projectWeaponSlot({ kind: "switching", from: "q2:equipment/ctf-grapple", next: primary.pending ?? equipment.weapon }, primary, equipment);
  expect(returning.ui.weaponStatus?.source).toBe(equipment.source); expect(returning.ui.weaponStatus?.ammo.kind).toBe("unmetered"); expect(returning.model).toBe(equipment.model); expect(returning.ui.ammo).toBeNull(); expect(returning.pending).toBe(primary.pending);
  expect(projectWeaponSlot({ kind: "active", provider: "q2:equipment/ctf-grapple" }, { ...primary, ui: selected.ui }, equipment).ui.items).toEqual([equipment.item]);
});

test("slot and grapple animation checkpoints retain cross-provider intent and source deadlines", () => {
  const state: WeaponSlotState = { kind: "switching", from: "q3:weapons", next: { provider: "q2:equipment/ctf-grapple", item: "q2:weapon_grapple" } };
  const slots = [{ actor: { slot: 3, generation: 2 }, state }];
  expect(readWeaponSlots(new SaveReader(decodeCheckpointValue(encodeCheckpointValue(slots)), "slots"))).toEqual(slots);
  const weapon = createGrappleWeaponState();
  weapon.handoff = "holstering"; weapon.animation.phase = "dropping"; weapon.animation.frame = 34;
  weapon.animation.thinkTime = 2.325; weapon.animation.fireFinished = 2.25; weapon.animation.fireBuffered = true;
  expect(readGrappleWeaponState(new SaveReader(decodeCheckpointValue(encodeCheckpointValue(weapon)), "weapon"))).toEqual(weapon);
  expect(() => readWeaponSlots(new SaveReader([{ actor: { slot: 3, generation: 2 }, state: { kind: "holstering-primary" } }], "slots"))).toThrow();
  expect(() => readGrappleWeaponState(new SaveReader({ ...weapon, animation: { ...weapon.animation, phase: "foreign-primary" } }, "weapon"))).toThrow();
});

test("multiple admitted owners preserve committed outgoing traversal and validate saved ownership after binding", async () => {
  const { WeaponSlot } = await import("../../src/app/bootstrap/simulation/weapon-slot.ts");
  const calls: string[] = []; let settled = false, live = true;
  const slot = new WeaponSlot({ provider: "q1:weapons", accepts: item => item === "q1:weapon/axe", select: () => true,
    holster: () => { calls.push("retire"); }, isHolstered: () => settled, resume: () => { calls.push("primary"); return true; } }, undefined,
    { kind: "switching", from: "q1:weapons", next: { provider: "mod:weapons", item: "mod:weapon/beam" } });
  expect(() => slot.validateRestore()).toThrow("not admitted");
  const close = slot.bind({ current: () => live, read: () => ({ source: { provider: "mod:weapons", content: "q1:classic:id1:installed" }, active: "mod:weapon/beam", pending: null, model: null, items: [] }),
    handoff: { provider: "mod:weapons", accepts: item => item === "mod:weapon/beam", select: () => true, holster: () => { calls.push("retire-mod"); }, isHolstered: () => true, resume: () => { calls.push("mod"); return true; } } });
  slot.validateRestore(); slot.reconcile(); expect(slot.selected("mod:weapons")).toBe(false); expect(calls).toEqual([]);
  settled = true; slot.reconcile(); expect(calls).toEqual(["mod"]); expect(slot.selected("mod:weapons")).toBe(true);
  live = false; close(); expect(slot.primarySelected()).toBe(true); expect(calls).toEqual(["mod", "primary"]);
  expect(slot.request({ provider: "mod:weapons", item: "mod:weapon/beam" })).toBe(false);
});

test("original incoming refusal resumes the exact outgoing source and preserves reentrant replacement", async () => {
  const { WeaponSlot } = await import("../../src/app/bootstrap/simulation/weapon-slot.ts");
  const log: string[] = [];
  const slot = new WeaponSlot({ provider: "q1:weapons", accepts: () => true, select: () => true, holster: () => { log.push("retire-primary"); }, isHolstered: () => true,
    resume: () => { log.push("resume-primary"); return true; } });
  let refuse: () => boolean = () => false;
  const close = slot.bind({ current: () => true, read: () => ({ source: { provider: "mod:weapons", content: "q1:classic:id1:installed" }, active: null, pending: null, model: null, items: [] }),
    handoff: { provider: "mod:weapons", accepts: () => true, select: () => true, holster: () => { log.push("retire-mod"); }, isHolstered: () => true,
      resume: () => { log.push("original-refusal"); return refuse(); } } });
  expect(slot.request({ provider: "mod:weapons", item: "mod:weapon/empty" })).toBe(true); slot.reconcile();
  expect(slot.primarySelected()).toBe(true); expect(log).toEqual(["retire-primary", "original-refusal", "resume-primary"]);
  log.length = 0; refuse = () => { close(); return false; };
  slot.request({ provider: "mod:weapons", item: "mod:weapon/empty" }); slot.reconcile();
  expect(log).toEqual(["retire-primary", "original-refusal", "resume-primary"]); expect(slot.primarySelected()).toBe(true);
});
