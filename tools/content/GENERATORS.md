# Generated tables: inputs and recorded outputs

The generators below need source trees that are not in this repository. Their committed outputs are
recorded here by SHA-256 so a regeneration can be compared byte for byte. Input trees are identified by
what to obtain; no input hash is recorded because the original trees are not on the machines that
maintain this project. Record the hash of the tree you use when you regenerate.

## Quake II rerelease monster tables

- Generator: `tools/content/generate-q2-monster-tables.ts`
- Input: the per-monster `m_<species>.cpp` and `m_<species>.h` files, and `game.h`, of the public Quake II rerelease game DLL source.
- Run: `QTS_Q2_RERELEASE_SOURCE=<source dir> bun tools/content/generate-q2-monster-tables.ts <species>...`
- Output: `src/content/q2/rerelease/monsters/tables/<species>.ts` and `flashes.ts` (flashes is rewritten on every run).
- The generator skips the 19 moves in `UNREFERENCED_MOVES` (unreferenced by the port, absent from the game DLL); the committed tables had them pruned the same way and the hashes below are of the pruned files.
- Not verified: that every committed table is the unmodified output of this generator; nothing here proves it.

| File | SHA-256 |
| --- | --- |
| tables/actor.ts | `5f466d728ef29ce6381b13285dcc5538a6679489fb405c614d89dcd1bb4ff4ad` |
| tables/arachnid.ts | `0b76767b0401f82a62369ab3bfed9d0d8376a74ca0d20bf0b9d34eebbefe8e5b` |
| tables/berserk.ts | `69c160280f1721d5896482b05fd89ab924b6d4729ca68de3d9391505c9055ba1` |
| tables/boss2.ts | `ecc1f5675279112e20ca5f8d76a9dd80e95cb0586e6f64f9033aa32f1e855cf4` |
| tables/boss31.ts | `b76adde97f0181c107b87f899fe23e31bb5f7ac00dc0d9ee63e28592e5e67877` |
| tables/boss32.ts | `7abe53a7cdd05f567af13958fae39c64f0f9b7e7d110250f5483e887745aeb00` |
| tables/brain.ts | `8ef13b66f3785046af3f620f6fddb79ad1b40de15d575dc2cd4032043a07750f` |
| tables/chick.ts | `1122a3eebf5aa44dbc75c91cb1e653ad91a6239798977ce26224cd54af85270f` |
| tables/flashes.ts | `1b152f86abc2ee60efcd24ab38aeaea1dd0d1aea8be3aab15a00417753d7898b` |
| tables/flipper.ts | `8f11250304ba558e1c53980e234faa1496af2100bf182919aab13af036978bd9` |
| tables/float.ts | `0a4c0649efded33d9d8096ee69c5bc6f0a43174c95ec8ecaa6a33d25eff80c48` |
| tables/flyer.ts | `7f274f8cb3757c5ea13b58f3466cb8275356fe5730e4d5a3039e8a389c3b0872` |
| tables/gladiator.ts | `f49680090beafbfe12d0c4922fe6818a3c459b5270af63e15181fc081b27c3b5` |
| tables/guardian.ts | `8206563ccdcd84fb6d52629af186348c97dd20693fc61bd8c42ef1e169778f34` |
| tables/guncmdr.ts | `39b8f4f3e6e2aadfcbd93bfe7862b5687fd5d427eb57307ea71a7b2887a619c5` |
| tables/gunner.ts | `bddc17f6b7677ec52379a3991fdbaa7dd9423829c49d3e66cf8ed0b9b0e78a1f` |
| tables/hover.ts | `724f26c014ea9795361d8a375914e4090bc2bca4a21bc4aa92f5c54f531547ef` |
| tables/insane.ts | `3314600690a23112be3edece9813fdd04bace2a6df187fc61134850f08e4c71d` |
| tables/medic.ts | `9060c94a9c0382ab909a0ca7808ea50b7a6eb86c5d6fdbf9181be9ba700e7639` |
| tables/mutant.ts | `227a08c5ee38a7f578bf5cf413d3e677c65a4b46542e06b87187f32b5869209a` |
| tables/parasite.ts | `a04d6924b886ece550191ab33cdea5d4f0e5aaf8b8e58045fbd50fd944b81f18` |
| tables/shambler.ts | `82a2b481f020534abed03dee9ab10043e6c586eb615af006d71284218cc89de5` |
| tables/supertank.ts | `a879cdb0865b3119f93d28fe21be6e2f033688d718509f9833a796f902633df3` |
| tables/tank.ts | `86ad98d3bfc180f1c98e2103ce7bf596446bc7215d124f2f281a67c03c186c9b` |

## MG3 monster resources

- Generator: `tools/content/generate-mg3-monster-resources.ts`
- Input: the `quakec_mg3` QuakeC source directory (its `monsters/*.qc` files).
- Run: `bun tools/content/generate-mg3-monster-resources.ts <quakec_mg3 dir>`
- Output: `src/content/monsters/mg3-resources.ts`

| File | SHA-256 |
| --- | --- |
| src/content/monsters/mg3-resources.ts | `51d50d82557240230f443df08557fb39732240db48d21dd11eb58a2c70d93b83` |

## Others

- `tools/profile-frame.ts` needs `QTS_TEST_CORPUS`; it no longer has a default path.

## Tables read from the shipped rerelease DLL (no generator)

`src/content/q2/rerelease/monsters/tables/missionpack.ts` (mission pack monster frame callbacks) and `src/content/q2/foundation/rerelease-ammo.ts` (ammo capacities) were derived from `game_x64.dll` (SHA-256 `045d49c5...baccd`) by locating each `mmove_t` / gitem / `InitClientPersistant` store by structure. `tests/content/q2/rerelease-missionpack-moves.test.ts`, `tests/content/q2/rerelease-ammo.test.ts` and `tests/content/q2/rerelease-soldier-variants.test.ts` re-read the DLL from the corpus and fail if a table drifts from it.
