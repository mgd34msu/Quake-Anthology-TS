// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { corpusFile } from "../../support/corpus.ts";

import { decodeLocalizationKey } from "../../../src/text/localization-key.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../../src/core/numeric.ts";
import {
  QcEntityMemory,
  QcMachine,
  classicQcEntityLayout,
  createQcBuiltins,
  createQcSourceSlotStorage,
  loadQcProgram,
  qcHostKindForProgram,
  qcLinkBounds,
} from "../../../src/compat/qc/index.ts";
import { QcWorldHost } from "../../../src/compat/qc/world-host.ts";
import { createQcPresentationBindings } from "../../../src/compat/qc/presentation-host.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry, SharedBodyTable, SourceActorSlots, quakeEdictLifetime } from "../../../src/world/actors/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { readQ1Bsp } from "../../../src/formats/q1-map/index.ts";

async function setup() {
  const archive = await openArchive(corpusFile("q1/rerelease/id1/pak0.pak"));
  const actors = new SessionActorRegistry(createIdentityOwner("qc-localization-key"));
  const progs = archive.findEntries("progs.dat").at(-1),
    map = archive.findEntries("maps/end.bsp").at(-1);
  if (progs === undefined || map === undefined) throw new Error("Missing retail rerelease sources");
  const program = loadQcProgram(await archive.readEntry(progs)),
    scene = createSceneQueries(readQ1Bsp(await archive.readEntry(map)));
  const numeric = createNumericOperations(Q1_DONOR_PROFILE);
  const entities = new QcEntityMemory(classicQcEntityLayout(program), 16, 2);
  const bodies = new SharedBodyTable(actors, {
    absoluteBounds: (_actor, body) => qcLinkBounds(body, 0, numeric),
    onLink: () => undefined,
    onUnlink: () => undefined,
  });
  const slots = new SourceActorSlots(actors, {
    provider: "test:qc",
    capacity: 16,
    lifetime: quakeEdictLifetime(2),
    storage: createQcSourceSlotStorage({ program, entities }, { freeOffsetBytes: 0, freeTimeOffsetBytes: 92 }),
    now: () => ({ kind: "seconds", value: 0 }),
    unlink: actor => bodies.unlink(actor),
    exhausted: () => {
      throw new Error("No edicts");
    },
  });
  slots.bindExisting(0, "quakec:world");
  slots.bindExisting(1, "quakec:client");
  const world = new QcWorldHost({
    program,
    entities,
    actors,
    slots,
    bodies,
    scene,
    numeric: Q1_DONOR_PROFILE,
    model: () => null,
    foreignReference: () => {
      throw new Error("No foreign actors");
    },
  });
  const printed: string[] = [];
  const presentation = createQcPresentationBindings(world, {
    content: "q1:rerelease:id1:retail",
    finaleFinished: () => true,
    message: () => undefined,
    loading: () => false,
    print: text => {
      printed.push(text);
      return undefined;
    },
    broadcastPrint: text => {
      printed.push(text);
      return undefined;
    },
    lookup: () => null,
    precache: () => {
      throw new Error("No precache");
    },
    events: { registerResource: () => undefined, emit: () => undefined },
  });
  const host = new Map([...world.host, ...presentation]);
  const vm = new QcMachine({
    program,
    entities,
    numeric,
    builtins: createQcBuiltins({ kind: qcHostKindForProgram(program), host, isFreeEntity: slot => world.isFreeEntity(slot) }),
    serverActive: () => true,
  });
  return { archive, program, vm, printed, entities };
}

test("ex_bprint carries a localization key and its arguments as a versioned key text", async () => {
  const { archive, program, vm, printed } = await setup();
  try {
    vm.globals.setInt(4, vm.strings.setEngine("test:key", "$qc_entered", 32));
    vm.globals.setInt(7, vm.strings.setEngine("test:arg", "Ranger", 32));
    vm.execute(program.functionNamed("ex_bprint").index, 2);
    expect(printed.map(decodeLocalizationKey)).toEqual([{ key: "$qc_entered", args: ["Ranger"] }]);
    printed.length = 0;
    vm.execute(program.functionNamed("ex_bprint").index, 1);
    expect(printed).toEqual(["$qc_entered"]);
  } finally {
    archive.close();
  }
});

test("find matches an entity whose string field is empty, as WinQuake does", async () => {
  const { archive, program, vm } = await setup();
  try {
    vm.globals.setInt(4, 0);
    vm.globals.setInt(7, vm.fieldOffset("targetname"));
    vm.globals.setInt(10, vm.strings.setEngine("test:empty", "", 4));
    vm.execute(program.functionNamed("find").index, 3);
    expect(vm.entities.slot(vm.globals.int(1))).toBe(1);
  } finally {
    archive.close();
  }
});
