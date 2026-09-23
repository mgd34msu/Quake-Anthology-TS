/** Source client output is opt-in; retaining a stat does not grant display ownership. */
export interface QcModClientPresentation {
  readonly hud: "none" | "replace-vitals";
  readonly view: "none" | "set-view";
}

export interface NativeModClientPresentation {
  readonly hud: "none" | "layout-overlay" | "replace-status";
  readonly view: "none" | "playerstate";
}
