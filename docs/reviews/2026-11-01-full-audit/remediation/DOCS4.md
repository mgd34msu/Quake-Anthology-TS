# DOCS4 remediation

| ID | status | note |
| --- | --- | --- |
| DOCS4-001 | fixed | Resolved by the DOCS3-009 alternative: menu-source-comparison.md is marked a dated snapshot; its 57 contradicted rows were not individually restated. |
| DOCS4-002 | fixed | The 12 false rows were already Open. The route text of the 11 accidental rows (M0935, M0941, M0942, M0947, M0949, M0952-M0955, M1029, M1030) now names the match menu control (src/ui/library/match.ts, Q3 dialect only) in place of the Quit/Resume text. Docs only; no test. |
| DOCS4-003 | fixed | Resolved by the DOCS3-009 alternative (dated snapshot banner); the 21 rows were not restated. |
| DOCS4-004 | fixed | Resolved by the DOCS3-009 alternative (dated snapshot banner); binding rows not restated. |
| DOCS4-005 | fixed | All 83 "located at" citations in menu-source-comparison.md were checked mechanically against the cited line: 68 that did not contain the name were replaced by an explicit "no verified citation" sentence, the other 15 lost their line numbers. M0209/M0211/M0212 now say no such cvar exists (rg over src finds none), M0242-M0245 and M1037-M1043 route text was corrected to the startup host menu and browser master entry. Docs only; no test. |
| DOCS4-006 | fixed | See DOCS2-004: the 68 false and 7 partial rows were re-derived with the rest; centerprints (q2.hud.centerprints-notifications), timed autosave (q1.saves.autosave, q2.save.autosave-transition) and the classic-only bot fallback are recorded as open or qualified rather than closed. |
| DOCS4-007 | fixed | completion-status.md row q3.execution.qvm-roles carries a correction note (Q3QvmServerGame, QVM application scalars and QvmUi are joined). Row status not re-scored. |
| DOCS4-008 | fixed | completion-status.md row q2.lmctf.voting carries a note that referee voting is not implemented and the row is partial; docs/status.md lists it. Row status not re-scored. |
| DOCS4-009 | no-action | Info; the dependency entries live in the JSON, which now also carries the re-derived state per row (see DOCS2-004). |
