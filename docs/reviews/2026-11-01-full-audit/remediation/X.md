| ID | status | note |
|---|---|---|
| X-001 | fixed | browser-view.ts `updateVisiblePings` tests the 32-slot limit only for rows that need a ping, as cl_main.c does. No test. |
| X-002 | fixed | `serverStatus` with a null size now only marks the matching (or chosen) slot retrieved and keeps its address and cached result, as CL_ServerStatus does. No test added. |
