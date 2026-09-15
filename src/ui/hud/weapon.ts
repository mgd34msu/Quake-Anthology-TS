import type { ResourceId } from "../../contracts/content.ts";
import type { Rect } from "../../contracts/render.ts";
import type { ArsenalAmmoWarning, UiDrawCommand, WeaponHudStatus } from "../../contracts/ui.ts";
import type { UiSkin } from "../common/skin.ts";

export interface CommonWeaponHud {
  readonly status: WeaponHudStatus;
  readonly warning: ArsenalAmmoWarning;
  readonly weaponIcon: ResourceId | null;
  readonly ammoIcon: ResourceId | null;
  readonly iconAspect?: number;
  readonly ammoAspect?: number;
  readonly nativeStatus: boolean;
  readonly measureText?: (text: string, scale: number) => number;
}

export function hudStatusRows(textScale: number, capHeight = 8): { readonly labelTop: number; readonly height: number } {
  const labelTop = Math.max(25, 4 + capHeight * textScale * 1.5 + 4);
  return { labelTop, height: Math.max(42, Math.ceil(labelTop + capHeight * textScale * 0.9 + 4)) };
}

export function drawWeaponHud(data: CommonWeaponHud, rect: Rect, skin: UiSkin, textScale: number, minimumTextScale = 0): readonly UiDrawCommand[] {
  const ammo = data.status.ammo, unavailable = ammo.kind === "finite" && !ammo.hasAmmoToStart;
  const activeWarning = data.status.source.provider.startsWith("q3:") ? null : unavailable ? "NO AMMO" : ammo.kind === "finite" && ammo.low ? "LOW AMMO" : null;
  const warning = data.warning === "empty" ? "OUT OF AMMO" : data.warning === "low" ? "LOW AMMO WARNING" : activeWarning;
  const color = warning === null && !unavailable ? skin.colors.text : skin.colors.accent;
  if (minimumTextScale > 0 && rect.height === 32) {
    const scale = minimumTextScale, top = (skin.capInk?.top ?? 0) * scale;
    const commands: UiDrawCommand[] = [{ kind: "fill", rect, color: skin.colors.panel }];
    const icon = data.weaponIcon ?? data.ammoIcon;
    if (icon !== null) commands.push({ kind: "image", resource: icon, rect: { x: rect.x + 4, y: rect.y + 4, width: 24, height: 24 / (data.iconAspect ?? 1) },
      texCoords: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: { x: 1, y: 1, z: 1, w: 1 } });
    const left = rect.x + (icon === null ? 4 : 32), available = rect.x + rect.width - 4 - left;
    const labels = [ammo.kind === "finite" ? String(ammo.count) : icon === null ? data.status.label : "", warning === "LOW AMMO WARNING" ? "LOW AMMO" : warning ?? ""];
    for (const [row, label] of labels.entries()) {
      const chars = Array.from(label);
      while (chars.length > 0 && (data.measureText?.(chars.join(""), scale) ?? chars.length * 8 * scale) > available) chars.pop();
      if (chars.length > 0) commands.push({ kind: "text", origin: { x: left, y: rect.y + 4 + row * 14 - top }, text: chars.join(""), font: skin.font, scale, color, align: "left", shadow: true });
    }
    return commands;
  }
  const rows = hudStatusRows(textScale, skin.capInk?.height);
  const top = skin.capInk?.top ?? 0;
  const commands: UiDrawCommand[] = [{ kind: "fill", rect, color: skin.colors.panel }];
  const icon = data.weaponIcon ?? data.ammoIcon;
  const numberWidth = ammo.kind === "finite" ? data.measureText?.(String(ammo.count), textScale * 1.5) ?? String(ammo.count).length * 8 * textScale * 1.5 : 0;
  const secondaryIcon = data.ammoIcon !== null && data.weaponIcon !== null && ammo.kind === "finite";
  const stackedIcon = icon !== null && numberWidth > rect.width - (secondaryIcon ? 84 : 66);
  const aspect = data.iconAspect ?? 1, maxWidth = warning === null ? 48 : 30, maxHeight = warning === null ? 32 : 20;
  const width = Math.min(stackedIcon ? 24 : maxWidth, (stackedIcon ? Math.min(24, rect.height - rows.labelTop - 4) : maxHeight) * aspect), height = width / aspect;
  if (icon !== null) commands.push({ kind: "image", resource: icon, rect: { x: rect.x + 4 + ((stackedIcon ? 24 : 48) - width) / 2, y: rect.y + (stackedIcon ? rows.labelTop : 5), width, height },
    texCoords: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: { x: 1, y: 1, z: 1, w: 1 } });
  const x = rect.x + (icon === null || stackedIcon ? 8 : 58);
  if (ammo.kind === "finite") {
    const value = String(ammo.count), available = rect.x + rect.width - (secondaryIcon && !stackedIcon ? 26 : 8) - x;
    const scale = Math.min(textScale * 1.5, available / Math.max(1, data.measureText?.(value, 1) ?? value.length * 8));
    commands.push({ kind: "text", origin: { x, y: rect.y + 4 - top * scale }, text: value,
      font: skin.font, scale, color, align: "left", shadow: true });
  }
  if (warning !== null || icon === null) {
    const original = warning ?? data.status.label, left = stackedIcon ? rect.x + 32 : warning === null ? x : rect.x + 4;
    const available = rect.x + rect.width - (stackedIcon && secondaryIcon ? 26 : 4) - left;
    const text = warning === "LOW AMMO WARNING" && (data.measureText?.(original, 1) ?? original.length * 8) * minimumTextScale > available ? "LOW AMMO" : original;
    const width = data.measureText?.(text, 1) ?? Array.from(text).length * 8;
    const scale = Math.max(minimumTextScale, Math.min(textScale * 0.9, available / Math.max(1, width)));
    const measure = (value: string): number => (data.measureText?.(value, 1) ?? Array.from(value).length * 8) * scale;
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      const next = line === "" ? word : `${line} ${word}`;
      if (line !== "" && measure(next) > available) { lines.push(line); line = word; } else line = next;
    }
    if (line !== "") lines.push(line);
    const maximumLines = Math.max(1, Math.floor((rect.height - rows.labelTop - 4) / ((skin.capInk?.height ?? 8) * scale)));
    for (const [index, value] of lines.slice(0, maximumLines).entries()) {
      let visible = value;
      const truncated = index === maximumLines - 1 && lines.length > maximumLines || measure(visible) > available;
      if (truncated) {
        const characters = Array.from(visible);
        while (characters.length > 0 && measure(characters.join("") + "…") > available) characters.pop();
        visible = characters.join("") + "…";
      }
      commands.push({ kind: "text", origin: { x: left, y: rect.y + rows.labelTop + index * 8 * scale - top * scale }, text: visible,
        font: skin.font, scale, color, align: "left", shadow: true });
    }
  }
  const ammoAspect = data.ammoAspect ?? 1, ammoWidth = Math.min(18, 18 * ammoAspect);
  if (data.ammoIcon !== null && data.weaponIcon !== null && ammo.kind === "finite") commands.push({ kind: "image", resource: data.ammoIcon,
    rect: { x: rect.x + rect.width - 22, y: rect.y + (stackedIcon ? rows.labelTop : 4), width: ammoWidth, height: ammoWidth / ammoAspect },
    texCoords: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: { x: 1, y: 1, z: 1, w: 1 } });
  return commands;
}
