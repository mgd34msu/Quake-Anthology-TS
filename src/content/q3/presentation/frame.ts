import type { SourcePlayerState } from "../base/shared/player-state.ts";
// CG_DrawActiveFrame ordering, owned by one viewing seat. id Software, GPL-2.0-or-later.
import type { Axis, Vec3 } from "../../../contracts/math.ts";
import type { SceneCamera } from "../../../contracts/render.ts";
import { add3, scale3 } from "../../../core/math.ts";
import type { ParticleSystem } from "../../../render/scene/particles/q3-system.ts";
import { EntityType, PersistentIndex, Team, statSchema, weaponCount } from "../base/shared/definitions.ts";
import { MoveFlags } from "../base/shared/player-state.ts";
import { ClientVmCvarSymbol } from "./config.ts";
import type { ClientConfiguration } from "./config.ts";
import type { ClientDrawStatus } from "./draw-status.ts";
import type { ClientDrawTools } from "./draw-tools.ts";
import type { PacketEntityPresenter, PacketEntityOptions } from "./entities.ts";
import type { ClientFrameAudio } from "./frame-audio.ts";
import type { ClientHud } from "./hud.ts";
import type { LocalEntitySystem } from "./local-entities.ts";
import type { ImpactMarkSystem } from "./marks.ts";
import type { ClientMedia } from "./media.ts";
import type { PredictionRuntime } from "./prediction.ts";
import type { ClientServerCommandRuntime } from "./server-commands.ts";
import type { SnapshotRuntime } from "./snapshots.ts";
import type { ClientGameState } from "./state.ts";
import type { ViewRuntime } from "./view.ts";
import type { ClientWeaponRuntime } from "./weapons.ts";
import type { Q3SceneRecorder } from "./scene.ts";
export interface Q3PresentationFrame { readonly serverTime: number; readonly stereo: "center" | "left" | "right"; readonly demoPlayback: boolean; readonly engineFrameNumber: number; }
export interface Q3PresentationFrameHost {
  readonly configuration: ClientConfiguration; readonly media: ClientMedia; readonly snapshots: SnapshotRuntime;
  readonly prediction: PredictionRuntime; readonly view: ViewRuntime; readonly packet: PacketEntityPresenter;
  readonly marks: ImpactMarkSystem; readonly particles: ParticleSystem; readonly localEntities: LocalEntitySystem;
  readonly weapons: ClientWeaponRuntime; readonly frameAudio: ClientFrameAudio; readonly serverCommands: ClientServerCommandRuntime;
  readonly hud: ClientHud; readonly status: ClientDrawStatus; readonly tools: ClientDrawTools; readonly scene: Q3SceneRecorder;
  readonly hardware: "generic" | "ragepro";
  /** The session supplies the current recipe's packet presentation settings. */
  packetOptions(): PacketEntityOptions;
  presentViewWeapon(state: SourcePlayerState, source: () => void): void;
  enterFrame(frame: Q3PresentationFrame): void;
  setUserCommandValue(weapon: number, sensitivity: number): void;
  clearLoopingSounds(killAll: boolean): void;
  setListener(client: number, origin: Vec3, axis: Axis): void;
  loadingFrame(): Promise<void>;
  setTimescale(value: number): void;
  print(text: string): void;
}
export interface Q3PresentationSceneHost extends Pick<Q3PresentationFrameHost,
  "configuration" | "media" | "snapshots" | "packet" | "marks" | "particles" | "localEntities" | "frameAudio" | "serverCommands" | "scene" | "packetOptions" | "enterFrame" | "clearLoopingSounds"> {
  readonly scope: "scene";
}
/** Frame presentation never advances simulation or reads another seat's input queue. */
export class Q3PresentationFrameRuntime {
  private drawing = false;
  private sceneDrawing = false;
  private closed = false;
  constructor(readonly state: ClientGameState, readonly host: Q3PresentationFrameHost | Q3PresentationSceneHost) {
    for (const owner of "scope" in host ? [host.snapshots] : [host.snapshots, host.prediction, host.view, host.weapons, host.hud, host.status])
      if (owner.state !== state) throw new Error("Q3 frame owners must share one seat's cgame state");
  }
  close(): void { if (this.drawing && !this.sceneDrawing) throw new Error("Cannot retire cgame during a frame"); this.closed = true; this.host.scene.clearScene(); }
  async drawActiveFrame(input: Q3PresentationFrame): Promise<void> {
    if ("scope" in this.host) throw new Error("Supplemental cgame cannot draw the primary frame");
    if (this.closed || this.drawing) throw new Error("Cgame frame is closed or already drawing");
    this.drawing = true;
    try { await this.frame({ ...input }); } finally { this.drawing = false; }
  }
  async drawSceneFrame(input: Q3PresentationFrame, camera: SceneCamera): Promise<void> {
    if (!("scope" in this.host)) throw new Error("Primary cgame requires its full frame");
    if (this.closed || this.drawing) throw new Error("Cgame frame is closed or already drawing");
    this.drawing = true; this.sceneDrawing = true;
    try {
      const h = this.host, s = this.state;
      for (const clock of [input.serverTime, input.engineFrameNumber]) if (!Number.isInteger(clock) || clock < -2147483648 || clock > 2147483647) throw new RangeError("Cgame clocks require int32");
      if (input.serverTime < s.oldTime) throw new Error("Supplemental cgame source time moved backward");
      const current = (): void => { if (this.closed) throw new Error("Supplemental cgame retired during its frame"); };
      s.time = input.serverTime; h.enterFrame(input); await h.configuration.updateCvars(); current();
      h.clearLoopingSounds(false); h.scene.clearScene(); await h.snapshots.processSnapshots(); current();
      const snapshot = s.snap;
      if (snapshot === null || snapshot.flags & 2) return;
      s.predictedPlayerState = snapshot.playerState.copy(); s.physicsTime = snapshot.serverTime;
      s.frameTime = Math.max(0, (s.time - s.oldTime) | 0); s.oldTime = s.time; s.clientFrame = (s.clientFrame + 1) | 0;
      s.refdef.viewOrigin = { ...camera.origin }; s.refdef.viewAxis = camera.axis;
      s.refdef.x = camera.viewport.x; s.refdef.y = camera.viewport.y; s.refdef.width = camera.viewport.width; s.refdef.height = camera.viewport.height;
      s.refdef.fovX = Math.atan(1 / camera.projection[0]) * 360 / Math.PI;
      s.refdef.fovY = Math.atan(1 / camera.projection[5]) * 360 / Math.PI; s.refdef.time = s.time;
      const required = new Set([s.predictedPlayerState.weapon]), count = weaponCount(s.product);
      for (const entity of snapshot.entities) if (entity.eType === EntityType.ET_PLAYER || entity.eType === EntityType.ET_MISSILE || entity.eType === EntityType.ET_GRAPPLE)
        required.add(entity.weapon > count ? 0 : entity.weapon);
      for (const weapon of required) { await h.media.weaponRegistry.registerWeapon(weapon); current(); }
      h.packet.addPacketEntities(h.packetOptions());
      for (const poly of h.marks.addMarks()) h.scene.addPoly(poly);
      for (const poly of h.particles.addParticles()) h.scene.addPoly(poly);
      h.localEntities.addEntities({ time: s.time, frameTime: s.frameTime, viewOrigin: s.refdef.viewOrigin }, h.scene);
      h.frameAudio.playBufferedSounds(); await h.serverCommands.playBufferedVoiceChats(); current();
    } finally { this.drawing = false; this.sceneDrawing = false; }
  }
  private async frame(frame: Q3PresentationFrame): Promise<void> {
    const h = this.host, s = this.state;
    if ("scope" in h) throw new Error("Supplemental cgame cannot draw the primary frame");
    for (const clock of [frame.serverTime, frame.engineFrameNumber]) if (!Number.isInteger(clock) || clock < -2147483648 || clock > 2147483647) throw new RangeError("Cgame clocks require int32");
    s.time = frame.serverTime; h.enterFrame(frame); await h.configuration.updateCvars();
    if (s.infoScreenText !== "") return h.loadingFrame();
    h.clearLoopingSounds(false); h.scene.clearScene(); await h.snapshots.processSnapshots();
    const snapshot = s.snap;
    if (snapshot === null || snapshot.flags & 2) return h.loadingFrame();
    h.setUserCommandValue(s.weaponSelect, s.zoomSensitivity); s.clientFrame = (s.clientFrame + 1) | 0;
    await h.prediction.predictPlayerState(); h.view.calculateViewValues();
    const requiredWeapons = new Set([s.predictedPlayerState.weapon]);
    const owned = snapshot.playerState.stats.get(statSchema(s.product).weapons), count = weaponCount(s.product);
    for (let weapon = 1; weapon < count; weapon++) if ((owned & (1 << weapon)) !== 0) requiredWeapons.add(weapon);
    for (const entity of snapshot.entities) {
      const current = s.entityAt(entity.number).currentState;
      if (current.eType === EntityType.ET_PLAYER) requiredWeapons.add(current.weapon);
      else if (current.eType === EntityType.ET_MISSILE || current.eType === EntityType.ET_GRAPPLE)
        requiredWeapons.add(current.weapon > count ? 0 : current.weapon);
    }
    for (const weapon of requiredWeapons) await h.media.weaponRegistry.registerWeapon(weapon);
    if (!s.renderingThirdPerson) { const damage = h.view.damageBlendBlob(h.media.graphics.viewBloodShader, h.hardware === "ragepro"); if (damage !== null) h.scene.addRefEntity(damage); }
    if (!s.hyperspace) {
      h.packet.addPacketEntities(h.packetOptions());
      for (const poly of h.marks.addMarks()) h.scene.addPoly(poly);
      for (const poly of h.particles.addParticles()) h.scene.addPoly(poly);
      h.localEntities.addEntities({ time: s.time, frameTime: s.frameTime, viewOrigin: s.refdef.viewOrigin }, h.scene);
    }
    h.presentViewWeapon(s.predictedPlayerState, () => h.weapons.addViewWeapon(s.predictedPlayerState)); h.frameAudio.playBufferedSounds(); await h.serverCommands.playBufferedVoiceChats();
    if (s.testModelEntity.model.kind !== "default") { const model = await h.view.addTestModel(); if (model !== null) h.scene.addRefEntity(model); }
    const refdef = h.view.finishRefdef(); h.frameAudio.powerupTimerSounds(); h.setListener(snapshot.playerState.clientNum, refdef.viewOrigin, refdef.viewAxis);
    if (frame.stereo !== "right") { s.frameTime = Math.max(0, (s.time - s.oldTime) | 0); s.oldTime = s.time; h.status.addLagometerFrameInfo(); }
    this.fadeTimescale();
    if (snapshot.playerState.persistant.get(PersistentIndex.PERS_TEAM) === Team.TEAM_SPECTATOR && snapshot.playerState.pmFlags & MoveFlags.SCOREBOARD) { h.hud.drawTourneyScoreboard(); return; }
    const stereo = h.configuration.readVmCvar("cg_stereoSeparation").numericValue;
    const separation = frame.stereo === "center" ? 0 : Math.fround(stereo * (frame.stereo === "left" ? -0.5 : 0.5));
    h.tools.tileClear(refdef);
    const base = refdef.viewOrigin;
    if (separation !== 0) refdef.viewOrigin = add3(base, scale3(refdef.viewAxis[1], -separation));
    h.scene.renderScene(refdef); refdef.viewOrigin = base;
    await h.hud.draw2D();
    if (h.configuration.readVmCvar("cg_stats").integerValue !== 0) h.print(`cg.clientFrame:${s.clientFrame}\n`);
  }
  private fadeTimescale(): void {
    if ("scope" in this.host) throw new Error("Supplemental cgame cannot control primary timescale");
    const c = this.host.configuration, end = c.readVmCvar("cg_timescaleFadeEnd").numericValue, speed = c.readVmCvar("cg_timescaleFadeSpeed").numericValue;
    const current = c.readVmSymbol(ClientVmCvarSymbol.cg_timescale).numericValue;
    if (current === end) return;
    const delta = Math.fround(Math.fround(speed * Math.fround(this.state.frameTime)) / 1000);
    const value = current < end ? Math.min(end, Math.fround(current + delta)) : Math.max(end, Math.fround(current - delta));
    c.setVmNumericValue(ClientVmCvarSymbol.cg_timescale, value); if (speed !== 0) this.host.setTimescale(value);
  }
}
