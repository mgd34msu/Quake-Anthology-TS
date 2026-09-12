import { SizeBuf, MSG_WriteByte, MSG_WriteCoord } from "../../network/q1/message.ts";
import { NetQuakeDecoder } from "../../network/q1/netquake.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { NetworkEvent } from "../../contracts/protocol.ts";
/* Quake WinQuake/pr_cmds.c PF_* presentation and precache builtins. GPL-2.0-or-later. */
import type { ContentId, ResolvedResourceReference } from "../../contracts/content.ts";
import type { Q1Event, Q1SoundChannel } from "../../content/q1/foundation/types.ts";
import type { QcHostBuiltinName } from "./builtins.ts";
import type { QcBuiltin } from "./machine.ts";
import type { QcWorldHost } from "./world-host.ts";

export type QcPresentationEvent = Extract<Q1Event, { readonly kind: "sound" | "ambient" | "particles" | "lightstyle" }>;
export interface QcPrecachedResource {
  readonly index: number;
  readonly resource: ResolvedResourceReference;
}
export interface QcPresentationServices {
  readonly content: ContentId;
  /** The session's source precache table owns ordering, deduplication, limits and resource loading. */
  precache(kind: "model" | "sound", name: string): QcPrecachedResource;
  lookup(kind: "sound", name: string): QcPrecachedResource | null;
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
  install("bprint", vm => { services.print(vm.varString(0)); });
  const message = services.message;
  if (message !== undefined) {
    for (const name of ["sprint", "centerprint", "stuffcmd"] satisfies readonly QcHostBuiltinName[]) install(name, vm => {
      const actor = world.actor(vm.entities.slot(vm.argInt(0))), text = vm.varString(1);
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
    let sourceChannel: Q1SoundChannel;
    switch (channel) {
      case 0: sourceChannel = "auto"; break;
      case 1: sourceChannel = "weapon"; break;
      case 2: sourceChannel = "voice"; break;
      case 3: sourceChannel = "item"; break;
      case 4: sourceChannel = "body"; break;
      case 5: case 6: case 7: sourceChannel = channel; break;
      default: return vm.fail(`SV_StartSound: channel = ${channel}`);
    }
    const path = vm.argString(2), resource = services.lookup("sound", path);
    if (resource === null) { services.print(`SV_StartSound: ${path} not precacheed\n`); return; }
    register(resource);
    const actor = world.actor(vm.entities.slot(vm.argInt(0)));
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


/** Raw QC datagram writes retain NetQuake encoding before joining shared effects. */
export class QcBroadcastMessages {
  readonly host: ReadonlyMap<QcHostBuiltinName, QcBuiltin>;
  private readonly buffer = new SizeBuf(1024);
  private readonly decoder = new NetQuakeDecoder({ kind: "q1-netquake", version: 15 });
  constructor(world: QcWorldHost, private readonly emit: (effect: Extract<Q1Event, { readonly kind: "effect" }>) => undefined) {
    const write = (operation: (buffer: SizeBuf, value: number) => void): QcBuiltin => vm => {
      if (vm.program !== world.options.program || vm.entities !== world.options.entities) return vm.fail("QC message belongs to another source");
      if (vm.argFloat(0) !== 0) return vm.fail("QC message destination is not the supported MSG_BROADCAST datagram");
      operation(this.buffer, vm.argFloat(1));
    };
    this.host = new Map<QcHostBuiltinName, QcBuiltin>([["WriteByte", write(MSG_WriteByte)], ["WriteCoord", write(MSG_WriteCoord)]]);
  }
  flush(): undefined {
    const effects = this.decoder.decode(this.buffer.bytes()).map(message => {
      if (message.kind !== "temporary-entity" || message.effect.kind !== "point" || message.effect.type !== 2)
        throw new Error(`Unsupported QC broadcast message ${message.kind}`);
      return { kind: "effect", effect: "gunshot", actor: null, origin: message.effect.origin, amount: message.effect.count } satisfies Extract<Q1Event, { readonly kind: "effect" }>;
    });
    for (const effect of effects) this.emit(effect);
    this.buffer.clear();
    return undefined;
  }
}
