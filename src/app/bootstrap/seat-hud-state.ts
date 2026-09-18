import type { ContentId, ResourceId } from "../../contracts/content.ts";
import type { Vec3, Vec4 } from "../../contracts/math.ts";
import type { ApplicationWeaponHudAssets } from "./weapon-hud.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { CommonHudData, HudHealthBar, HudHelp, HudPrompt, HudInventoryItem, HudPointOfInterest, HudDamageIndicator } from "../../ui/hud/index.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";

type HudAssets = Pick<ApplicationWeaponHudAssets, "load" | "picture"> & { readonly assets: { provider(content: ContentId): Promise<Pick<Awaited<ReturnType<ApplicationWeaponHudAssets["assets"]["provider"]>>, "palette">> } };

/** State addressed to one local actor; source events remain authoritative. */
export class SeatSourceHud {
  private readonly pending: SimulationPresentationEvent[] = [];
  private readonly objectivePrints: { readonly text: string; readonly seconds: number }[] = [];
  drainObjectivePrints(): readonly { readonly text: string; readonly seconds: number }[] { return this.objectivePrints.splice(0); }
  private objective = "";
  private missionVisible = false;
  private readonly bars = new Map<number, HudHealthBar>();
  private readonly helpText = new Map<number, string>();
  private helpVisible = false;
  private inventory: readonly HudInventoryItem[] | null = null;
  private scoresHeld = false;
  private scoreVisible = false;
  private scoreRows: readonly string[] = [];
  private readonly clients = new Map<number, { readonly name: string; readonly frags: number; readonly team: number; readonly observer: boolean }>();
  private report: { readonly lines: readonly string[]; readonly ready: number } | null = null;
  private readonly pois: { readonly key: number; readonly flags: number; width: number; height: number; readonly content: ContentId; readonly path: string; image: ResourceId | null; readonly origin: Vec3; readonly expiresMilliseconds: number; readonly color: number; tint: Vec4 }[] = [];
  private path: { readonly origin: Vec3; readonly direction: Vec3; readonly expiresMilliseconds: number } | null = null;
  inventoryItems(): readonly HudInventoryItem[] | null { return this.inventory; }
  scores(down: boolean): void { this.scoresHeld = down; }
  private flags = 0;
  private runeItems = 0;
  private helpComputer: HudHelp | null = null;
  private red = 0;
  private blue = 0;
  private ctf = false;
  private pickup: { readonly name: string; readonly path: string; readonly content: ContentId; icon: ResourceId | null; readonly expiresMilliseconds: number } | null = null;
  private readonly damage: HudDamageIndicator[] = [];
  private damagePicture: { readonly content: ContentId; image: ResourceId | null; width: number; height: number } | null = null;
  private capture = "";
  private captureUntil = 0;
  constructor(private readonly actor: ActorId, private readonly localize?: (content: ContentId, text: string, args?: readonly string[]) => Promise<string>) {}

  async prepare(icons: HudAssets): Promise<void> {
    for (const source of this.pending.splice(0)) {
      if (source.kind !== "q2-rerelease" || this.localize === undefined) { this.apply(source); continue; }
      const event = source.event;
      if (event.kind === "healthbar") this.apply({ ...source, event: { ...event, name: await this.localize(source.content, event.name) } });
      else if (event.kind === "help-computer") this.apply({ ...source, event: { ...event, primary: await this.localize(source.content, event.primary), secondary: await this.localize(source.content, event.secondary) } });
      else if (event.kind === "mission-objective") this.apply({ ...source, event: { ...event, text: await this.localize(source.content, event.text, event.args), args: [] } });
      else this.apply(source);
    }
    for (const poi of this.pois) if (poi.image === null) {
      poi.image = await icons.load({ kind: "image", resource: { content: poi.content, path: `pics/${poi.path}.pcx` } });
      const picture = icons.picture(poi.image);
      if (picture?.kind === "image") { poi.width = picture.image.width; poi.height = picture.image.height; }
      const palette = (await icons.assets.provider(poi.content)).palette;
      if (palette !== null) poi.tint = { x: (palette.colors[poi.color * 3] ?? 255) / 255, y: (palette.colors[poi.color * 3 + 1] ?? 255) / 255, z: (palette.colors[poi.color * 3 + 2] ?? 255) / 255, w: 1 };
    }
    const damagePicture = this.damagePicture;
    if (damagePicture !== null && damagePicture.image === null) {
      damagePicture.image = await icons.load({ kind: "image", resource: { content: damagePicture.content, path: "pics/damage_indicator.pcx" } });
      const picture = icons.picture(damagePicture.image);
      if (picture?.kind === "image") { damagePicture.width = picture.image.width; damagePicture.height = picture.image.height; }
    }
    const pickup = this.pickup;
    if (pickup !== null && pickup.icon === null && pickup.path !== "") pickup.icon = await icons.load({ kind: "image", resource: { content: pickup.content, path: `pics/${pickup.path}.pcx` } });
  }
  points(): readonly HudPointOfInterest[] {
    return this.pois.flatMap(poi => poi.image === null ? [] : [{ id: poi.key, origin: poi.origin, image: poi.image, width: poi.width, height: poi.height,
      color: poi.tint, hideOnAim: (poi.flags & 1) !== 0, expiresMilliseconds: poi.expiresMilliseconds }]);
  }
  receive(source: SimulationPresentationEvent): void {
    if (this.localize !== undefined && source.kind === "q2-rerelease" && (source.event.kind === "healthbar" || source.event.kind === "help-computer" || source.event.kind === "mission-objective")) this.pending.push(source);
    else this.apply(source);
  }
  private apply(source: SimulationPresentationEvent): void {
    if (source.kind === "q2" && source.event.kind === "pickup" && source.event.player.equals(this.actor))
      this.pickup = { name: source.event.name, content: source.content, path: source.event.icon, icon: null, expiresMilliseconds: source.seconds * 1000 + 3000 };
    if (source.kind === "q2" && source.event.kind === "damage-indicator" && source.event.actor.equals(this.actor)) {
      this.damage.push({ origin: source.event.origin, amount: source.event.amount, expiresMilliseconds: source.seconds * 1000 + 800 });
      if (this.damage.length > 8) this.damage.shift();
    }
    if (source.kind === "q2" && source.event.kind === "help") this.helpText.set(source.event.slot, source.event.text);
    if (source.kind === "q2-player" && source.event.kind === "inventory" && source.event.actor.equals(this.actor)) {
      const event = source.event;
      this.inventory = event.visible === false ? null : event.entries.filter(entry => entry.count > 0).map(entry => ({ id: entry.item,
        label: event.labels?.find(label => label.item === entry.item)?.name ?? entry.item.replace(/^q2:/u, "").replaceAll("_", " "), count: entry.count, selected: entry.item === event.selected, binding: null, icon: null }));
      if (this.inventory !== null) this.helpVisible = false;
    }
    if (source.kind === "q2-player" && source.event.kind === "help" && source.event.actor.equals(this.actor)) { this.helpVisible = source.event.visible; if (this.helpVisible) { this.inventory = null; this.scoreVisible = false; } }
    if (source.kind === "q2-player" && source.event.kind === "view" && source.event.actor.equals(this.actor)) {
      if ((source.event.view.layouts & 2) === 0) this.inventory = null;
      else if (this.inventory !== null) { const selected = source.event.view.selectedItem; this.inventory = this.inventory.map(item => ({ ...item, selected: item.id === selected })); }
      if ((source.event.view.layouts & 1) === 0) { this.helpVisible = false; this.scoreVisible = false; }
    }
    if (source.kind === "q2-player" && source.event.kind === "scoreboard" && source.event.actor.equals(this.actor)) {
      this.scoreRows = source.event.rows.map(row => `${row.score}  ${row.name}  ${row.ping}ms  ${row.minutes}m${row.spectator ? "  Spectator" : ""}`);
      this.scoreVisible = true; this.helpVisible = false; this.inventory = null;
    }
    if (source.kind === "q2-rerelease") {
      const event = source.event;
      if (event.kind === "mission-objective" && event.actor.equals(this.actor)) { this.objective = event.text; this.objectivePrints.push({ text: event.text, seconds: source.seconds }); }
      if (event.kind === "mission-status" && event.actor.equals(this.actor)) this.missionVisible = event.iconVisible;
      if ((event.kind === "poi" || event.kind === "keyed-poi") && event.actor.equals(this.actor)) {
        const key = event.kind === "poi" ? 1 : event.key, now = source.seconds * 1000;
        let index = key === 0 ? -1 : this.pois.findIndex(poi => poi.key === key);
        if (index < 0) index = this.pois.findIndex(poi => poi.expiresMilliseconds <= now);
        if (index < 0 && this.pois.length < 32) index = this.pois.length;
        if (index < 0) {
          let oldest = Infinity;
          for (const [candidate, poi] of this.pois.entries()) if (poi.key === 0 && poi.expiresMilliseconds < oldest) { oldest = poi.expiresMilliseconds; index = candidate; }
        }
        if (index >= 0) this.pois[index] = { key, width: 32, height: 32, flags: event.kind === "poi" ? 1 : event.flags, content: source.content, path: event.image, image: null, origin: event.position, color: event.color & 255, tint: { x: 1, y: 1, z: 1, w: 1 }, expiresMilliseconds: now + event.duration };
      }
      if (event.kind === "remove-poi" && event.actor.equals(this.actor) && event.key !== 0) {
        const index = this.pois.findIndex(poi => poi.key === event.key); if (index >= 0) this.pois.splice(index, 1);
      }
      if (event.kind === "directional-damage" && event.actor.equals(this.actor)) {
        if (this.damagePicture?.content !== source.content) this.damagePicture = { content: source.content, image: null, width: 0, height: 0 };
        const now = source.seconds * 1000, direction = event.direction;
        let index = this.damage.findIndex(value => value.expiresMilliseconds <= now || "direction" in value && value.direction.x * direction.x + value.direction.y * direction.y + value.direction.z * direction.z >= 0.95);
        if (index < 0) index = this.damage.length < 32 ? this.damage.length : 0;
        const previous = this.damage[index];
        const retain = previous !== undefined && previous.expiresMilliseconds > now && "direction" in previous && previous.direction.x * direction.x + previous.direction.y * direction.y + previous.direction.z * direction.z >= 0.95 ? previous : null;
        const normalize = (value: Vec3): Vec3 => { const length = Math.hypot(value.x, value.y, value.z) || 1; return { x: value.x / length, y: value.y / length, z: value.z / length }; };
        const color = normalize({ x: Number(event.health) + Number(event.armor), y: Number(event.shield) + Number(event.armor), z: Number(event.armor) });
        this.damage[index] = { direction, amount: event.damage + (retain?.amount ?? 0), color: normalize({ x: color.x + (retain?.color.x ?? 0), y: color.y + (retain?.color.y ?? 0), z: color.z + (retain?.color.z ?? 0) }), health: event.health || (retain?.health ?? false), armor: event.armor || (retain?.armor ?? false), shield: event.shield || (retain?.shield ?? false), expiresMilliseconds: now + 1000 };
      }
      if (event.kind === "help-path" && event.actor.equals(this.actor)) this.path = { origin: event.position, direction: event.direction, expiresMilliseconds: source.seconds * 1000 + 10000 };
      if (event.kind === "end-of-unit") this.report = { ready: event.buttonTime * 1000, lines: [...event.levels].sort((a,b) => a.visitOrder - b.visitOrder).map(level => `${level.name || level.map}: ${level.killedMonsters}/${level.totalMonsters} kills  ${level.foundSecrets}/${level.totalSecrets} secrets  ${Math.floor(level.time / 60)}:${String(Math.floor(level.time % 60)).padStart(2, "0")}`) };
      if (event.kind === "healthbar" && event.actor.equals(this.actor)) {
        if (!event.visible) this.bars.delete(event.slot);
        else this.bars.set(event.slot, { id: `boss:${event.slot}`, label: event.name, value: event.fraction, maximum: 1, color: { x: 0.8, y: 0.12, z: 0.08, w: 1 } });
      }
      if (event.kind === "help-computer" && event.actor.equals(this.actor)) {
        this.helpVisible = event.visible; if (event.visible) { this.inventory = null; this.scoreVisible = false; }
        this.helpComputer = { title: "Help computer", lines: [event.primary, event.secondary].filter(text => text !== ""), objectives: [] };
      }
    }
    if (source.kind === "q1-composition") {
      const event = source.event;
      if (event.kind === "client") this.clients.set(event.client.slot, event.client);
      if (event.kind === "client-left") this.clients.delete(event.slot);
      if (event.kind === "ctf-status" && event.actor.equals(this.actor)) {
        this.ctf = true; this.red = event.status.red; this.blue = event.status.blue; this.flags = event.status.flags; this.runeItems = event.status.runeItems;
      }
      if (event.kind === "ctf-capture") {
        this.ctf = true;
        if (event.team === "red") this.red = event.total; else this.blue = event.total;
        this.capture = `${event.team === "red" ? "Red" : "Blue"} captured the flag`;
        this.captureUntil = source.seconds * 1000 + 3000;
      }
    }
  }

  presentation(nowMilliseconds: number): Pick<CommonHudData, "healthBars" | "help" | "prompts" | "inventory" | "pickup" | "damageIndicators" | "helpPath"> {
    const prompts: HudPrompt[] = this.ctf ? [{ action: `Red ${this.red} - Blue ${this.blue}`, binding: "", icon: null }] : [];
    if (this.missionVisible && this.objective !== "") prompts.push({ action: "New objective", binding: "", icon: null });
    if (this.ctf) {
      const flag = (bits: number): string => (bits & 4) !== 0 ? "dropped" : (bits & 2) !== 0 ? "carried" : "home";
      prompts.push({ action: `Red flag ${flag(this.flags & 7)} - Blue flag ${flag((this.flags >> 3) & 7)}`, binding: "", icon: null });
      for (const [bit, label] of [[32, "Resistance"], [64, "Strength"], [128, "Haste"], [256, "Regeneration"]] satisfies readonly (readonly [number, string])[]) {
        if ((this.runeItems & bit) !== 0) prompts.push({ action: label, binding: "", icon: null });
      }
    }
    if (this.captureUntil > nowMilliseconds) prompts.push({ action: this.capture, binding: "", icon: null });
    const scores = this.scoreVisible ? this.scoreRows : this.scoresHeld && this.clients.size > 0 ? [...this.clients.values()].sort((a,b) => b.frags - a.frags).map(client => `${client.frags}  ${client.name}${client.team === 0 ? "" : `  Team ${client.team}`}${client.observer ? "  Spectator" : ""}`) : null;
    return { helpPath: this.path !== null && this.path.expiresMilliseconds > nowMilliseconds ? this.path : null, pickup: this.pickup, damageIndicators: this.damage.filter(damage => damage.expiresMilliseconds > nowMilliseconds).map(damage => "direction" in damage && this.damagePicture !== null && this.damagePicture.image !== null && this.damagePicture.width > 0 ? { ...damage, picture: { image: this.damagePicture.image, width: this.damagePicture.width, height: this.damagePicture.height } } : damage), inventory: this.inventory, healthBars: [...this.bars.entries()].sort(([a], [b]) => a - b).map(([, bar]) => bar),
      help: this.report !== null ? { title: "Unit complete", lines: this.report.lines, objectives: [{ text: nowMilliseconds >= this.report.ready ? "Press attack to continue" : "", complete: false }] } : scores !== null ? { title: "Scores", lines: scores, objectives: [] } : this.helpVisible ? this.helpComputer ?? { title: "Help computer", lines: [...this.helpText.entries()].sort(([a], [b]) => a - b).map(([, text]) => text), objectives: [] } : null,
      prompts };
  }
}
