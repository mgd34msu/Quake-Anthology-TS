# X — items found while settling comparisons made from memory

## Coverage
See verification/VERIFY-X.md.

## Findings
### X-001 — Visible-ping scan stops at the first row after the queue fills, where id stops only at a row needing a ping
- **Verification (VERIFY-Z): confirmed. Final severity: Info.** browser-view.ts:229 breaks on any row at 32; cl_main.c:3154 tests only inside `ping == -1`, so :3182 still consumes overflow. `browser.ts` (stubbed transport), 32 `-1` rows then 2 `0` rows with 2 overflow addresses: 32 pings sent, overflow still 2, row 32 still ping 0; by reading C, both addresses are consumed in that call. A later pass reaches them, so the impact is as stated.
- Severity: Info
- Category: bug
- Location: network/q3/browser-view.ts:229
- Original: client/cl_main.c:3154, :3182
- Confidence: traced
- Evidence: Port: `if (count >= 32) break;` runs first for every row. C tests `slots >= MAX_PINGREQUESTS` only inside `server[i].ping == -1`, so `ping == 0` rows after the queue fills still take an address from the global overflow list in the same call.
- Impact: Global-list overflow replacement can start one or more refresh passes later. Final contents are unaffected as long as passes continue, because a later pass reaches those rows once a slot frees.
- Remediation: Move the check into the `ping === -1` path.

### X-002 — Resetting one server status request frees the slot and forgets its result, where id only marks it retrieved
- **Verification (VERIFY-Z): confirmed-with-changes. Final severity: Info.** browser-view.ts:277-281 clears address and handle, and `browser.ts` shows the re-query sends a second request; cl_main.c:2672-2677 only sets `retrieved`, including on a slot picked for an unmatched address. Correction, the impact is overstated: the stock UI does not reach the cached-result difference for the status panel. After success ui_main.c:4176-4178 sets `nextServerStatusRefresh = 0`, so :4162-4166 stops polling until a forced refresh, and :4171 resets all slots on both sides. Find-player resets all at :4051 and moves on after :4109, so only a repeated address in one search could differ. q3_ui declares the trap and has no caller.
- Severity: Info
- Category: bug
- Location: network/q3/browser-view.ts:277-281
- Original: client/cl_main.c:2672-2677; ui/ui_main.c:3909-3911, :4109, :4178
- Confidence: traced
- Evidence: C: `serverStatus = CL_GetServerStatus( to ); if ( !serverStatusString ) { serverStatus->retrieved = qtrue; return qfalse; }`, keeping the address and string. A later query for that address returns the cached string at once. For an address with no slot, C marks whichever slot CL_GetServerStatus picks, including the oldest. Port: matching slot only, and it releases the handle and clears the address, so the next query sends a new `getstatus` and returns 0 first. No slot is marked for an unmatched address.
- Impact: Team Arena's find-player and status panels can send one more request and show fresher data where id shows a cached result. The port's result is arguably better, and the UI recovers either way.
- Remediation: None needed unless exact behaviour is wanted; if so, set `retrieved` only and keep the address and handle.
