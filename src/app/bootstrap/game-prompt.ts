import { loadLocalizationResources } from "../../text/localization-resources.ts";
import type { ActorId, SeatId } from "../../contracts/identity.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { SeatInputEvent, SeatInputFocus, UiControl } from "../../contracts/ui.ts";
import type { Q1CompositionEvent } from "../../content/composition/q1/types.ts";
import { NativeUiController, menuRow } from "../../ui/common/index.ts";
import type { LocalizationCatalog } from "../../text/localization.ts";
import type { ApplicationAssets } from "./assets.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";

export const gamePromptMenu = "menu:application:prompt";
type Prompt = Extract<Q1CompositionEvent, { readonly kind: "prompt" }>;
interface PendingPrompt { readonly content: ContentId; readonly value: Prompt; }

export class SeatGamePrompt {
  private pending: PendingPrompt | null = null;
  private prepared: PendingPrompt | null = null;
  private preparedLanguage = "";
  private title = "";
  private page = 0;
  private choices: Prompt["choices"] = [];
  private readonly catalogs = new Map<string, Promise<LocalizationCatalog>>();
  private readonly unregister: () => void;

  constructor(private readonly seat: SeatId, private readonly actor: () => ActorId,
    private readonly controller: NativeUiController, private readonly impulse: (value: number) => void, private readonly language: () => string = () => "english") {
    this.unregister = controller.register(gamePromptMenu, () => ({ id: gamePromptMenu, title: this.title, fullScreen: false,
      controls: this.controls(), open: () => undefined, close: () => undefined }));
  }

  private controls(): readonly UiControl[] {
    const first = this.page * 4;
    const controls: UiControl[] = this.choices.slice(first, first + 4).map((choice, row) => ({ kind: "button", id: `ui:game-prompt:${first + row}`,
      label: `${first + row + 1}. ${choice.label}`, rect: menuRow(row, { y: 220, height: 44 }), enabled: true, visible: true,
      activate: () => { this.choose(first + row); return undefined; } }));
    if (this.choices.length > 4) {
      controls.push({ kind: "button", id: "ui:game-prompt:previous", label: "Previous", rect: menuRow(0, { y: 408, width: 248 }), enabled: this.page > 0, visible: true,
        activate: () => { this.page--; return undefined; } },
      { kind: "button", id: "ui:game-prompt:next", label: `Next (${this.page + 1}/${Math.ceil(this.choices.length / 4)})`,
        rect: menuRow(0, { x: 328, y: 408, width: 248 }), enabled: first + 4 < this.choices.length, visible: true,
        activate: () => { this.page++; return undefined; } });
    }
    return controls;
  }

  receive(events: readonly SimulationPresentationEvent[]): void {
    for (const source of events) {
      if (source.kind !== "q1-composition") continue;
      const event = source.event.kind === "addon" ? source.event.event : source.event;
      if ((event.kind !== "prompt" && event.kind !== "clear-prompt") || !event.actor.equals(this.actor())) continue;
      if (event.kind === "clear-prompt") this.clear();
      else this.pending = { content: source.content, value: event };
    }
  }

  private catalog(content: ContentId, language: string, assets: Pick<ApplicationAssets, "provider">): Promise<LocalizationCatalog> {
    const key = `${content}:${language}`;
    const found = this.catalogs.get(key); if (found !== undefined) return found;
    const pending = (async () => {
      const provider = await assets.provider(content);
      return loadLocalizationResources(this.seat, language, async path => (await provider.mounts.open(path))?.bytes ?? null);
    })();
    this.catalogs.set(key, pending); return pending;
  }

  async prepare(assets: Pick<ApplicationAssets, "provider">, focus: () => SeatInputFocus): Promise<void> {
    const pending = this.pending, language = this.language();
    if (pending !== null && !pending.value.actor.equals(this.actor())) { this.clear(); return; }
    if (pending !== null && (pending !== this.prepared || language !== this.preparedLanguage)) {
      const catalog = await this.catalog(pending.content, language, assets);
      if (this.language() !== language || this.pending !== pending || !pending.value.actor.equals(this.actor())) return;
      this.page = 0;
      this.title = catalog.localize(pending.value.title);
      this.choices = pending.value.choices.map(choice => ({ ...choice, label: catalog.localize(choice.label) }));
      this.prepared = pending; this.preparedLanguage = language;
    }
    if (this.pending !== null && focus().kind === "game") this.controller.openMenu(gamePromptMenu);
    if (this.pending === null && this.controller.activeMenu === gamePromptMenu) this.controller.closeMenu();
  }

  input(event: SeatInputEvent): boolean {
    if (!event.seat.equals(this.seat) || this.controller.activeMenu !== gamePromptMenu) return false;
    if (event.kind === "key" && event.code >= 49 && event.code <= 57) {
      if (event.down && !event.repeat) this.choose(event.code - 49);
      return true;
    }
    return false;
  }

  private choose(index: number): void {
    if (this.pending === null || this.pending !== this.prepared || !this.pending.value.actor.equals(this.actor())) return;
    const choice = this.choices[index]; if (choice === undefined) return;
    this.clear();
    this.impulse(choice.impulse);
  }

  clear(): void {
    this.pending = null; this.prepared = null; this.title = ""; this.page = 0; this.choices = [];
    if (this.controller.activeMenu === gamePromptMenu) this.controller.closeMenu();
  }
  close(): void { this.clear(); this.unregister(); this.catalogs.clear(); }
}
