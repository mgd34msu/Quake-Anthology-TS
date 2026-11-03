| ID | status | note |
|---|---|---|
| SRCQ2-001 | fixed | world/collision/q2.ts setAreaPortalState rejects only a number above the lump count (cmodel.c), unlisted portals are kept in the open set; the RangeError for an out-of-range number is a frame fault, which restarts the map. Test: tests/world/collision/q2-source-rules.test.ts (retail train.bsp). |
| SRCQ2-002 | fixed | world/collision/index.ts: the point-trace corpse exception applies only when the corpse's family differs from the query's; same-family corpses obey the mask (sv_world.c DEADMONSTER skip). Test: q2-source-rules.test.ts. |
| SRCQ2-003 | fixed | New Q2_NULL_SURFACE (collision/contents.ts) is returned by traceQ2Box, for secondary surfaces and by Q2Collision.trace for any trace with no textured side, so movement friction applies on box actors. Test: q2-source-rules.test.ts. |
| SRCQ2-004 | fixed | collision/index.ts: a Q2 box actor with startSolid replaces the result (sv_world.c) and a world fraction 0 returns before entity clipping. Test: q2-source-rules.test.ts. |
| SRCQ2-005 | fixed | q2.ts and body.ts keep the raw enter fraction for stored policies and clamp after selection; classic game traces and point contents now use stored leaf contents (physics.ts policy and waterTransition, source-hosts.ts via ActorHostWorld.leafContents set in runtime.ts for non-rerelease content). Test: q2-source-rules.test.ts covers the raw-fraction rule on actor boxes; the stored-policy wiring has no test. |
| SRCQ2-006 | fixed | classic-guest-source.ts starts the x87 control word at 0x7f (24-bit, sys_win.c _controlfp). No test and no retail differential trace; the DLL CRT's own fldcw sites were not traced, as the finding notes. |
| SRCQ2-007 | fixed | base/entities/triggers.ts init leaves movedir zero for unrotated triggers; rerelease/triggers.ts also keys on the `angle` field. No test. |
| SRCQ2-008 | fixed | entity-services.ts useTargets plays the entity's noise_index (target_secret/goal noise or secret.wav, trigger_once/multiple `sounds` 1-3) instead of always talk1. No test. |
| SRCQ2-009 | fixed | Classic help computer: game helpChanged counter (use_target_help), per-player helpChanged/gameHelpChanged, pc_up.wav beep up to 3 times every 64 frames, Cmd_Help_f reopen rule, STAT_HELPICON as wire stat 11 (i_help). The local HUD has no help-icon consumer, so only networked clients see the icon. No test. |
| SRCQ2-010 | fixed | base/player/view.ts layouts bit 1 branches on deathmatch as p_hud.c does. No test. |
| SRCQ2-011 | fixed | view.ts kick applies the floor then the 50 ceiling. No test. |
| SRCQ2-012 | fixed | triggers.ts trigger_monsterjump tests SVF_DEADMONSTER (bit 2). No test. |
| SRCQ2-013 | fixed | foundation/movers.ts doorBlocked emits q2:explosion1 before removing a crushed non-living entity. No test. |
| SRCQ2-014 | fixed | source-hosts.ts inPvs/inPhs add the areasConnected test (reaches classic host.ts through the same host). No test. |
| SRCQ2-015 | fixed | network/q2/frames.ts drops the ordering throw and the removal-without-source throw; a mismatched U_REMOVE steps past the old entity as cl_ents.c does. No console print (the reader has no print channel) and no MAX_EDICTS check, because extended protocols allow larger numbers. No test. |
| SRCQ2-016 | fixed | message.ts compares and range-selects effects as unsigned; vanilla.ts and r1q2.ts read the long form with `>>> 0`. No test. |
| SRCQ2-017 | fixed | compat/q2/classic/host.ts traceBytes always writes a mapped csurface_t (empty one when the trace has none) and writes the world edict for a miss; with SRCQ2-003 the shared trace also carries it. No test (no DLL run). |
