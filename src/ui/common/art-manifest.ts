export interface MenuArtFile {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}
export interface MenuArtFrame extends MenuArtFile {
  readonly region: {
    readonly width: number;
    readonly height: number;
    readonly uv: readonly [{ readonly x: number; readonly y: number }, { readonly x: number; readonly y: number }];
  };
  readonly border: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  readonly borderScale: number;
}
export const menuBackground: MenuArtFile = {
  file: "assets/ui/menu-background.png", width: 1536, height: 1024,
  sha256: "04c4fd787c4b47f1ba27ec293c361cdf1c87406fe4d1f0005b8ba6fbe1287ffa",
};
export const menuPanel: MenuArtFrame = {
  file: "assets/ui/menu-panel.png", width: 1254, height: 1254,
  sha256: "179d84c501384fc88443a9a415a06195270306706eb7e4ca5dc68ed06043f2a0",
  region: { width: 1254, height: 1254, uv: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
  border: { left: 160, top: 160, right: 160, bottom: 160 }, borderScale: 0.2,
};
export const menuFocus: MenuArtFrame = {
  file: "assets/ui/menu-focus.png", width: 2172, height: 724,
  sha256: "65b98e03aaba9f26edc36ffa0e769e2932b5b85ea994a09447edf3bfc6ba4312",
  region: { width: 2172, height: 633, uv: [{ x: 0, y: 68 / 724 }, { x: 1, y: 701 / 724 }] },
  border: { left: 96, top: 96, right: 96, bottom: 96 }, borderScale: 0.0625,
};
export const menuArtFiles: readonly MenuArtFile[] = [menuBackground, menuPanel, menuFocus];
