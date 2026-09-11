/* quakec_hipnotic/hipdecoy.qc source frame order. Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { MonsterFrame } from "../../../base/animation.ts";

export const frames: ReadonlyMap<string, MonsterFrame> = new Map<string, MonsterFrame>([
  ["decoy_stand1", {"frame": 17, "next": "decoy_stand1", "operations": [{"kind": "action", "name": "hipdecoy:decoy_stand1"}]}],
  ["decoy_walk1", {"frame": 6, "next": "decoy_walk1", "operations": [{"kind": "action", "name": "hipdecoy:decoy_walk1"}]}],
]);
