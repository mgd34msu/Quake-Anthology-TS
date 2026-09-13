import { MAX_DATAGRAM, MAX_MSGLEN } from "../../network/q1/wire-types.ts";
import { QuakeWorldDecoder, writeQuakeWorldMessage } from "../../network/q1/quakeworld.ts";
import type { QuakeWorldMessage } from "../../network/q1/quakeworld.ts";
import type { Vec3 } from "../../contracts/math.ts";
import { SizeBuf, MSG_WriteByte, MSG_WriteChar, MSG_WriteShort, MSG_WriteLong, MSG_WriteCoord, MSG_WriteAngle, MSG_WriteString } from "../../network/q1/message.ts";
import { NetQuakeDecoder, writeNetQuakeMessage } from "../../network/q1/netquake.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { NetworkEvent } from "../../contracts/protocol.ts";
/* Quake WinQuake/pr_cmds.c PF_* presentation and precache builtins. GPL-2.0-or-later. */
import type { ContentId, ResolvedResourceReference } from "../../contracts/content.ts";
import type { Q1Event, Q1SoundChannel } from "../../content/q1/foundation/types.ts";
import type { QcHostBuiltinName } from "./builtins.ts";
import type { QcBuiltin } from "./machine.ts";
import type { QcWorldHost } from "./world-host.ts";

export type QcPresentationEvent = Extract<Q1Event, { readonly kind: "sound" | "ambient" | "particles" | "lightstyle" | "server-command" | "static-model" }>;
export interface QcPrecachedResource {
  readonly index: number;
  readonly resource: ResolvedResourceReference;
}
export type QcMessageDestination =
  | { readonly kind: "broadcast"; readonly reliable: boolean }
  | { readonly kind: "client"; readonly actor: ActorId; readonly reliable: true }
  | { readonly kind: "signon" }
  | { readonly kind: "multicast"; readonly origin: Vec3; readonly visibility: "all" | "pvs" | "phs"; readonly reliable: boolean };
export interface QcRoutedMessage { readonly message: QuakeWorldMessage; readonly actor: ActorId | null; }
export interface QcQuakeWorldMessageServices {
  loading(): boolean;
  client(actor: ActorId): boolean;
  phs(): boolean;
  route(entries: readonly QcRoutedMessage[], destination: QcMessageDestination): undefined;
}
export interface QcPresentationServices {
  readonly qw?: QcQuakeWorldMessageServices;
  readonly content: ContentId;
  /** The session's source precache table owns ordering, deduplication, limits and resource loading. */
  precache(kind: "model" | "sound", name: string): QcPrecachedResource;
  lookup(kind: "model" | "sound", name: string): QcPrecachedResource | null;
  loading(): boolean;
  print(text: string): undefined;
  message?(event: NetworkEvent, actor: ActorId): undefined;
  /** Structurally accepted by the application's existing SimulationEvents instance. */
  readonly events: {
    emit(content: ContentId, source: { readonly kind: "q1"; readonly event: QcPresentationEvent }): undefined;
    registerResource(content: ContentId, path: string, resource: ResolvedResourceReference): undefined;
  };
}

/** Adds source events to the same sink as built-in gameplay, without another media registry. */
export function createQcPresentationBindings(world: QcWorldHost, services: QcPresentationServices): ReadonlyMap<QcHostBuiltinName, QcBuiltin> {
  const bindings = new Map<QcHostBuiltinName, QcBuiltin>();
  const register = (value: QcPrecachedResource): void => {
    services.events.registerResource(services.content, value.resource.requestedPath, value.resource);
  };
  const emit = (event: QcPresentationEvent): undefined => services.events.emit(services.content, { kind: "q1", event });
  const install = (name: QcHostBuiltinName, builtin: QcBuiltin): void => {
    bindings.set(name, vm => {
      if (vm.program !== world.options.program || vm.entities !== world.options.entities) return vm.fail("presentation builtin belongs to another QC machine");
      return builtin(vm);
    });
  };
  const qw = world.options.program.api.kind === "q1-quakeworld" ? services.qw : undefined;
  if (world.options.program.api.kind === "q1-quakeworld" && qw === undefined) throw new Error("QuakeWorld presentation requires routed message services");
  install("bprint", vm => {
    if (qw === undefined) services.print(vm.varString(0));
    else {
      const text = vm.varString(1); services.print(text);
      qw.route([{ message: { kind: "print", level: Math.trunc(vm.argFloat(0)), text }, actor: null }], { kind: "broadcast", reliable: true });
    }
  });
  install("localcmd", vm => { emit({ kind: "server-command", text: vm.argString(0) }); });
  install("makestatic", vm => {
    const words = vm.entities.fromReference(vm.argInt(0));
    const path = vm.strings.get(words.int(vm.fieldOffset("model")));
    const resource = path === "" ? null : services.lookup("model", path);
    if (path !== "" && resource === null) return vm.fail(`makestatic model was not precached: ${path}`);
    const remove = world.host.get("remove");
    if (remove === undefined) return vm.fail("makestatic requires source entity removal");
    if (resource !== null) register(resource);
    emit({ kind: "static-model", path, frame: Math.trunc(words.float(vm.fieldOffset("frame"))),
      colorMap: Math.trunc(words.float(vm.fieldOffset("colormap"))), skin: Math.trunc(words.float(vm.fieldOffset("skin"))),
      origin: words.vector(vm.fieldOffset("origin")), angles: words.vector(vm.fieldOffset("angles")) });
    remove(vm);
  });
  const message = services.message;
  if (message !== undefined || qw !== undefined) {
    for (const name of ["sprint", "centerprint", "stuffcmd"] satisfies readonly QcHostBuiltinName[]) install(name, vm => {
      const actor = world.actor(vm.entities.slot(vm.argInt(0))), text = vm.varString(qw !== undefined && name === "sprint" ? 2 : 1);
      if (qw !== undefined) {
        if (!qw.client(actor.id)) { services.print(`tried to ${name} to a non-client\n`); return; }
        return qw.route([{ message: name === "sprint" ? { kind: "print", level: Math.trunc(vm.argFloat(1)), text }
          : name === "centerprint" ? { kind: "center-print", text } : { kind: "stufftext", text }, actor: actor.id }], { kind: "client", actor: actor.id, reliable: true });
      }
      if (message === undefined) return vm.fail("Missing client message service");
      message(name === "sprint" ? { kind: "print", level: 2, text }
        : name === "centerprint" ? { kind: "center-print", text } : { kind: "command-text", text }, actor.id);
    });
  }
  for (const kind of ["sound", "model"] satisfies readonly ("sound" | "model")[]) {
    install(kind === "sound" ? "precache_sound" : "precache_model", vm => {
      if (!services.loading()) return vm.fail("PF_Precache_*: Precache can only be done in spawn functions");
      const name = vm.argString(0);
      vm.returnInt(vm.argInt(0));
      if (name.length === 0 || name.charCodeAt(0) <= 32) return vm.fail("Bad string");
      register(services.precache(kind, name));
    });
  }
  install("precache_file", vm => { vm.returnInt(vm.argInt(0)); });
  install("sound", vm => {
    const channel = Math.trunc(vm.argFloat(1)), volume = Math.trunc(vm.numeric.multiply(vm.argFloat(3), 255)), attenuation = vm.argFloat(4);
    if (!Number.isFinite(volume) || volume < 0 || volume > 255) return vm.fail(`SV_StartSound: volume = ${volume}`);
    if (!Number.isFinite(attenuation) || attenuation < 0 || attenuation > 4) return vm.fail(`SV_StartSound: attenuation = ${attenuation}`);
    if (!Number.isFinite(channel) || channel < 0 || channel > (qw === undefined ? 7 : 15)) return vm.fail(`SV_StartSound: channel = ${channel}`);
    const channelId = channel & 7;
    let sourceChannel: Q1SoundChannel;
    switch (channelId) {
      case 0: sourceChannel = "auto"; break;
      case 1: sourceChannel = "weapon"; break;
      case 2: sourceChannel = "voice"; break;
      case 3: sourceChannel = "item"; break;
      case 4: sourceChannel = "body"; break;
      case 5: case 6: case 7: sourceChannel = channelId; break;
      default: return vm.fail(`SV_StartSound: channel = ${channel}`);
    }
    const path = vm.argString(2), resource = services.lookup("sound", path);
    if (resource === null) { services.print(`SV_StartSound: ${path} not precacheed\n`); return; }
    register(resource);
    const actor = world.actor(vm.entities.slot(vm.argInt(0)));
    if (qw !== undefined) {
      const words = vm.entities.fromReference(vm.argInt(0)), origin = words.vector(vm.fieldOffset("origin"));
      const mins = words.vector(vm.fieldOffset("mins")), maxs = words.vector(vm.fieldOffset("maxs"));
      const position = words.float(vm.fieldOffset("solid")) === 4 ? { x: vm.numeric.add(origin.x, vm.numeric.multiply(vm.numeric.add(mins.x, maxs.x), 0.5)),
        y: vm.numeric.add(origin.y, vm.numeric.multiply(vm.numeric.add(mins.y, maxs.y), 0.5)), z: vm.numeric.add(origin.z, vm.numeric.multiply(vm.numeric.add(mins.z, maxs.z), 0.5)) } : origin;
      return qw.route([{ message: { kind: "sound", entity: vm.entities.slot(vm.argInt(0)), channel: channel & 7,
        index: resource.index, origin: position, volume, attenuation }, actor: actor.id }],
        { kind: "multicast", origin: position, visibility: (channel & 8) !== 0 || !qw.phs() ? "all" : "phs", reliable: (channel & 8) !== 0 });
    }
    emit({ kind: "sound", actor: actor.id, path, channel: sourceChannel, volume: volume / 255, attenuation });
  });
  install("ambientsound", vm => {
    const path = vm.argString(1), resource = services.lookup("sound", path);
    if (resource === null) { services.print(`no precache: ${path}\n`); return; }
    register(resource);
    emit({ kind: "ambient", origin: vm.argVector(0), path, volume: vm.argFloat(2), attenuation: vm.argFloat(3) });
  });
  install("particle", vm => {
    emit({ kind: "particles", origin: vm.argVector(0), direction: vm.argVector(1), color: Math.trunc(vm.argFloat(2)), count: Math.trunc(vm.argFloat(3)) });
  });
  install("lightstyle", vm => {
    const style = Math.trunc(vm.argFloat(0));
    if (!Number.isFinite(style) || style < 0 || style >= 64) return vm.fail("lightstyle outside source style table");
    // The shared sink owns persistence even while the server is loading.
    emit({ kind: "lightstyle", style, pattern: vm.argString(1) });
  });
  return bindings;
}


export type QcBroadcastEvent = Extract<Q1Event, { readonly kind: "effect" | "beam" | "colored-explosion" }>;

/** QC writes retain their source codec and destination before joining shared presentation. */
export class QcBroadcastMessages {
  readonly host: ReadonlyMap<QcHostBuiltinName, QcBuiltin>;
  private readonly buffer = new SizeBuf(1024);
  private readonly owners = new Map<number, ActorId | null>();
  private readonly decoder = new NetQuakeDecoder({ kind: "q1-netquake", version: 15 });
  private signonBuffers = 1;
  private readonly qwDecoder = new QuakeWorldDecoder();
  private readonly routedBuffers = new Map<string, { readonly buffer: SizeBuf; readonly owners: Map<number, ActorId | null>; readonly destination: QcMessageDestination | null }>();
  constructor(world: QcWorldHost, private readonly emit: (effect: QcBroadcastEvent) => undefined, private readonly qw?: QcQuakeWorldMessageServices) {
    const isQw = world.options.program.api.kind === "q1-quakeworld";
    if (isQw && qw === undefined) throw new Error("QuakeWorld messages require routed message services");
    if (!isQw && qw !== undefined) throw new Error("NetQuake messages cannot use QuakeWorld routes");
    const target = (vm: Parameters<QcBuiltin>[0]) => {
      const dest = Math.trunc(vm.argFloat(0));
      let key: string, destination: QcMessageDestination | null;
      switch (dest) {
        case 0: key = "broadcast"; destination = { kind: "broadcast", reliable: false }; break;
        case 1: {
          const actor = world.actor(vm.entities.slot(vm.globals.int(vm.globalOffset("msg_entity"))));
          if (qw?.client(actor.id) !== true) return vm.fail("WriteDest: not a client");
          key = `client:${actor.id.slot}:${actor.id.generation}`; destination = { kind: "client", actor: actor.id, reliable: true }; break;
        }
        case 2: key = "all"; destination = { kind: "broadcast", reliable: true }; break;
        case 3:
          if (qw?.loading() !== true) return vm.fail("PF_Write_*: MSG_INIT can only be written in spawn functions");
          key = "signon"; destination = { kind: "signon" }; break;
        case 4: key = "multicast"; destination = null; break;
        default: return vm.fail("WriteDest: bad destination");
      }
      // MSG_ONE aggregates one netchan message plus four source backbuffers; the host packs native reliable records.
      let entry = this.routedBuffers.get(key);
      if (entry === undefined) { entry = { buffer: new SizeBuf(dest === 1 ? MAX_MSGLEN * 5 : dest === 0 || dest === 3 ? MAX_DATAGRAM : MAX_MSGLEN, dest === 0), owners: new Map<number, ActorId | null>(), destination }; this.routedBuffers.set(key, entry); }
      return entry;
    };
    const write = (operation: (vm: Parameters<QcBuiltin>[0], buffer: SizeBuf) => void): QcBuiltin => vm => {
      if (vm.program !== world.options.program || vm.entities !== world.options.entities) return vm.fail("QC message belongs to another source");
      if (!isQw && vm.argFloat(0) !== 0) return vm.fail("QC message destination is not the supported MSG_BROADCAST datagram");
      const entry = isQw ? target(vm) : { buffer: this.buffer, owners: this.owners };
      const before = entry.buffer.cursize;
      operation(vm, entry.buffer);
      // Capture identity when each possible entity word completes, independent of the writer used.
      for (let end = Math.max(1, before); end < entry.buffer.cursize; end++) {
        const low = entry.buffer.data[end - 1], high = entry.buffer.data[end];
        if (low === undefined || high === undefined) throw new Error("Missing written QC message byte");
        entry.owners.set(end - 1, world.options.slots.at(low + high * 256)?.id ?? null);
        if (isQw) entry.owners.set(-end, world.options.slots.at(((low + high * 256) >>> 3) & 1023)?.id ?? null);
      }
    };
    const number = (operation: (buffer: SizeBuf, value: number) => void): QcBuiltin => write((vm, buffer) => operation(buffer, vm.argFloat(1)));
    const host = new Map<QcHostBuiltinName, QcBuiltin>([
      ["WriteByte", number(MSG_WriteByte)], ["WriteChar", number(MSG_WriteChar)],
      ["WriteShort", number(MSG_WriteShort)], ["WriteLong", number(MSG_WriteLong)],
      ["WriteCoord", number(MSG_WriteCoord)], ["WriteAngle", number(MSG_WriteAngle)],
      ["WriteString", write((vm, buffer) => MSG_WriteString(buffer, vm.argString(1)))],
      ["WriteEntity", write((vm, buffer) => MSG_WriteShort(buffer, vm.entities.slot(vm.argInt(1))))],
    ]);
    if (isQw) host.set("multicast", vm => {
      if (vm.program !== world.options.program || vm.entities !== world.options.entities) return vm.fail("QC multicast belongs to another source");
      const mode = Math.trunc(vm.argFloat(1));
      if (mode < 0 || mode > 5) return vm.fail("SV_Multicast: bad destination");
      const entry = this.routedBuffers.get("multicast");
      if (entry !== undefined) {
        this.routeBuffer(entry, { kind: "multicast", origin: vm.argVector(0), visibility: mode % 3 === 0 ? "all" : mode % 3 === 1 ? "phs" : "pvs", reliable: mode >= 3 });
        this.routedBuffers.delete("multicast");
      }
    });
    this.host = host;
  }
  private routeBuffer(entry: { readonly buffer: SizeBuf; readonly owners: ReadonlyMap<number, ActorId | null> }, destination: QcMessageDestination): void {
    if (this.qw === undefined) throw new Error("Missing QuakeWorld routing service");
    const encoded = new SizeBuf(entry.buffer.maxsize);
    const entries = this.qwDecoder.decode(entry.buffer.bytes(), 0).map((message): QcRoutedMessage => {
      if (message.kind === "packet-entities" || message.kind === "invalid-delta") throw new Error("QC cannot write snapshot entity deltas");
      const offset = encoded.cursize;
      writeQuakeWorldMessage(encoded, this.qwDecoder.protocol, message);
      const actor = message.kind === "temporary-entity" && message.effect.kind === "beam" ? entry.owners.get(offset + 2) ?? null
        : message.kind === "sound" || message.kind === "stop-sound" ? entry.owners.get(-offset - 2) ?? null
        : message.kind === "muzzle-flash" || message.kind === "set-view" ? entry.owners.get(offset + 1) ?? null : null;
      if (message.kind === "temporary-entity" && message.effect.kind === "beam" && actor === null) throw new Error("QC beam had no owned actor when written");
      return { message, actor };
    });
    this.qw.route(entries, destination);
  }
  /** Source SV_FlushSignon runs after each entity spawn, reserving 512 bytes for the next. */
  flushSignon(): undefined {
    const entry = this.routedBuffers.get("signon");
    if (entry !== undefined && entry.buffer.cursize >= MAX_DATAGRAM - 512) {
      if (this.signonBuffers === 7) throw new Error("QW MAX_SIGNON_BUFFERS exhausted");
      this.signonBuffers++;
      this.routeBuffer(entry, { kind: "signon" }); this.routedBuffers.delete("signon");
    }
    return undefined;
  }
  bytes(): Uint8Array { return this.buffer.bytes(); }
  flush(): undefined {
    if (this.qw !== undefined) {
      for (const [key, entry] of this.routedBuffers) {
        if (entry.destination === null) continue;
        // QW SV_SendClientMessages discards the entire overflowed broadcast datagram.
        if (!entry.buffer.overflowed) this.routeBuffer(entry, entry.destination);
        this.routedBuffers.delete(key);
      }
      return undefined;
    }
    const encoded = new SizeBuf(1024);
    const effects = this.decoder.decode(this.buffer.bytes()).map((message): QcBroadcastEvent => {
      if (message.kind !== "temporary-entity") throw new Error(`Unsupported QC broadcast message ${message.kind}`);
      const offset = encoded.cursize;
      writeNetQuakeMessage(encoded, this.decoder.protocol, message);
      const effect = message.effect;
      if (effect.kind === "explosion-colors") return { kind: "colored-explosion", origin: effect.origin, colorStart: effect.colorStart, colorLength: effect.colorLength };
      if (effect.kind === "beam") {
        const actor = this.owners.get(offset + 2);
        if (actor === undefined || actor === null) throw new Error(`QC beam entity ${effect.entity} had no owned actor when written`);
        const style = effect.type === 5 ? "lightning1" : effect.type === 6 ? "lightning2" : effect.type === 9 ? "lightning3" : effect.type === 13 ? "grapple" : null;
        if (style === null) throw new Error(`Unsupported QC beam ${effect.type}`);
        return { kind: "beam", style, actor, start: effect.start, end: effect.end };
      }
      let name: Extract<Q1Event, { readonly kind: "effect" }>["effect"];
      switch (effect.type) {
        case 0: name = "spike"; break;
        case 1: name = "superspike"; break;
        case 2: name = "gunshot"; break;
        case 3: name = "explosion"; break;
        case 4: name = "tar-explosion"; break;
        case 7: name = "wizard-spike"; break;
        case 8: name = "knight-spike"; break;
        case 10: name = "lava-splash"; break;
        case 11: name = "teleport"; break;
        default: throw new Error(`Unsupported QC point effect ${effect.type}`);
      }
      return { kind: "effect", effect: name, actor: null, origin: effect.origin, amount: effect.count };
    });
    for (const effect of effects) this.emit(effect);
    this.buffer.clear();
    this.owners.clear();
    return undefined;
  }
}
