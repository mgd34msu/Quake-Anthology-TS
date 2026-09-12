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

export function drawWeaponHud(data: CommonWeaponHud, rect: Rect, skin: UiSkin, textScale: number): readonly UiDrawCommand[] {
  const ammo = data.status.ammo, unavailable = ammo.kind === "finite" && !ammo.hasAmmoToStart;
  const activeWarning = data.status.source.provider.startsWith("q3:") ? null : unavailable ? "NO AMMO" : ammo.kind === "finite" && ammo.low ? "LOW AMMO" : null;
  const warning = data.warning === "empty" ? "OUT OF AMMO" : data.warning === "low" ? "LOW AMMO WARNING" : activeWarning;
  const color = warning === null && !unavailable ? skin.colors.text : skin.colors.accent;
  const commands: UiDrawCommand[] = [{ kind: "fill", rect, color: skin.colors.panel }];
  const icon = data.weaponIcon ?? data.ammoIcon;
  const aspect = data.iconAspect ?? 1, maxWidth = warning === null ? 48 : 30, maxHeight = warning === null ? 32 : 20;
  const width = Math.min(maxWidth, maxHeight * aspect), height = width / aspect;
  if (icon !== null) commands.push({ kind: "image", resource: icon, rect: { x: rect.x + 4 + (48 - width) / 2, y: rect.y + 5, width, height },
    texCoords: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: { x: 1, y: 1, z: 1, w: 1 } });
  const x = rect.x + (icon === null ? 8 : 58);
  if (ammo.kind === "finite") commands.push({ kind: "text", origin: { x, y: rect.y + 4 }, text: String(ammo.count),
    font: skin.font, scale: textScale * 1.5, color, align: "left", shadow: true });
  if (warning !== null || icon === null) {
    const text = warning ?? data.status.label, left = warning === null ? x : rect.x + 4;
    const width = data.measureText?.(text, 1) ?? Array.from(text).length * 8;
    const scale = Math.min(textScale * 0.9, (rect.x + rect.width - 4 - left) / Math.max(1, width));
    commands.push({ kind: "text", origin: { x: left, y: rect.y + 25 }, text,
      font: skin.font, scale, color, align: "left", shadow: true });
  }
  const ammoAspect = data.ammoAspect ?? 1, ammoWidth = Math.min(18, 18 * ammoAspect);
  if (data.ammoIcon !== null && data.weaponIcon !== null && ammo.kind === "finite") commands.push({ kind: "image", resource: data.ammoIcon,
    rect: { x: rect.x + rect.width - 22, y: rect.y + 4, width: ammoWidth, height: ammoWidth / ammoAspect },
    texCoords: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: { x: 1, y: 1, z: 1, w: 1 } });
  return commands;
}
