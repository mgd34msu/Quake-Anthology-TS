# Native primary game declarations

A Quake II game DLL can expose its original private weapon, inventory, pickup,
player and world interfaces through `native-compatibility.json`. The DLL continues
to execute its original functions. The declaration identifies source fields and
instruction boundaries that let those functions work with selected weapons and
items from other games or components.

Put the file in the DLL's source content directory. For example, a classic mod
installed under `q2/mymod/` keeps its DLL, assets and declaration there. The same
relative directory under the user content root can override installed files.
Rerelease packages use their own catalog content directory. A declaration from
another selected weapon or map package cannot replace the source DLL's file.

The document has `version: 1` and a `modules` array. Each module requires:

- `artifactPath`: the relative path selected as the native game library.
- `artifactDigest`: `sha256:` followed by the exact DLL SHA-256 in lowercase.
- `apiVersion`: `3` for classic Windows i386 or `2023` for rerelease Windows x64.
- `primary`: the complete profile described below.

Paths are compared case insensitively after relative-path validation. Duplicate
module paths, changed DLL bytes, mismatched APIs and incomplete profiles are
rejected. A selected declaration replaces the whole built-in primary profile.
Missing sections never borrow offsets from a different DLL. Without a matching
declaration, only the exact built-in artifacts have these composition services.

## Primary profile

`primary` contains `weapons`, `player`, `commands`, `inventory`, `drop`, `pickups`
and `world`. Profiles carry byte offsets and relative virtual addresses for the
selected source artifact. RVAs are relative to the loaded PE image, not file
positions or absolute host addresses. Declare original source regions and their
actual joins; do not point at a substitute implementation.

The TypeScript contracts define every required field:

| Section | Contract and purpose |
| --- | --- |
| `weapons` | `NativePrimaryWeaponProfile`: original dispatcher, input decision regions, buffered input and continuation predicates, source clock, client fields, spawn completion, animation and source damage/delay decisions. |
| `player` | `NativePrimaryPlayerProfile`: original spawn selection and objective-drop operation, private command angles and velocity fields. |
| `commands` | `NativePrimaryCommandProfile`: original give/drop eligibility, imported argument access, item records, item classification masks and ammunition lookup. |
| `inventory` | `NativePrimaryInventoryProfile`: original cursor, scanner, validation and use regions; source item prototypes for weapon, ammunition, usable, passive, droppable and undroppable entries. |
| `drop` | `NativePrimaryDropProfile`: original named/inventory drop entry, lookup, allocation, callbacks and committed debit regions. |
| `pickups` | `NativePickupProfile`: original complete touch caller, recipient grants, source capacity fields and retained target/respawn continuation. |
| Classic `world` | `ClassicPrimaryWorldProfile`: private combat fields, original armor entries and item priorities, source flags, complete item table, unnamed source items and capacity fields. |
| Rerelease `world` | `RereleasePrimaryWorldProfile`: private entity/client layouts, native combat and armor regions, source inventory roster, deferred damage fields and original Pmove equipment sites. |

The profile readers are in `src/compat/q2/native-primary-profiles.ts` and each
edition's `world-profile.ts`. The runtime supplies the selected artifact digest
and API ABI to these sections. Pickup function signatures include their explicit
ABI and must match it. Source tests can inspect scalar or pointer fields in the
`entity`, `client` or `image` record. Fields, item tables and executable addresses
are checked before the DLL's `Init` executes.

Inventory prototypes identify real source item descriptors. Original scanners
and callbacks still decide whether an action is allowed. Prototypes do not create
new weapon types or replace source refusal, attack timing, buffered shots or
committed drops. Item names must exist in the DLL's live item table.

Saved games and retained map travel include both the DLL digest and the selected
declaration's digest. Changing, removing or replacing that declaration rejects
continuation instead of rebinding saved source data to different offsets.
