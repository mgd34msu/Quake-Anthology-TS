import { samePresentationOwner } from "../../contracts/presentation.ts";
import type { ActorId } from '../../contracts/identity.ts';
import type { ContentId } from '../../contracts/content.ts';
import type { RendererImage } from '../../contracts/render.ts';
import { SKY_FACE_SUFFIXES } from '../../materials/sky.ts';
import type { WorldViewInput } from '../../render/scene/world.ts';
import type { ProviderSceneAssets } from './assets.ts';
import type { Q1ClientMetadataEvent, SimulationPresentationEvent } from './simulation/types.ts';

export interface Q1ClientRow {
  readonly slot: number;
  readonly name: string;
  readonly colors: number;
  readonly frags: number;
  readonly ping?: number;
  readonly social?: string;
  readonly playerInfo?: string;
}
export interface Q1ServiceAssets { provider(content: ContentId): Promise<Pick<ProviderSceneAssets,'textures'>>; }
type Sky = NonNullable<WorldViewInput['sourceSky']>;
interface SkySelection { readonly content: ContentId; readonly name: string; ready: boolean; value: Sky | null; }
interface ClientTables { readonly shared: Map<number,Q1ClientRow>; readonly recipients: Map<ActorId,Map<number,Q1ClientRow>>; }
export function updateQ1ClientMetadata(table: Map<number,Q1ClientRow>, event: Q1ClientMetadataEvent): void {
  const row = table.get(event.slot) ?? {slot:event.slot,name:'',colors:0,frags:0};
  switch(event.kind) {
    case 'name': table.set(event.slot,{...row,name:event.value}); break;
    case 'colors': table.set(event.slot,{...row,colors:event.value}); break;
    case 'frags': table.set(event.slot,{...row,frags:event.value}); break;
    case 'ping': table.set(event.slot,{...row,ping:event.value}); break;
    case 'social': table.set(event.slot,{...row,social:event.value}); break;
    case 'player-info': table.set(event.slot,{...row,playerInfo:event.value}); break;
  }
}

/** Source slots are scoreboard indices, not engine actors or platform identities. */
export class Q1ServicePresentation {
  private sharedSky: SkySelection | null = null;
  private readonly skies = new Map<ActorId,SkySelection>();
  private readonly tables = new Map<ContentId,ClientTables>();
  private closed = false;
  private readonly retained = new Map<string, SimulationPresentationEvent>();

  receive(events: readonly SimulationPresentationEvent[]): void {
    if(this.closed) throw new Error('Q1 service presentation is closed');
    for(const source of events) {
      if (source.kind === 'presentation-owner') {
        if (source.event.kind === 'refreshed') {
          if (this.sharedSky !== null) this.sharedSky = { ...this.sharedSky };
          for (const [actor, sky] of this.skies) this.skies.set(actor, { ...sky });
          continue;
        }
        for (const [key, event] of this.retained) if (samePresentationOwner(event.owner, source.event.owner)) this.retained.delete(key);
        this.sharedSky = null; this.skies.clear(); this.tables.clear();
        this.apply([...this.retained.values()].sort((a,b) => a.sequence - b.sequence));
      } else if (source.kind === 'q1-sky' || source.kind === 'q1-client') {
        const recipient = source.recipient === undefined ? 'world' : `${source.recipient.slot}:${source.recipient.generation}`;
        const key = source.kind === 'q1-sky' ? `sky:${recipient}` : `${source.content}:${source.event.slot}:${source.event.kind}:${recipient}`;
        this.retained.set(key, source); this.apply([source]);
      }
    }
  }

  private apply(events: readonly SimulationPresentationEvent[]): void {
    for(const source of events) {
      if(source.kind === 'q1-sky') {
        const value: SkySelection = {content:source.content,name:source.event.name,ready:false,value:null};
        if(source.recipient === undefined) {this.sharedSky=value;this.skies.clear();}
        else this.skies.set(source.recipient,value);
      } else if(source.kind === 'q1-client') {
        let tables=this.tables.get(source.content);
        if(tables === undefined) {tables={shared:new Map<number,Q1ClientRow>(),recipients:new Map<ActorId,Map<number,Q1ClientRow>>()};this.tables.set(source.content,tables);}
        if(source.recipient === undefined) {updateQ1ClientMetadata(tables.shared,source.event);for(const table of tables.recipients.values())updateQ1ClientMetadata(table,source.event);}
        else {
          let table=tables.recipients.get(source.recipient);
          if(table === undefined) {table=new Map(tables.shared);tables.recipients.set(source.recipient,table);}
          updateQ1ClientMetadata(table,source.event);
        }
      }
    }
  }

  private selections(): readonly SkySelection[] {
    return [...(this.sharedSky === null ? [] : [this.sharedSky]), ...this.skies.values()];
  }

  private async load(value: SkySelection, assets: Q1ServiceAssets): Promise<Sky | null> {
    if (value.name === '') return null;
    const provider = await assets.provider(value.content), images: RendererImage[] = [];
    let found = false;
    for (const suffix of SKY_FACE_SUFFIXES) {
      const path = `gfx/env/${value.name}${suffix}`;
      const image = await provider.textures.load(`${path}.tga`, { family: 'q1', wrap: 'clamp', mipmap: false, usage: 'sky' })
        ?? await provider.textures.load(`${path}.png`, { family: 'q1', wrap: 'clamp', mipmap: false, usage: 'sky' });
      found ||= image !== null; images.push((image ?? provider.textures.missing).image);
    }
    return found ? { images, rotation: 0, autoRotate: false, axis: { x: 0, y: 0, z: 1 } } : null;
  }

  private publish(selection: SkySelection, sky: Sky | null): void {
    if (this.closed || !this.selections().includes(selection)) return;
    selection.value = sky; selection.ready = true;
  }

  async prepare(assets: Q1ServiceAssets): Promise<void> {
    if (this.closed) throw new Error('Q1 service presentation is closed');
    await Promise.all(this.selections().filter(value => !value.ready).map(async value => this.publish(value, await this.load(value, assets))));
  }

  async prepareImageRefresh(assets: Q1ServiceAssets): Promise<() => void> {
    if (this.closed) throw new Error('Q1 service presentation is closed');
    const replacements = await Promise.all(this.selections().map(async selection => ({ selection, sky: await this.load(selection, assets) })));
    return () => { for (const replacement of replacements) this.publish(replacement.selection, replacement.sky); };
  }

  view(actor: ActorId): Pick<WorldViewInput,'sourceSky'> {
    const value=this.skies.get(actor) ?? this.sharedSky;
    return value?.value === null || value === null || value === undefined ? {} : {sourceSky:value.value};
  }
  clients(content:ContentId,actor:ActorId): readonly Q1ClientRow[] {
    const tables=this.tables.get(content);return [...(tables?.recipients.get(actor) ?? tables?.shared ?? new Map<number,Q1ClientRow>()).values()].sort((a,b)=>a.slot-b.slot);
  }
  retire(actor:ActorId):void {
    this.skies.delete(actor);for(const tables of this.tables.values())tables.recipients.delete(actor);
    for (const [key, source] of this.retained) if (source.recipient?.equals(actor)) this.retained.delete(key);
  }
  reset():void {this.retained.clear();this.sharedSky=null;this.skies.clear();this.tables.clear();}
  close():void {this.reset();this.closed=true;}
}
