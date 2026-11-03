| ID | status | note |
|---|---|---|
| LEFT-003 | fixed | Cap of 16 lit-geometry entries per pose and surface. Still no test: needs a full model-preparation context. |
| LEFT-004 | fixed | browser-view.ts: `addServer` returns -1 for an unresolvable address and rechecks capacity after the await, `removeServer` returns quietly, `getPing`/`getPingInfo` return empty results for an out-of-range slot. tests/compat/qvm/client-browser.test.ts changed to expect an empty result for an out-of-range ping slot; three other tests in that file fail on serverStatus changes made elsewhere. |
| LEFT-005 | fixed | `legacyClientCommand` returns null for an unmapped or non-numeric `cs` and the getServerCommand wrapper drops it with a print. Test: tests/app/audit-app-fixes.test.ts. |
| LEFT-006 | no-action | Refuted by verification: a closed checkpoint closes the reopened input during construction. |
| LEFT-007 | fixed | parseAddonCatalog skips a malformed row (optional `skipped` callback, summarized in the browser message) and rejects `-game .` and `-game ..`. Test: tests/content/catalog/addons.test.ts. |
| LEFT-008 | fixed | Deleted toQ3Snapshot/toQ3EntityState (+ unused helpers) from network/q3/adapters.ts, the unused QuakeWorldPredictionHistory file (network/q1/prediction.ts; live QW prediction is app/bootstrap/simulation/prediction/qw-source-state.ts), and formats/q3-model/animation.ts (duplicate of content/q3/foundation/animation-config.ts). tests/formats/q3-model/retail.test.ts now imports the live parser; passes. |
