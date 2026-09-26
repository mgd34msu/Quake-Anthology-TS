# Remaining project work

Current source summary: 22 of the T01–T23 targets are accepted. T10 remains open. This is an implementation status, not a claim that every original game, mod, device and campaign works correctly. The list below separates known work from unverified workflows. Fix confirmed defects through shared behavior; keep verification proportionate.

## Patch release work

| Area | Target | Remaining work |
|---|---|---|
| Gameplay lag | T10 | Reduce original native DLL tick cost and resulting freezes/input delay without reducing simulation work or visual quality. The latest accepted runtime's late base1 sample measured 41.23 ms native and 45.55 ms per application step against a 25 ms native interval. |

The user accepted saving and loading and approved 1.0.0 with gameplay lag deferred.
Autosaves happen only on level entry. Manual saves and loading keep their existing
behavior. No other implementation item is currently identified as a release blocker.

## Qualification limits

The accepted implementation does not establish every possible mod, campaign,
physical device, rendered language or native multiplayer combination. Supported
interfaces and declarations remain required for original mods. These limits are
recorded in the [functional targets](functional-targets/status.md) and
[mod compatibility guide](mod-compatibility.md); they are not additional items on
the agreed patch implementation list.

The reported Q1 finale orb defect is fixed and installed in `72794d58`. Actual classic and rerelease `end` travel failed before the shared Q1 PUSH correction and passes afterward. The fix applies generally to translating Q1 pushers; remaining finale lag is part of the gameplay performance item above.

T19's future ranking-service backend is the explicitly approved placeholder. It is the only permitted placeholder and does not block the agreed implementation scope.

See [functional target status](functional-targets/status.md), [installed delivery](execution-status.md#installed-executable-and-recent-fixes), and [tick execution](tick-execution.md).
