/* Q2 rerelease configstrings, svc_locprint and cg_screen.cpp story draws. GPL-2.0-or-later. */
import type { ContentId } from "../../contracts/content.ts";
import type { ActorId, SeatId } from "../../contracts/identity.ts";
import type { RendererImage } from "../../contracts/render.ts";
import type { WorldViewInput } from "../../render/scene/world.ts";
import { SKY_FACE_SUFFIXES } from "../../materials/sky.ts";
import { LocalizationCatalog } from "../../text/localization.ts";
import type { Draw2D } from "../../text/draw2d.ts";
import type { SeatTextPresentation } from "../../text/layout.ts";
import type { ApplicationAssets } from "./assets.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";
import { RereleaseFog } from "./rerelease-presentation/fog.ts";

export interface RereleasePresentationSeat { readonly seat: SeatId; readonly actor: ActorId; readonly language?: string; }
export type RereleaseSkyView = NonNullable<WorldViewInput["q2Sky"]>;
type RereleaseSource = Extract<SimulationPresentationEvent, { readonly kind: "q2-rerelease" }>;
interface SeatState {
  readonly binding: RereleasePresentationSeat;
  readonly catalogs: Map<ContentId, Promise<LocalizationCatalog>>;
  readonly fog: RereleaseFog;
  fogReceived: boolean;
  story: string;
}

/** Player name tokens are resolved after localized argument expansion, as in CL_ParseLocPrint. */
export function q2PlayerNameTokens(text: string, names: ReadonlyMap<number, string>): string {
  return text.replace(/##P([0-9]+)/gu, (_token: string, digits: string) => names.get(Number(digits)) ?? "");
}

/** Holds client configstrings and interpolation only. Source game callbacks own story changes and application actions. */
export class ApplicationRereleasePresentation {
  private readonly seats: readonly SeatState[];
  private readonly names = new Map<number, string>();
  private readonly pending: (RereleaseSource | Extract<SimulationPresentationEvent, { readonly kind: "q2-player" }>)[] = [];
  private readonly prints: SimulationPresentationEvent[] = [];
  private readonly skies = new Map<ContentId, Map<string, Promise<readonly RendererImage[]>>>();
  private sky: RereleaseSkyView | null = null;
  private skySource: { readonly content: ContentId; readonly name: string } | null = null;

  async prepareImageRefresh(providers: Pick<ApplicationAssets, "provider">): Promise<() => void> {
    const next = this.sky === null || this.skySource === null ? null
      : { ...this.sky, images: await this.loadSkyImages(providers, this.skySource.content, this.skySource.name) };
    return () => { this.skies.clear(); this.sky = next; };
  }

  constructor(private readonly assets: Pick<ApplicationAssets, "provider">, seats: readonly RereleasePresentationSeat[]) {
    this.seats = seats.map(binding => ({ binding, catalogs: new Map<ContentId, Promise<LocalizationCatalog>>(), fog: new RereleaseFog(), fogReceived: false, story: "" }));
  }

  receive(events: readonly SimulationPresentationEvent[]): void {
    for (const source of events) {
      if (source.kind === "q2-player" && source.event.kind === "userinfo") this.pending.push(source);
      if (source.kind !== "q2-rerelease") continue;
      const event = source.event;
      if (event.kind === "fog") { for (const seat of this.seats) if (seat.binding.actor.equals(event.actor)) { seat.fog.receive(event.value, event.transitionMilliseconds, source.seconds); seat.fogReceived = true; } }
      else if (event.kind === "story" || event.kind === "localized-print" || event.kind === "sky") this.pending.push(source);
    }
  }

  private catalog(seat: SeatState, content: ContentId): Promise<LocalizationCatalog> {
    const existing = seat.catalogs.get(content); if (existing !== undefined) return existing;
    const pending = (async (): Promise<LocalizationCatalog> => {
      const provider = await this.assets.provider(content), language = seat.binding.language ?? "english", path = `localization/loc_${language}.txt`;
      const [primary, english] = await Promise.all([provider.mounts.open(path), language === "english" ? Promise.resolve(null) : provider.mounts.open("localization/loc_english.txt")]);
      const result = new LocalizationCatalog(seat.binding.seat, "q2-rerelease"); result.loadOrdered({ base: primary?.bytes ?? null, mods: [] }, { base: english?.bytes ?? null, mods: [] }); return result;
    })();
    seat.catalogs.set(content, pending); return pending;
  }

  private skyImages(content: ContentId, name: string): Promise<readonly RendererImage[]> {
    let cache = this.skies.get(content); if (cache === undefined) { cache = new Map<string, Promise<readonly RendererImage[]>>(); this.skies.set(content, cache); }
    const existing = cache.get(name); if (existing !== undefined) return existing;
    const pending = this.loadSkyImages(this.assets, content, name);
    cache.set(name, pending); return pending;
  }

  private async loadSkyImages(providers: Pick<ApplicationAssets, "provider">, content: ContentId, name: string): Promise<readonly RendererImage[]> {
      const provider = await providers.provider(content), images: RendererImage[] = [];
      for (const suffix of SKY_FACE_SUFFIXES) {
        const image = await provider.textures.load(`env/${name}${suffix}`, { family: "q2", wrap: "clamp", mipmap: false, usage: "sky" });
        images.push((image ?? provider.textures.missing).image);
      }
      return images;
  }

  async prepare(): Promise<void> {
    for (const source of this.pending.splice(0)) {
      if (source.kind === "q2-player") { if (source.event.kind === "userinfo") this.names.set(source.event.slot, source.event.name); continue; }
      const event = source.event;
      if (event.kind === "sky") { this.skySource = { content: source.content, name: event.name }; this.sky = { images: await this.skyImages(source.content, event.name), rotation: event.rotation, autoRotate: event.rotation !== 0 && event.autoRotate, axis: { ...event.axis } }; continue; }
      if (event.kind !== "story" && event.kind !== "localized-print") continue;
      for (const seat of this.seats) {
        if (event.kind === "localized-print" && event.actor !== null && !seat.binding.actor.equals(event.actor)) continue;
        const catalog = await this.catalog(seat, source.content), text = q2PlayerNameTokens(catalog.localize(event.text, event.kind === "localized-print" ? event.args : []), this.names);
        if (event.kind === "story") seat.story = text;
        else this.prints.push({ kind: "q2-player", content: source.content, seconds: source.seconds, sequence: source.sequence,
          ...(source.sourceEntity === undefined ? {} : { sourceEntity: source.sourceEntity }), event: { kind: "print", target: seat.binding.actor, level: event.level, text } });
      }
    }
  }

  drainPrints(): readonly SimulationPresentationEvent[] { return this.prints.splice(0); }
  storyActive(actor: ActorId): boolean { return this.seats.some(seat => seat.binding.actor.equals(actor) && seat.story !== ""); }
  view(actor: ActorId, seconds: number): Pick<WorldViewInput, "q2Fog"> & { readonly q2Sky?: RereleaseSkyView } {
    const seat = this.seats.find(seat => seat.binding.actor.equals(actor));
    return { ...(seat?.fogReceived ? { q2Fog: seat.fog.current(seconds) } : {}), ...(this.sky === null ? {} : { q2Sky: this.sky }) };
  }
  drawStory(actor: ActorId, draw: Draw2D, text: SeatTextPresentation, scale: number): void {
    const seat = this.seats.find(seat => seat.binding.actor.equals(actor)); if (seat === undefined || seat.story === "") return;
    if (!text.seat.equals(seat.binding.seat)) throw new Error("Story font belongs to another seat");
    const options = { text: seat.story, scale, color: { x: 1, y: 1, z: 1, w: 1 }, align: "center" } satisfies Parameters<SeatTextPresentation["layout"]>[0];
    const layout = text.layout(options); text.draw(draw, { ...options, maxWidth: Math.max(1, layout.width) }, { x: (draw.width - layout.width) / 2, y: (draw.height - layout.height) / 2 }, scale);
  }
}
