/* Rogue p_view.c and g_sphere.c presentation state. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3, Vec4 } from "../../../contracts/math.ts";
import type { SceneCamera } from "../../../contracts/render.ts";
import type { Q2MissionPackPlayerEffect } from "../../../content/q2/missionpacks/types.ts";
import { anglesToAxis } from "../../../core/math.ts";

interface PlayerEffects {
  irUntil: number;
  nukeUntil: number;
  sphere: Extract<Q2MissionPackPlayerEffect, { readonly kind: "sphere-camera" }> | null;
}
export interface Q2EffectPlayerView { readonly camera: SceneCamera; readonly infrared: boolean; readonly blend: Vec4 | null; }

export class Q2EffectViews {
  private readonly players = new Map<ActorId, PlayerEffects>();
  receive(event: Exclude<Q2MissionPackPlayerEffect, { readonly kind: "tracker-pain" }>): void {
    let state = this.players.get(event.actor);
    if (state === undefined) { state = { irUntil: 0, nukeUntil: 0, sphere: null }; this.players.set(event.actor, state); }
    if (event.kind === "ir") state.irUntil = event.until;
    else if (event.kind === "nuke-blind") state.nukeUntil = event.until;
    else state.sphere = event.sphere === null ? null : { ...event, origin: { ...event.origin }, angles: { ...event.angles } };
  }
  frame(actor: ActorId, camera: SceneCamera, seconds: number, pose: (actor: ActorId) => { readonly origin: Vec3 } | undefined): Q2EffectPlayerView {
    const state = this.players.get(actor);
    if (state === undefined) return { camera, infrared: false, blend: null };
    const frames = Math.round(state.irUntil * 10) - Math.round(seconds * 10);
    const infrared = frames > 0 && (frames > 30 || (frames & 4) !== 0);
    const nukeAlpha = Math.max(0, Math.min(1, (state.nukeUntil - seconds) / 2));
    const alpha = nukeAlpha + (1 - nukeAlpha) * (infrared ? 0.2 : 0);
    const fraction = alpha > 0 ? nukeAlpha / alpha : 0;
    const blend = alpha > 0 ? { x: 1, y: fraction, z: fraction, w: alpha } : null;
    const sphere = state.sphere;
    const selected = sphere === null || sphere.sphere === null ? camera : { ...camera,
      origin: pose(sphere.sphere)?.origin ?? sphere.origin, axis: anglesToAxis(sphere.angles) };
    return { camera: selected, infrared, blend };
  }
  clear(): void { this.players.clear(); }
}
