# Ranking services

There are two separate pieces: local standings that work today, and an extension point for an
online Quake III ranking service that has no implementation.

## Local standings

When a match ends, the family's own end-of-match state (Quake and QuakeWorld intermission, Quake II
layout intermission, Quake III level intermission) produces one family-neutral `MatchResult`
(`src/app/bootstrap/match-results.ts`): the family, the rules provider, a match id, the map, and
each scored client slot with its score, whether it won, and the player's identity. Spectators are skipped, and
bots are scored but have no identity. Only deathmatch matches produce a result.

`ApplicationMatchRankings` admits each result once into an `EventRing`. A `LocalRankingService`
(`src/network/services/online.ts`) reads the ring through its own cursor and keeps standings per
rules provider: matches, wins, total score. Only slots bound to a local account are ranked; the
hosting player's account and players whose userinfo carries a protocol account or social id are
bound, bots and unnamed clients are not. Each ranked result is also recorded in the player-progress
file (`player-progress.json`, see [save-format.md](save-format.md)), so standings survive a restart
and are rebuilt from it. If the ring is full, the result is dropped and counted, and that match is
not ranked.

This is wired in for a match started from the startup menu's local lobby: the application prints
`Local standings: ...` after the match. A game launched directly from the command line with no
lobby does not rank matches.

## Online ranking extension point

Local progress and match records have their own storage and UI. Online ranking is optional and the
backend is replaceable. With no provider configured, enabling rankings reports that the service is
unavailable; it does not authenticate players, submit invented results or prevent ordinary play.
Single-player never starts the online ranking lifecycle.

### Connecting a service

Implement [`RankingServiceProvider`](../src/network/services/rankings.ts), then pass the instance and its game key through `ApplicationHost.rankings` when calling `Application.open`. The application already forwards this provider to its Q3 ranking owner and connects account UI actions, source match reports, disconnects and world retirement to it.

| Method | Responsibility |
|---|---|
| `begin(gameKey)` | Create a match and return its stable ID. |
| `login(match, request)` | Authenticate or create an account; return its ID/rank or an explicit denial. |
| `join(match, account)` | Associate the account with the match. |
| `report(match, report)` | Accept original integer/string statistic keys, preserving accumulation and player IDs. |
| `poll()` | Advance pending service operations when the backend requires it. |
| `logout(match, account)` | Release the player's participation. |
| `finish(match)` | Submit/finalize the match and release service resources. |

The provider owns its storage, transport, account policy and ranking formula. It can run entirely locally or connect to a remote service. Source statistic keys and match/account IDs cross the interface; source entity slots remain private to the current game. Requests are serialized, failed providers expose an unavailable state, and cleanup still attempts match finalization after a player cleanup failure.

The executable ships no `RankingServiceProvider` implementation. `LocalRankingService` above is not one: it ranks finished matches locally and does not implement this interface. This extension point does not provide compatibility with the original Quake III Global Rankings network protocol, its ranking formula or unmodified retail clients.
