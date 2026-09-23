# Ranking service extension point

The ranking backend is the project's **only permitted placeholder**. On September 22, 2026, the project owner accepted a replaceable service interface instead of requiring the original Quake III Global Rankings service. This exception does not permit placeholders, simulated success or unimplemented behavior elsewhere.

Local progress and match records already have their own storage and UI. Online ranking is optional. With no provider configured, enabling rankings reports that the service is unavailable; it does not authenticate players, submit invented results or prevent ordinary play. Single-player never starts the online ranking lifecycle.

## Connecting a future service

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

The provider owns its storage, transport, account policy and ranking formula. It can run entirely locally or connect to a service we build later. Source statistic keys and match/account IDs cross the interface; source entity slots remain private to the current game. Requests are serialized, failed providers expose an unavailable state, and cleanup still attempts match finalization after a player cleanup failure.

The current command-line executable does not include a local or online implementation of this provider. Supplying one is future backend work, explicitly allowed by this exception. This extension point does not establish compatibility with the old service's network protocol, historical ranking formula or unmodified retail clients.

## Acceptance

T19's required scope is local progress/records and the working ranking extension point. The old GRank transport is no longer a completion blocker. Existing focused checks cover account acceptance/denial, report delivery, absent providers, single-player isolation, provider failures and cleanup. Local progress and record browsing have separate existing checks.
