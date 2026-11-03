| ID | status | note |
|---|---|---|
| TAB2-001 | fixed | Added the sounds the frame tables play to the mummy, eel, gremlin, scourge, wrath and lava man manifests (monsters/expansions.ts). No test. |
| TAB2-002 | fixed | MG3 manifests no longer union every base monster: mg3-resources.ts is regenerated from the MG3 progs.dat spawn-function closure plus the declared precaches (tools/content/generate-mg3-monster-resources.ts, now SPDX/progs based, no .bsp). tests/content/mg3-resources.test.ts and tests/content/catalog/expansion-weapons.test.ts (retail resolve). |
| TAB2-003 | fixed | Catalog availability now enforces requiredPrograms through the base chain (own directory/archives, then each base product); remote overlays are exempt. Local corpus products stay installed. tests/content/catalog/required-programs.test.ts. |
| TAB2-004 | fixed | Added monster_dragon and monster_morph to the Rogue and monster_spikemine to the Hipnotic selection manifests, resources taken from the spawn functions in the shipped rogue/hipnotic progs.dat. tests/content/mg3-resources.test.ts. |
| TAB2-005 | fixed | Added a test that the alias, Q2 wire and Q3 direction-byte normal tables agree entry by entry (tests/content/tables/normal-tables.test.ts, passing); the copies are kept. |
