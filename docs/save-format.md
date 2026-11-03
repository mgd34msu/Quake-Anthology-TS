# Save format

What a save file is, where it goes and which operations can read it. This describes the
code in `src/persistence`; the schema is the TypeScript in `src/contracts/session.ts`
(`SaveImage`) and the readers in `src/persistence`, which are the authority.

## Where saves live

`~/.local/share/quake-typescript/saves/`, or `saves/` inside a custom `--user-content-root`. `save NAME` adds `.sav` when the name has no
extension. A relative name resolves inside that directory. The reserved name `current` is used
for internal level-transition state and cannot be a user slot. Autosaves are written on level
entry only ([playing.md](playing.md#save-and-load)).

Saves stay in this directory even for stock games. The shared format is not id's `.sav` or
`.ssv`, so it is not written under the original names in a game folder; use `save NAME v5` or
`v6` to export a Quake save the original reads. A stock game's configuration, by contrast, is
written to its native file ([content-layout.md](content-layout.md#where-files-are-read-and-written)).

## Commands

- `save NAME [shared|v5|v6]` writes the shared format by default. `v5` and `v6` export the
  active singleplayer NetQuake source in its original format and are not available for mixed
  compositions.
- `load NAME [SOURCE_PRODUCT]` detects the format. Name the source product when an original
  Quake save matches more than one installed product.
- `save` accepts only a path inside the save directory ending in `.sav`. `load` also accepts an
  absolute path to an existing file elsewhere, which is how original saves are imported, but only
  from the local console; a script, a game or client module or a remote client needs
  `--allow-load-paths` ([SECURITY.md](../SECURITY.md)).
- A save is refused when there is no active world, while hosting or joined to a network game, in
  deathmatch (except server-administration match saves), during intermission, with no players
  or with a dead player. Quake III worlds are exempt from the deathmatch, intermission and
  dead-player rules (`src/persistence/save-policy.ts`).

## The shared container (`QTSAVE5`)

```
bytes 0..7   ASCII "QTSAVE5\n"
bytes 8..11  header length (u32 little endian)
bytes 12..   header (map and content id, at most 4096 bytes), then the checkpoint value envelope
```

The header lets the save menu list a save without decoding the payload. On load it must agree
with the recipe inside the image, or the load fails.

Saves beginning `QTSAVE4\n` (header, schema 3), `QTSAVE3\n` (no header, schema 3) and
`QTSAVE2\n` (no header, schema 2) are read, never written. None has the selection-consumption
record, so reading migrates them to schema 4 with an empty `consumption` list; version 2 also
triggers armor normalization on restore. Any other prefix is rejected with
`unsupported unified save signature/version`.

The JSON is a plain-data envelope. Numbers that JSON cannot carry (`NaN`, infinities, `-0`)
and bigints are written as `{ "$qts": "number" | "bigint", "value": "<text>" }`, byte arrays as
`{ "$qts": "bytes", "value": "<base64>" }` (base64 must be canonical). Live objects, maps,
functions and symbols are refused at write time, and the key `$qts` is reserved.

Files are written to a temporary name in the save directory through a held directory
descriptor (`O_EXCL | O_NOFOLLOW`, mode `0600`), synced and renamed over the target, so a crash
leaves the old save or the new one.

## `SaveImage` (schema version 4)

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `4` |
| `consumption` | What a native-guest session did with each selection axis (enemies, movement, character): `honored`, `partial` or `guest-native`, with detail. Status metadata; restore does not read it back as state. |
| `recipe` | The `ExecutableRecipe`: the selected world program, maps, movement, character, arsenals, monsters, mods |
| `frame`, `nextEventSequence` | The frame context and the next event number |
| `clocks`, `random` | Per-provider source time and random state |
| `actors` | Per-slot lifetime (active with owner and definition, or free with a time) and generation |
| `bodies`, `combat`, `inventories`, `configurations`, `thinks` | Shared body state, damage and protection state, inventories, per-actor configuration and scheduled callbacks |
| `providers` | Opaque per-provider checkpoints: `{ provider, schema, version, bytes }`. The world actor table is the provider `world:actors`, schema `world:source-slots`, version 1. |
| `guests` | Checkpoints of guest modules (DLL, QVM) with their identity |
| `mods` | Optional mod session state |
| `legacyArmorLayout` | Present when read from version 2 |

Each provider owns its schema and version number. A reader rejects a provider checkpoint whose
provider, schema or version it does not know, and the whole load fails with a
`SaveFormatError` naming the field path.

## Provider checkpoint versions

Each entry in `providers` and `guests` carries its own version, read by the code that owns it.
These are the ones with more than one version in the readers today:

| Checkpoint | Current | Older versions |
| --- | --- | --- |
| Quake foundation (`q1-foundation`, `src/persistence/q1-foundation.ts`) | 6 | 5 is still read. Version 5 monsters carried the grunt and dog sequence cursor; version 6 keeps that animation state in the base controller. |
| Bot director (`src/bots/behavior/director.ts`) | 2 | 1 is still read. Version 1 digested every file under `bots/`, navigation graphs included, to check that the mounted bot assets match; version 2 leaves the graphs out. A save whose bot assets differ from the mounted files is refused. |
| Native guest (`kind: "native-guest"`, `src/persistence/execution.ts`) | 2 | An image without a `version` field is version 1: it has no heap image and assumes the layout a fresh startup produces. Version 2 adds the guest heap (mappings, allocator state, blocks) and, for Windows modules, heaps, reservations, TLS slots, FLS slots and the last error. A version 2 image without an `fls` list reads as no FLS slots. |
| Quake II foundation (`src/persistence/q2-foundation.ts`) | 1 | none |
| Gameplay mod session (`mods`) | 1 | none |

A version that a reader does not list fails the load.

Player progress is not part of a save. Achievements, completed levels and matches, and ranked results are kept in
`player-progress.json` in the selected product's user-content directory, a JSON document
`{ "version": 2, "events": [...] }` written through a `.pending` file and rename. Version 1 is
still read. A file that is torn, foreign or fails its checks opens as empty progress and is
rewritten on the next event.

## Restoring

A save restores the exact recipe, so the same content must be installed: changed or missing
original modules and declarations can prevent restoring private source state. Connected client
slots must match the saved players. A saved profile can change the active movement and
character selections. Map travel does not copy references to the previous map's actors; world
scoped guests restart, and only adapters with independent session state keep their state.

## Original formats

`save NAME v5` / `v6` write original NetQuake (version 5) and KEX-style (version 6) Quake saves
for singleplayer sessions. A reader for Quake II KEX saves is in `src/persistence/kex-q2-save.ts`.
Original saves cannot carry mixed-game state, so a mixed composition must use the shared
format. How completely original VM globals, edicts and callbacks round-trip is a verified
limit, not a guarantee; see [status.md](status.md).
