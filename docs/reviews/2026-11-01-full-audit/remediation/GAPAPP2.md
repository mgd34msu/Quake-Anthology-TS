| ID | status | note |
|---|---|---|
| GAPAPP2-003 | fixed | SeatSourceHud loads POI, damage and pickup pictures through `loadOptional` (a miss is remembered and drawn as nothing, a leading `/` is honored) and an unset POI image index is dropped. Test: tests/ui/hud/source-state.test.ts. |
| GAPAPP2-004 | no-action | Checked against the working tree: `sourceCaptureFrame` already ignores negative values and `sourceFrameMilliseconds` clamps negative scale and overflow; covered by existing frame-time tests. |
| GAPAPP2-005 | fixed | Q2 sound with an empty precache slot and a monster flash outside the table are dropped, and `q1ColorExplosion` with length 0 returns. No test. |
| GAPAPP2-006 | fixed | Finished voices are retired on every stop event, so the tracker no longer grows without `prepare`. No test. |
| GAPAPP2-007 | fixed | q3 effects walk the pool once per frame (again only if its count changed) instead of per reference. No test. |
| GAPAPP2-008 | fixed | Q3 asset owners share opened synchronous assets per mount plan. No test. |
| GAPAPP2-009 | fixed | Native Q2 HUD picture table is capped at 512 names per content, reported once. No test. |
| GAPAPP2-010 | fixed | Q3 configstring array reused, PVS bytes memoized, Q2 particle sampling no longer uses quadratic unshift. Not done: UI weapon-icon preparation skip, rerelease story re-localization. No test. |
| GAPAPP2-011 | fixed | audio.json, view.json, cvar archives and player progress fall back to defaults when parsed but invalid (with a warning where a print channel exists); the operator IP filter stays strict. Test: tests/app/audit-app-fixes.test.ts (audio and view). |
| GAPAPP2-012 | fixed | An invalid authored weapon wheel keeps the default wheel, a missing wheel icon is skipped, a Q3 hands model without its tag is not drawn, the finale without its picture is dropped; the native held model was already tolerant. No test. |
| GAPAPP2-013 | fixed | Removal tombstones the copy; hidden copies, their cached package and tombstone are deleted at the next start. Test: tests/app/addon-library-purge.test.ts. |
| GAPAPP2-014 | fixed | The catalog fetch uses a 20 s timeout plus Cancel, and cancel promises are caught. No test. |
| GAPAPP2-015 | fixed | Music `select` updates the record in place, an opened intro is closed if the loop fails to open, and the unused `bloodOwners` was deleted. No test. |
| GAPAPP2-016 | fixed | Added table tests: tests/app/q2-native-hud-prepare.test.ts (layout error, picture load paths, players/ fallback, missing image, 512-picture cap reported once, scale, clear), tests/text/sound-captions-table.test.ts (source offset, no sidecar/reference/stopped voice, language switch, closed owner), tests/app/selected-q3-presentation-collection.test.ts (the collection's no-source, no-client, closed and failed-prepare paths; the per-seat consumer needs a full cgame and is not covered). |
