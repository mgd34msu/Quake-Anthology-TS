The Q2 capture contains 32 bounded source-derived references. The authority is the original C and C++ under `../qsrc/quake-2` and `../qsrc/quake2-rerelease-dll`. No original engine executable runs during capture, and no TypeScript donor implementation supplies expected outputs.

The read-only check command is:

```bash
bun run tools/reference/q2/capture.ts --check
```

The capture command writes `verification/reference-cases/q2/capture.json`:

```bash
bun run tools/reference/q2/capture.ts
```

The boundary tests run with:

```bash
bun test tools/reference/q2/oracle.test.ts
```

The capture records raw SHA-256 identities for 18 original files, exact source line ranges, model files, the Bun executable, inputs, reviewed literal expectations, actual observations, and callback order. A source hash mismatch fails the command. A passing result establishes only the stated source-derived contract.

The cases cover classic 10 Hz binary32 seconds, supplied re-release 25 ms cadence, think deadlines and return values, frame entry and live edict order, synchronous ammo pickup returns, armor rounding, cross-unit progression bits, re-release save declarations, flechette capacity, Q64 configuration, and native jump and crouch predicates. The tests also crosscheck 10,000 clock steps, neighboring binary32 deadlines, armor products, and every button byte.

Save cases extract `FIELD_AUTO` declarations and project sample state through that field selection. They do not run the original save codec or prove a restored game. Re-release stores flechette capacity at `max_ammo[8]`; the classic adaptation's `max_flechettes` name is not an original re-release field.

Numeric cases name their storage and evaluation assumptions. In particular, armor multiplication uses binary32 before `ceil`, and classic frame time uses the unsuffixed double literal before a float store. Native compiler excess precision remains unmeasured.

The original sources establish the native input predicates. They do not define this project's LegacyKEX conversion magnitude, conflicting-button precedence, private 4038 codec, or LMCTF prediction agreement. Those require separate adapter evidence. Render, audio, network, performance, full save restoration, and gameplay completion remain outside this capture.
