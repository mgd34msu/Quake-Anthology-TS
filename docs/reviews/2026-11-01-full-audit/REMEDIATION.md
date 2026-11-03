# Remediation status

Tracks fixes for this audit in the working tree. An ID not listed here is still open.

## Fixed, with a regression test written for the fix

| IDs | Test |
| --- | --- |
| GAPQ3-001, GAPQ3-002, SRC2Q3-001, BOTS-001, LEFT-001, GAPSIM-001 (string fitting only), NET-002 (sequence jump only), SRC3Q3-001 (`q3dm3` only), AUDIT-001, APP-001 (dedicated restart, repeat-fault exit), NET-023, GAPAPP2-004 (overflowing timescale only) | `tests/network/remote-fault-containment.test.ts`, plus the unified, Q2 and Q3 network tests changed to expect a dropped peer |
| APP-001, NET-005 and APP-002 (client return to menu on a session fault; the fault was injected, not a real malformed packet or failed world load) | `tests/first-playable/startup-session-fault.test.ts` |
| PLATFORM-001 | `tests/audio/component-loops.test.ts` |
| APP-005, APP-012 | `tests/app/crash-log.test.ts` |

## Fixed, covered only by existing tests or not run at all

NET-001, NET-003, SIM-001, BOTS-002, BOTS-003, RENDER-002, APP-003, APP-004, APP-006, APP-007, APP-008, GAPAPP-001, GAPAPP-008, GAPAPP2-001, GAPAPP2-002, GAPCORE-001, GAPCORE-002, GAPNET-001, GAPQ3-003, GAPQ3-004, GAPQ3-005, GAPQ12-002, GAPQ12-003 (now drops the peer instead of printing usage), GAPQ12B-001, GAPQ12B-002, GAPQ12C-001, SRC4Q1A-003, SRC4Q2-001, SRC7-001, SRC9-001, SRCQ2-001, UI-001, UI-003, LEFT-002, VM-004 and GUEST-008 (through the frame boundaries, not at the VM boundary)

## Behavior changes to review

- Game callback failures caused by one peer now drop that peer instead of ending the server.
- A dedicated server restarts its map after a frame fault and exits after more than 3 faults in 60 seconds.
- Graphical clients return to the menu after any session fault except world corruption.
- Several fixes deliberately differ from id's source, where the source read invalid memory, hung or leaked: BOTS-002, GAPQ3-001, GAPQ3-002.
