// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId } from "../../../contracts/identity.ts";
import type { QvmGameData } from "../../../compat/qvm/game-data.ts";
import type { QvmFiles } from "../../../compat/qvm/file-syscalls.ts";
import type { QvmServerGameServices } from "../../../compat/qvm/server-game-syscalls.ts";
import type { CvarRegistry } from "../../../core/cvars/index.ts";
import { CommonParseCursor, CommonParseState } from "../../../core/common-parse.ts";
import { Q3_BINARY32_PROFILE } from "../../../core/numeric.ts";
import type { SharedSceneQueries } from "../../../world/collision/index.ts";
import { parseQ1Entities, q1EntityValue } from "../../../formats/q1-map/entities.ts";
import { SaveReader } from "../../../persistence/value.ts";

/** Only source initialization and client spawn points are needed by a trajectory component. */
export function qvmWeaponInitializationEntities(text: string): string {
  const classes = new Set(['worldspawn', 'info_player_start', 'info_player_deathmatch', 'info_player_intermission', 'team_CTF_redplayer', 'team_CTF_blueplayer', 'team_CTF_redspawn', 'team_CTF_bluespawn']);
  const entities = parseQ1Entities(text).filter(entity => classes.has(q1EntityValue(entity, 'classname') ?? ''));
  if (entities.filter(entity => q1EntityValue(entity, 'classname') === 'worldspawn').length !== 1) throw new Error('QVM component requires one authored worldspawn');
  const quote = (value: string): string => { if (value.includes('"') || value.includes('\0')) throw new Error('Unquotable QVM spawn field'); return '"' + value + '"'; };
  return entities.map(entity => '{\n' + entity.properties.map(field => quote(field.key) + ' ' + quote(field.value)).join('\n') + '\n}\n').join('');
}

const CLIENTS = 64;
const CONFIGSTRINGS = 1024;

/** Host state every QVM component source (weapon behavior, grapple) keeps for its borrowed qagame image. */
export class QvmComponentState {
  readonly configstrings = new Map<number, string>();
  readonly userinfo = new Map<number, string>();
  readonly parser = new CommonParseState();
  readonly cursor: CommonParseCursor;
  constructor(entityText: string, readonly cvars: CvarRegistry) {
    this.cursor = new CommonParseCursor(qvmWeaponInitializationEntities(entityText));
  }
  /** Source-neutral part of the host checkpoint; callers add their own scalar fields. */
  capture(data: QvmGameData, files: QvmFiles) {
    return { data: data.checkpoint(), cvars: this.cvars.captureSaveState(),
      configstrings: [...this.configstrings].map(([index, value]) => ({ index, value })), userinfo: [...this.userinfo].map(([slot, value]) => ({ slot, value })),
      files: files.captureCheckpoint(), entityText: this.cursor.source, cursor: this.cursor.offset, parser: this.parser.captureSaveState() };
  }
  restore(reader: SaveReader, data: QvmGameData, files: QvmFiles, label: string): void {
    reader.field("entityText").literal(this.cursor.source);
    const saved = reader.field("data");
    data.restore({ entitiesWord: saved.field("entitiesWord").integer(), numEntities: saved.field("numEntities").integer(0), entityStride: saved.field("entityStride").integer(0),
      clientsWord: saved.field("clientsWord").integer(), clientStride: saved.field("clientStride").integer(0) });
    this.cvars.restoreSaveState(reader.field("cvars").value); this.configstrings.clear(); this.userinfo.clear();
    for (const entry of reader.field("userinfo").list(cell => ({ slot: cell.field("slot").integer(0), value: cell.field("value").string() }))) {
      if (entry.slot >= CLIENTS || this.userinfo.has(entry.slot)) throw new Error(`Invalid saved ${label} client`);
      this.userinfo.set(entry.slot, entry.value);
    }
    for (const entry of reader.field("configstrings").list(cell => ({ index: cell.field("index").integer(0), value: cell.field("value").string() }))) {
      if (entry.index >= CONFIGSTRINGS || this.configstrings.has(entry.index)) throw new Error(`Invalid saved ${label} configstring`);
      this.configstrings.set(entry.index, entry.value);
    }
    this.cursor.offset = reader.field("cursor").nullable(cell => cell.integer(0)); this.parser.restoreSaveState(reader.field("parser").value);
    files.restoreCheckpoint(reader.field("files").value);
  }
}

export interface QvmComponentSpatialOptions {
  readonly scene: SharedSceneQueries;
  readonly cvars: CvarRegistry;
  readonly data: QvmGameData;
  readonly label: string;
  actorForSlot(slot: number): ActorId | null;
  slotOf(actor: ActorId): number;
  /** Actors the component owns itself and must not see in its own area queries. */
  hidden?(actor: ActorId): boolean;
  reject(operation: "perform undeclared brush contact" | "bind a primary brush" | "change world portals"): never;
}

/** Spatial imports shared by the QVM component sources: collision, contents, PVS and entity linking all come from shared scene queries. */
export function qvmComponentSpatial(options: QvmComponentSpatialOptions): QvmServerGameServices["spatial"] {
  const { scene, cvars, data, label } = options;
  const curves = (): boolean => cvars.variableValue("cm_noCurves") === 0;
  return {
    trace: input => {
      const trace = scene.trace({ start: input.start, end: input.end, shape: input.shape, target: { kind: "world" }, numeric: Q3_BINARY32_PROFILE,
        passActor: options.actorForSlot(input.passEntityNum), policy: { kind: "q3", contentsMask: input.mask, curves: curves(), playerCurveClip: cvars.variableValue("cm_playerCurveClip") !== 0 } });
      if (trace.kind !== "q3") throw new Error(`${label} trace lost its source policy`);
      return { fraction: trace.fraction, end: trace.end, allSolid: trace.allSolid, startSolid: trace.startSolid, contents: trace.contents, surfaceFlags: trace.surfaceFlags, plane: trace.sourcePlane,
        entityNum: trace.hit.kind === "actor" ? options.slotOf(trace.hit.actor) : trace.fraction === 1 ? 1023 : 1022 };
    },
    pointContents: (point, pass) => {
      const sample = scene.pointContents({ point, target: { kind: "world" }, passActor: options.actorForSlot(pass), numeric: Q3_BINARY32_PROFILE,
        policy: { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true } });
      if (sample.kind !== "q3") throw new Error(`${label} contents lost its source policy`);
      return sample.contents;
    },
    areaEntities: (bounds, maximum) => {
      const hidden = options.hidden, found = scene.queryActors(bounds), actors = hidden === undefined ? found : found.filter(entry => !hidden(entry.body.actor));
      return (maximum < 0 ? actors : actors.slice(0, maximum)).map(entry => options.slotOf(entry.body.actor));
    },
    entityContact: () => options.reject("perform undeclared brush contact"),
    setBrushModel: () => options.reject("bind a primary brush"),
    adjustAreaPortalState: () => options.reject("change world portals"),
    inPvs: (first, second, ignore) => {
      const a = scene.pointLeaf(first), b = scene.pointLeaf(second);
      return scene.clusterVisible(scene.leafCluster(a), scene.leafCluster(b), "pvs") && (ignore || scene.areasConnected(scene.leafArea(a), scene.leafArea(b)));
    },
    areasConnected: (first, second) => scene.areasConnected(first, second),
    link: slot => {
      const r = data.entity(slot).r; r.linked = true;
      r.absmin = { x: r.currentOrigin.x + r.mins.x - 1, y: r.currentOrigin.y + r.mins.y - 1, z: r.currentOrigin.z + r.mins.z - 1 };
      r.absmax = { x: r.currentOrigin.x + r.maxs.x + 1, y: r.currentOrigin.y + r.maxs.y + 1, z: r.currentOrigin.z + r.maxs.z + 1 };
    },
    unlink: slot => { data.entity(slot).r.linked = false; },
  };
}
