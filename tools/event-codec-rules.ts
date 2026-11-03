// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What tools/generate-event-codec.ts cannot derive from the types. Every entry carries a fingerprint of the type shape it
 * covers; the check fails when that shape changes, so the hand-written code is reviewed alongside the type.
 */
export interface HandWritten {
  readonly reason: string;
  readonly shape: string;
}

/** Reader/writer pairs that are written by hand in unified-event-codec.ts. */
export const handWritten: Readonly<Record<string, HandWritten>> = {
  EventArmorState: { reason: "two-line block form", shape: "6cd49d2930d3" },
  EventQ2CtfEventHudFlagStates: { reason: "fixed-length tuple", shape: "bb85a1bfc60a" },
  EventQ2CtfEventScoreboardCaptures: { reason: "fixed-length tuple", shape: "cfbed970cce5" },
  EventQ2NativeCause: { reason: "discriminated by edition, not kind", shape: "64b6e5fffafa" },
  EventQ2PresentationEventPoiFields: { reason: "Map with duplicate-key rejection", shape: "a76a285c142c" },
  EventSimulationPresentationEvent: { reason: "common envelope fields and presentation owner", shape: "95521e538c45" },
};

/** Union cases kept as written in the codec while the rest of the union is derived, by node name then variant kind. */
export const keptCases: Readonly<Record<string, Readonly<Record<string, HandWritten>>>> = {
  EventQ1Event: { effect: { reason: "inline muzzle object", shape: "5d9b558fe803" } },
  EventQ2WeaponEvent: { beam: { reason: "inline nullable actor", shape: "0e7bb0ec67b8" } },
  EventQ2RereleaseEvent: {
    "remove-poi": { reason: "spread writer", shape: "e0399c7aedec" },
    "keyed-poi": { reason: "spread writer", shape: "7346d4961ffd" },
    "directional-damage": { reason: "spread writer", shape: "81037465d3f5" },
  },
  EventRegularArmorState: { source: { reason: "nullable item inline", shape: "b9582a63331f" } },
  EventQ3SourceEvent: {
    sound: { reason: "spread writer", shape: "e93902802628" },
    "player-event": { reason: "source module, player state and sequence validation", shape: "4c80af5e0cb2" },
  },
};

/** Fields decoded through a range check (GAPNET-007), keyed `Node.field` or `Node/kind.field`. */
export const ranges: Readonly<Record<string, string>> = {
  "EventWorldTextInput.cellSize": "positive",
  "EventQ2RereleaseEvent/world-text.lifetime": "nonNegative",
};
