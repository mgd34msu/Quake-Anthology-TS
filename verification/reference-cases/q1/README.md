`source-derived.json` contains 23 Q1 reference cases evaluated from original source equations. Every case includes fixed expected steps, observed steps, source identifiers, and its derivation. Source records include file SHA-256 hashes, exact line ranges, quoted code, and excerpt hashes.

The capture command from the project root is:

```sh
bun run tools/reference/q1/capture.ts
```

The default source root is the sibling `../qsrc` directory. A positional path selects another source root. A changed source hash causes capture to fail before writing the record.

The read-only command verifies current source hashes, evaluates all cases, and compares the stored cases with their fixed expectations:

```sh
bun run tools/reference/q1/capture.ts --check
```

The oracle test command is:

```sh
bun test tools/reference/q1
```

The captured cases cover these source contracts:

| Contract | Pinned behavior |
| --- | --- |
| WinQuake scalar VM operations | Each scalar result stores binary32. Bit operations truncate float operands to signed integers within range. Halfway rounding and loss of an intermediate unit have explicit bit-pattern expectations. |
| WinQuake `SV_RunThink` | The double frame endpoint is inclusive. Overdue callbacks clamp through float storage. The engine clears `nextthink` before the callback and sets `self` and world `other`. Removal follows `PF_Remove` into `ED_Free`, which sets `nextthink` to -1. The engine returns false after removal and executes one callback per invocation. |
| mg1 `hub_trigger_changelevel` | This source revision requires five sigil bits, mask 31. Four classic sigils, mask 15, leave the gate closed. The sixth bit cannot replace the fifth. |
| mg3 `trigger_rune_counter` and `rune_counter_use` | Spawn filtering precedes count default and callback installation. A zero count defaults to two. Only the first four rune bits count toward the threshold. Fractional and negative nonzero counts retain source behavior. |

The oracle imports no engine implementation. Its tests compare fixed hand-derived cases, exhaust the rune masks with independent arithmetic and a fixed nibble-count table, and reject malformed inputs and changed source evidence.

The record identifies its evidence as `source-derived` with `measuredOriginalExecution: false`. It contains no measured native-engine or retail trace. It executes neither original C nor compiled QuakeC, and it reads no commercial asset.

Scalar arithmetic assumes IEEE-754 binary32 storage with round-to-nearest ties-to-even and finite, defined conversions. Native compiler excess precision, vector reductions, fused operations, and undefined arithmetic remain outside these cases. `SV_RunThink` accepts prescribed callback effects and symbolic entity identifiers, with zero representing world.

The mission cases stop at callback invocation. They do not initialize the mg1 exit trigger or execute mg3 `SUB_UseTargets`. That function can delay actual target callbacks, so its invocation does not prove immediate downstream activation. Retail campaign completion, historical retail source equivalence, arbitrary QuakeC callbacks, and complete engine numeric equivalence remain unverified.
