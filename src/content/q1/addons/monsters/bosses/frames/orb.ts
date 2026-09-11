/* mg3_orb.qc source frame declarations. Copyright (C) 1996-2026 id Software LLC. GPL-2.0-or-later. */
import type { MonsterFrame } from "../../../../base/animation.ts";
export const frames: ReadonlyMap<string, MonsterFrame> = new Map<string, MonsterFrame>([
  ["orb_stand1", {"frame":0,"next":"orb_stand1","operations":[{"kind":"action","name":"orb:orb_stand1"}]}],
  ["orb_walk1", {"frame":0,"next":"orb_walk1","operations":[{"kind":"action","name":"orb:orb_walk1"}]}],
  ["orb_side1", {"frame":0,"next":"orb_side1","operations":[{"kind":"action","name":"orb:orb_side1"}]}],
  ["orb_run1", {"frame":0,"next":"orb_run1","operations":[{"kind":"action","name":"orb:orb_run1"}]}],
  ["orb_fast1", {"frame":0,"next":"orb_fast2","operations":[{"kind":"action","name":"orb:orb_fast1"}]}],
  ["orb_fast2", {"frame":1,"next":"orb_fast3","operations":[]}],
  ["orb_fast3", {"frame":2,"next":"orb_fast4","operations":[{"kind":"action","name":"orb:orb_fast3"}]}],
  ["orb_fast4", {"frame":0,"next":"orb_fast5","operations":[{"kind":"action","name":"orb:orb_fast4"}]}],
  ["orb_fast5", {"frame":2,"next":"orb_run1","operations":[{"kind":"action","name":"orb:orb_fast5"}]}],
  ["orb_pain1", {"frame":2,"next":"orb_pain2","operations":[{"kind":"action","name":"orb:orb_pain1"}]}],
  ["orb_pain2", {"frame":2,"next":"orb_pain3","operations":[{"kind":"action","name":"orb:orb_pain2"}]}],
  ["orb_pain3", {"frame":2,"next":"orb_pain4","operations":[]}],
  ["orb_pain4", {"frame":0,"next":"orb_run1","operations":[]}],
  ["orb_death1", {"frame":1,"next":"orb_death2","operations":[{"kind":"action","name":"orb:orb_death1"}]}],
  ["orb_death2", {"frame":2,"next":"orb_death3","operations":[]}],
  ["orb_death3", {"frame":2,"next":"orb_death4","operations":[{"kind":"action","name":"orb:orb_death3"}]}],
  ["orb_death4", {"frame":2,"next":"orb_death4","operations":[{"kind":"action","name":"orb:orb_death4"}]}],
]);
