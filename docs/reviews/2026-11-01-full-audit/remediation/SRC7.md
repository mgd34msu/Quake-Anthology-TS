# SRC7 remediation
| ID | status | note |
|---|---|---|
| SRC7-002 | fixed | startPing and startStatus no longer throw when the send fails; the ping slot stays pending to time out and the status request is resent on the next call. tests/compat/qvm/client-browser.test.ts re-run on the current tree and passes (the earlier failure was another agent's mid-edit status-slot change). No new test. |
| SRC7-003 | fixed | The default monster blocked callback now runs only for infantry and soldier; every other species is never blocked-checked. No test. |
| SRC7-004 | fixed | One helper, waterAboveWaistAt, probes feet, +26 and +48 from the point and refuses only when all three are water, used by both jump-down sites. No test. |
| SRC7-005 | fixed | token_t string reads end at the 1023rd character when the field is unterminated, so the long-name read returns 0 instead of throwing. No test. |
| SRC7-006 | fixed | Syscall 318 with an unsupported presence prints the AAS_PresenceTypeBoundingBox message, clears the result and returns 0; syscall 577 returns 0 for a portal area. The BOTLIB_TEST part was refuted. No test. |
| SRC7-007 | fixed | The nightmare pain cooldown extension now applies after every th_pain call, including the army early return and dogs. No test. |
| SRC7-008 | fixed | dprint prints unconditionally for QuakeWorld in both bindings and stays gated on developer for the NetQuake family. No test. |
| SRC7-009 | no-action | Info: the branch is unreachable today (no caller passes a path navigation); the finding says to fix it when the branch goes live. |
| SRC7-010 | no-action | Info: the rankings call is harmless and reports keys id never sends; left as is. |
