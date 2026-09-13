import type { ConfigStore } from "../../settings/config.ts";
import type { SettingBinding } from "../../ui/settings/index.ts";

/** A user preference supplies the ordinary view; game cameras retain their own FOV. */
export class ApplicationViewSettings {
  private selected: number | null = null;
  constructor(private readonly changed: (value: number) => void) {}
  get fieldOfView(): number { return this.selected ?? 90; }
  get override(): number | null { return this.selected; }
  setFieldOfView(value: number): void {
    if (!Number.isFinite(value) || value < 60 || value > 160) throw new RangeError("Field of view must be between 60 and 160 degrees");
    this.selected = value;
    this.changed(value);
  }
  binding(): SettingBinding {
    const settings = this;
    return { id: "ui:view:field-of-view", get label() { return `Field of view (${settings.fieldOfView})`; }, category: "display", kind: "slider", enabled: () => true,
      minimum: 60, maximum: 160, step: 5, read: () => this.fieldOfView, write: value => this.setFieldOfView(value) };
  }
  async load(store: ConfigStore): Promise<void> {
    const text = await store.loadText("view.json"); if (text === null) return;
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1
      || !("fieldOfView" in value) || typeof value.fieldOfView !== "number") throw new Error("Invalid view preferences");
    this.setFieldOfView(value.fieldOfView);
  }
  async save(store: ConfigStore): Promise<void> {
    if (this.selected !== null) await store.dump("view.json", JSON.stringify({ version: 1, fieldOfView: this.selected }) + "\n");
  }
}
