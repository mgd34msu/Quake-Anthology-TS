# Choose a game and customize it

Open **Play a game → Custom game**. The menu offers installed campaigns, starting
maps, movement, character source and model, weapons, supported monster replacements,
and equipment. Unsupported combinations can fail preparation or report an error
in the menu. See [current compatibility](mod-compatibility.md) for source interfaces.

## Choose rules and maps

Under **World**, choose the game or mod that supplies the rules. **Map content**
selects the installed product supplying the map independently.

The command-line equivalent is:

```sh
./quake-typescript --game PRODUCT --map-game MAP_PRODUCT --map MAP
```

Omit `--map-game` to use the selected game's maps. For example, an installed LRCTF
Q3 module can run locally on Q2's `base1`:

```sh
./quake-typescript --game q3-classic-lrctf --map-game q2-classic-baseq2 \
  --map base1 --movement q3 --character q3 --mode deathmatch +set bot_enable 0
```

The selected module owns its rules and interpretation of map entities. A map must
supply the objectives and entities those rules need. Changing geometry does not
create missing CTF flags or mission scripts. Native clients also need a map format
their original engine supports.

## Choose movement and characters

Select movement and character sources in the custom-game menu. On the command line,
`--movement` accepts `q1`, `q2`, `q3`, `qw`, or an exact installed product such as
`q2-rerelease-baseq2`. `qw` selects `q1-quakeworld`, including its command timing.

This example uses QuakeWorld movement and Q3 Ranger in classic Q1:

```sh
./quake-typescript --game q1-classic-id1 --map e1m1 \
  --movement qw --character q3 --model ranger
```

Explicit menu selections and saved selections retain their chosen source. Classic
presets must keep classic behavior; see the [project's fidelity requirement](../README.md).

## Enable independent mods

Open **Custom game → Mods** to search installed components and toggle their
**Enabled/Disabled** state. Each entry identifies its source. Multiple compatible
components can run together, including components from different games.

Conflicting selections report the affected names and retain the previous selection.
Missing or outdated declarations can make individual components unavailable.
Choosing a game-type mod under **World** is separate from enabling additions here.

The command-line option can be repeated:

```sh
./quake-typescript --game PRODUCT --mod PRODUCT_A/COMPONENT_A --mod PRODUCT_B/COMPONENT_B
```

Declarations bind original source behavior for weapons, items, actors, rules,
presentation, and other supported operations. General mod interoperability remains
unfinished. See [component declarations and limits](mod-compatibility.md#independent-components).

## Configure equipment

Under **Custom game → Equipment**:

| Control | Choices |
| --- | --- |
| Hook | Off, Weapon slot, Offhand |
| Hook style | Threewave for Q1, Q2, or Q3; LMCTF for Q2; LRCTF for Q3 |
| Offhand grenades | Off, On |

Hook style selects the source implementation independently from placement. The
picker lists hook providers rather than every installed mod and combines classic
and rerelease asset choices within each source-game style. Offhand grenades use
installed Q2 grenade assets; the feature has no separate classic/rerelease toggle.

The [content layout guide](content-layout.md#install-a-mod) explains the Q1
Threewave packages needed for its original Morning Star model.

## Change controls

Open **Options → Controls → Bindings (Player 1)**. The searchable, scrollable table
shows actions and current keys. Select a key to capture its replacement, or use
**Add** for another binding. Existing profile bindings are preserved.

**Options → Controls** also exposes numeric sensitivity sliders and horizontal
and vertical multipliers. Invert mouse is separate. Startup edits persist.
Right mouse is `MOUSE2`; middle mouse is `MOUSE3`. See the
[console guide](console-and-llm.md#inspect-commands-and-bindings) for binding commands.

## Save and load

Automatic saves happen only when entering a level in a supported singleplayer
session. The **Autosave on level load** setting controls this behavior.
There are no timed or mid-level automatic saves. Loading an existing save does
not overwrite it with a new autosave. The legacy `sv_autosave_interval` variable
is accepted for old configuration files but no longer schedules saves.

`save NAME` writes the shared format, including supported mixed-game state.
For an ordinary singleplayer NetQuake source session, export original Quake saves
with `save NAME v5` or `save NAME v6`. Mixed compositions need shared saves because
the original formats cannot retain their extra state.

`load NAME` detects the format. If an original save matches several installed
products, use `load NAME PRODUCT_ID` to select its source. The console commands
`help save` and `help load` show the syntax.

Keep the exact original modules and matching declarations used by a saved game.
Changed or missing declarations can prevent restoring private source state.
See [compatibility limits](mod-compatibility.md) for the selected runtime.

## Play multiplayer

**Multiplayer → Find servers** provides LAN discovery, direct addresses, favorites,
and connection controls. Mixed-game networking and original game protocols have
different compatibility requirements. Use the [networking guide](networking-unified.md)
and `--help` for hosting and connection options.
