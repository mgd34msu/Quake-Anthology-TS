| ID | status | note |
|---|---|---|
| SRC2Q3-002 | fixed | autosprite and autosprite2 process whole quads and drop a trailing partial one instead of throwing, as tr_shade_calc.c does after its warning; no warning is printed because the deform has no print path (deform.ts). No test. |
| SRC2Q3-003 | fixed | `kamikazeArea` skips a candidate that an earlier victim's death unlinked (weapon.ts). No test. |
| SRC2Q3-004 | fixed | `rgbGen const` uses the tolerant `sourceVector` reader (zero default for missing components) and the strict `vector` helper was removed (material.ts). No test. |
| SRC2Q3-005 | fixed | Trace shapes no longer require ordered bounds, only finite ones (collision/q3/world.ts, model.ts). `validateBounds` stays for temporary capsule hulls. No test. |
| SRC2Q3-006 | no-action | Verification: the throws match id's overruns and the proposed `CommonError("drop")` behaves the same as `RangeError` until VM-004's drop handler exists, so changing the type changes nothing. |
| SRC2Q3-007 | fixed | prepareFogVolume takes an identityLight factor (default 1) and scales the fog color by it before quantizing, as tr_bsp.c does; WorldSceneOptions gains q3IdentityLight, passed from the world loader. Test: tests/materials/fog.test.ts. |
