# SRC8C remediation
| ID | status | note |
|---|---|---|
| SRC8C-001 | fixed | For AAS graphs select returns the lowest-time stored reachability with no movement simulation, the retained reachability is checked with the static test only, and checkBarrierJump skips its admission for AAS. Foreign graphs keep admission. Live check on retail q3dm19 (six bots, 90 s): func_bobbing travel selected 15 times with 1040 move commands and no blocked or failed result; jump pads 6 selects. Whether each bot then rode the platform was not measured separately. Tests: aas-routing.test.ts (a mover that admission refuses is selected) and q3-routing.test.ts (q3dm19 mover and jump pad edges are selected).
| SRC8C-002 | fixed | The standing-on-model branch treats func_static like a door and leaves func_train to the blocked branch. No test. |
| SRC8C-003 | fixed | airControl is the BotAirControl free-flight loop with sv_gravity. No test. |
| SRC8C-004 | fixed | movementViewTarget ports BotMovementViewTarget/BotAddToTarget over TravelGraph.select starting from lastReachability, with the teleporter, weapon-jump and pad/mover rules. No test. |
| SRC8C-005 | fixed | predictVisiblePosition skips the start point, stops after 20 hops, succeeds on reaching the goal area and uses an empty avoid list, as the finding's remediation says. The trace pass-entity and mask arguments keep their values because the C values are not in the finding or on this machine. No test. |
| SRC8C-006 | fixed | jumpSpeed is the closed-form AAS_HorizontalVelocityForJump with phys_maxvelocity 320. No test. |
| SRC8C-007 | fixed | Travel traces use SOLID and PLAYERCLIP; BODY stays only in checkBlocked. No test. |
| SRC8C-008 | fixed | select applies BotValidTravel's area-contents test through the static edge test with the move flags, so the airborne jump-pad recovery returns none and the caller's first-pad fallback runs; the recovery call now passes the extrapolated end point as the avoid-spot origin (controller.ts, via select's `from`) instead of the bot origin. Test: aas-routing.test.ts covers the static path only. |
| SRC8C-009 | fixed | The $evalint/$evalfloat sign token, #eval number and a lone stringized macro token now carry defined (zero) numeric fields. No test. |
| SRC8C-010 | fixed | The float-to-integer token conversion wraps to 32 bits and expression arithmetic wraps (Math.imul for multiply) instead of throwing RangeError. No test. |
| SRC8C-011 | fixed | findMatchInto copies at most 255 bytes so the message buffer stays terminated. Test: botfile-errors.test.ts. |
| SRC8C-012 | fixed | An unclosed syn.c context is reported through the parser's fail path so setup publishes no synonyms. Test: botfile-errors.test.ts. |
