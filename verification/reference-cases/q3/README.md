# Q3 source-derived reference cases

Run from the project root:

```sh
LC_ALL=C bun tools/reference/q3/capture.ts
bun test tools/reference/q3/scenarios.test.ts
LC_ALL=C bun tools/reference/q3/capture.ts --check
```

The first command writes `capture.json`. `--check` verifies the pinned original source files and evaluates the cases without replacing the capture. A source mismatch fails before evaluation. The tests run the literal expectations without requiring the external source checkout.

These are source-derived observations. No original executable, retail session, donor executable, or QVM interpreter runs. The runner imports no Q3 TypeScript-port implementation. It transcribes bounded operations from the original `../qsrc/quake-iii-arena` files and compares them with literal expected values whose derivations are recorded next to each assertion. The original source and commercial data remain read-only. The source-derived code follows the original Quake III Arena code under GPL-2.0-or-later.

Eight cases cover binary32 arithmetic, Pmove command splitting, timer deadlines, weapon ammo/event order, switching deadlines, haste and infinite ammo, synchronous ClientConnect denial/acceptance, and nested VM context restoration. Each record includes source file hashes and line locations, evaluator and fixture hashes, Bun executable identity, runtime version, command, time of capture, exact inputs and outputs, causal call/event traces, assumptions, and zero comparison tolerances.

The numeric case explicitly selects binary32 rounding after each float operation. It preserves binary64 promotion for `msec * 0.001` before assignment to a float. Its cancellation probe is a numerical specimen with a non-unit normal, not a physical collision case. Native compiler excess precision and alternative numeric profiles require separate references.

The weapon cases invoke the source-defined PM_Weapon projection directly. This permits exact 199/200 and 249/250 ms deadline probes without claiming Pmove would pass an unsplit 249 ms interval. Live-player and ownership guards are fixed assumptions. Ammo is observed at event append time, before the new cooldown is added. Three consecutive events also prove the two-slot ring overwrites slot zero while the sequence increases.

The connection case represents denial strings with synthetic QVM offset 32. The source-derived contract is the immediate nonzero return through ClientConnect, vmMain, and VM_Call, followed by explicit VM pointer resolution and rejection before `connectResponse`. Successful imported callbacks are recorded by call site; userinfo parsing, session contents, network bytes, and VM instructions are outside this case. The nested callback case separately checks that VM_Call restores a non-null prior VM, while an outermost call leaves the called VM current.

Passing these specimens is an initial independent source contract. It does not establish complete engine parity, gameplay, rendering, audio, wire compatibility, or performance.
