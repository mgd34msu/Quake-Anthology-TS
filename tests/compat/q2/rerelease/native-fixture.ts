import { testCorpusRoot, corpusFile } from "../../../support/corpus.ts";

import { SaveReader } from "../../../../src/persistence/value.ts";
import { readRereleasePrimaryWorldProfile } from "../../../../src/compat/q2/rerelease/world-profile.ts";
import { builtinNativePrimary } from "../../../../src/compat/q2/native-primary.ts";
import type { RereleaseDebugShapesEvent } from "../../../../src/compat/q2/rerelease/debug-shapes.ts";
import type { RereleaseWorldTextEvent } from "../../../../src/compat/q2/rerelease/world-text.ts";
// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, spyOn } from "bun:test";
import { createMountPlanId } from "../../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import { readGuestString } from "../../../../src/compat/q2/rerelease/imports.ts";
import type { MappedGuestMemory } from "../../../../src/guest/core/index.ts";
import { createNumericOperations, Q2_DONOR_PROFILE } from "../../../../src/core/numeric.ts";
import { RereleaseGuestServices } from "../../../../src/app/bootstrap/simulation/rerelease-guest-services.ts";
import type { RereleaseGuestServicesOptions } from "../../../../src/app/bootstrap/simulation/rerelease-guest-services-contract.ts";
import type { RereleaseCoreServices } from "../../../../src/compat/q2/rerelease/imports.ts";
import { prepareRereleaseGuest, RereleaseGuestSource } from "../../../../src/app/bootstrap/simulation/rerelease-guest-source.ts";
import { discoverInstalledContent } from "../../../../src/content/catalog/index.ts";
import { openMountPlan } from "../../../../src/content/mounts/index.ts";
import type { RereleaseSoundEvent } from "../../../../src/compat/q2/rerelease/sounds.ts";
import { nativeWorld } from "./world.ts";
import { rereleaseInventoryItems } from "../../../../src/compat/q2/rerelease/semantics.ts";
import { RereleaseSourceEdict } from "../../../../src/compat/q2/rerelease/source-state.ts";
import type { RereleaseQ2GuestHost, RereleaseSemanticBindings } from "../../../../src/compat/q2/rerelease/host.ts";
import type { RereleaseForeignDamageServices } from "../../../../src/compat/q2/rerelease/foreign-actors.ts";
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
  const prints: string[] = [], reached: string[] = [];
  const world = await nativeWorld();
  const releaseListeners = { active: 0 }, subscribe = world.engine.actors.onRelease.bind(world.engine.actors);
  spyOn(world.engine.actors, 'onRelease').mockImplementation(callback => {
    releaseListeners.active++; const unsubscribe = subscribe(callback);
    return () => { releaseListeners.active--; return unsubscribe(); };
  });
  const sounds: RereleaseSoundEvent[] = [];
  const unicasts: RereleaseUnicast[] = [], multicasts: RereleaseMulticast[] = [];
  let attached: RereleaseQ2GuestHost | null = null;
  let inventoryItems: ReturnType<typeof rereleaseInventoryItems> | null = null;
  const owner = (): RereleaseQ2GuestHost => { if (attached === null) throw new Error("Fixture host is not attached"); return attached; };
  const semantics: RereleaseSemanticBindings = !nativeBindings ? world.semantics : { ...world.semantics, bind: (view: import("../../../../src/contracts/execution.ts").RawEntityView, actor: import("../../../../src/contracts/identity.ts").OwnedActor, module: import("../../../../src/compat/q2/rerelease/module.ts").RereleaseGuestModule) => {
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
  const serviceOptions: RereleaseGuestServicesOptions = { scene: world.scene, cvars, numeric: createNumericOperations(Q2_DONOR_PROFILE), maxClients: 8, mapPath: "maps/base1.bsp", frameMilliseconds: 25,
    engine: world.engine, admit: () => undefined, collision: world.collision, print: text => { prints.push(text); }, acceptsClient: slot => slot === 1,
    command: () => ({ arguments: commandArguments(), args: commandArguments().slice(1).join(" ") }),
    addCommand: () => { throw new Error("This fixture has no command executor"); }, debugGraph: () => undefined,
    navigation: { runtime: () => null, moveToPoint: () => 0, followActor: () => 0 }, clipboard: { kind: "dedicated" }, localize: (key, args) => [key, ...args].join(":"),
    debugShapes: event => { debugShapes?.(event); }, worldText: event => { worldText?.(event); }, semanticBindings: semantics,
    ...(foreignDamage === undefined ? {} : { foreignDamage }) };
  const adapter = new RereleaseGuestServices(serviceOptions);
  const { debugShapes: hostShapes, worldText: hostText, messages, sound, ...hostOptions } = adapter.hostOptions;
  if (messages === undefined || sound === undefined) throw new Error("Production services supply no message or sound sink");
  /** A host imports table that records which imports the guest reached and answers the client-only clock the server does not own. */
  const recording = (core: RereleaseCoreServices): RereleaseCoreServices => ({ ...core, invoke: call => {
    reached.push(`${call.api}.${call.name}`);
    if (call.api === "cgame" && call.name === "CL_ClientRealTime") return { kind: "uint64", value: 1_700_000_000_000n };
    return core.invoke?.(call);
  } });
  const source = RereleaseGuestSource.create(selected, { ...hostOptions,
    ...(worldText === undefined ? {} : { worldText: hostText }),
    ...(debugShapes === undefined ? {} : { debugShapes: hostShapes }),
    ...(debugDrawing === undefined ? {} : { debugDrawing }),
    clock: { nowMilliseconds: () => 1_700_000_000_000, performanceCounter: () => 12345678n, performanceFrequency: 10000000n },
    sound: event => { sounds.push(event); sound(event); },
    messages: { ...messages, unicast: message => { unicasts.push(message); messages.unicast(message); }, multicast: message => { multicasts.push(message); messages.multicast(message); } },
    services: memory => recording(adapter.bindMemory(memory)), instructionBudget });
  activeSources.push(source);
  const { host, memory, runtime } = source;
  attached = host;
  adapter.bindHost(host);
  expect(host.options.engine).toBe(adapter.hostOptions.engine); expect(host.options.spatial).toBe(adapter.hostOptions.spatial); expect(host.options.semantics).toBe(adapter.hostOptions.semantics);
  world.attach(host);
  const guest = host.module, core = host.core;
  /** A fresh services adapter over the same options, for tests that attach a second source to the same engine. */
  const services = (memory: MappedGuestMemory): RereleaseCoreServices => recording(new RereleaseGuestServices(serviceOptions).bindMemory(memory));
  return { source, prepared, services, adapter, releaseListeners, guest, core, host, world, memory, runtime, cvars, prints, reached, unicasts, multicasts, sounds };
}
