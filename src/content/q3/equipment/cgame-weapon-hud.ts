import type { QvmModuleOptions } from "../../../compat/qvm/module.ts";

/** Original HUD entry and final view-weapon visibility decision, qualified per cgame artifact. */
export function q3EquipmentPresentationProfile(artifact: QvmModuleOptions["artifact"]): {
  readonly hud: number;
  readonly warning: { readonly entry: number; readonly state: number };
  readonly status: { readonly kind: "regions"; readonly entries: readonly { readonly entry: number; readonly decision: number; readonly ammo: readonly { readonly entry: number; readonly join: number }[] }[] }
    | { readonly kind: "functions"; readonly entries: readonly number[] };
  readonly held: { readonly entry: number; readonly gun: number };
  readonly view: { readonly entry: number; readonly decision: number };
} | null {
  if (artifact.role !== "cgame") return null;
  switch (artifact.module.digest) {
    case "sha256:a4744482c9b93852cc71f4d7ce03b3e4337e5d89844d27d272c2c16d74df07fa":
      return { warning: { entry: 22881, state: 1084512 }, status: { kind: "functions", entries: [24534, 24736] }, held: { entry: 106742, gun: 28 }, hud: 108261, view: { entry: 107738, decision: 107828 } };
    case "sha256:14858804fb98609ed8b3b3c3b825f0a7cb544063f7e43735c884cd5e4a51157c":
      return { warning: { entry: 26123, state: 1012656 }, status: { kind: "regions", entries: [{ entry: 10083, decision: 10087, ammo: [{ entry: 10141, join: 10228 }, { entry: 10402, join: 10525 }] }, { entry: 13793, decision: 13797, ammo: [{ entry: 14011, join: 14098 }, { entry: 14833, join: 14960 }] }] }, held: { entry: 103468, gun: 184 }, hud: 106815, view: { entry: 105885, decision: 105975 } };
    default: return null;
  }
}
