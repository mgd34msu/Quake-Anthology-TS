import type { ActorId, OwnedActor, ProviderId } from "../../../contracts/identity.ts";
import type { BodyState } from "../../../contracts/world.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { CommandContext } from "../../../contracts/common.ts";
import type { SavedActorId } from "../../../contracts/session.ts";
import type { QvmGrappleDefinition } from "../../../contracts/qvm-grapple.ts";
import { QvmGame } from "../../../compat/qvm/game.ts";
import type { QvmModuleOptions } from "../../../compat/qvm/module.ts";
import { QvmGrappleProvider, type QvmGrappleCheckpoint, type QvmGrappleProjection } from "../../../compat/qvm/grapple-provider.ts";
import { QvmGameImport } from "../../../compat/qvm/abi.ts";
import { qvmCommonSyscall, type QvmCommonServices } from "../../../compat/qvm/common-syscalls.ts";
import { qvmServerGameSyscall, type QvmServerGameServices } from "../../../compat/qvm/server-game-syscalls.ts";
import { QvmFiles, qvmFileSyscall } from "../../../compat/qvm/file-syscalls.ts";
import { rejectQvmSyscall, type QvmHostCall, type QvmHostResult } from "../../../compat/qvm/syscalls.ts";
import { CvarRegistry } from "../../../core/cvars/index.ts";
import { CommandBuffer } from "../../../core/commands/index.ts";
import { CommonParseCursor, CommonParseState } from "../../../core/common-parse.ts";
import { Q3_BINARY32_PROFILE } from "../../../core/numeric.ts";
import { qvmAngleVectors } from "../../../core/qvm-math.ts";
import type { MountedContent } from "../../../content/mounts/index.ts";
import type { SharedSceneQueries } from "../../../world/collision/index.ts";
import type { SessionActorRegistry, SharedBodyTable } from "../../../world/actors/index.ts";
import { SaveReader, encodeCheckpointValue, decodeCheckpointValue } from "../../../persistence/value.ts";
import { readSavedActor, savedActorId } from "../../../persistence/save-image.ts";
import { readGuest } from "../../../persistence/execution.ts";
import { readVector } from "../../../persistence/shared.ts";
import { qvmWeaponInitializationEntities } from "./qvm-weapon-behavior.ts";
import type { Q3SourceEvent } from "./q3/host.ts";
import type { ContentId } from "../../../contracts/content.ts";
import type { SimulationPresentation } from "./types.ts";

export type QvmGrappleTarget = { readonly actor: ActorId; readonly body: BodyState; readonly health: number } & (
  | { readonly kind: "actor"; readonly mover: boolean }
  | { readonly kind: "player"; readonly userinfo: string; readonly team: "free" | "red" | "blue" | "spectator"; readonly viewHeight: number }
);
export interface QvmGrappleDamage {
  readonly target: ActorId; readonly inflictor: ActorId | null; readonly attacker: ActorId | null;
  readonly direction: Vec3; readonly point: Vec3; readonly amount: number; readonly flags: number; readonly method: number;
}
export interface QvmGrappleSourceOptions {
  readonly artifact: QvmModuleOptions["artifact"];
  readonly profile: QvmGrappleDefinition;
  readonly provider: ProviderId;
  readonly mounts: MountedContent;
  readonly actors: SessionActorRegistry;
  readonly bodies: SharedBodyTable;
  readonly scene: SharedSceneQueries;
  readonly context: CommandContext;
  readonly seed: number;
  readonly entityText: string;
  readonly binding?: "offhand" | "slot";
  readonly realTime: Extract<QvmCommonServices, { role: "qagame" }>["realTime"];
  targets(): readonly QvmGrappleTarget[];
  event(event: Q3SourceEvent): void;
  velocity(actor: ActorId, velocity: Vec3): void;
  damage(damage: QvmGrappleDamage): void;
  assertCurrent(): void;
}
interface Binding { readonly actor: ActorId; readonly pointer: number; readonly client: boolean; origin: Vec3; }
interface Tether { readonly actor: OwnedActor; projection: QvmGrappleProjection; }
export interface QvmGrappleSourceCheckpoint {
  readonly version: 1;
  readonly grapple: QvmGrappleCheckpoint;
  readonly bindings: readonly { readonly actor: SavedActorId; readonly pointer: number; readonly client: boolean; readonly origin: Vec3 }[];
  readonly tethers: readonly { readonly owner: SavedActorId; readonly actor: SavedActorId }[];
}

/** One initialized source VM borrows session players and owns only its hook actors. */
export class QvmGrappleSource {
  readonly host: Pick<QvmGrappleSourceOptions, "actors" | "bodies">;
  readonly vm: QvmGame;
  private provider: QvmGrappleProvider | null = null;
  private readonly cvars: CvarRegistry;
  private readonly files: QvmFiles;
  private readonly commands: CommandBuffer;
  private readonly configstrings = new Map<number, string>();
  private readonly userinfo = new Map<number, string>();
  private readonly bindings = new Map<ActorId, Binding>();
  private readonly tethers = new Map<ActorId, Tether>();
  private readonly parser = new CommonParseState();
  private readonly cursor: CommonParseCursor;
  private readonly services: QvmServerGameServices;
  private readonly unsubscribe: () => undefined;
  private milliseconds = 0;
  private closed = false;
  private synchronizing = false;
  private restoringTethers: ReadonlyMap<ActorId, OwnedActor> | null = null;
  private constructor(readonly options: QvmGrappleSourceOptions) {
    this.host = options;
    this.cursor = new CommonParseCursor(qvmWeaponInitializationEntities(options.entityText));
    this.cvars = new CvarRegistry({ dialect: "q3", context: options.context, print: text => options.event({ kind: "print", text }) });
    for (const [name, value] of Object.entries({ g_log: "", cm_noCurves: "0", cm_playerCurveClip: "1", bot_enable: "0", sv_maxclients: "64", dedicated: "1", g_gametype: "0" })) this.cvars.register(name, value, 0);
    for (const [name, value] of Object.entries(options.profile.initialCvars)) { this.cvars.register(name, value, 0); this.cvars.set(name, value, true); }
    this.commands = new CommandBuffer({ dialect: "q3", context: options.context, cvars: this.cvars,
      print: text => options.event({ kind: "print", text }), readScript: async name => {
        const resource = await options.mounts.open(name); return resource === null ? undefined : new TextDecoder().decode(resource.bytes);
      } });
    this.files = new QvmFiles({ mounts: options.mounts, writable: null, print: text => options.event({ kind: "print", text }), assertCurrent: () => this.current() });
    this.vm = new QvmGame({ artifact: options.artifact, host: call => this.syscall(call), hostState: {
      checkpoint: () => ({ state: { module: options.artifact.module, format: "q3:grapple-host", bytes: encodeCheckpointValue({
        version: 1, milliseconds: this.milliseconds, data: this.vm.data.checkpoint(), cvars: this.cvars.captureSaveState(),
        configstrings: [...this.configstrings].map(([index, value]) => ({ index, value })), userinfo: [...this.userinfo].map(([slot, value]) => ({ slot, value })),
        files: this.files.captureCheckpoint(), entityText: this.cursor.source, cursor: this.cursor.offset, parser: this.parser.captureSaveState(),
      }) }, random: [], callbacks: [] }),
      restore: checkpoint => {
        if (checkpoint.state.format !== "q3:grapple-host" || checkpoint.random.length !== 0 || checkpoint.callbacks.length !== 0) throw new Error("Invalid QVM grapple host checkpoint");
        const reader = new SaveReader(decodeCheckpointValue(checkpoint.state.bytes), "qvm.grapple.host");
        reader.field("version").literal(1); reader.field("entityText").literal(this.cursor.source);
        this.milliseconds = reader.field("milliseconds").integer(0);
        const data = reader.field("data"); this.vm.data.restore({ entitiesWord: data.field("entitiesWord").integer(), numEntities: data.field("numEntities").integer(0), entityStride: data.field("entityStride").integer(0), clientsWord: data.field("clientsWord").integer(), clientStride: data.field("clientStride").integer(0) });
        this.cvars.restoreSaveState(reader.field("cvars").value); this.configstrings.clear(); this.userinfo.clear();
        for (const entry of reader.field("userinfo").list(cell => ({ slot: cell.field("slot").integer(0), value: cell.field("value").string() }))) {
          if (entry.slot >= 64 || this.userinfo.has(entry.slot)) throw new Error("Invalid saved grapple client"); this.userinfo.set(entry.slot, entry.value);
        }
        for (const entry of reader.field("configstrings").list(cell => ({ index: cell.field("index").integer(0), value: cell.field("value").string() }))) {
          if (entry.index >= 1024 || this.configstrings.has(entry.index)) throw new Error("Invalid saved grapple configstring"); this.configstrings.set(entry.index, entry.value);
        }
        this.cursor.offset = reader.field("cursor").nullable(cell => cell.integer(0)); this.parser.restoreSaveState(reader.field("parser").value);
        this.files.restoreCheckpoint(reader.field("files").value); return undefined;
      },
    } });
    this.vm.data.setClientCount(64);
    this.vm.module.bindFunction({ kind: "qvm", module: options.artifact.module, instructionIndex: options.profile.callbacks.sameTeam }, call => {
      const first = this.actorForPointer(call.words.getInt32(0, true)), second = this.actorForPointer(call.words.getInt32(4, true));
      if (first === null || second === null) return call.proceed();
      const targets = options.targets(), a = targets.find(target => target.actor.equals(first)), b = targets.find(target => target.actor.equals(second));
      return Number(a?.kind === "player" && b?.kind === "player" && (a.team === "red" || a.team === "blue") && a.team === b.team);
    });
    this.vm.module.bindFunction({ kind: "qvm", module: options.artifact.module, instructionIndex: options.profile.callbacks.damage }, call => {
      const pointer = call.words.getInt32(0, true), actor = this.actorForSlot(this.slot(pointer));
      if (actor === null || !this.bindings.has(actor)) return call.proceed();
      const reference = (offset: number): ActorId | null => this.actorForPointer(call.words.getInt32(offset, true));
      const vector = (offset: number): Vec3 => { const word = call.words.getInt32(offset, true); if (word === 0) return { x: 0, y: 0, z: 0 };
        const view = this.vm.module.memory.view(word, 12); return { x: view.getFloat32(0, true), y: view.getFloat32(4, true), z: view.getFloat32(8, true) }; };
      options.damage({ target: actor, inflictor: reference(4), attacker: reference(8), direction: vector(12), point: vector(16),
        amount: call.words.getInt32(20, true), flags: call.words.getInt32(24, true), method: call.words.getInt32(28, true) });
      const target = options.targets().find(entry => entry.actor.equals(actor));
      this.vm.data.entityBytes(this.slot(pointer)).setInt32(options.profile.fields.health, Math.trunc(target?.health ?? 0), true);
      return 0;
    });
    this.services = { data: this.vm.data, cvars: this.cvars, maxClients: 64,
      configstrings: { get: index => this.configstrings.get(index) ?? "", set: (index, value) => { this.configstrings.set(index, value); options.event({ kind: "configstring", index, value }); } },
      getUserinfo: slot => this.userinfo.get(slot) ?? "", setUserinfo: (slot, value) => { this.userinfo.set(slot, value); },
      getUserCommand: () => ({ serverTime: this.milliseconds, angles: [0, 0, 0], buttons: 0, weapon: 0, forwardmove: 0, rightmove: 0, upmove: 0 }),
      dropClient: (client, reason) => { throw new Error(`Grapple source rejected borrowed client ${client}: ${reason}`); },
      sendServerCommand: (client, text) => options.event({ kind: "server-command", client, text }),
      entityToken: () => ({ token: this.parser.parse(this.cursor), ended: this.cursor.offset === null }),
      spatial: {
        trace: input => {
          const trace = options.scene.trace({ start: input.start, end: input.end, shape: input.shape, target: { kind: "world" }, numeric: Q3_BINARY32_PROFILE,
            passActor: this.actorForSlot(input.passEntityNum), policy: { kind: "q3", contentsMask: input.mask, curves: this.cvars.variableValue("cm_noCurves") === 0, playerCurveClip: this.cvars.variableValue("cm_playerCurveClip") !== 0 } });
          if (trace.kind !== "q3") throw new Error("Grapple collision lost its source policy");
          return { fraction: trace.fraction, end: trace.end, allSolid: trace.allSolid, startSolid: trace.startSolid, contents: trace.contents,
            surfaceFlags: trace.surfaceFlags, plane: trace.sourcePlane, entityNum: trace.hit.kind === "actor" ? this.slot(this.mirror(trace.hit.actor)) : trace.fraction === 1 ? 1023 : 1022 };
        },
        pointContents: (point, pass) => {
          const sample = options.scene.pointContents({ point, target: { kind: "world" }, passActor: this.actorForSlot(pass), numeric: Q3_BINARY32_PROFILE,
            policy: { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true } });
          if (sample.kind !== "q3") throw new Error("Grapple contents lost its source policy"); return sample.contents;
        },
        areaEntities: (bounds, maximum) => {
          const actors = options.scene.queryActors(bounds).filter(entry => ![...this.tethers.values()].some(tether => tether.actor.id.equals(entry.body.actor)));
          return (maximum < 0 ? actors : actors.slice(0, maximum)).map(entry => this.slot(this.mirror(entry.body.actor)));
        },
        entityContact: () => { throw new Error("Grapple source requested undeclared brush contact"); },
        setBrushModel: () => { throw new Error("Grapple source attempted to own a map brush"); },
        adjustAreaPortalState: () => { throw new Error("Grapple source attempted to change map portals"); },
        inPvs: (first, second, ignore) => { const a = options.scene.pointLeaf(first), b = options.scene.pointLeaf(second);
          return options.scene.clusterVisible(options.scene.leafCluster(a), options.scene.leafCluster(b), "pvs") && (ignore || options.scene.areasConnected(options.scene.leafArea(a), options.scene.leafArea(b))); },
        areasConnected: (first, second) => options.scene.areasConnected(first, second),
        link: slot => { const r = this.vm.data.entity(slot).r; r.linked = true;
          r.absmin = { x: r.currentOrigin.x + r.mins.x - 1, y: r.currentOrigin.y + r.mins.y - 1, z: r.currentOrigin.z + r.mins.z - 1 };
          r.absmax = { x: r.currentOrigin.x + r.maxs.x + 1, y: r.currentOrigin.y + r.maxs.y + 1, z: r.currentOrigin.z + r.maxs.z + 1 }; },
        unlink: slot => { this.vm.data.entity(slot).r.linked = false; },
      },
    };
    this.unsubscribe = options.actors.onRelease(actor => { this.removeActor(actor.id); return undefined; });
  }
  static async create(options: QvmGrappleSourceOptions): Promise<QvmGrappleSource> {
    const source = new QvmGrappleSource(options);
    try {
      await source.vm.initializeAsync(0, options.seed);
      await source.commands.executeScriptsAsync(async () => {});
      const image = options.artifact.image, word = Math.ceil((image.dataLength + image.literalLength + image.bssLength) / 16) * 16;
      const byteLength = Math.max(64, options.profile.movement.byteLength);
      if (word + byteLength > image.allocatedDataLength - 65536) throw new Error("Grapple source has no reserved scratch below the VM stack");
      source.provider = new QvmGrappleProvider(source.vm, options.artifact, options.profile, {
        synchronize: () => source.synchronize(), entity: actor => source.bindings.get(actor)?.pointer ?? null,
        actor: pointer => source.actorForPointer(pointer), restoreActor: saved => source.restoreActor(saved),
        publish: (owner, projection) => source.publish(owner, projection), velocity: (actor, velocity) => options.velocity(actor, velocity), scratch: { word, byteLength },
      });
      return source;
    } catch (error) { source.close(); throw error; }
  }
  get core(): QvmGrappleProvider { if (this.provider === null) throw new Error("Grapple source has not initialized"); return this.provider; }
  private current(): void { this.options.assertCurrent(); if (this.closed) throw new Error("Grapple source is closed"); }
  private syscall(call: QvmHostCall): QvmHostResult {
    this.current();
    const commands = { executeNow: (text: string | null) => { if (text !== null) this.commands.executeNow(text); }, append: (text: string) => this.commands.append(text), insert: (text: string) => this.commands.insert(text) };
    const result = qvmCommonSyscall(call, { role: "qagame", cvars: this.cvars, print: text => this.options.event({ kind: "print", text }), milliseconds: () => this.milliseconds,
      arguments: () => [], realTime: this.options.realTime, commands }) ?? qvmFileSyscall(call, this.files) ?? qvmServerGameSyscall(call, this.services);
    if (result !== null) return result;
    if (call.kind === "engine" && call.role === "qagame" && (call.code === QvmGameImport.BOTLIB_SETUP || call.code === QvmGameImport.BOTLIB_AAS_INITIALIZED)) return 0;
    return rejectQvmSyscall(call);
  }
  private slot(pointer: number): number { return this.vm.data.numberFromPointer(pointer); }
  private actorForPointer(pointer: number): ActorId | null {
    if (pointer === 0) return null;
    const layout = this.vm.data.checkpoint(), slot = (pointer - layout.entitiesWord) / layout.entityStride;
    if (slot === 1022 || slot === 1023) return null;
    return this.actorForSlot(this.slot(pointer));
  }
  private actorForSlot(slot: number): ActorId | null {
    for (const binding of this.bindings.values()) if (this.slot(binding.pointer) === slot) return binding.actor;
    for (const tether of this.tethers.values()) if (this.slot(tether.projection.hook) === slot) return tether.actor.id;
    return null;
  }
  private mirror(actor: ActorId): number {
    const target = this.options.targets().find(entry => entry.actor.equals(actor));
    if (target === undefined) throw new Error("Grapple collision refers to an unavailable shared actor");
    let binding = this.bindings.get(target.actor);
    if (binding === undefined) {
      if (target.kind === "player") {
        let slot = 0; while (slot < 64 && this.userinfo.has(slot)) slot++;
        if (slot === 64) throw new Error("Grapple source exhausted its client capacity");
        const pointer = this.vm.data.entityBytes(slot).byteOffset - this.vm.module.memory.bytes.byteOffset;
        binding = { actor: target.actor, pointer, client: true, origin: target.body.origin }; this.bindings.set(target.actor, binding); this.userinfo.set(slot, target.userinfo);
        const denial = this.vm.clientConnect(slot, true, false); if (denial !== null) throw new Error(`Grapple source rejected client: ${denial}`);
        this.vm.clientBegin(slot);
      } else {
        const pointer = this.vm.module.call([], this.options.profile.callbacks.allocate); this.slot(pointer);
        if ([...this.bindings.values()].some(entry => entry.pointer === pointer)) throw new Error("Grapple source reused an occupied actor");
        binding = { actor: target.actor, pointer, client: false, origin: target.body.origin }; this.bindings.set(target.actor, binding);
      }
    }
    const entity = this.vm.data.entityFromPointer(binding.pointer), body = target.body;
    if (target.kind === "player") {
      const slot = this.slot(binding.pointer), ps = this.vm.data.publicPlayerBytes(slot);
      if (this.userinfo.get(slot) !== target.userinfo) { this.userinfo.set(slot, target.userinfo); this.vm.clientUserinfoChanged(slot); }
      for (const [offset, vector] of [[20, body.origin], [32, body.velocity], [152, body.angles]] satisfies readonly (readonly [number, Vec3])[]) {
        ps.setFloat32(offset, vector.x, true); ps.setFloat32(offset + 4, vector.y, true); ps.setFloat32(offset + 8, vector.z, true);
      }
      ps.setInt32(184, Math.trunc(target.health), true); ps.setInt32(164, Math.trunc(target.viewHeight), true);
      ps.setInt32(260, { free: 0, red: 1, blue: 2, spectator: 3 }[target.team], true);
      ps.setInt32(4, target.team === "spectator" ? 2 : target.health <= 0 ? 3 : 0, true);
      entity.r.contents = target.team === "spectator" ? 0 : target.health > 0 ? 0x2000000 : 0x4000000;
      entity.s.eType = 1;
    } else {
      entity.s.eType = target.mover ? 4 : 0;
      if (target.mover && this.provider !== null) {
        const delta = { x: body.origin.x - binding.origin.x, y: body.origin.y - binding.origin.y, z: body.origin.z - binding.origin.z };
        if (delta.x !== 0 || delta.y !== 0 || delta.z !== 0) this.provider.moverMoved(actor, delta);
      }
    }
    entity.r.currentOrigin = body.origin; entity.r.currentAngles = body.angles; entity.r.mins = body.bounds.min; entity.r.maxs = body.bounds.max;
    entity.s.origin = body.origin; entity.s.angles = body.angles; entity.s.pos = { ...entity.s.pos, base: body.origin, delta: body.velocity, time: this.milliseconds };
    this.vm.data.entityBytes(this.slot(binding.pointer)).setInt32(this.options.profile.fields.health, Math.trunc(target.health), true);
    this.vm.data.entityBytes(this.slot(binding.pointer)).setInt32(this.options.profile.fields.takedamage, Number(target.health > 0), true);
    binding.origin = body.origin; return binding.pointer;
  }
  private synchronize(): void {
    if (this.synchronizing) return;
    this.synchronizing = true;
    try {
      const targets = this.options.targets();
      for (const actor of [...this.bindings.keys()]) if (!targets.some(target => target.actor.equals(actor))) this.removeActor(actor);
      for (const target of targets) this.mirror(target.actor);
    } finally { this.synchronizing = false; }
  }
  private publish(owner: ActorId, projection: QvmGrappleProjection | null): void {
    const previous = this.tethers.get(owner);
    if (projection === null) { if (previous !== undefined) { this.tethers.delete(owner); if (this.options.actors.isLive(previous.actor.id)) this.options.actors.release(previous.actor); } return; }
    const actor = previous?.actor ?? this.restoringTethers?.get(owner) ?? this.options.actors.allocate(this.options.provider, "q3:equipment/hook");
    this.tethers.set(owner, { actor, projection });
    const record = this.vm.data.entityFromPointer(projection.hook);
    const body: BodyState = { origin: projection.pulling ? projection.point : projection.origin, velocity: projection.velocity, angles: record.r.currentAngles,
      bounds: { min: record.r.mins, max: record.r.maxs }, ground: projection.mover };
    this.options.bodies.write(actor, body); this.options.bodies.link(actor);
    if (projection.pulling && previous?.projection.pulling === false && this.restoringTethers === null) this.sound(actor.id, this.options.profile.presentation.attachSound, false);
  }
  private sound(actor: ActorId, path: string | null, loop: boolean): void {
    const body = this.options.bodies.read(actor); if (path === null || body === null) return;
    this.options.event({ kind: "sound", actor, path, origin: body.origin, velocity: body.velocity, channel: 0, volume: 1, loop });
  }
  private removeActor(actor: ActorId): void {
    if (this.closed || this.provider === null) return;
    this.provider.actorReleased(actor);
    const binding = this.bindings.get(actor); if (binding === undefined) return;
    if (binding.client) { const slot = this.slot(binding.pointer); this.vm.clientDisconnect(slot); this.userinfo.delete(slot); }
    else this.vm.module.call([binding.pointer], this.options.profile.callbacks.free);
    this.bindings.delete(actor);
  }
  beginFrame(milliseconds: number, frame: number): void {
    this.current(); this.milliseconds = milliseconds; this.core.beginFrame(milliseconds, frame); this.core.step();
    const profile = this.options.profile;
    for (let slot = 64; slot < this.vm.data.numEntities; slot++) {
      const record = this.vm.data.entityBytes(slot);
      if (record.getInt32(profile.fields.inuse, true) !== 0 && record.getInt32(profile.fields.freeAfterEvent, true) !== 0
        && milliseconds - record.getInt32(profile.fields.eventTime, true) > profile.eventLifetimeMilliseconds)
        this.vm.module.call([record.byteOffset - this.vm.module.memory.bytes.byteOffset], profile.callbacks.free);
    }
    for (const [owner, tether] of this.tethers) if (tether.projection.pulling) {
      const body = this.options.bodies.read(owner), point = tether.projection.point;
      const hanging = body !== null && Math.hypot(point.x - body.origin.x, point.y - body.origin.y, point.z - body.origin.z - 26) <= 64;
      this.sound(owner, hanging ? profile.presentation.hangSound : profile.presentation.pullSound, true);
    }
  }
  fire(actor: ActorId): void { this.current(); const previous = this.hook(actor); this.core.fire(actor); if (previous === null && this.hook(actor) !== null) this.sound(actor, this.options.profile.presentation.fireSound, false); }
  admit(actor: ActorId): undefined {
    this.current(); this.mirror(actor);
    if (this.bindings.get(actor)?.client !== true) throw new Error("Grapple equipment requires an admitted source client");
    return undefined;
  }
  release(actor: ActorId): void { const previous = this.hook(actor); this.core.release(actor); if (previous !== null && this.hook(actor) === null) this.sound(actor, this.options.profile.presentation.releaseSound, false); }
  hook(actor: ActorId): ActorId | null { return this.tethers.get(actor)?.actor.id ?? null; }
  weaponView(actor: ActorId) {
    const binding = this.bindings.get(actor);
    if (binding === undefined || !binding.client) throw new Error("Hook view has no source player");
    const state = this.vm.data.copyPlayerState(this.slot(binding.pointer)), presentation = this.options.profile.presentation;
    return { path: presentation.viewModel, frame: 0, kickOrigin: { x: 0, y: 0, z: 0 }, kickPitch: 0,
      modelAttachments: presentation.viewAttachments, modelAnchor: presentation.viewAnchor, q3Weapon: {
        timeMilliseconds: this.milliseconds, torsoAnimation: state.torsoAnimation, lastFireMilliseconds: null,
        firing: this.hook(actor) !== null, horizontalSpeed: Math.hypot(state.velocity.x, state.velocity.y), bobCycle: state.bobCycle, weapon: presentation.weaponIndex } };
  }
  presentations(content: ContentId): readonly SimulationPresentation[] {
    const result: SimulationPresentation[] = [], presentation = this.options.profile.presentation;
    for (const [owner, tether] of this.tethers) {
      const body = this.options.bodies.read(tether.actor.id), player = this.options.targets().find(target => target.actor.equals(owner));
      if (body === null || player === undefined) continue;
      const common = { actor: tether.actor.id, content, family: "q3", frame: 0, oldFrame: 0, skin: 0, effects: 0, renderFlags: 0,
        origin: body.origin, angles: body.angles, scale: 1, visible: true, viewWeapon: false } satisfies Omit<SimulationPresentation, "path">;
      result.push({ ...common, path: presentation.projectileModel });
      const start = { ...player.body.origin, z: player.body.origin.z + (player.kind === "player" ? player.viewHeight : 0) };
      const cable = presentation.cable;
      if (cable.kind === "shader") result.push({ ...common, path: "", origin: start, shaderBeam: { path: cable.path, end: body.origin, width: cable.width } });
      else result.push({ ...common, path: cable.flight, q3GrappleCable: { owner, ownerOrigin: player.body.origin, ownerAngles: player.body.angles,
        viewHeight: player.kind === "player" ? player.viewHeight : 0, offhand: this.options.binding !== "slot", attached: tether.projection.pulling,
        flight: cable.flight, pull: cable.pull, hold: cable.hold, segmentLength: cable.segmentLength } });
    }
    return result;
  }
  pulling(actor: ActorId): boolean { return this.tethers.get(actor)?.projection.pulling ?? false; }
  pull(actor: ActorId): void {
    const body = this.options.bodies.read(actor); if (body === null) return;
    this.synchronize(); this.core.pull(actor, qvmAngleVectors(body.angles).forward);
  }
  private restoreActor(saved: SavedActorId): ActorId {
    const actor = this.options.actors.resolveSaved(saved); if (actor === null) throw new Error("Saved grapple refers to a missing shared actor"); return actor.id;
  }
  capture(): QvmGrappleSourceCheckpoint {
    return { version: 1, grapple: this.core.capture(), bindings: [...this.bindings.values()].map(binding => ({ ...binding, actor: savedActorId(binding.actor) })),
      tethers: [...this.tethers].map(([owner, tether]) => ({ owner: savedActorId(owner), actor: savedActorId(tether.actor.id) })) };
  }
  restore(checkpoint: QvmGrappleSourceCheckpoint): void {
    if (checkpoint.version !== 1) throw new Error("Invalid grapple source checkpoint");
    this.bindings.clear();
    for (const entry of checkpoint.bindings) { const actor = this.restoreActor(entry.actor);
      if (this.bindings.has(actor) || [...this.bindings.values()].some(binding => binding.pointer === entry.pointer)) throw new Error("Duplicate saved grapple binding");
      this.bindings.set(actor, { ...entry, actor });
    }
    // Source restoration publishes hooks; keep the saved shared actor identity for each tether.
    const restored = new Map<ActorId, OwnedActor>();
    for (const entry of checkpoint.tethers) { const owner = this.restoreActor(entry.owner), actor = this.options.actors.resolveSaved(entry.actor);
      if (actor === null || actor.owner !== this.options.provider || restored.has(owner)) throw new Error("Invalid saved shared tether"); restored.set(owner, actor); }
    this.tethers.clear();
    this.restoringTethers = restored;
    try { this.core.restore(checkpoint.grapple); } finally { this.restoringTethers = null; }
  }
  close(): void {
    if (this.closed) return;
    this.unsubscribe();
    try { this.provider?.close(); } finally { this.closed = true; this.bindings.clear(); this.tethers.clear(); try { this.files.closeAll(); } finally { this.vm.retire(); } }
  }
}

export function readQvmGrappleSourceCheckpoint(reader: SaveReader): QvmGrappleSourceCheckpoint {
  const grapple = reader.field("grapple"), module = readGuest(grapple.field("module"));
  if (module.kind !== "qvm") throw grapple.field("module").fail("Expected QVM grapple continuation");
  return { version: reader.field("version").literal(1), grapple: { version: grapple.field("version").literal(1), profile: grapple.field("profile").string(), module, owners: grapple.field("owners").list(readSavedActor) },
    bindings: reader.field("bindings").list(entry => ({ actor: readSavedActor(entry.field("actor")), pointer: entry.field("pointer").integer(1), client: entry.field("client").boolean(), origin: readVector(entry.field("origin")) })),
    tethers: reader.field("tethers").list(entry => ({ owner: readSavedActor(entry.field("owner")), actor: readSavedActor(entry.field("actor")) })) };
}
