import type { ActorId } from "../../../contracts/identity.ts";
import type { ModIdentity } from "../../../contracts/mods.ts";
import { sameModIdentity } from "../../../contracts/mods.ts";
import type { PresentationOwner } from "../../../contracts/presentation.ts";
import { samePresentationOwner } from "../../../contracts/presentation.ts";
import type { ModClientPresentationFrame, NativeModCameraView } from "../../../world/session/mod-client-presentation.ts";
import type { NativeQ2HudFrame } from "../../../ui/hud/q2-native.ts";
import type { Q2ProtocolIdentity } from "../../../contracts/protocol.ts";
import { q2ApplicationLayout } from "./q2-layout.ts";
import { readModIdentity } from "../../../persistence/mods.ts";
import { SaveReader } from "../../../persistence/value.ts";
import { readComponentOwner } from "./unified-components.ts";
import { actor, readNativeCameraView, wireActor } from "./unified-frame-values.ts";
import type { UnifiedIdentityDecoder } from "./unified-types.ts";

type NativeFrame = Extract<ModClientPresentationFrame, { kind: "native" }>;
interface NativeIdentity { readonly owner: PresentationOwner; readonly identity: ModIdentity; readonly generation: number; }
export interface UnifiedNativePublication extends NativeIdentity { readonly viewer: ActorId; readonly frame: NativeFrame; }
type HudState = Pick<NativeQ2HudFrame, "protocol" | "layout" | "inventory" | "playerNumber"> & { readonly configstrings: NativeQ2HudFrame["configstrings"] | null };
export interface UnifiedNativeState extends NativeIdentity {
  readonly hud: { readonly mode: NonNullable<NativeFrame["hud"]>["mode"]; readonly frame: HudState } | null;
}
export interface UnifiedNativeFrame {
  readonly owner: PresentationOwner;
  readonly generation: number;
  readonly viewer: ActorId;
  readonly hud: Pick<NativeQ2HudFrame, "stats" | "serverFrame" | "timeMilliseconds" | "frameTimeMilliseconds"> | null;
  readonly view: NativeModCameraView | null;
}
function sameNumbers(a: readonly number[], b: readonly number[]): boolean { return a.length === b.length && a.every((value, index) => value === b[index]); }
function sameConfigs(a: ReadonlyMap<number, string>, b: ReadonlyMap<number, string>): boolean { if (a === b) return true; if (a.size !== b.size) return false; for (const [key, value] of a) if (b.get(key) !== value) return false; return true; }
export function projectNativeComponents(previous: readonly UnifiedNativePublication[], sources: readonly UnifiedNativePublication[]) {
  let changed = sources.length !== previous.length;
  const oldSources = new Map(previous.map(source => [source.owner.provider, source]));
  const states: UnifiedNativeState[] = sources.map((source, index) => {
    const old = oldSources.get(source.owner.provider);
    const same = old !== undefined && samePresentationOwner(source.owner, old.owner) && source.generation === old.generation;
    if (same && (!sameModIdentity(source.identity, old.identity) || !source.viewer.equals(old.viewer))) throw new Error("Native component activation changed identity or recipient");
    const hud = source.frame.hud, oldHud = same ? old.frame.hud : null;
    const sameConfig = hud !== null && oldHud !== null && sameConfigs(hud.frame.configstrings, oldHud.frame.configstrings);
    const sameHud = hud === null ? oldHud === null : oldHud !== null && sameConfig && hud.mode === oldHud.mode && hud.frame.protocol.kind === oldHud.frame.protocol.kind
      && hud.frame.layout === oldHud.frame.layout && hud.frame.playerNumber === oldHud.frame.playerNumber && sameNumbers(hud.frame.inventory, oldHud.frame.inventory);
    changed ||= !same || !sameHud || !samePresentationOwner(previous[index]?.owner, source.owner);
    return { owner: source.owner, identity: source.identity, generation: source.generation,
      hud: hud === null ? null : { mode: hud.mode, frame: { protocol: hud.frame.protocol, configstrings: sameConfig ? null : hud.frame.configstrings,
        layout: hud.frame.layout, inventory: hud.frame.inventory, playerNumber: hud.frame.playerNumber } } };
  });
  const frames: UnifiedNativeFrame[] = sources.map(source => ({ owner: source.owner, generation: source.generation, viewer: source.viewer, view: source.frame.view,
    hud: source.frame.hud === null ? null : { stats: source.frame.hud.frame.stats, serverFrame: source.frame.hud.frame.serverFrame, timeMilliseconds: source.frame.hud.frame.timeMilliseconds,
      ...(source.frame.hud.frame.frameTimeMilliseconds === undefined ? {} : { frameTimeMilliseconds: source.frame.hud.frame.frameTimeMilliseconds }) } }));
  return { changed, states, frames };
}
function integer(reader: SaveReader, minimum: number, maximum: number): number {
  const value = reader.integer(minimum); return Number.isSafeInteger(value) && value <= maximum ? value : reader.fail("native component integer exceeds its range");
}
function text(reader: SaveReader, maximum: number): string {
  const value = reader.string(); return value.length <= maximum && !value.includes("\0") ? value : reader.fail("invalid native component string");
}
function protocol(reader: SaveReader): Q2ProtocolIdentity {
  const kind = reader.field("kind").choice("q2-classic", "q2-rerelease");
  if (kind === "q2-classic") { reader.field("version").literal(34); return { kind, version: 34 }; }
  reader.field("version").literal(1038); return { kind, version: 1038 };
}
export function writeNativeStates(sources: readonly UnifiedNativeState[]) {
  return sources.map(source => ({ ...source, hud: source.hud === null ? null : { ...source.hud, frame: { ...source.hud.frame,
    configstrings: source.hud.frame.configstrings === null ? null : Array.from(source.hud.frame.configstrings, ([index, value]) => ({ index, value })) } } }));
}
export function readNativeStates(reader: SaveReader): readonly UnifiedNativeState[] {
  return reader.value === undefined ? [] : reader.list(source => ({ owner: readComponentOwner(source.field("owner")), identity: readModIdentity(source.field("identity")),
    generation: integer(source.field("generation"), 0, Number.MAX_SAFE_INTEGER), hud: source.field("hud").nullable(hud => {
      const frame = hud.field("frame"), sourceProtocol = protocol(frame.field("protocol")), layout = q2ApplicationLayout(sourceProtocol);
      const configstrings = frame.field("configstrings").nullable(configs => {
        const values = configs.list(value => ({ index: integer(value.field("index"), 0, layout.maxConfigStrings - 1), value: text(value.field("value"), 65535) }));
        const result = new Map(values.map(value => [value.index, value.value]));
        if (values.length !== result.size) return configs.fail("duplicate native configstrings");
        return result;
      });
      const inventory = frame.field("inventory").list(value => integer(value, -32768, 32767));
      if (inventory.length > 256) return frame.fail("native inventory exceeds source slots");
      return { mode: hud.field("mode").choice("layout-overlay", "replace-status"), frame: { protocol: sourceProtocol, configstrings,
        layout: text(frame.field("layout"), 65535), inventory, playerNumber: integer(frame.field("playerNumber"), 0, 255) } };
    }) }));
}
export function writeNativeFrames(sources: readonly UnifiedNativeFrame[]) { return sources.map(source => ({ ...source, viewer: wireActor(source.viewer) })); }
export function readNativeFrames(reader: SaveReader, identity: UnifiedIdentityDecoder): readonly UnifiedNativeFrame[] {
  return reader.value === undefined ? [] : reader.list(source => ({ owner: readComponentOwner(source.field("owner")), generation: integer(source.field("generation"), 0, Number.MAX_SAFE_INTEGER),
    viewer: actor(source.field("viewer"), identity), view: source.field("view").nullable(readNativeCameraView), hud: source.field("hud").nullable(hud => {
      const stats = hud.field("stats").list(value => integer(value, -32768, 32767));
      if (stats.length !== 32 && stats.length !== 64) return hud.fail("invalid source native stat count");
      const frameTimeMilliseconds = hud.field("frameTimeMilliseconds").value === undefined ? undefined : hud.field("frameTimeMilliseconds").finite();
      if (frameTimeMilliseconds !== undefined && frameTimeMilliseconds <= 0) return hud.fail("native source frame interval must be positive");
      return { stats, serverFrame: integer(hud.field("serverFrame"), 0, 2147483647), timeMilliseconds: hud.field("timeMilliseconds").finite(),
        ...(frameTimeMilliseconds === undefined ? {} : { frameTimeMilliseconds }) };
    }) }));
}
