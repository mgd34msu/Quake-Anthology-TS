import type { ContentId } from '../../../contracts/content.ts';
import type { ActorId } from '../../../contracts/identity.ts';
import type { SavedActorId } from '../../../contracts/session.ts';
import type { Q1AddonEvent } from '../../../content/q1/addons/context.ts';
import { Q1FogState, q1WorldFog, type Q1Fog, type Q1FogTransition } from '../../../materials/legacy-fog.ts';
import { savedActorId, readSavedActor } from '../../../persistence/save-image.ts';
import { readContentId } from '../../../persistence/recipe.ts';
import { SaveReader } from '../../../persistence/value.ts';
import type { SimulationPresentationEvent } from './types.ts';

type Context = Pick<SimulationPresentationEvent, 'content' | 'sequence' | 'seconds' | 'sourceEntity'>;
type FogEvent = Extract<Q1AddonEvent, { readonly kind: 'fog' }>;
type ResolvedFog = Extract<SimulationPresentationEvent, { readonly kind: 'q1-fog' }>;
interface RetainedFog { readonly player: ActorId | null; readonly state: Q1FogState; skyFactor: number; context: Context | null; }
export interface SimulationQ1FogOptions { readonly content: ContentId; readonly acceptedContents?: ReadonlySet<ContentId>; readonly entities: string; readonly alive: (actor: ActorId) => boolean; }

function bounded(reader: SaveReader, minimum: number, maximum = Infinity): number {
  const value = reader.finite(); return value < minimum || value > maximum ? reader.fail('fog value out of range') : value;
}
function readFog(reader: SaveReader): Q1Fog {
  const color = reader.field('color');
  return { density: bounded(reader.field('density'), 0), color: { x: bounded(color.field('x'), 0, 1), y: bounded(color.field('y'), 0, 1), z: bounded(color.field('z'), 0, 1) } };
}
function readTransition(reader: SaveReader): Q1FogTransition {
  return { previous: readFog(reader.field('previous')), target: readFog(reader.field('target')), start: reader.field('start').finite(), duration: bounded(reader.field('duration'), 0) };
}
function key(actor: ActorId): string { return `${actor.slot}:${actor.generation}`; }
function resolved(value: RetainedFog): readonly ResolvedFog[] {
  return value.context === null ? [] : [{ ...value.context, kind: 'q1-fog', event: { kind: 'transition', player: value.player, transition: value.state.capture(), skyFactor: value.skyFactor } }];
}

/** Finite world/actor transitions, not an event replay log. */
export class SimulationQ1Fog {
  private readonly initial: Q1FogTransition;
  private readonly global: RetainedFog;
  private readonly actors = new Map<string, RetainedFog>();
  constructor(private readonly options: SimulationQ1FogOptions) {
    this.initial = q1WorldFog(options.entities);
    const state = new Q1FogState(); state.install(this.initial);
    this.global = { player: null, state, skyFactor: 0.5, context: null };
  }
  reset(): void { this.global.state.install(this.initial); this.global.skyFactor = 0.5; this.global.context = null; this.actors.clear(); }
  retire(actor: ActorId): void {
    const retained = this.actors.get(key(actor));
    if (retained?.player?.equals(actor)) this.actors.delete(key(actor));
  }
  private accepts(content: ContentId): boolean { return content === this.options.content || this.options.acceptedContents?.has(content) === true; }
  update(context: Context, event: FogEvent): readonly ResolvedFog[] {
    if (!this.accepts(context.content)) return [];
    const apply = (value: RetainedFog): readonly ResolvedFog[] => {
      value.state.update({ density: event.density, color: event.color }, context.seconds, event.duration);
      value.skyFactor = Math.max(0, Math.min(1, event.skyFactor));
      value.context = { content: context.content, sequence: context.sequence, seconds: context.seconds, sourceEntity: context.sourceEntity ?? null };
      return resolved(value);
    };
    if (event.player === null) {
      const output = [...apply(this.global)];
      for (const [id, value] of this.actors) {
        if (value.player === null || !this.options.alive(value.player)) { this.actors.delete(id); continue; }
        output.push(...apply(value));
      }
      return output;
    }
    if (!this.options.alive(event.player)) return [];
    let value = this.actors.get(key(event.player));
    if (value === undefined || !value.player?.equals(event.player)) {
      const state = new Q1FogState(); state.install(this.global.state.capture());
      value = { player: event.player, state, skyFactor: this.global.skyFactor, context: null };
      this.actors.set(key(event.player), value);
    }
    return apply(value);
  }
  capture() {
    const capture = (value: RetainedFog) => ({ transition: value.state.capture(), skyFactor: value.skyFactor, context: value.context });
    return { content: this.options.content, global: capture(this.global), actors: [...this.actors.values()].flatMap(value =>
      value.player === null || !this.options.alive(value.player) ? [] : [{ player: savedActorId(value.player), ...capture(value) }]) };
  }
  restore(reader: SaveReader, reference: (actor: SavedActorId) => ActorId): readonly ResolvedFog[] {
    if (readContentId(reader.field('content')) !== this.options.content) return reader.fail('fog state belongs to another map content');
    const read = (entry: SaveReader, player: ActorId | null): RetainedFog => {
      const state = new Q1FogState(); state.install(readTransition(entry.field('transition')));
      const context = entry.field('context').nullable(value => {
        const content = readContentId(value.field('content'));
        if (!this.accepts(content)) return value.fail('fog source content is not selected');
        return { content, sequence: value.field('sequence').integer(0), seconds: value.field('seconds').finite(), sourceEntity: value.field('sourceEntity').nullable(v => v.integer(0)) };
      });
      if (player !== null && context === null) return entry.fail('actor fog requires its source context');
      return { player, state, skyFactor: bounded(entry.field('skyFactor'), 0, 1), context };
    };
    const global = read(reader.field('global'), null), actors = new Map<string, RetainedFog>();
    reader.field('actors').list(entry => {
      const player = reference(readSavedActor(entry.field('player'))), id = key(player);
      if (!this.options.alive(player)) return entry.fail('fog actor is not alive');
      if (actors.has(id)) return entry.fail('duplicate fog actor');
      actors.set(id, read(entry, player));
    });
    this.global.state.install(global.state.capture()); this.global.skyFactor = global.skyFactor; this.global.context = global.context;
    this.actors.clear(); for (const [id, value] of actors) this.actors.set(id, value);
    return [...resolved(this.global), ...[...this.actors.values()].flatMap(resolved)];
  }
}
