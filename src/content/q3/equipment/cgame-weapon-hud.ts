import type { QvmModuleOptions } from "../../../compat/qvm/module.ts";

/** Authored CG_DrawWeaponSelect entries; other status-bar fields keep their source renderer. */
export function q3EquipmentHudSelector(artifact: QvmModuleOptions["artifact"]): number | null {
  if (artifact.role !== "cgame") return null;
  switch (artifact.module.digest) {
    case "sha256:a4744482c9b93852cc71f4d7ce03b3e4337e5d89844d27d272c2c16d74df07fa": return 108261;
    case "sha256:14858804fb98609ed8b3b3c3b825f0a7cb544063f7e43735c884cd5e4a51157c": return 106815;
    default: return null;
  }
}
