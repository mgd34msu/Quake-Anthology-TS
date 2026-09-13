import { expect, test } from "bun:test";
import { openArchive } from "../../../src/content/archive/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../../src/core/numeric.ts";
import { QcEntityMemory, QcMachine, classicQcEntityLayout, createQcBuiltins, createQcSourceSlotStorage, loadQcProgram, qcLinkBounds } from "../../../src/compat/qc/index.ts";
import { QcWorldHost } from "../../../src/compat/qc/world-host.ts";
import { QcFinaleAcknowledgement, createQcPresentationBindings } from "../../../src/compat/qc/presentation-host.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry, SharedBodyTable, SourceActorSlots, quakeEdictLifetime } from "../../../src/world/actors/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { readQ1Bsp } from "../../../src/formats/q1-map/index.ts";

test("retail rerelease finale_5 polls the shared attack acknowledgement through its named builtin", async () => {
  const archive = await openArchive(new URL("../../../../qfiles/q1/rerelease/id1/pak0.pak", import.meta.url).pathname);
  const actors = new SessionActorRegistry(createIdentityOwner("qc-finale"));
  try {
    const progs = archive.findEntries("progs.dat").at(-1), map = archive.findEntries("maps/end.bsp").at(-1);
    if (progs === undefined || map === undefined) throw new Error("Missing retail finale sources");
    const program = loadQcProgram(await archive.readEntry(progs)), scene = createSceneQueries(readQ1Bsp(await archive.readEntry(map)));
    const numeric = createNumericOperations(Q1_DONOR_PROFILE), entities = new QcEntityMemory(classicQcEntityLayout(program), 16);
    const bodies = new SharedBodyTable(actors, { absoluteBounds: (_actor, body) => qcLinkBounds(body, 0, numeric), onLink: () => undefined, onUnlink: () => undefined });
    let seconds = 10;
    const slots = new SourceActorSlots(actors, { provider: "test:qc", capacity: 16, lifetime: quakeEdictLifetime(1),
      storage: createQcSourceSlotStorage({ program, entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: 92 }),
      now: () => ({ kind: "seconds", value: seconds }), unlink: actor => bodies.unlink(actor), exhausted: () => { throw new Error("No finale edicts"); } });
    slots.bindExisting(0, "quakec:world"); const timer = slots.allocate("quakec:timer"), player = slots.allocate("quakec:player");
    const world = new QcWorldHost({ program, entities, actors, slots, bodies, scene, numeric: Q1_DONOR_PROFILE, model: () => null, foreignReference: () => { throw new Error("No foreign actors"); } });
    const acknowledgement = new QcFinaleAcknowledgement(), buttons = new Map([[player.id, true]]);
    const presentation = createQcPresentationBindings(world, { content: "q1:rerelease:id1:retail", finaleFinished: () => acknowledgement.poll(seconds, buttons),
      loading: () => false, print: () => undefined, lookup: () => null, precache: () => { throw new Error("No finale precache"); },
      events: { registerResource: () => undefined, emit: () => undefined } });
    const vm = new QcMachine({ program, entities, numeric, builtins: createQcBuiltins({ kind: "rerelease", host: presentation }), serverActive: () => true });
    vm.globals.setInt(vm.globalOffset("self"), entities.reference(1));
    const poll = (time: number): boolean => {
      seconds = time; vm.globals.setFloat(vm.globalOffset("time"), time);
      entities.at(1).setInt(vm.fieldOffset("think"), program.functionNamed("finale_5").index);
      vm.execute(program.functionNamed("finale_5").index);
      const accepted = entities.at(1).int(vm.fieldOffset("think")) === program.functionNamed("finale_6").index;
      expect(entities.at(1).float(vm.fieldOffset("nextthink"))).toBeCloseTo(time + (accepted ? 5 : 0.1), 4);
      return accepted;
    };
    expect(timer.id.equals(world.actor(1).id)).toBe(true);
    expect(poll(10)).toBe(false); expect(poll(10.1)).toBe(false);
    buttons.set(player.id, false); expect(poll(10.2)).toBe(false);
    buttons.set(player.id, true); expect(poll(10.3)).toBe(true); expect(poll(10.4)).toBe(true);
    expect(poll(12)).toBe(false);
    const joined = slots.allocate("quakec:joined"); buttons.set(joined.id, true); expect(poll(12.1)).toBe(true);
    buttons.delete(joined.id); acknowledgement.reset(); expect(poll(12.2)).toBe(false);
    buttons.set(player.id, false); expect(poll(12.3)).toBe(false);
    buttons.set(player.id, true); expect(poll(12.4)).toBe(true);
    expect(poll(1)).toBe(false);
  } finally { actors.close(); archive.close(); }
});
