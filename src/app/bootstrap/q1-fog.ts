// Quakespasm/quake-1-re-ts Fog_Update, Fog_ParseWorldspawn and Fog_GetColor.
// SPDX-License-Identifier: GPL-2.0-or-later
import type { ContentId } from '../../contracts/content.ts';
import type { ActorId } from '../../contracts/identity.ts';
import type { SceneFog } from '../../contracts/render.ts';
import { Q1FogState, q1WorldFog } from '../../materials/legacy-fog.ts';
import type { SimulationPresentationEvent } from './simulation/types.ts';

/** One seat in one published world; construction resets fades on world travel. */
export class Q1MapFog {
  private readonly state = new Q1FogState();
  private skyFactor = 0.5;
  constructor(entities: string, private readonly contents: ReadonlySet<ContentId>, private readonly actor: ActorId, private enabled = true) {
    this.state.install(q1WorldFog(entities));
  }
  receive(events: readonly SimulationPresentationEvent[]): void {
    for (const source of events) {
      if (source.kind !== 'q1-fog' || !this.contents.has(source.content)) continue;
      const event = source.event;
      if (event.player !== null && !event.player.equals(this.actor)) continue;
      this.enabled = true; this.state.install(event.transition); this.skyFactor = event.skyFactor;
    }
  }
  get active(): boolean { return this.enabled; }
  current(seconds: number): Extract<SceneFog, { readonly kind: 'q1' }> {
    const value = this.state.sample(seconds);
    const byte = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255) / 255;
    return { kind: 'q1', density: value.density, color: { x: byte(value.color.x), y: byte(value.color.y), z: byte(value.color.z) }, skyFactor: this.skyFactor };
  }
}
