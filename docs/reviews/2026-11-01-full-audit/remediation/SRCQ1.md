| ID | status | note |
|---|---|---|
| SRCQ1-001 | fixed | `SharedPhysics.pushEntity` impacts when a Q1 push starts inside a solid (`trace.startSolid`), matching `if (trace.ent)`. Test: tests/first-playable/simulation/physics.test.ts "Q1 missile that starts inside another solid still impacts it" (verified failing without the change). |
| SRCQ1-002 | fixed | `radiusDamage` skips `solid: none` targets and walks the actors in descending order like findradius. No test. |
| SRCQ1-003 | fixed | Dog leap keeps `step` movement (the `toss` assignment was removed). The landing dland2 sound is part of the shared step physics, not added here. No test. |
| SRCQ1-004 | fixed | Foundation grunt/dog attack delays go through `attackDelay`, which skips the write on classic nightmare. No test. |
| SRCQ1-005 | fixed | Test tests/first-playable/simulation/notarget-selected-monsters.test.ts updated (it asserted the old drop-on-notarget behavior; passes). `monsterTargetEligible` ignores notarget; foundation `findTarget` measures eye-to-eye distance, retaliate ignores a world attacker and sets `oldEnemy` after the same-enemy check, and the death activator is `attacker ?? enemy`. |
| SRCQ1-006 | fixed | `idealPitch` truncates each probe difference to an integer as the C does. No test. |
| SRCQ1-007 | fixed | Origin, grenade angles and axe offsets were already done. The stale-`other` branch: `other` is world at every weapon fire (SV_RunThink sets it to world, SV_Impact/SV_TouchLinks restore it), so the +400 z branch cannot fire in the engine's own flow and the port matches; no tracked global added (it would be dead code). No test |
| SRCQ1-008 | fixed | When no QuakeC host supplies QW state, the authoritative QW move is seeded with the command's angles before its axes are built. No test. |
| SRCQ1-009 | fixed | physics.ts keeps a Q1 body on the ground when its supporter is freed (rebound to world) as WinQuake does; other families unchanged. Test: tests/first-playable/simulation/physics.test.ts |
