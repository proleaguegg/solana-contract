# @tanv33/pro-league

TypeScript client for the ProLeague tournament & leaderboard program on Solana — escrowed prize pools, automated payouts, and on-chain platform fees.

Bracket tournaments and time-boxed leaderboards both settle on-chain: entry fees and sponsorships sit in a program-owned escrow that only the program can move, prizes are paid out by the program, and a platform fee is swept to the treasury when the event concludes. No custodial wallet.

Generated from the Anchor IDL with [Kinobi](https://github.com/metaplex-foundation/kinobi), built for [Umi](https://github.com/metaplex-foundation/umi).

- **Program ID:** `matchNmUczmPKteQb9BJ8gRgafaQpDh2oDZJGuLsHfR`
- **Clusters:** devnet runs the current release (2.1.1). Mainnet runs an earlier 2024 build; its upgrade to this release is pending.

## Install

```bash
npm install @tanv33/pro-league @metaplex-foundation/umi @metaplex-foundation/mpl-toolbox
```

`@metaplex-foundation/umi` is a peer dependency. `mpl-toolbox` is needed for associated-token-account helpers.

## Setup

Register the program as a Umi plugin:

```ts
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { keypairIdentity, UmiPlugin } from '@metaplex-foundation/umi';
import { createTournamentProgram } from '@tanv33/pro-league';

const proLeague = (): UmiPlugin => ({
  install(umi) {
    umi.use(mplToolbox());
    umi.programs.add(createTournamentProgram(), false);
  },
});

const umi = createUmi('https://api.devnet.solana.com').use(proLeague());
umi.use(keypairIdentity(driverKeypair));
```

Most instructions must be signed by the program's **driver** key — the automated operator that advances a tournament. Account defaults (PDAs and associated token accounts) are resolved for you, so you generally pass wallets and the client derives the rest.

## Tournaments

### Lifecycle

```
initialize → sponsorTournament? → publishTournament → joinTournament / leaveTournament
  → announceTournament → addWinner → markWinnerWonNextRound → sendPrize → closeTournament
```

Cancellation path: `pauseTournament → refundJoiningFees + refundSponsor → refundCreatorAndCancelTournament`.

### Create and publish

```ts
import {
  initialize,
  publishTournament,
  findTournamentPda,
  findGlobalPda,
} from '@tanv33/pro-league';

const tournamentId = 'summer-cup-01'; // max 28 chars
const tournament = findTournamentPda(umi, { tournamentId });

await initialize(umi, {
  driver,
  creator,                       // signs; pays the fee for a non-whitelisted mint
  creatorInfo: creator.publicKey,
  global: findGlobalPda(umi),
  tournamentId,
  joiningFees: 10_000_000,       // entry fee per player, in base units
  totalPlayers: 8,               // must be a power of two, >= 2
  winningRounds: 2,
  platformFeeBps: 2000,          // 20% — capped at 3000 (30%)
  mint,
}).sendAndConfirm(umi);

// Sets the prize ladder. Index 0 is the champion, index 1 the runner-up tier,
// index 2 pays 2 players, index 3 pays 4, and so on.
// The creator funds the prize pool plus the platform fee on it (minus anything
// already in escrow, e.g. a sponsorship). Entry fees do not fund the pool.
await publishTournament(umi, {
  creator,                       // must match the recorded creator
  tournament,
  joiningFees: null,             // null keeps the fee set at initialize
  roundPrizes: [40_000_000, 30_000_000],
  mint,
}).sendAndConfirm(umi);
```

`publishTournament` can only be called **once**, and only while no player has joined. Every tournament instruction that moves tokens (except the recovery-only `destroyTournament`) must be passed the tournament's own `mint`; any other mint fails with `InvalidMint`.

### Join, play, pay out

```ts
import {
  joinTournament,
  addWinner,
  markWinnerWonNextRound,
  sendPrize,
  closeTournament,
} from '@tanv33/pro-league';
import { findAssociatedTokenPda } from '@metaplex-foundation/mpl-toolbox';

await joinTournament(umi, {
  driver,
  player,                        // must sign when joiningFees > 0
  playerInfo: player.publicKey,
  // pass explicitly: this account is optional, so it is not auto-derived
  playerTokenAccount: findAssociatedTokenPda(umi, {
    mint,
    owner: player.publicKey,
  }),
  tournament,
  mint,
}).sendAndConfirm(umi);

// Record a result, then flag anyone who advanced so they cannot claim that
// round's prize — they get paid for the round they are eliminated in.
await addWinner(umi, { tournament, driver, winner, roundIndex: 0 })
  .sendAndConfirm(umi);
await markWinnerWonNextRound(umi, { tournament, driver, winner, roundIndex: 1 })
  .sendAndConfirm(umi);

await sendPrize(umi, { tournament, driver, winner, mint, roundIndex: 0 })
  .sendAndConfirm(umi);

// Sweeps the platform fee to the treasury, the remainder to the creator, and
// closes the escrow. Every recorded entry must be paid or advanced first.
await closeTournament(umi, {
  tournament,
  creatorTokenAccount: findAssociatedTokenPda(umi, {
    mint,
    owner: creator.publicKey,
  }),
  treasury,                      // must equal the program's treasury constant
  driver,
  mint,
}).sendAndConfirm(umi);
```

### Reading state

```ts
import { safeFetchTournament } from '@tanv33/pro-league';

const t = await safeFetchTournament(umi, tournament);
t?.players;        // enrolled wallets
t?.rounds;         // prize per round + winner/claim status
t?.pendingFees;    // platform fee accrued, swept at close
t?.platformFeeBps; // fixed for the life of the tournament
```

## Leaderboards

A separate, time-boxed prize-pool product in the same program. All funds sit in one leaderboard-owned escrow; each inflow splits into the prize pool and the platform fee.

```
initializeLeaderboard → publishLeaderboard → joinLeaderboard / depositSponsorship
  → concludeLeaderboard → sendPrizeLeaderboard (per slot) → cleanupLeaderboard (batches) → closeLeaderboard
```

```ts
import {
  initializeLeaderboard,
  joinLeaderboard,
  concludeLeaderboard,
  sendPrizeLeaderboard,
  findLeaderboardPda,
  safeFetchLeaderboard,
  LeaderboardState,
} from '@tanv33/pro-league';

const leaderboard = findLeaderboardPda(umi, { leaderboardId });

await initializeLeaderboard(umi, {
  driver,
  creator,                       // signs; required for a non-whitelisted mint
  creatorInfo: creator.publicKey,
  leaderboardId,                 // max 28 chars
  startTimestamp,
  endTimestamp,                  // 1 hour to 7 days after start
  sponsorCutoff,
  buyInAmount,
  minParticipants,
  maxParticipants,
  payoutSlotsBps: [6000, 4000],  // must sum to 10000, max 10 slots
  platformFeeBps: 2000,
  mint,
}).sendAndConfirm(umi);
```

Prizes must be paid in strict `slotIndex` order — `sendPrizeLeaderboard` rejects an out-of-order or already-paid slot, and a participant who already received a slot (`ParticipantAlreadyPaid`). Check that winners are distinct before sending.

After the last slot is paid, close every `Participant` and `Sponsor` account with `cleanupLeaderboard` before `closeLeaderboard`; the rent returns to the driver. Pass up to ~30 addresses per transaction. Already-closed addresses are skipped, so a retried batch is safe. Progress is `closedParticipantCount` / `closedSponsorCount` against `participantCount` / `sponsorCount`.

```ts
await cleanupLeaderboard(umi, {
  driver,
  leaderboard,
  accounts: [participantPdaA, participantPdaB, sponsorPda], // findParticipantPda / findSponsorPda
}).sendAndConfirm(umi);
```

## Fees and refunds

**Tournaments (since 2.1.0): the fee is charged on the prize pool, at publish.**

```
pool = Σ roundPrizes[i] × payees(i)        payees = 1, 1, 2, 4, 8, …
fee  = floor(pool × platformFeeBps / 10000)
```

| Step | Effect |
|---|---|
| `publishTournament` | `pendingFees = fee`; creator funds `pool + fee − escrow balance` |
| `joinTournament` / `sponsorTournament` | Full amount enters escrow; no fee. A sponsorship made before publish counts toward the creator's `pool + fee` |
| `closeTournament` | `pendingFees` → treasury, remainder (entry fees included) → creator, escrow closed |

Winners receive the full advertised prize. Refunds (`leaveTournament`, `refundJoiningFees`, `refundSponsor`) return the full amount.

**Leaderboards: the fee is booked on every inflow and paid at conclude.** Each buy-in and sponsorship splits into `prizePool` and `pendingFees` (`floor(gross × bps / 10000)`). `concludeLeaderboard` sweeps `pendingFees` to the treasury; a cancelled leaderboard refunds the full gross, fee included.

## Error handling

A failed transaction throws the matching error class (`<Name>Error`, with `code` and `name`). Tournament errors use codes 6000+, leaderboard errors 7000+:

```ts
import { SponsorCutoffInvalidError, WinnerAlreadyPaidError } from '@tanv33/pro-league';

try {
  await builder.sendAndConfirm(umi);
} catch (e) {
  if (e instanceof WinnerAlreadyPaidError) { /* slot already paid: treat as done */ }
}
```

Leaderboard errors whose name also exists in the tournament list carry a `Leaderboard` prefix in the SDK only (`LeaderboardInvalidMintError`, `LeaderboardPlayerAlreadyJoinedError`, `LeaderboardUnauthorizedError`, `LeaderboardInvalidFeeError`, `LeaderboardInvalidTreasuryError`, `LeaderboardSponsorshipClosedError`, `LeaderboardOverFlowError`). The program log keeps the plain name, e.g. `Error Code: InvalidMint. Error Number: 7025.`

Codes worth handling explicitly:

| Error | Meaning |
|---|---|
| `InvalidMint` | `mint` is not the tournament's (or leaderboard's) mint |
| `InvalidFee` | `platformFeeBps` above the 30% cap |
| `InvalidPlayerCount` | `totalPlayers` not a power of two, or below 2 |
| `TournamentPublished` | `publishTournament` called twice |
| `WrongCreator` | signer is not the recorded creator |
| `TournamentNotPublished` | `announceTournament` or `joinTournament` before publish |
| `BracketsIsAnnounced` | `joinTournament` or `leaveTournament` after announce |
| `SponsorshipClosed` | sponsoring a tournament that is paused for cancellation |
| `TournamentIsPaused` | join, payout or close on a tournament paused for cancellation |
| `InsufficientCreatorFunds` | creator cannot cover `pool + fee` at publish |
| `PrizePoolRequired` | an entry fee with no prize pool |
| `PrizeNotClaimed` | closing while a winner is still owed a prize |
| `InvalidTreasury` | treasury account does not match the program constant |
| `WinnerAlreadyPaid` | leaderboard slot already paid |
| `ParticipantAlreadyPaid` | leaderboard participant already received a slot |
| `CleanupNotComplete` | `closeLeaderboard` before every participant/sponsor account was cleaned up |

Duplicate refunds surface as Anchor's `AccountNotInitialized` (`3012`), because the participant/sponsor account is closed on a successful refund.

## Changes in 3.1.0

- **Breaking:** leaderboard error codes move from 6000–6032 to **7000–7032** (same order, same names and messages). They used to share numbers with tournament errors, so the SDK reported leaderboard failures under tournament names (6011 `SponsorCutoffInvalid` surfaced as `PlayerMustBeSigner`). Every leaderboard error now has its own SDK error class. Code that compares leaderboard error numbers must add 1000; code that matches names or messages needs no change.

## Changes in 3.0.0

- **Breaking:** `destroyTournament`, `transposeTournamentCreator` and `transposeTournamentPlayer` are recovery tools for the program upgrade authority, no longer the driver. They take `authority`, `programData` and `program` (same as `initGlobal`) instead of `driver`. A non-authority signer fails with `Unauthorized` (6029).
- `destroyTournament` only pays the escrow to the creator recorded on the tournament; any other `creator` fails with `WrongCreator` (6025). Account rent returns to the authority.
- `transposeTournamentPlayer` rejects a `newPlayer` already in the tournament with `PlayerAlreadyJoined` (6008).
- `closeTournament` on an **unpublished** tournament that holds sponsor money fails with `SponsorAmountNotRefunded` (6021). Cancel it instead: `pauseTournament` → `refundSponsor` → `refundCreatorAndCancelTournament`. Published tournaments and unsponsored drafts close as before.
- `sendPrizeLeaderboard` pays a participant at most one slot; a second slot to the same wallet fails with `ParticipantAlreadyPaid` (6031). A retry of an already-paid slot still returns `WinnerAlreadyPaid` first. `Participant` gains a `prizePaid` field.
- New `cleanupLeaderboard` (driver): after all slots are paid on a concluded leaderboard, closes the `Participant` / `Sponsor` accounts passed as `accounts` and returns their rent to the driver. `closeLeaderboard` on a concluded leaderboard now fails with `CleanupNotComplete` (6032) until every one is closed.
- **Breaking:** `Leaderboard.refundedPlayerCount` / `refundedSponsorCount` are renamed `closedParticipantCount` / `closedSponsorCount`. They count accounts closed by a refund (cancel path) or by `cleanupLeaderboard` (conclude path).

## Changes in 2.2.0

- **Breaking:** `sponsorTournament` now requires the operator's signature. Pass `driver` (a `Signer`) alongside `sponsor`; both must sign.
- `joinTournament` is only accepted between `publishTournament` and `announceTournament`. Joining before publish fails with `TournamentNotPublished` (6038), and after announce with `BracketsIsAnnounced` (6035).

## Changes in 2.1.1

- Every tournament instruction now checks that `mint` is the tournament's mint (new error `InvalidMint`, 6044). Callers already passing the right mint need no change.

## Changes in 2.1.0

- The tournament platform fee moved from entry fees to the prize pool (see [Fees and refunds](#fees-and-refunds)). No instruction signatures changed.

## Breaking changes in 2.0.0

- `initialize` now requires **`platformFeeBps`** (0–3000).
- `closeTournament` now requires a **`treasury`** account matching the program constant.
- `totalPlayers` must be a power of two and at least 2.
- `publishTournament` is single-use and creator-bound.
- `announceTournament` requires the tournament to be published first.

## License

Proprietary. Copyright (c) 2023-2026 ProLeague. All rights reserved. Evaluation,
auditing and security research are permitted; any other use needs written
permission. See [LICENSE](LICENSE).
