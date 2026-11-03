| ID | status | note |
|---|---|---|
| GAPQ12C-001 | fixed | First fix (rogue-tag `announce` skips a released holder) verified. Also, team-lock and Rogue `disconnect` requests from think code are now queued in `composition/q1/runtime.ts` and released at the next `preFrame`, matching `stuffcmd disconnect`, so the rest of that player's frame no longer runs on a released actor. No dedicated test. |
| GAPQ12C-002 | fixed | `dabeam.ts` now schedules `dabeam_free`, which emits `visible: false` for the beam actor before removing it. Test: `tests/gameplay/q2-missionpacks/monsters/monsters.test.ts` "monster dabeam hides its beam before its actor is freed". |
| GAPQ12C-003 | fixed | Shambler bolt is a short-lived `shambler_bolt` beam entity that is hidden and freed after 0.1 s, so no line stays after the shot or the shambler's death. The pain-during-windup half is faithful to m_shambler.cpp (C orphans the same beam), so it was left as is. No test. |
| GAPQ12C-004 | fixed | `func_bob` now converts its degree counter to radians for `Math.sin`/`Math.cos`. Test: `tests/gameplay/q1-addons/common.test.ts` "func_bob advances its sine in degrees". |
| GAPQ12C-005 | fixed | The one throw with no `objerror` counterpart (`target_lightramp lost its light`, lights.ts) now stops the ramp like the QC's freed-edict read. The remaining throws are QC `objerror` sites (Host_Error in the original) and now go through the frame-fault path (map restart) instead of exiting the process. No test. |
| GAPQ12C-006 | fixed | Gladiator `die` emits `loop: "stop"` for its hum (`rg_hum` or `phaloop` for gladb). No test. |
| GAPQ12C-007 | fixed | `projectileDumpDefinition` reads the model at offset 80. No test (debug log only). |
| GAPQ12C-008 | no-action | Info: unused `registerQ2RereleaseOrdinaryMonsters` is a second registration path; no behavior change, left for the owner (a grep of `tests` and `tools` was never done, so deleting it blind is not safe). |
