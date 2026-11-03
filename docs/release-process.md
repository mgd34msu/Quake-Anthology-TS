# Release process

This describes what the repository tooling does today. CI (`.github/workflows/ci.yml`) runs
the corpus-free checks (typecheck, format, SPDX, event codec, policy, `test:unit`) on pull
requests and pushes to `main`; a weekly self-hosted job (`corpus.yml`) runs the corpus tier.
Cutting a release is done by hand on the maintainer's machine.

## Versions

- The version lives in `package.json` (`version`) and `src/version.ts`, and must be
  SemVer: `MAJOR.MINOR.PATCH`, with an optional pre-release suffix while a tree is ahead of
  the last tag (for example `1.2.7-dev`). `quake-typescript --version` prints it.
- Keep the two in step. At tags `v1.1.10` and `v1.2.0` `src/version.ts` still said `1.1.9`,
  so those binaries report the wrong version.
- A tree after a tag carries the next version with a `-dev` suffix in both files, so a build
  from it never claims to be the tag's release. `bun run build` accepts it;
  `bun run release` refuses any pre-release version (set the final version first).

## Cutting a release

1. Update `package.json`, `src/version.ts`, [CHANGELOG.md](../CHANGELOG.md) (move
   `Unreleased` under the new version) and add `docs/releases/<version>.md`. Update the
   version and link in the root README.
2. Commit everything. The release script refuses to run on a dirty tree, including
   untracked files.
3. Run `bun run release`.
4. Tag the commit `v<version>` and attach the archive and its checksum on GitHub Releases.

## What `bun run release` does

`tools/release.ts`, linux x64 only:

1. Checks that the tree is a git work tree, is clean, and that `package.json` has a
   final (non pre-release) `MAJOR.MINOR.PATCH` version, and that `LICENSE`, `THIRD-PARTY-NOTICES.md`, `README.md` and
   `src/formats/images/IJG-LICENSE.md` exist.
2. Runs the gates `typecheck` and `test:unit` (`bun run typecheck`, then the corpus-free
   unit tier).
3. Builds the runtime (`tools/build.ts`, see below) and checks that HEAD and the tree did
   not change during the build.
4. Packs `dist/release/quake-anthology-<version>-linux-x64.tar.gz` containing the
   `quake-typescript` executable, `LICENSE`, `THIRD-PARTY-NOTICES.md`, `README.md`,
   `licenses/IJG-LICENSE.md` and `RELEASE.json` (version, commit, build time, source hash,
   executable SHA-256). The tar uses a fixed order, owner and mtime, so the same commit and
   executable pack to the same bytes.
5. Writes `<archive>.sha256` and prints the SHA-256.

## What `bun run build` does

`tools/build.ts` copies the tracked source to an immutable snapshot, runs `typecheck` and
`policy` against that snapshot, compiles `src/main.ts` into a standalone `quake-typescript`
executable under `dist/`, and records `dist/runtime.json` (source hash, commit, dirty flag,
Bun and TypeScript versions, executable SHA-256). Options: `--keep-snapshot`,
`--keep-builds=N` (default 3 published builds kept). `bun run build:tools` builds the helper
executables listed in `tools/build.ts` (`check-policy`, `source-camera`, `aas`).

The compiled executable still needs the native libraries and your game data
([getting-started.md](getting-started.md)).

## Checks that exist

| Command | Purpose |
| --- | --- |
| `bun run typecheck` | `tsc --noEmit` over the whole project |
| `bun run policy` | Source policy (`tools/check-policy.ts`): banned casts and `any`, layer edges, native-artifact and implementation-language checks. Slow (minutes). |
| `bun run test:unit` | Tests that need no game data or window |
| `bun run test:corpus` | As above plus data-dependent tests; needs `QTS_TEST_CORPUS` |
| `bun run test:gl` | Adds native-window and renderer tests |
| `bun run format:check`, `bun run spdx`, `bun run codec:check` | Biome formatting, SPDX headers, and the generated event codec being current |
| `bun run check` | typecheck, format, SPDX, codec, policy and the unit tier together |

The test tiers are `bun run test:unit`, `test:corpus` and `test:gl` (see `tools/test-tier.ts`).
