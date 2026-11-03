import { testCorpusRoot, corpusFile } from "../../../support/corpus.ts";

import { SaveReader } from "../../../../src/persistence/value.ts";
import { readRereleasePrimaryWorldProfile } from "../../../../src/compat/q2/rerelease/world-profile.ts";
import { builtinNativePrimary } from "../../../../src/compat/q2/native-primary.ts";
import type { RereleaseDebugShapesEvent } from "../../../../src/compat/q2/rerelease/debug-shapes.ts";
import type { RereleaseWorldTextEvent } from "../../../../src/compat/q2/rerelease/world-text.ts";
// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, spyOn } from "bun:test";
import { createMountPlanId } from "../../../../src/contracts/content.ts";
import type { GuestAddress } from "../../../../src/contracts/execution.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import { integer, pointer, requiredPointer } from "../../../../src/guest/runtime/common/memory.ts";
import { readGuestString } from "../../../../src/compat/q2/rerelease/imports.ts";
import type { RereleaseCoreServices } from "../../../../src/compat/q2/rerelease/imports.ts";
import { prepareRereleaseGuest, RereleaseGuestSource } from "../../../../src/app/bootstrap/simulation/rerelease-guest-source.ts";
import { discoverInstalledContent } from "../../../../src/content/catalog/index.ts";
import { openMountPlan } from "../../../../src/content/mounts/index.ts";
import type { RereleaseSoundEvent } from "../../../../src/compat/q2/rerelease/sounds.ts";
import { nativeWorld } from "./world.ts";
import { rereleaseInventoryItems } from "../../../../src/compat/q2/rerelease/semantics.ts";
import { RereleaseSourceEdict } from "../../../../src/compat/q2/rerelease/source-state.ts";
import type { RereleaseQ2GuestHost } from "../../../../src/compat/q2/rerelease/host.ts";
import type { RereleaseForeignDamageServices } from "../../../../src/compat/q2/rerelease/foreign-actors.ts";
import { SizeBuf, SZ_Init } from "../../../../src/network/q2/message.ts";
import type { RereleaseUnicast, RereleaseMulticast } from "../../../../src/compat/q2/rerelease/messages.ts";
import { RereleaseSourceClient } from "../../../../src/compat/q2/rerelease/source-state.ts";
import { retailRereleaseClientProfile } from "../../../../src/compat/q2/rerelease/client-profile.ts";

const dll = new URL(corpusFile("q2/rerelease/baseq2/game_x64.dll"), "file:///");
export const available = await Bun.file(dll).exists();
const activeSources: RereleaseGuestSource[] = [];
/** Test files register this with `afterEach`; a shared helper module cannot register the hook for its importers. */
export function closeNativeSources(): void { for (const source of activeSources.splice(0)) source.close(); }
export async function nativeFixture(worldText?: (event: RereleaseWorldTextEvent) => void, nativeBindings = false, commandArguments: () => readonly string[] = () => [], foreignDamage?: RereleaseForeignDamageServices, debugShapes?: (event: RereleaseDebugShapesEvent) => void, debugDrawing?: "headless", declaredWorld = false, instructionBudget = 5_000_000) {
  const catalog = await discoverInstalledContent({ corpusRoot: testCorpusRoot(), discoverMods: false });
  const product = catalog.require("q2-rerelease-baseq2");
  using mounts = await openMountPlan(await catalog.createMountPlan({ id: createMountPlanId("test", "native-rerelease"), assets: product.id, geometry: product.id }));
  const artifact = await mounts.resolve("game_x64.dll"); if (artifact === null) throw new Error("Missing mounted native DLL");
  expect(artifact.digest).toBe("sha256:045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd");
  const prepared = await prepareRereleaseGuest({ kind: "native", owner: { provider: "q2:rerelease-native-host", content: product.id }, role: "server-game",
    artifact, api: { kind: "q2-rerelease-game", version: 2023 }, profile: { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" } }, mounts);
  const cvars = new CvarRegistry({ dialect: "q2-rerelease", context: { session: createIdentityOwner("rerelease-native").session, origin: { kind: "server-console" } } });
  const prints: string[] = [], configstrings = new Map<number, string>(), reached: string[] = [];
  const localized: { readonly destination: GuestAddress | null; readonly level: number; readonly base: string; readonly arguments: readonly string[] }[] = [];
  const resources = new Map<string, Map<string, number>>();
  const services = (memory: import("../../../../src/guest/core/index.ts").MappedGuestMemory): RereleaseCoreServices => ({
    cvars, print: text => { prints.push(text); return undefined; }, getConfigstring: index => configstrings.get(index) ?? "",
    setConfigstring: (index, text) => { configstrings.set(index, text); return undefined; },
    resourceIndex: (kind, name) => {
      if (name.length === 0) return 0;
      let table = resources.get(kind);
      if (table === undefined) { table = new Map<string, number>(); resources.set(kind, table); }
      const previous = table.get(name);
      if (previous !== undefined) return previous;
      const index = table.size + 1; table.set(name, index); return index;
    },
    serverFrame: () => 123, commandArguments, commandTail: () => commandArguments().slice(1).join(" "),
    addCommand: () => { throw new Error("This fixture has no command executor"); }, extension: () => null,
    invoke: call => {
      reached.push(`${call.api}.${call.name}`);
      if (call.api === "cgame" && call.name === "CL_ClientRealTime") return { kind: "uint64", value: 1_700_000_000_000n };
      if (call.name === "Loc_Print") {
        const count = Number(integer(call.arguments, 4)), array = pointer(call.arguments, 3), arguments_: string[] = [];
        for (let index = 0; index < count; index++) {
          if (array === null) throw new Error("Missing localization argument array");
          const text = memory.readPointer(memory.offset(array, BigInt(index * 8)));
          if (text === null) throw new Error("Missing localization string");
          arguments_.push(readGuestString(memory, text));
        }
        localized.push({ destination: pointer(call.arguments, 0), level: Number(integer(call.arguments, 1)), base: readGuestString(memory, requiredPointer(call.arguments, 2)), arguments: arguments_ });
        return { kind: "void" };
      }
      return undefined;
    },
  });
  const world = await nativeWorld(index => { for (const [name, value] of resources.get("model") ?? []) if (value === index) return name; return undefined; });
  const releaseListeners = { active: 0 }, subscribe = world.engine.actors.onRelease.bind(world.engine.actors);
  spyOn(world.engine.actors, 'onRelease').mockImplementation(callback => {
    releaseListeners.active++; const unsubscribe = subscribe(callback);
    return () => { releaseListeners.active--; return unsubscribe(); };
  });
  // SV_SpawnServer reserves source resource indices for the loaded BSP and inline models.
  const resourceIndex = (name: string): void => { let table = resources.get("model"); if (table === undefined) { table = new Map<string, number>(); resources.set("model", table); } if (!table.has(name)) table.set(name, table.size + 1); };
  resourceIndex("maps/base1.bsp");
  for (let index = 1; index < world.world.models.length; index++) resourceIndex(`*${index}`);
  const buffer = new SizeBuf();
  SZ_Init(buffer, new Uint8Array(65536), 65536);
  const sounds: RereleaseSoundEvent[] = [];
  const unicasts: RereleaseUnicast[] = [], multicasts: RereleaseMulticast[] = [];
  let attached: RereleaseQ2GuestHost | null = null;
  let inventoryItems: ReturnType<typeof rereleaseInventoryItems> | null = null;
  const owner = (): RereleaseQ2GuestHost => { if (attached === null) throw new Error("Fixture host is not attached"); return attached; };
  const semantics = !nativeBindings ? world.semantics : { ...world.semantics, bind: (view: import("../../../../src/contracts/execution.ts").RawEntityView, actor: import("../../../../src/contracts/identity.ts").OwnedActor, module: import("../../../../src/compat/q2/rerelease/module.ts").RereleaseGuestModule) => {
    const base = world.semantics.bind(view, actor, module), edict = new RereleaseSourceEdict(view, module);
    const client = edict.client === null ? null : new RereleaseSourceClient(edict.client, module, retailRereleaseClientProfile);
    if (client !== null && inventoryItems === null) inventoryItems = rereleaseInventoryItems(module, value => owner().core.string(value));
    const classname = module.memory.readPointer(edict.at("classname"));
    const barrel = foreignDamage !== undefined && classname !== null && ["misc_explobox", "monster_soldier"].includes(readGuestString(module.memory, classname));
    return { ...base, combat: !barrel ? base.combat : edict.combat({ armor: () => ({ regular: { kind: "none" }, powered: { kind: "none" } }), writeArmor: () => { throw new Error("Native barrel has no armor"); }, traits: () => ({ invulnerable: false, team: null, noKnockback: false }) }),
      inventory: client === null || inventoryItems === null ? null : client.inventory(inventoryItems),
      callbacks: edict.callbacks({ address: id => owner().addressForActor(id), actor: address => owner().actor(module.entities().fromPointer(address))?.id ?? null }, trace => owner().encodeTrace(trace)) };
  } };
  const profile = declaredWorld ? builtinNativePrimary(artifact.digest, "rerelease") : null;
  if (declaredWorld && profile?.edition !== "rerelease") throw new Error("Missing original primary fixture profile");
  const selected = profile?.edition !== "rerelease" ? prepared : { ...prepared,
    primary: { declaration: artifact, profile: { ...profile, world: readRereleasePrimaryWorldProfile(new SaveReader(profile.world), artifact.digest) } } };
  const source = RereleaseGuestSource.create(selected, { services,
    ...(foreignDamage === undefined ? {} : { foreignDamage }),
    clock: { nowMilliseconds: () => 1_700_000_000_000, performanceCounter: () => 12345678n, performanceFrequency: 10000000n },
    ...(worldText === undefined ? {} : { worldText }),
    ...(debugShapes === undefined ? {} : { debugShapes }),
    ...(debugDrawing === undefined ? {} : { debugDrawing }),
    sound: event => { sounds.push(event); },
    messages: { buffer, acceptsClient: slot => slot === 1, unicast: message => { unicasts.push(message); }, multicast: message => { multicasts.push(message); } },
    engine: world.engine, spatial: world.spatial, semantics, instructionBudget });
  activeSources.push(source);
  const { host, memory, runtime } = source;
  attached = host;
  expect(host.options.engine).toBe(world.engine); expect(host.options.spatial).toBe(world.spatial); expect(host.options.semantics).toBe(semantics);
  world.attach(host);
  const guest = host.module, core = host.core;
  return { source, prepared, services, releaseListeners, guest, core, host, world, memory, runtime, cvars, prints, reached, resources, configstrings, localized, unicasts, multicasts, sounds };
}
