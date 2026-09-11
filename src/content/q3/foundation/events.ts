/* Character-local CG_EntityEvent and CG_PainEvent behavior.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { PlayerFootsteps } from "./animation-config.ts";
import type { Q3CharacterEvent } from "./character.ts";
import type { PlayerPoseState } from "./player-pose.ts";
import { EntityEvent } from "../../../movement/q3/constants.ts";

export type Q3CharacterPresentationEffect =
  | { readonly kind: "custom-sound"; readonly channel: "auto" | "voice" | "body"; readonly name: string }
  | { readonly kind: "sound"; readonly channel: "auto" | "voice" | "body"; readonly path: string }
  | { readonly kind: "footstep"; readonly material: PlayerFootsteps | "metal" | "splash"; readonly variant: number }
  | { readonly kind: "jump-pad-smoke"; readonly radius: 32; readonly durationMilliseconds: 1000 }
  | { readonly kind: "teleport"; readonly direction: "in" | "out" }
  | { readonly kind: "weapon-fire" }
  | { readonly kind: "out-of-ammo" }
  | { readonly kind: "gib-player" }
  | { readonly kind: "stop-looping-sound" }
  | { readonly kind: "source-event"; readonly event: Q3CharacterEvent };

export interface Q3CharacterEventOptions {
  readonly local: boolean;
  readonly footsteps: boolean;
  readonly predictSteps: boolean;
  readonly sourceFlags: number;
}

/** The caller supplies its seat's cgame random stream and pose, independently of simulation RNG. */
export class Q3CharacterEventPresenter {
  stepTime = 0;
  stepChange = 0;
  landTime = 0;
  landChange = 0;
  muzzleFlashTime = -99999;

  constructor(readonly pose: PlayerPoseState, readonly footsteps: PlayerFootsteps, readonly random: { rand(): number }) {}

  pain(timeMilliseconds: number, health: number): readonly Q3CharacterPresentationEffect[] {
    if (((timeMilliseconds - this.pose.painTime) | 0) < 500) return [];
    const level = health < 25 ? 25 : health < 50 ? 50 : health < 75 ? 75 : 100;
    this.pose.painTime = timeMilliseconds;
    this.pose.painDirection = !this.pose.painDirection;
    return [{ kind: "custom-sound", channel: "voice", name: `*pain${level}_1.wav` }];
  }

  event(source: Q3CharacterEvent, options: Q3CharacterEventOptions): readonly Q3CharacterPresentationEffect[] {
    const event = source.event & ~0x300, time = source.timeMilliseconds;
    const sound = (path: string, channel: "auto" | "voice" | "body" = "auto"): Q3CharacterPresentationEffect => ({ kind: "sound", channel, path });
    const custom = (name: string, channel: "auto" | "voice" | "body" = "voice"): Q3CharacterPresentationEffect => ({ kind: "custom-sound", channel, name });
    switch (event) {
      case EntityEvent.EV_NONE: return [];
      case EntityEvent.EV_FOOTSTEP: case EntityEvent.EV_FOOTSTEP_METAL: case EntityEvent.EV_FOOTSPLASH:
      case EntityEvent.EV_FOOTWADE: case EntityEvent.EV_SWIM:
        return options.footsteps ? [{ kind: "footstep", material: event === EntityEvent.EV_FOOTSTEP ? this.footsteps
          : event === EntityEvent.EV_FOOTSTEP_METAL ? "metal" : "splash", variant: this.random.rand() & 3 }] : [];
      case EntityEvent.EV_FALL_SHORT: case EntityEvent.EV_FALL_MEDIUM: case EntityEvent.EV_FALL_FAR:
        if (event === EntityEvent.EV_FALL_FAR) this.pose.painTime = time;
        if (options.local) { this.landChange = -8 * (event - EntityEvent.EV_FALL_SHORT + 1); this.landTime = time; }
        return [event === EntityEvent.EV_FALL_SHORT ? sound("sound/player/land1.wav")
          : custom(event === EntityEvent.EV_FALL_MEDIUM ? "*pain100_1.wav" : "*fall1.wav", event === EntityEvent.EV_FALL_MEDIUM ? "voice" : "auto")];
      case EntityEvent.EV_STEP_4: case EntityEvent.EV_STEP_8: case EntityEvent.EV_STEP_12: case EntityEvent.EV_STEP_16: {
        if (!options.local || !options.predictSteps) return [];
        const elapsed = (time - this.stepTime) | 0;
        const previous = elapsed < 200 ? Math.fround(Math.fround(this.stepChange * Math.fround((200 - elapsed) | 0)) / 200) : 0;
        this.stepChange = Math.min(32, Math.fround(previous + 4 * (event - EntityEvent.EV_STEP_4 + 1)));
        this.stepTime = time;
        return [];
      }
      case EntityEvent.EV_JUMP_PAD: return [{ kind: "jump-pad-smoke", radius: 32, durationMilliseconds: 1000 }, sound("sound/world/jumppad.wav", "voice"), custom("*jump1.wav")];
      case EntityEvent.EV_JUMP: return [custom("*jump1.wav")];
      case EntityEvent.EV_TAUNT: return [custom("*taunt.wav")];
      case EntityEvent.EV_WATER_TOUCH: return [sound("sound/player/watr_in.wav")];
      case EntityEvent.EV_WATER_LEAVE: return [sound("sound/player/watr_out.wav")];
      case EntityEvent.EV_WATER_UNDER: return [sound("sound/player/watr_un.wav")];
      case EntityEvent.EV_WATER_CLEAR: return [custom("*gasp.wav", "auto")];
      case EntityEvent.EV_NOAMMO: return options.local ? [{ kind: "out-of-ammo" }] : [];
      case EntityEvent.EV_CHANGE_WEAPON: return [sound("sound/weapons/change.wav")];
      case EntityEvent.EV_FIRE_WEAPON: this.muzzleFlashTime = time; return [{ kind: "weapon-fire" }];
      case EntityEvent.EV_PLAYER_TELEPORT_IN: return [sound("sound/world/telein.wav"), { kind: "teleport", direction: "in" }];
      case EntityEvent.EV_PLAYER_TELEPORT_OUT: return [sound("sound/world/teleout.wav"), { kind: "teleport", direction: "out" }];
      case EntityEvent.EV_PAIN: return options.local ? [] : this.pain(time, source.parameter);
      case EntityEvent.EV_DEATH1: case EntityEvent.EV_DEATH2: case EntityEvent.EV_DEATH3: return [custom(`*death${event - EntityEvent.EV_DEATH1 + 1}.wav`)];
      case EntityEvent.EV_GIB_PLAYER: return options.sourceFlags & 0x200 ? [{ kind: "gib-player" }]
        : [sound("sound/player/gibsplt1.wav", "body"), { kind: "gib-player" }];
      case EntityEvent.EV_STOPLOOPINGSOUND: return [{ kind: "stop-looping-sound" }];
      // Match, pickup, projectile and Team Arena events retain their complete source payload for their owners.
      default: return [{ kind: "source-event", event: source }];
    }
  }
}
