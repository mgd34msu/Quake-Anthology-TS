import type { ContentDigest } from "../../contracts/content.ts";
import type { NativePrimaryPlayerProfile } from "./native-primary-player.ts";
import { xatrix1998CombatProfile, xatrixCombatProfile } from "./classic/combat-profile.ts";

/** 1998 retail Xatrix DLL (0b0d119e): resp.score 0xd80 and resp.cmd_angles 0xd84 (no resp.spectator in this build), SelectSpawnPoint at 0x307e0. */
export function nativePrimaryPlayerProfile(digest: ContentDigest): NativePrimaryPlayerProfile | null {
  if (digest === xatrix1998CombatProfile.digest) return { digest, match: { score: 0xd80, teams: [] }, spawn: 0x307e0, objectives: { kind: "none" },
    commandAngles: 0xd84, velocity: 0x178, forward: null };
  if (digest === xatrixCombatProfile.digest) return { digest, match: { score: 0xd88, teams: [] }, spawn: 0x312a0, objectives: { kind: "none" },
    commandAngles: 0xd8c, velocity: 0x178, forward: null };
  if (digest === "sha256:045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd") return { digest, match: { score: 0x17c8, teams: [{ source: "q2:1", team: "team:red", arguments: ["team", "red"] }, { source: "q2:2", team: "team:blue", arguments: ["team", "blue"] }] }, spawn: 0xd9050, objectives: { kind: "entry", entry: 0x11eb10 },
    commandAngles: 0x17cc, velocity: 0x694, forward: 0x19a4 };
  return null;
}
