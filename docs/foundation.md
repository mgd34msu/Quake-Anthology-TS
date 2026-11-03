# Shared foundation: primitives and the event system

`src/foundation` holds the small data-structure primitives the rest of the engine builds on.
It is the lowest layer (see [architecture.md](architecture.md)) and imports nothing from the
other layers. Everything is exported from `src/foundation/index.ts`.

The rules the primitives follow:

- One definition per shared capability. Game and protocol differences stay at their boundaries
  as numeric rules or field adapters, not as a second store of the same state.
- Storage is sized when the structure is constructed and then reused. Hot paths reuse slots,
  cursors and scratch instead of allocating per call, per event or per frame. Exhaustion is
  counted and explicit, never a silent overwrite.
- Identities are integers in hot code (interned string ids, packed actor keys, provider ranks).
  Text is resolved once at admission, and text, never ids, is what gets saved or sent.
- Events are admitted once into one ring. Consumers advance independent cursors in admission
  order, retirement frees only the prefix every cursor has passed, and leases pin records that
  must outlive retirement.

## What is here

| File | Export | Purpose |
| --- | --- | --- |
| `event-ring.ts` | `EventRing<T>` | Power-of-two slot ring. `append` returns a record id (from 1) or 0 when full, and counts the refusal. `admit` throws a `RangeError` instead. `appendAll` and `admitAll` take a batch all-or-nothing. Consumers open cursors (`openCursor`, `read`, `peek`, `drain`, `take`); `retire` frees records every cursor has passed; `retain` leases a record past retirement (`leasedRecord`, `releaseLease`, `visitRetained`); `stats` reports capacity, live, leased, accepted, blocked and retired counts. |
| `bounded-queue.ts` | `BoundedQueue<T>` | Fixed-capacity ring that drops the oldest entry when full, for capped presentation histories (dynamic lights, damage indicators, pings, chat). Authoritative output that must not lose records belongs in `EventRing`, not here. |
| `strings.ts` | `StringTable`, `quakeNameFlags`, `NAME_*`, `STRING_NONE` | Interns text to uint32 ids (`intern`, `find`, `bindNames`, `text`). Name classification bits (monster, player start, brush path, team names and so on) are computed once at admission and read with `nameFlags`. |
| `id-index.ts` | `IdIndex` | Hash index from a `(string id, discriminator)` pair to an integer value over typed arrays. Capacity is reserved before insertion (`reserve`). Duplicate keys keep admission order and are walked newest first with `begin` and `next`. Also `find`, `remove`, `removeValue`, `retain`, `clear`. |
| `stamp.ts` | `StampSet` | Epoch visit marks. `begin()` starts a query by incrementing an epoch instead of clearing a set; `mark` returns true the first time an index is marked in that epoch. Used for collision and renderer de-duplication. |
| `cleanup.ts` | `CleanupStack` | Teardown callbacks kept by an owner until close. `runAll` runs in registration order and empties the stack; `runReverse` runs in reverse order and empties it; `invokeReverse` runs in reverse without emptying it, for retained scopes. Callbacks added while a run is in progress wait for the next run. |
| `binary.ts` | `loadU16LE`, `loadU32LE`, `loadI32LE`, `loadF32LE`, `loadF64LE`, the matching `store*LE`, `float32Bits`, `float32FromBits`, `float64Bits`, `float64FromBits` | Byte loads and stores as plain arithmetic, and float reinterpretation through one retained scratch word instead of a new `ArrayBuffer` or `DataView` per call. |

Related code outside this directory: vector math lives in `src/core/math.ts` as `*Into`
helpers that write into caller-supplied objects, and think ordering in `src/world/scheduler.ts`
compares stored integer provider ranks.

## Check a foundation change

```sh
bun test tests/foundation tests/core
bun tools/check-policy.ts src/foundation
bun run bench:foundation
```

`bun run bench:foundation` runs `tools/bench-foundation.ts`, which times these structures against
the allocating alternatives. The numbers depend on the machine and the Bun version, so none are
recorded here.
