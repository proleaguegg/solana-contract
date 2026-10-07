# @tanv33/pro-league

TypeScript client for the ProLeague tournament & leaderboard program on Solana — escrowed prize pools, automated payouts, and on-chain platform fees.

Bracket tournaments and time-boxed leaderboards both settle on-chain: entry fees and sponsorships sit in a program-owned escrow that only the program can move, prizes pay out to winners automatically, and a configurable platform fee is swept to the treasury when the event concludes. No custodial wallet, no manual payout step.

Generated from the Anchor IDL with [Kinobi](https://github.com/metaplex-foundation/kinobi), built for [Umi](https://github.com/metaplex-foundation/umi).

- **Program ID:** `matchNmUczmPKteQb9BJ8gRgafaQpDh2oDZJGuLsHfR`
- **Clusters:** devnet, mainnet-beta

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
// The creator must cover any shortfall between expected net entry fees and the
// prizes promised — the program will not publish an underfunded pool.
await publishTournament(umi, {
  creator,                       // must match the recorded creator
  tournament,
  joiningFees: null,             // null keeps the fee set at initialize
  roundPrizes: [40_000_000, 30_000_000],
  mint,
}).sendAndConfirm(umi);
```

`publishTournament` can only be called **once**, and the entry fee can no longer change after the first player joins.

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
  → concludeLeaderboard → sendPrizeLeaderboard (per slot) → closeLeaderboard
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
  creator,
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

Prizes must be paid in strict `slotIndex` order — `sendPrizeLeaderboard` rejects an out-of-order or already-paid slot.

## Fees and refunds

The platform fee is **booked on every inflow and paid once, at the end**:

| Step | Effect |
|---|---|
| `joinTournament` / `sponsorTournament` | Full gross enters escrow; `pendingFees += floor(gross × bps / 10000)` |
| `closeTournament` | `pendingFees` → treasury, remainder → creator, escrow closed |

Because the fee is only booked until the event concludes, **refunds return the full gross**. `leaveTournament`, `refundJoiningFees` and `refundSponsor` each reverse the booked fee — a cancelled event earns the platform nothing.

## Error handling

Program errors are typed and parsed from transaction logs:

```ts
import { TournamentError, LeaderboardError } from '@tanv33/pro-league';
```

Codes worth handling explicitly:

| Error | Meaning |
|---|---|
| `InvalidFee` | `platformFeeBps` above the 30% cap |
| `InvalidPlayerCount` | `totalPlayers` not a power of two, or below 2 |
| `TournamentPublished` | `publishTournament` called twice |
| `WrongCreator` | signer is not the recorded creator |
| `TournamentNotPublished` | `announceTournament` before publish |
| `SponsorshipClosed` | sponsoring a tournament that is paused for cancellation |
| `PrizeNotClaimed` | closing while a winner is still owed a prize |
| `InvalidTreasury` | treasury account does not match the program constant |
| `WinnerAlreadyPaid` | leaderboard slot already paid |

Duplicate refunds surface as Anchor's `AccountNotInitialized` (`3012`), because the participant/sponsor account is closed on a successful refund.

## Breaking changes in 2.0.0

- `initialize` now requires **`platformFeeBps`** (0–3000).
- `closeTournament` now requires a **`treasury`** account matching the program constant.
- `totalPlayers` must be a power of two and at least 2.
- `publishTournament` is single-use and creator-bound.
- `announceTournament` requires the tournament to be published first.

## License

Proprietary. Copyright (c) 2023-2026 ProLeague. All rights reserved.
No use, copying, modification or distribution without prior written
permission. See [LICENSE](LICENSE).
