# Tournament — Off-Chain Integration Guide

How the on-chain bracket tournament works and how the backend (MongoDB + APIs +
workers) should mirror it. Companion to `LEADERBOARD_OFFCHAIN.md`; same program,
different product.

- **Program ID:** `matchNmUczmPKteQb9BJ8gRgafaQpDh2oDZJGuLsHfR` (devnet + mainnet)
- **SDK:** `@tanv33/pro-league@^2.0.0` — every instruction builder, PDA finder and
  account fetcher used below is exported from it.

> **2.0.0 is a breaking upgrade.** `initialize` now requires `platformFeeBps`;
> `closeTournament` now requires a `treasury` account. Code on 1.x will fail
> against the current program. See §12.

---

## 1. Responsibility split — who owns what

The chain owns **money and state transitions**. The backend owns **identity,
match results, and orchestration**. The chain has no idea who actually won a
match — the backend decides and tells the chain which wallet to record.

| Concern | Owner | Notes |
|---|---|---|
| Holding entry fees + sponsorship (escrow) | **On-chain** | one token account per tournament |
| Prize funding guarantee | **On-chain** | publish reverts if the ladder is underfunded |
| Payouts, refunds, fee sweep | **On-chain** | source of truth for all balances |
| Bracket seeding, match scheduling, results | **Off-chain** | Mongo |
| Who a player is, usernames, game accounts | **Off-chain** | Mongo |
| Deciding winners → recording them | **Off-chain → signs on-chain** | driver key |
| Anti-cheat, disputes | **Off-chain** | resolve before recording a result |

Almost every write is signed by the **`DRIVER`** wallet (backend hot wallet).
`publishTournament` must be signed by the **creator**, `pauseTournament` by driver
**and** creator, and a paid `joinTournament` by the **player**.

---

## 2. Constants & hard constraints (validate in the API layer too)

| Constant | Value | Meaning |
|---|---|---|
| tournament id length | **28** chars | PDA seed, must be unique and never reused |
| `totalPlayers` | **power of two, ≥ 2** | 2, 4, 8, 16, 32, 64, 128 … |
| `PLATFORM_FEE_BPS_MAX` | **3000** | `platformFeeBps` ≤ 3000 (30%) |
| `TOTAL_BPS` | **10000** | basis-point denominator |
| `NON_WHITELISTED_CREATION_FEE` | **0.001 SOL** | charged to the creator when the mint isn't whitelisted |
| `TREASURY` | fixed pubkey | fee destination, **differs between dev and prod builds** |

Rules the program enforces — mirror them so you fail before spending a transaction:

- `totalPlayers` must be a power of two and at least 2. A non-power-of-two wedges
  the account (it is sized with `log2()` truncated while publish builds
  `log2().ceil()` rounds) **after entry fees are already escrowed**.
- `platformFeeBps ≤ 3000`.
- Tournament ids must be unique. A closed tournament frees its PDA, so **reusing
  an id lets a stale retry land on a brand-new tournament.** Never reuse.

> **Amounts are token base units** (raw `u64`), never display units. Apply the mint's
> `decimals`: USDC (6 dp) `$5 = 5_000_000`. Store the raw value **as a string or
> `Decimal128`** and do arithmetic with `BigInt` — `u64` overflows JS `number`.

---

## 3. On-chain accounts

### 3.1 `Tournament` — PDA seeds `["TOURNAMENT_STATE", tournamentId]`

| Field | Type | Notes |
|---|---|---|
| `bump` | u8 | |
| `creator` | Pubkey | receives the leftover pot at close; mutable via `transposeTournamentCreator` |
| `joiningFees` | u64 | entry fee per player, base units |
| `totalPlayers` | u16 | bracket size, power of two |
| `totalRounds` | u16 | `log2(totalPlayers)` |
| `isPublished` | bool | prize ladder set; **one-way, single-use** |
| `isAnnounced` | bool | roster frozen, no more leaving |
| `isPaused` | bool | cancellation in progress |
| `isSponsored` | bool | |
| `tournamentId` | String | ≤ 28 chars |
| `players` | Vec\<Pubkey\> | enrolled wallets, in join order — **this ordering is the bracket index** |
| `rounds` | Vec\<Round\> | see §4 |
| `sponsor` | Pubkey | |
| `sponsorAmount` | u64 | gross, reset to 0 on refund |
| `mint` | Pubkey | |
| `platformFeeBps` | u16 | **immutable after initialize** |
| `pendingFees` | u64 | fee accrued so far, swept at close |

`Round`: `{ reverseIndex: u8, winningPrice: u64, winnersAndCollectedStatus: HashMap<u32, RoundWinners> }`
`RoundWinners`: `{ wonNextRound: bool, claimed: bool }`

The HashMap key is the **player's index in `players`**, not a pubkey.

### 3.2 `Global` — PDA seeds `["GLOBAL", programId]`

Holds `whitelistMint: Vec<Pubkey>`. If a tournament's mint is absent, the creator
must sign `initialize` and pays 0.001 SOL to the driver. Managed only by the
program's upgrade authority. **From SDK 2.0.0 this account auto-derives** — stop
passing it.

### 3.3 Escrow token account

The tournament's associated token account for `mint`. Holds entry fees, sponsorship
and any creator top-up. Closed at the end; its rent returns to the driver.

---

## 4. The bracket model — read this twice

This is the least intuitive part of the program and the easiest thing to get wrong.

`rounds[i].reverseIndex == i`, and round `i` has capacity **2^i** entries. Round
index counts **distance from the trophy**, not play order:

| Round index | Capacity | Who lives here | Payouts from this round |
|---|---|---|---|
| 0 | 1 | the champion | 1 |
| 1 | 2 | the two finalists | 1 (the runner-up) |
| 2 | 4 | the four semifinalists | 2 |
| 3 | 8 | the eight quarterfinalists | 4 |

A player recorded in round `i` either **advanced** (`wonNextRound = true`, so they
get paid from a lower round index) or **was eliminated at that depth** and claims
`rounds[i].winningPrice`. So the number of payouts per round is `1, 1, 2, 4, 8 …` —
exactly the multiplier `publishTournament` uses to total the ladder.

**Consequence for `roundPrizes`:** index 0 is the champion's prize, index 1 the
runner-up's, index 2 is paid to *each* semifinal loser, index 3 to *each*
quarterfinal loser. Total cost is:

```
totalPrizeSum = p[0]*1 + p[1]*1 + p[2]*2 + p[3]*4 + …
```

Rounds you leave out of `roundPrizes` get `winningPrice = 0` and pay nobody.

**There is no dedicated "3rd place" slot.** If your product promises one, price it
into the round-2 tier (both semifinal losers get the same amount) or handle it
off-chain.

### Recording results

For each round, after matches resolve:

1. `addWinner(roundIndex, winner)` for every player who reached that depth.
2. `markWinnerWonNextRound(roundIndex, winner)` for the subset who advanced.
3. `sendPrize(roundIndex, winner)` for those who did **not** advance.

`addWinner` rejects a duplicate **within a round** but not across rounds — the
backend must not record the same wallet in two rounds, or it can be paid twice.

---

## 5. Lifecycle & the pause lock

```
initialize → [sponsorTournament] → publishTournament → joinTournament / leaveTournament
           → announceTournament → addWinner / markWinnerWonNextRound → sendPrize
           → closeTournament
```

Cancellation:

```
pauseTournament → refundJoiningFees (per player) + refundSponsor
                → refundCreatorAndCancelTournament
```

`isPaused` is a **hard lock**, not a hint. The guard matrix:

| Instruction | Rule |
|---|---|
| `joinTournament`, `sponsorTournament`, `sendPrize`, `closeTournament` | **blocked while paused** |
| `refundJoiningFees`, `refundSponsor`, `refundCreatorAndCancelTournament` | **require paused** |
| `leaveTournament` | allowed until `isAnnounced`; no pause rule |

Other one-way rules worth encoding in your API:

- **`publishTournament` is single-use and creator-bound.** A second call fails.
- **The entry fee freezes once anyone joins** — passing `joiningFees` to publish
  after the first join fails.
- **`announceTournament` requires `isPublished`.** Players can't be locked in
  before the prizes exist.
- **`closeTournament` requires every recorded entry to be paid or advanced.**

---

## 6. Money math

### Fee booking

The platform fee is **booked on every inflow and paid once, at close**:

| Step | Effect |
|---|---|
| `joinTournament` | full gross → escrow; `pendingFees += floor(gross × bps / 10000)` |
| `sponsorTournament` | same |
| `leaveTournament`, `refundJoiningFees`, `refundSponsor` | reverse the booking, refund **full gross** |
| `closeTournament` | `pendingFees` → treasury, remainder → creator, escrow closed |

Nothing reaches the treasury until close. A cancelled tournament earns the platform
**zero** — that is deliberate, so refunds never have to claw back from the treasury.

**If you never call `closeTournament`, you never collect.** Closing finished
tournaments is the revenue step; make it a monitored job, not a manual chore.

### The publish funding check

At publish the program computes:

```
availableNet   = escrowBalance - pendingFees
netPerPlayer   = joiningFees - floor(joiningFees × bps / 10000)
remainingSlots = totalPlayers - players.length
projected      = availableNet + netPerPlayer × remainingSlots
shortfall      = max(0, totalPrizeSum - projected)
```

The creator transfers `shortfall` immediately, in the same transaction, and that
top-up is **not** fee'd. If `shortfall > 0` the creator's token account must hold it
or publish fails — surface this in the UI *before* submitting.

### Worked example — 8 players, 10 USDC entry, 20% fee, ladder [40, 30]

```
gross in      80 (entries) + 20 (sponsor) = 100
pendingFees   16 + 4                      =  20
net available                             =  80
totalPrizeSum 40×1 + 30×1                 =  70   → no creator top-up
paid out      champion 40, runner-up 30   =  70
at close      treasury 20, creator 10
```

Mirror this math off-chain for previews — but treat the chain as truth.

---

## 7. Suggested MongoDB models

### `tournaments`
```jsonc
{
  "tournamentId": "summer-cup-01",       // unique, ≤28 chars, NEVER reused
  "pda": "…",
  "mint": "…",
  "decimals": 6,
  "creator": "…",
  "joiningFees": "10000000",             // string — base units
  "totalPlayers": 8,
  "totalRounds": 3,
  "platformFeeBps": 2000,
  "roundPrizes": ["40000000", "30000000"],
  "state": "draft",                      // draft|published|open|announced|running|settling|closed|cancelled
  "isPublished": false,
  "isAnnounced": false,
  "isPaused": false,
  "pendingFees": "0",                    // mirrored from chain
  "escrowAta": "…",
  "sponsor": null,
  "sponsorAmount": "0",
  "lastSyncedSlot": 0,
  "createdAt": ISODate
}
```
Indexes: unique `tournamentId`; `{ state }`; `{ "state": 1, "createdAt": -1 }`.

### `tournament_players`
```jsonc
{
  "tournamentId": "…",
  "userId": ObjectId,
  "wallet": "…",
  "playerIndex": 3,                      // position in on-chain `players` — the bracket key
  "joinTxn": "…",
  "status": "joined",                    // joined|left|refunded
  "feePaid": "10000000"
}
```
Indexes: unique `{ tournamentId, wallet }`; `{ tournamentId, playerIndex }`.

### `matches`
```jsonc
{
  "tournamentId": "…",
  "roundIndex": 2,                       // distance from trophy, see §4
  "slot": 0,
  "playerA": "…", "playerB": "…",
  "winner": "…",
  "status": "pending",                   // pending|reported|disputed|final
  "reportedAt": ISODate
}
```
Only a `final` match may drive an `addWinner` job.

### `round_results` (what has been written on-chain)
```jsonc
{
  "tournamentId": "…",
  "roundIndex": 1,
  "wallet": "…",
  "playerIndex": 3,
  "addedOnChain": true,
  "wonNextRound": false,
  "prizePaid": true,
  "prizeAmount": "30000000",
  "payoutTxn": "…"
}
```
Indexes: unique `{ tournamentId, roundIndex, wallet }`.

### `onchain_jobs` (idempotent worker queue)
```jsonc
{
  "kind": "sendPrize",
  "tournamentId": "…",
  "args": { "roundIndex": 1, "winner": "…" },
  "status": "pending",                   // pending|submitted|confirmed|failed
  "attempts": 0,
  "lastError": null,
  "txn": null,
  "idempotencyKey": "summer-cup-01:sendPrize:r1:<wallet>",
  "createdAt": ISODate
}
```
Indexes: unique `idempotencyKey`; `{ status, kind }`.

---

## 8. Suggested API surface

State-changing endpoints enqueue an `onchain_jobs` doc and return `202` with a job
id. Reads serve from Mongo and reconcile against chain on demand.

**Organizer**
- `POST /tournaments` → validate §2, enqueue `initialize`
- `POST /tournaments/:id/publish` → body `{ roundPrizes[] }`; return the computed
  shortfall first so the creator can approve funding
- `POST /tournaments/:id/announce` → requires published + roster full
- `POST /tournaments/:id/pause` → begins cancellation (needs creator signature)
- `POST /tournaments/:id/close` → the revenue step

**Player**
- `POST /tournaments/:id/join` → needs the player's signature when `joiningFees > 0`
- `POST /tournaments/:id/leave` → only before `isAnnounced`

**Sponsor**
- `POST /tournaments/:id/sponsor` → **only before publish** in practice; see §11

**Results**
- `POST /tournaments/:id/matches/:matchId/result` → writes Mongo only
- `POST /tournaments/:id/rounds/:roundIndex/commit` → enqueues `addWinner` +
  `markWinnerWonNextRound` + `sendPrize` for that round

**Read**
- `GET /tournaments/:id` (mirror), `GET /tournaments/:id/bracket`,
  `GET /tournaments/:id/onchain` (live fetch for reconciliation)

---

## 9. Call shapes that bite

Three accounts are **not** auto-derived. Passing them is mandatory:

```ts
import { findAssociatedTokenPda } from '@metaplex-foundation/mpl-toolbox';

// paid join — playerTokenAccount is an optional account, so the SDK does NOT
// derive it. Omit it and the program panics on an unwrap.
await joinTournament(umi, {
  driver,
  player,                                  // must sign when joiningFees > 0
  playerInfo: player.publicKey,
  playerTokenAccount: findAssociatedTokenPda(umi, { mint, owner: player.publicKey }),
  tournament,
  mint,
}).sendAndConfirm(umi);

// close — creatorTokenAccount and treasury are both required
await closeTournament(umi, {
  tournament,
  creatorTokenAccount: findAssociatedTokenPda(umi, { mint, owner: creatorPubkey }),
  treasury: TREASURY_PUBKEY,               // must equal the program constant
  driver,
  mint,
}).sendAndConfirm(umi);
```

`TREASURY` differs between dev and prod builds — keep it in config per cluster, never
hardcode one value in shared code.

---

## 10. Idempotency & error handling

Workers must be safe to retry. Treat these as **terminal success**, not failure:

| Error | Instruction | Means |
|---|---|---|
| `PlayerAlreadyJoined` | `joinTournament` | already joined — mark confirmed |
| `WinnerAlreadyExists` | `addWinner` | already recorded |
| `AlreadyClaimed` | `sendPrize` | already paid |
| `TournamentPublished` | `publishTournament` | already published |
| `AccountNotInitialized` (3012) | any | tournament already closed/destroyed |

Treat these as **bugs in your orchestration** — stop and alert, don't retry:

| Error | Meaning |
|---|---|
| `InvalidFee` | `platformFeeBps` > 3000 |
| `InvalidPlayerCount` | `totalPlayers` not a power of two, or < 2 |
| `WrongCreator` | publishing with the wrong signer |
| `TournamentNotPublished` | announced before publishing |
| `SponsorshipClosed` | sponsoring a paused tournament |
| `TournamentIsPaused` | join/pay/close during cancellation |
| `TournamentNotPaused` | refunding outside cancellation |
| `PrizeNotClaimed` | closing with a winner still owed |
| `ExpectedWinnerLength` | round has fewer entries than its capacity |
| `InvalidTreasury` | wrong treasury account for the cluster |
| `WonNextRound` | paying a player who advanced |

**Transport failures are not program failures.** Devnet RPC drops a large share of
concurrent connections (`fetch failed`, `ETIMEDOUT`). Retry those with the **same
blockhash** so the signature is identical and the cluster de-duplicates instead of
double-executing. Cap concurrency — batching 8+ sends through `Promise.all` is what
triggers the drops.

---

## 11. Known sharp edges

Behaviours that are working as designed but will surprise you:

- **Sponsoring after publish still succeeds.** The prize ladder is frozen at publish
  and cannot be raised, so late sponsor money becomes creator margin at close, not
  bigger prizes. Refuse late sponsorships at the API layer, or refund them
  (`refundSponsor` works at any point in a cancellation).
- **No minimum prize floor.** A tournament can charge entry and pay nothing. Enforce
  a floor in your API — it is deliberately not on-chain so you can tune it.
- **An under-filled bracket shorts the treasury, not the winners.** If players leave
  after publish, prizes can exceed net funds; the close-time clamp absorbs the
  difference from the fee. Don't announce a bracket that isn't full.
- **`destroyTournament` refunds nobody.** It is a raw teardown: it sweeps the entire
  escrow to whatever wallet is passed as `creator` and closes the accounts, with no
  per-player refunds and no state checks. Emergency use only — prefer the proper
  cancel path.
- **`transposeTournamentCreator` redirects the leftover sweep**, since close pays
  `tournament.creator`. Treat it as a privileged operation and audit it.

---

## 12. Migrating to SDK 2.0.0

1. Add `platformFeeBps` to every `initialize` call (0–3000).
2. Add `treasury` to every `closeTournament` call, per cluster.
3. Drop `global` from call sites — it now auto-derives.
4. Ensure `totalPlayers` is a power of two ≥ 2.
5. Publish exactly once, with the recorded creator signing.
6. Announce only after publishing.
7. Handle the new error codes in §10.
8. Mirror `platformFeeBps` and `pendingFees` into your `tournaments` collection.

---

## 13. Reconciliation & operations

- **Chain is truth.** Re-fetch the `Tournament` account after every confirmed job and
  overwrite the mirror; never let Mongo win a disagreement about money.
- **Sweep job:** find `state != closed` tournaments whose prizes are all paid and
  enqueue `closeTournament`. Unclosed tournaments are uncollected revenue and
  locked rent.
- **Balance alarm:** alert when the escrow balance is below `pendingFees` — it means
  prizes overdrew the pot and the treasury is about to be shorted.
- **Driver wallet:** it pays rent and fees for every write, including `init_if_needed`
  token accounts for players. Monitor its SOL balance; a drained driver halts
  everything.
- **Never reuse a tournament id.** Closing frees the PDA, so a replayed job could
  land on a different tournament.
