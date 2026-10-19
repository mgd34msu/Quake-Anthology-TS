import { expect, test } from "bun:test";
import { corpusFile } from "../../support/corpus.ts";

import { openArchive } from "../../../src/content/archive/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../../src/core/numeric.ts";
import { QcEntityMemory, QcMachine, classicQcEntityLayout, createQcBuiltins, createQcSourceSlotStorage, loadQcProgram, qcHostKindForProgram, qcLinkBounds } from "../../../src/compat/qc/index.ts";
import { QcWorldHost } from "../../../src/compat/qc/world-host.ts";
import { createQcPresentationBindings } from "../../../src/compat/qc/presentation-host.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry, SharedBodyTable, SourceActorSlots, quakeEdictLifetime } from "../../../src/world/actors/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { readQ1Bsp } from "../../../src/formats/q1-map/index.ts";

test("retail rerelease programs select the rerelease host and bind every ex_* builtin", async () => {
  const archive = await openArchive(corpusFile("q1/rerelease/id1/pak0.pak"));
  const actors = new SessionActorRegistry(createIdentityOwner("qc-rerelease-builtins"));
  try {
    const progs = archive.findEntries("progs.dat").at(-1), map = archive.findEntries("maps/end.bsp").at(-1);
    if (progs === undefined || map === undefined) throw new Error("Missing retail rerelease sources");
    const program = loadQcProgram(await archive.readEntry(progs)), scene = createSceneQueries(readQ1Bsp(await archive.readEntry(map)));
    expect(qcHostKindForProgram(program)).toBe("rerelease");
    const numeric = createNumericOperations(Q1_DONOR_PROFILE);
    const entities = new QcEntityMemory(classicQcEntityLayout(program), 16);
    const bodies = new SharedBodyTable(actors, { absoluteBounds: (_actor, body) => qcLinkBounds(body, 0, numeric), onLink: () => undefined, onUnlink: () => undefined });
    const slots = new SourceActorSlots(actors, { provider: "test:qc", capacity: 16, lifetime: quakeEdictLifetime(1),
      storage: createQcSourceSlotStorage({ program, entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: 92 }),
      now: () => ({ kind: "seconds", value: 0 }), unlink: actor => bodies.unlink(actor), exhausted: () => { throw new Error("No edicts"); } });
    slots.bindExisting(0, "quakec:world");
    const world = new QcWorldHost({ program, entities, actors, slots, bodies, scene, numeric: Q1_DONOR_PROFILE, model: () => null, foreignReference: () => { throw new Error("No foreign actors"); } });
    const printed: string[] = [];
    const presentation = createQcPresentationBindings(world, { content: "q1:rerelease:id1:retail", finaleFinished: () => true,
      message: () => undefined, loading: () => false, print: text => { printed.push(text); return undefined; }, lookup: () => null,
      precache: () => { throw new Error("No precache"); }, events: { registerResource: () => undefined, emit: () => undefined } });
    const host = new Map([...world.host, ...presentation]);
    const vm = new QcMachine({ program, entities, numeric, builtins: createQcBuiltins({ kind: qcHostKindForProgram(program), host }), serverActive: () => true });
    expect(vm.missingBuiltins().filter(missing => missing.number === null)).toEqual([]);
    // ex_bprint routes through the broadcast print channel without faulting.
    const marker = "ex_bprint", bytes = new TextEncoder().encode(marker);
    let stringOffset = -1;
    outer: for (let at = 1; at + bytes.length <= program.strings.length; at++) {
      for (let index = 0; index < bytes.length; index++) if (program.strings[at + index] !== bytes[index]) continue outer;
      stringOffset = at; break;
    }
    if (stringOffset < 0) throw new Error("Missing marker string");
    vm.globals.setInt(4, stringOffset);
    vm.execute(program.functionNamed("ex_bprint").index, 1);
    expect(printed).toEqual([marker]);
    vm.execute(program.functionNamed("ex_CheckPlayerEXFlags").index, 1);
    expect(vm.globals.float(1)).toBe(0);
    for (const name of ["ex_draw_point", "ex_bot_movetopoint", "ex_walkpathtogoal", "ex_prompt", "ex_promptchoice", "ex_clearprompt"]) {
      const fn = program.functions.find(candidate => candidate.name === name);
      if (fn !== undefined) vm.execute(fn.index, 0);
    }
  } finally { archive.close(); }
});
