// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestCallResult, RawEntityView } from "../../../contracts/execution.ts";
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { WeaponBehaviorDefinition, WeaponBehaviorInstance, WeaponBehaviorLaunch, WeaponBehaviorSource, WeaponTrajectoryUpdate } from "../../../contracts/weapon-behavior.ts";
import { sameWeaponBehavior } from "../../../contracts/weapon-behavior.ts";
import { edictLayout, fieldOffset } from "../../../compat/q2/rerelease/layouts.ts";
import { guestPointer, type RereleaseImportCall } from "../../../compat/q2/rerelease/module.ts";
import type { RereleaseQ2GuestHost, RereleaseSourceSave } from "../../../compat/q2/rerelease/host.ts";
import { rereleaseWeaponProfile, rereleaseWeaponInitializationEntities, withRereleaseWeaponProvisioning, type RereleaseWeaponProfile, type RereleaseWeaponShooter } from "../../../compat/q2/rerelease/weapon-behavior-profile.ts";
import { requiredPointer } from "../../../guest/runtime/common/memory.ts";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../../persistence/value.ts";
import type { ClassicGuestMap } from "./classic-guest-world.ts";
import { RereleaseGuestServices } from "./rerelease-guest-services.ts";
import type { RereleaseGuestServicesOptions } from "./rerelease-guest-services-contract.ts";
import { RereleaseGuestSource, type PreparedRereleaseGuest, type RereleaseGuestSourceOptions } from "./rerelease-guest-source.ts";

export interface RereleaseWeaponActor extends RereleaseWeaponShooter {
  readonly actor: OwnedActor;
  readonly userinfo: string;
}
export interface RereleaseWeaponBehaviorOptions {
  readonly prepared: PreparedRereleaseGuest;
  readonly services: RereleaseGuestServicesOptions;
  readonly clock: RereleaseGuestSourceOptions["clock"];
  readonly map: ClassicGuestMap;
  /** Source inventory is private; primary trigger, ammo, impact and presentation retain authority. */
  readonly ownership: { readonly inventory: "source-private"; readonly presentation: "selected-weapon" };
  actor(id: ActorId): RereleaseWeaponActor;
  nextFrame(): Promise<void>;
}
type BindingKind = "client" | "target" | "projectile";
interface Binding { readonly actor: OwnedActor; readonly kind: BindingKind; readonly generation: number }
/** Remove the primary identity before source cleanup can reenter or reuse its native slot. */
export function retireRereleaseWeaponActor(actor: ActorId, state: {
  readonly slots: Map<ActorId, number>;
  readonly bindings: Map<number, Binding>;
  readonly retired: Map<ActorId, WeaponTrajectoryUpdate>;
}, dispose: (slot: number, binding: Binding) => void): void {
  state.retired.delete(actor);
  const slot = state.slots.get(actor), binding = slot === undefined ? undefined : state.bindings.get(slot);
  if (slot === undefined || binding === undefined || binding.actor.id !== actor) return;
  state.slots.delete(actor); state.bindings.delete(slot);
  dispose(slot, binding);
}
export interface RereleaseWeaponBehaviorCheckpoint {
  readonly version: 1;
  readonly definition: WeaponBehaviorDefinition;
  readonly map: ClassicGuestMap;
  readonly time: number;
  readonly cvars: Uint8Array;
  readonly game: RereleaseSourceSave;
  readonly level: RereleaseSourceSave;
  readonly configstrings: readonly { readonly index: number; readonly value: string }[];
  readonly retired: readonly { readonly actor: SavedActorId; readonly trajectory: WeaponTrajectoryUpdate }[];
  readonly bindings: readonly { readonly slot: number; readonly actor: SavedActorId; readonly kind: BindingKind; readonly generation: number }[];
}
/** Native private state executes in its own address space. No source frame or primary actor binding occurs here. */
export class RereleaseWeaponBehaviorSource implements WeaponBehaviorSource {
  private source: RereleaseGuestSource | null = null;
  private services: RereleaseGuestServices | null = null;
  private profile: RereleaseWeaponProfile | null = null;
  private readonly bindings = new Map<number, Binding>();
  private readonly slots = new Map<ActorId, number>();
  private readonly instances = new Set<ActorId>();
  private readonly retired = new Map<ActorId, WeaponTrajectoryUpdate>();
  private command: { readonly arguments: readonly string[]; readonly args: string } = { arguments: [], args: "" };
  private capture: { readonly shooter: RawEntityView; readonly launch: WeaponBehaviorLaunch; readonly slots: Set<number> } | null = null;
  private releaseSubscription: (() => undefined) | null = null;
  private readonly pendingReleases = new Set<ActorId>();
  private busy = false;
  private closed = false;
  private time = 0;
  private initializationEntities = "";
  private constructor(private readonly options: RereleaseWeaponBehaviorOptions) {}
  static async create(options: RereleaseWeaponBehaviorOptions): Promise<RereleaseWeaponBehaviorSource> {
    const owner = new RereleaseWeaponBehaviorSource(options);
    try {
      const services = new RereleaseGuestServices({ ...options.services,
        engine: { ...options.services.engine, emit: () => undefined },
        command: () => owner.command,
        addCommand: () => { throw new Error("Native weapon component cannot execute server commands"); },
        debugShapes: () => undefined, worldText: () => undefined,
        semanticBindings: {
          project: view => owner.bindings.get(view.slot)?.actor ?? null,
          bind: () => { throw new Error("Native component cannot replace primary actor authorities"); },
          foreignAddress: actor => owner.mirror(actor).address,
        },
      });
      owner.services = services;
      const source = RereleaseGuestSource.create(options.prepared, { ...services.hostOptions, clock: options.clock,
        interceptImport: (call, host) => owner.intercept(call, host), services: memory => services.bindMemory(memory) });
      owner.source = source; services.bindHost(source.host);
      owner.profile = rereleaseWeaponProfile(source.host.module, source.imageBase);
      owner.initializationEntities = rereleaseWeaponInitializationEntities(options.map.entities, owner.profile);
      for (const preset of owner.profile.initialCvars) options.services.cvars.set(preset.name, preset.value, true);
      await source.initLoading(options.nextFrame);
      await source.host.spawnEntitiesLoading(options.map.map, owner.initializationEntities, options.map.spawnPoint, options.nextFrame);
      services.completeSpawn(); services.drainMessages();
      owner.releaseSubscription = options.services.engine.actors.onRelease(actor => {
        if (owner.busy) owner.pendingReleases.add(actor.id); else owner.releaseActor(actor.id);
        return undefined;
      });
      return owner;
    } catch (error) {
      try { owner.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Native component initialization and cleanup failed"); }
      throw error;
    }
  }
  private retained() {
    if (this.closed || this.source === null || this.services === null || this.profile === null) throw new Error("Native weapon component is not initialized");
    return { source: this.source, services: this.services, profile: this.profile, host: this.source.host };
  }
  get definition(): WeaponBehaviorDefinition { return this.retained().profile.definition; }
  private operation<T>(run: () => T): T {
    if (this.busy) throw new Error("Native weapon component operation is already active");
    this.busy = true; try { return run(); } finally { this.busy = false; this.flushReleases(); this.services?.drainMessages(); }
  }
  private flushReleases(): void {
    const errors: unknown[] = [];
    for (const actor of this.pendingReleases) {
      this.pendingReleases.delete(actor);
      try { this.releaseActor(actor); } catch (error) { errors.push(error); }
    }
    if (errors.length > 0) throw new AggregateError(errors, "Native component actor retirement failed");
  }
  private releaseActor(actor: ActorId): void {
    this.instances.delete(actor);
    retireRereleaseWeaponActor(actor, { slots: this.slots, bindings: this.bindings, retired: this.retired }, (slot, binding) => {
      if (this.closed) return;
      const { host, profile } = this.retained();
      if (binding.kind === "client") {
        try { host.clientDisconnect(slot); } finally { host.releaseClientReservation(slot); }
      } else if (this.live(slot, binding)) profile.free(this.view(slot));
    });
  }

  private setTime(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Native weapon invocation time must be finite and nonnegative");
    this.time = seconds; this.retained().profile.time(BigInt(Math.round(seconds * 1000)));
  }
  private view(slot: number): RawEntityView { return this.retained().host.module.entities().atSlot(slot); }
  private live(slot: number, binding: Binding): boolean {
    const { host, profile } = this.retained(), view = host.module.entities().atSlot(slot), memory = host.module.memory;
    return memory.readUint8(memory.offset(view.address, BigInt(fieldOffset(edictLayout, "inuse")))) !== 0 && profile.generation(view) === binding.generation;
  }
  private remember(record: RawEntityView, actor: OwnedActor, kind: BindingKind): void {
    this.bindings.set(record.slot, { actor, kind, generation: this.retained().profile.generation(record) }); this.slots.set(actor.id, record.slot);
  }
  private mirror(actor: ActorId): RawEntityView {
    const previous = this.slots.get(actor); if (previous !== undefined) return this.view(previous);
    const { profile } = this.retained(), target = this.options.actor(actor), record = profile.allocate();
    profile.project(record, target.body); this.remember(record, target.actor, "target"); return record;
  }
  private client(actor: ActorId): RawEntityView {
    const { host, profile } = this.retained(), target = this.options.actor(actor), previous = this.slots.get(actor);
    if (previous !== undefined) {
      const binding = this.bindings.get(previous);
      if (binding?.kind === "client") { profile.projectShooter(this.view(previous), target); return this.view(previous); }
      if (binding !== undefined) profile.free(this.view(previous));
      this.bindings.delete(previous); this.slots.delete(actor);
    }
    let slot = 1; while (slot <= this.options.services.maxClients && this.bindings.has(slot)) slot++;
    if (slot > this.options.services.maxClients) throw new Error("Native weapon component exhausted its real source client capacity");
    const record = host.module.entities().atSlot(slot);
    this.remember(record, target.actor, "client"); host.reserveClient(slot);
    const connected = host.clientConnect(slot, target.userinfo, "", false);
    if (!connected.accepted) { this.bindings.delete(slot); this.slots.delete(actor); host.releaseClientReservation(slot); throw new Error("Native weapon source rejected the shooter userinfo"); }
    host.clientBegin(slot); this.remember(record, target.actor, "client"); profile.projectShooter(record, target);
    for (const command of profile.equipment) this.clientCommand(record, command.arguments, command.tail);
    profile.equip(record); return record;
  }
  private clientCommand(record: RawEntityView, arguments_: readonly string[], args: string): void {
    this.command = { arguments: arguments_, args };
    try {
      const { host, profile } = this.retained();
      withRereleaseWeaponProvisioning(profile, this.options.services.cvars, () => host.core.refreshCvars(),
        () => host.module.callGame("ClientCommand", [guestPointer(record.address)], record));
    }
    finally { this.command = { arguments: [], args: "" }; }
  }
  attach(launch: WeaponBehaviorLaunch): WeaponBehaviorInstance | null {
    return this.operation(() => {
      const { host, profile } = this.retained();
      if (launch.role !== profile.definition.role || this.slots.has(launch.projectile.id)) throw new Error("Incompatible or duplicate native projectile attachment");
      this.setTime(launch.timeSeconds); const shooter = this.client(launch.shooter);
      this.clientCommand(shooter, profile.ammunition.arguments, profile.ammunition.tail);
      const capture = { shooter, launch, slots: new Set<number>() }; this.capture = capture;
      try { host.core.refreshCvars(); profile.launch(shooter); }
      catch (error) {
        for (const slot of capture.slots) { profile.free(this.view(slot)); this.bindings.delete(slot); }
        this.slots.delete(launch.projectile.id); throw error;
      }
      finally { this.capture = null; }
      if (capture.slots.size === 0) return null;
      if (capture.slots.size !== 1) {
        for (const slot of capture.slots) profile.free(this.view(slot));
        this.slots.delete(launch.projectile.id);
        for (const slot of capture.slots) this.bindings.delete(slot);
        throw new Error("Native launch emitted multiple projectiles; one-to-many trajectory composition is required");
      }
      const slot = capture.slots.values().next().value;
      if (slot === undefined) throw new Error("Native captured projectile disappeared");
      return this.instance(slot);
    });
  }
  resume(actor: ActorId): WeaponBehaviorInstance {
    const retired = this.retired.get(actor); if (retired !== undefined) return this.retiredInstance(actor, retired);
    const slot = this.slots.get(actor);
    if (slot === undefined || this.bindings.get(slot)?.kind !== "projectile") throw new Error("Saved native trajectory has no retained source projectile");
    return this.instance(slot);
  }
  private instance(slot: number): WeaponBehaviorInstance {
    const binding = this.bindings.get(slot); if (binding === undefined) throw new Error("Native projectile binding is missing");
    const actor = binding.actor.id;
    if (this.instances.has(actor)) throw new Error("Native projectile already has a trajectory owner");
    this.instances.add(actor); let closed = false;
    const initial = this.retained().profile.trajectory(this.view(slot));
    const retire = (trajectory: WeaponTrajectoryUpdate): null => { this.retired.set(actor, trajectory); this.bindings.delete(slot); this.slots.delete(actor); return null; };
    return { definition: this.definition, initial,
      step: (body, time) => this.operation(() => {
        if (closed || !this.options.services.engine.actors.isLive(actor)) throw new Error("Native trajectory instance is closed");
        this.setTime(time); if (this.retired.has(actor)) return null;
        if (!this.live(slot, binding)) return retire({ origin: body.origin, velocity: body.velocity, angles: body.angles });
        const { profile } = this.retained(), record = this.view(slot); profile.project(record, body);
        const next = profile.nextThink(record); if (next <= 0n || next > BigInt(Math.round(time * 1000))) return null;
        profile.think(record);
        if (!this.live(slot, binding)) return retire({ origin: body.origin, velocity: body.velocity, angles: body.angles });
        return profile.trajectory(record);
      }),
      close: () => { if (closed) return; closed = true; this.instances.delete(actor); this.releaseActor(actor); },
    };
  }
  private retiredInstance(actor: ActorId, initial: WeaponTrajectoryUpdate): WeaponBehaviorInstance {
    if (this.instances.has(actor)) throw new Error("Native projectile already has a trajectory owner");
    this.instances.add(actor); let closed = false;
    return { definition: this.definition, initial,
      step: () => { if (closed) throw new Error("Native trajectory instance is closed"); return null; },
      close: () => { if (closed) return; closed = true; this.instances.delete(actor); this.retired.delete(actor); },
    };
  }
  private intercept(call: RereleaseImportCall, host: RereleaseQ2GuestHost): GuestCallResult | undefined {
    switch (call.name) {
      case "SetAreaPortalState": throw new Error("Native trajectory component cannot mutate selected world portals");
      case "SendToClipBoard": throw new Error("Native trajectory component has no clipboard capability");
      case "linkentity": case "unlinkentity": {
        const record = host.module.entities().fromPointer(requiredPointer(call.arguments, 0)), capture = this.capture;
        if (record.slot === 0) return { kind: "void" };
        if (call.name === "linkentity" && capture !== null && this.retained().profile.matches(record, capture.shooter)) {
          capture.slots.add(record.slot); this.remember(record, capture.launch.projectile, "projectile");
        }
        const memory = host.module.memory, at = (name: string) => memory.offset(record.address, BigInt(fieldOffset(edictLayout, name)));
        memory.writeUint8(at("linked"), call.name === "linkentity" && memory.readUint8(at("solid")) !== 0 ? 1 : 0);
        if (call.name === "linkentity") {
          for (let axis = 0n; axis < 12n; axis += 4n) {
            const origin = memory.readFloat32(memory.offset(at("s.origin"), axis)), min = memory.readFloat32(memory.offset(at("mins"), axis)), max = memory.readFloat32(memory.offset(at("maxs"), axis));
            memory.writeFloat32(memory.offset(at("absmin"), axis), origin + min - 1);
            memory.writeFloat32(memory.offset(at("absmax"), axis), origin + max + 1);
            memory.writeFloat32(memory.offset(at("size"), axis), max - min);
          }
          memory.writeInt32(at("linkcount"), memory.readInt32(at("linkcount")) + 1);
        }
        return { kind: "void" };
      }
      // Selected weapon presentation stays primary; source inventory/ammo writes stay in private memory.
      case "WriteChar": case "WriteByte": case "WriteShort": case "WriteLong": case "WriteFloat": case "WriteAngle":
      case "WritePosition": case "WriteDir": case "WriteString": case "WriteEntity": case "unicast": case "multicast":
      case "sound": case "positioned_sound": case "local_sound": case "Broadcast_Print": case "Client_Print": case "Center_Print": case "Loc_Print":
        return { kind: "void" };
      default: return undefined;
    }
  }
  async checkpoint(nextFrame: () => Promise<void>): Promise<RereleaseWeaponBehaviorCheckpoint> {
    if (this.busy) throw new Error("Cannot save an active native weapon call");
    this.busy = true;
    try {
      const { host, services } = this.retained();
      const game = await host.writeSaveLoading("game", false, nextFrame), level = await host.writeSaveLoading("level", false, nextFrame);
      if (this.pendingReleases.size !== 0) throw new Error("Primary actors changed during native component capture");
      return { version: 1, definition: this.definition, map: this.options.map, time: this.time, game, level,
        cvars: encodeCheckpointValue(this.options.services.cvars.captureWorldTransferState()),
        configstrings: [...services.configstrings()].map(([index, value]) => ({ index, value })),
        retired: [...this.retired].map(([actor, trajectory]) => ({ actor: { slot: actor.slot, generation: actor.generation }, trajectory })),
        bindings: [...this.bindings].map(([slot, binding]) => ({ slot, actor: { slot: binding.actor.id.slot, generation: binding.actor.id.generation }, kind: binding.kind, generation: this.retained().profile.generation(this.view(slot)) })) };
    } finally { this.busy = false; this.flushReleases(); }
  }
  async restore(saved: RereleaseWeaponBehaviorCheckpoint, actor: (saved: SavedActorId) => OwnedActor, nextFrame: () => Promise<void>): Promise<void> {
    if (this.busy || this.bindings.size !== 0 || saved.version !== 1 || !sameWeaponBehavior(saved.definition, this.definition)
      || saved.map.map !== this.options.map.map || saved.map.entities !== this.options.map.entities || saved.map.spawnPoint !== this.options.map.spawnPoint
      || !Number.isFinite(saved.time) || saved.time < 0) throw new Error("Incompatible native trajectory checkpoint");
    this.busy = true;
    try {
      const { host, services, profile } = this.retained();
      this.options.services.cvars.restoreSaveState(decodeCheckpointValue(saved.cvars)); host.core.refreshCvars();
      await host.readSaveLoading("game", saved.game, nextFrame);
      await host.spawnEntitiesLoading(saved.map.map, this.initializationEntities, saved.map.spawnPoint, nextFrame);
      services.restoreConfigstrings(new Map(saved.configstrings.map(value => [value.index, value.value])));
      for (const binding of saved.bindings) {
        if (!Number.isSafeInteger(binding.slot) || binding.slot < 1 || this.bindings.has(binding.slot)) throw new Error("Invalid native component saved slot");
        const owner = actor(binding.actor); if (this.slots.has(owner.id)) throw new Error("Duplicate native component saved actor");
        this.bindings.set(binding.slot, { actor: owner, kind: binding.kind, generation: binding.generation }); this.slots.set(owner.id, binding.slot);
      }
      for (const retired of saved.retired) { const owner = actor(retired.actor); if (this.slots.has(owner.id) || this.retired.has(owner.id)) throw new Error("Invalid retired native trajectory actor"); this.retired.set(owner.id, retired.trajectory); }
      await host.readSaveLoading("level", saved.level, nextFrame);
      for (const [slot, binding] of this.bindings) {
        if (profile.generation(this.view(slot)) !== binding.generation) throw new Error("Native source save changed projectile generation");
        if (binding.kind === "client") host.reserveClient(slot);
      }
      this.time = saved.time; profile.time(BigInt(Math.round(saved.time * 1000))); services.drainMessages();
    } finally { this.busy = false; this.flushReleases(); }
  }
  close(): void { if (this.closed) return; if (this.busy) throw new Error("Cannot close an active native weapon component"); this.closed = true; this.releaseSubscription?.(); this.releaseSubscription = null;
    try { this.source?.close(); } finally { this.bindings.clear(); this.slots.clear(); this.instances.clear(); this.retired.clear(); this.pendingReleases.clear(); } }
}
