# Contributing

Thanks for looking at the code. This page is the short path from a clone to a change that
passes the project's checks. The architecture is in [docs/architecture.md](docs/architecture.md),
the current state of the project is in [docs/status.md](docs/status.md), and security reports go
through [SECURITY.md](SECURITY.md).

## Set up

You need [Bun](https://bun.sh) 1.3.14 or newer (the `packageManager` pin in `package.json`),
a 64-bit Linux system, and the native libraries listed in the [README](README.md). The
project builds on Linux x64 only.

```sh
bun install --frozen-lockfile
bun run start --content-root /path/to/games --menu   # run from source
```

Game data is not in the repository. Many tests need it; see "Tests" below.

## The rules the checks enforce

`bun run policy` (`tools/check-policy.ts`) and `tsc` run in strict mode with these project rules:

- No `as any`, `as unknown as`, `@ts-ignore` or non-null assertions in `src`.
- Do not use `any` without a stated reason; model the type.
- No empty `catch` without a comment saying why swallowing is correct.
- `src/` is split into layers (`src/<layer>/`); an import from one layer into another must
  already be listed in `tools/layer-edges.json`. Adding a new cross-layer import needs a
  deliberate edit to that file.
- Project source is TypeScript only; the policy check rejects other implementation languages,
  symlinks and native binaries in the tree.
- New lines in `src` should not exceed 160 characters (`bun tools/check-style.ts <base-ref>`
  checks the lines a change adds).

Style: match the surrounding code. Comments are sparse and explain a non-obvious reason, not what
the line does. Ported behavior should follow the original source it ports; when a deliberate
deviation exists, say so where it is.

## Error handling model

A fault caused by one network peer drops that peer. A frame fault restarts the map on a
dedicated server, and returns a graphical client to the menu. A dedicated server exits after more
than three faults in 60 seconds. Keep that model when you add code that runs guest or peer
input.

## Tests

`bun test` runs everything and is **not** the right entry point for routine work: the run
needs game data and a window for many tests, and the tiers below say which is which. Use the
tier runners, which wrap `bun test` and set the environment on purpose:

| Command | Needs | Behavior |
| --- | --- | --- |
| `bun run test:unit` | nothing | Strips corpus and native-window variables; data-dependent tests skip. |
| `bun run test:corpus` | `QTS_TEST_CORPUS` | Sets `QTS_TEST_REQUIRE_CORPUS=1`, so a guard whose file is missing fails instead of skipping. |
| `bun run test:gl` | `QTS_TEST_CORPUS`, a GL-capable SDL driver | As above, with `SDL_VIDEODRIVER=offscreen` by default and the native opt-in gates enabled. |
| `bun run test:policy` | nothing | `tests/policy` (slow). |
| `bun run test:platform` | nothing | `tests/platform`. |

Append `bun test` arguments to run one file, for example
`bun tools/test-tier.ts unit tests/persistence/save-policy.test.ts`.

`QTS_TEST_CORPUS` points at the assembled game data, either the Steam layout
(`Quake`, `Quake 2`, `Quake 3 Arena`) or `q1/`, `q2/`, `q3a/`. It is the only variable tests read for game data. Helpers are in `tests/support/corpus.ts`
(`corpusTest`, `corpusDescribe`, `corpusFile`). Screenshots and JSON evidence are written only when `QTS_TEST_CAPTURE_DIR` is set
(`writeCapture` in `tests/support/capture.ts`); use `waitFor` (`tests/support/wait.ts`) instead of fixed sleeps, and `runMutations`
(`tests/support/mutation.ts`) for seeded hostile-input tests of a parser.

`bunfig.toml` preloads `tests/support/hermetic.ts`, which points `HOME` at a throwaway directory,
so a test run does not read or write your real `~/.local/share/quake-typescript/`. Keep new
tests hermetic; do not read the real home directory.

Native opt-in gates are environment variables that the `gl` tier turns on:
`QUAKE_GL_SMOKE`, `QUAKE_UI_NATIVE_SMOKE`, `QUAKE_STARTUP_NATIVE_TEST`,
`QUAKE_PLATFORM_NATIVE_TEST`, `QUAKE_MEDIA_NATIVE`, `QUAKE_FLARE_RENDER`,
`QUAKE_DEBUG_SHAPES_NATIVE`, `QUAKE_Q2_NATIVE_APP`, `QUAKE_STARTUP_RETAIL_TEST`,
`QUAKE_VIEWWEAPON_RENDER`, `QUAKE_WORLD_TEXT_APP`, `QUAKE_DOWNLOAD_WORKFLOW_TEST` and
`QUAKE_DEATH_APPLICATION_TEST`. Without them those tests skip silently. Some tests need an
optional add-on (for example Copper at `q1/rerelease/copper`) and skip with a notice.

Add a focused regression test for each bug you fix. If a test asserted the old wrong
behavior, change the test and say so in the commit message.

## Before you send a change

```sh
bun run typecheck
bun run policy        # slow; minutes
bun run test:unit
```

`bun run check` runs those three. Say in the change description which tiers you ran and which
you could not (for example "corpus tier not run, no game data"). Do not claim a test passes
that you did not run.

## Where things go

- Docs: user guides live in `docs/` and are linked from [docs/README.md](docs/README.md).
  Dated reports are history; do not edit them to look current. Update
  [docs/status.md](docs/status.md) when you change what the project can or cannot do, and add
  a line to [CHANGELOG.md](CHANGELOG.md) under `Unreleased`.
- Release notes: `docs/releases/<version>.md`, written at release time; see
  [docs/release-process.md](docs/release-process.md).

## License

Contributions are accepted under GPL-2.0-or-later, the license of the project and of the id
Software sources it derives from. Keep existing source headers and attribution.
