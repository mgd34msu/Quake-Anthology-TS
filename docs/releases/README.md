# Release notes

One page per tagged release; [CHANGELOG.md](../../CHANGELOG.md) is the one-line index and
[the release process](../release-process.md) describes how releases are made.

| Version | Date | Theme |
| --- | --- | --- |
| [1.2.6](1.2.6.md) | 2026-10-26 | Tossed items no longer hang in mid-air |
| [1.2.5](1.2.5.md) | 2026-10-25 | Retained model batches, title art |
| [1.2.4](1.2.4.md) | 2026-10-23 | Retained lit model geometry |
| [1.2.3](1.2.3.md) | 2026-10-23 | Console and cvar correctness |
| [1.2.2](1.2.2.md) | 2026-10-23 | Performance |
| [1.2.1](1.2.1.md) | 2026-10-23 | Unified hosting, CPU renderer workers |
| [1.2.0](1.2.0.md) | 2026-10-22 | Performance |
| [1.1.10](1.1.10.md) | 2026-10-22 | Foreign enemies, travel, custom guests |
| [1.1.9](1.1.9.md) | 2026-10-21 | QuakeWorld and Quake III mod guests |
| [1.1.8](1.1.8.md) | 2026-10-21 | Black-box guests |
| [1.1.7](1.1.7.md) | 2026-10-21 | Any arsenal on any QuakeC program |
| [1.1.6](1.1.6.md) | 2026-10-20 | Undecodable companion files |
| [1.1.5](1.1.5.md) | 2026-10-20 | PvP mode matrix, rerelease saves |
| [1.1.4](1.1.4.md) | 2026-10-19 | Edition and mode matrix |
| [1.1.3](1.1.3.md) | 2026-10-17 | Custom-game builder |
| [1.1.2](1.1.2.md) | 2026-10-15 | LLM model list |
| [1.1.1](1.1.1.md) | 2026-10-15 | LLM sign-in |
| [1.1.0](1.1.0.md) | 2026-10-14 | Shared foundation, content discovery |
| [1.0.0](1.0.0.md) | 2026-09-26 | First release |

## Errata

These notes are not edited after release. Corrections found later:

- **`--version` at 1.1.10 and 1.2.0.** `src/version.ts` was still `1.1.9` at both tags, so those
  binaries print `1.1.9`.
- **`--steam`.** Notes 1.1.1 to 1.1.10 say `--steam` "searches Steam first". It searches
  Steam only (README and [getting-started.md](../getting-started.md) are correct).
- **1.1.10 contents.** The tag also contains foreign movement and character support on native
  Quake II worlds (commits `db69fc92`, `d6874ea9`, `e1c8620a`) and shared CTF on every world
  (`fbabc9a2`), which its notes do not mention.
- **Known issues carried from 1.1.3 to 1.1.6.** Notes through 1.1.6 list native-DLL gameplay
  stalls and the unified HUD as known issues. Later notes drop the section without recording a
  resolution. Per-game rerelease HUD layouts are executed natively since the 1.1.x series (see
  [mod-compatibility.md](../mod-compatibility.md)); a current performance number for native
  DLL worlds has not been re-measured. Treat both as not re-verified.
- **Unreleased.** The tree after 1.2.6 contains further changes; see the `Unreleased` section of
  the changelog. A build from it still reports 1.2.6.
