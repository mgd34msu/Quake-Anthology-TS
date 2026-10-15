import type { ResourceId } from "../../contracts/content.ts";
import type { UiDrawCommand, UiDrawContext } from "../../contracts/ui.ts";
import type { UiSkin } from "./skin.ts";
import { fitUi, transformUi } from "./layout.ts";

export const menuTitleFont: ResourceId = "resource:engine-menu:title";
/**
 * The frontend type scale. Every text draw in the startup menu uses one of
 * these sizes; body matches the controller skin so custom-drawn text and
 * control text render at the same size. Dense label/value pages (the custom
 * game builder) use the single field size for labels and values alike.
 */
export const menuText = {
  mainTitle: 6,
  title: 4,
  section: 1.7,
  label: 1.8,
  body: 2.6,
  field: 2.05,
  small: 1.5,
} as const;
export function menuSkin(font: ResourceId): UiSkin {
  return { font, titleFont: menuTitleFont, titleScale: menuText.title, fontScale: menuText.body, lineHeight: 24,
    background: null, panel: null, focus: null, button: null,
    colors: { text: { x: 0.9, y: 0.92, z: 0.94, w: 1 }, disabled: { x: 0.48, y: 0.5, z: 0.53, w: 1 },
      accent: { x: 1, y: 0.73, z: 0.35, w: 1 }, panel: { x: 0, y: 0, z: 0, w: 0 },
      control: { x: 0.06, y: 0.08, z: 0.1, w: 0.83 }, focused: { x: 0.23, y: 0.16, z: 0.09, w: 0.97 } } };
}
export function menuBackdrop(context: UiDrawContext): UiDrawCommand {
  const viewport = context.binding.viewport, ratio = viewport.width / viewport.height, artRatio = 1672 / 941;
  const cropX = ratio < artRatio ? (1 - ratio / artRatio) / 2 : 0, cropY = ratio > artRatio ? (1 - artRatio / ratio) / 2 : 0;
  return { kind: "image", resource: "resource:engine-menu:main-background", rect: viewport,
    texCoords: [{ x: cropX, y: cropY }, { x: 1 - cropX, y: 1 - cropY }], color: { x: 1, y: 1, z: 1, w: 1 } };
}
export function menuPanel(context: UiDrawContext, narrow = false): UiDrawCommand {
  return transformUi({ kind: "fill", rect: { x: 40, y: 28, width: narrow ? 264 : 560, height: 420 },
    color: { x: 0.025, y: 0.035, z: 0.045, w: narrow ? 0.86 : 0.96 } }, fitUi(context.binding.safeArea));
}
