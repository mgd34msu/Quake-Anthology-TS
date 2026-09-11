/* Player animation.cfg semantics from Q3 cg_players.c. GPL-2.0-or-later. */
import type { Vec3 } from "../../contracts/math.ts";
import { at, ModelTokens } from "./text.ts";

export const q3AnimationNames: readonly string[] = [
  "BOTH_DEATH1", "BOTH_DEAD1", "BOTH_DEATH2", "BOTH_DEAD2", "BOTH_DEATH3", "BOTH_DEAD3",
  "TORSO_GESTURE", "TORSO_ATTACK", "TORSO_ATTACK2", "TORSO_DROP", "TORSO_RAISE", "TORSO_STAND", "TORSO_STAND2",
  "LEGS_WALKCR", "LEGS_WALK", "LEGS_RUN", "LEGS_BACK", "LEGS_SWIM", "LEGS_JUMP", "LEGS_LAND", "LEGS_JUMPB", "LEGS_LANDB", "LEGS_IDLE", "LEGS_IDLECR", "LEGS_TURN",
  "TORSO_GETFLAG", "TORSO_GUARDBASE", "TORSO_PATROL", "TORSO_FOLLOWME", "TORSO_AFFIRMATIVE", "TORSO_NEGATIVE",
  "MAX_ANIMATIONS", "LEGS_BACKCR", "LEGS_BACKWALK", "FLAG_RUN", "FLAG_STAND", "FLAG_STAND2RUN",
];

export interface PlayerAnimation {
  readonly name: string;
  readonly firstFrame: number;
  readonly numFrames: number;
  readonly loopFrames: number;
  readonly frameLerp: number;
  readonly initialLerp: number;
  readonly reversed: boolean;
  readonly flipflop: boolean;
}
export interface PlayerAnimationConfig {
  readonly source: string;
  readonly footsteps: "normal" | "boot" | "flesh" | "mech" | "energy";
  readonly headOffset: Vec3;
  readonly gender: "male" | "female" | "neuter";
  readonly fixedLegs: boolean;
  readonly fixedTorso: boolean;
  readonly animations: readonly (PlayerAnimation | null)[];
  readonly diagnostics: readonly string[];
}

export function parsePlayerAnimationConfig(text: string, source = "<animation.cfg>"): PlayerAnimationConfig {
  const tokens = new ModelTokens(text, source);
  let footsteps: PlayerAnimationConfig["footsteps"] = "normal";
  let gender: PlayerAnimationConfig["gender"] = "male";
  let headOffset: Vec3 = { x: 0, y: 0, z: 0 };
  let fixedLegs = false;
  let fixedTorso = false;
  const diagnostics: string[] = [];
  let token = tokens.token();
  while (!/^\d/.test(token)) {
    switch (token.toLowerCase()) {
      case "footsteps": {
        const value = tokens.token().toLowerCase();
        if (value === "default" || value === "normal") footsteps = "normal";
        else if (value === "boot" || value === "flesh" || value === "mech" || value === "energy") footsteps = value;
        else diagnostics.push(`Unknown footsteps ${value}`);
        break;
      }
      case "sex": {
        const first = tokens.token().charAt(0).toLowerCase();
        gender = first === "f" ? "female" : first === "n" ? "neuter" : "male";
        break;
      }
      case "headoffset": headOffset = { x: tokens.float(), y: tokens.float(), z: tokens.float() }; break;
      case "fixedlegs": fixedLegs = true; break;
      case "fixedtorso": fixedTorso = true; break;
      default: diagnostics.push(`Unknown animation token ${token}`);
    }
    token = tokens.token();
  }
  const sourceAnimations: PlayerAnimation[] = [];
  let first: string | null = token;
  let legOffset = 0;
  for (let index = 0; index < 31; index++) {
    const name = at(q3AnimationNames, index, "animation name");
    if (first === null) {
      if (index < 25) tokens.fail(`missing animation ${name}`);
      sourceAnimations.push({ ...at(sourceAnimations, 6, "gesture animation"), name, reversed: false, flipflop: false });
      continue;
    }
    let firstFrame = Number(first);
    if (!Number.isInteger(firstFrame) || firstFrame < 0) tokens.fail(`invalid first frame ${first}`);
    if (index === 13) legOffset = firstFrame - at(sourceAnimations, 6, "gesture animation").firstFrame;
    if (index >= 13 && index < 25) firstFrame -= legOffset;
    const count = tokens.integer(-0x7fffffff, 0x7fffffff);
    const loopFrames = tokens.integer();
    const fps = tokens.float() || 1;
    const frameLerp = Math.trunc(Math.fround(1000 / fps));
    sourceAnimations.push({ name, firstFrame, numFrames: Math.abs(count), loopFrames, frameLerp, initialLerp: frameLerp, reversed: count < 0, flipflop: false });
    if (index < 30) first = tokens.next();
  }
  const animations: (PlayerAnimation | null)[] = [...sourceAnimations, null,
    { ...at(sourceAnimations, 13, "crouch animation"), name: "LEGS_BACKCR", reversed: true },
    { ...at(sourceAnimations, 14, "walk animation"), name: "LEGS_BACKWALK", reversed: true },
    { name: "FLAG_RUN", firstFrame: 0, numFrames: 16, loopFrames: 16, frameLerp: 66, initialLerp: 66, reversed: false, flipflop: false },
    { name: "FLAG_STAND", firstFrame: 16, numFrames: 5, loopFrames: 0, frameLerp: 50, initialLerp: 50, reversed: false, flipflop: false },
    { name: "FLAG_STAND2RUN", firstFrame: 16, numFrames: 5, loopFrames: 1, frameLerp: 66, initialLerp: 66, reversed: true, flipflop: false },
  ];
  return { source, footsteps, headOffset, gender, fixedLegs, fixedTorso, animations, diagnostics };
}
