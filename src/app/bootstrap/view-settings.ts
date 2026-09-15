import type { ConfigStore } from "../../settings/config.ts";
import type { SettingBinding } from "../../ui/settings/index.ts";
import { CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";
import { validateFieldOfView } from "./shared-setting-cvars.ts";

/** A user preference supplies the ordinary view; game cameras retain their own FOV. */
export class ApplicationViewSettings {
  private selected: number | null = null;
  private cvars: CvarRegistry | null = null;
  private explicit = false;
  constructor(private readonly changed: (value: number) => void) {}
  get fieldOfView(): number { return this.cvars === null ? this.selected ?? 90 : Number(this.cvars.variableString("fov")); }
  get override(): number | null { return this.explicit ? this.fieldOfView : null; }
  bindCvars(cvars: CvarRegistry): () => void {
    if (this.cvars !== null) throw new Error("View settings already have a cvar owner");
    const existing = cvars.find("fov"), stored = existing !== undefined && existing.value !== "90" && validateFieldOfView(existing.value) === null;
    if (!cvars.dialect.startsWith("q1") || existing === undefined || existing.resetValue !== "90") cvars.register("fov", "90", CvarFlag.Archive);
    if (validateFieldOfView(cvars.variableString("fov")) !== null) cvars.set("fov", "90", true);
    if (!stored && this.selected !== null) cvars.set("fov", String(this.selected));
    this.cvars = cvars; this.selected = null;
    this.explicit ||= stored && Number(cvars.variableString("fov")) !== 90;
    const remove = cvars.bindValue("fov", { validate: validateFieldOfView, changed: value => {
      this.explicit = true; this.changed(Number(value));
    } });
    cvars.document("fov", { summary: "Shared field-of-view preference in degrees. Game zoom and special cameras retain control.",
      usage: "fov [degrees]", examples: ["fov 120", "set fov 90"], allowedValues: ["60 through 160"] });
    return () => { remove(); this.selected = this.fieldOfView; this.cvars = null; };
  }
  setFieldOfView(value: number): void {
    if (!Number.isFinite(value) || value < 60 || value > 160) throw new RangeError("Field of view must be between 60 and 160 degrees");
    this.explicit = true;
    if (this.cvars === null) { this.selected = value; this.changed(value); }
    else this.cvars.set("fov", String(value));
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
    if (this.explicit) await store.dump("view.json", JSON.stringify({ version: 1, fieldOfView: this.fieldOfView }) + "\n");
  }
}
