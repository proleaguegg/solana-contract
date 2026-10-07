# Leaderboard — Off-Chain Integration Guide

How the on-chain leaderboard program works and how the backend (MongoDB + APIs +
workers) should mirror it. Written for the off-chain infra team.

- **Program ID:** `matchNmUczmPKteQb9BJ8gRgafaQpDh2oDZJGuLsHfR` (devnet; the mainnet deployment predates leaderboards and must be upgraded first)
- **SDK:** `@tanv33/pro-league@^2.1.1` (Umi-based TS client; every instruction
  builder + PDA finder + account fetcher used below is exported from it)

---

## 1. Responsibility split — who owns what

The chain owns **money + time + state transitions**. The backend owns **identity,
scoring, and orchestration**. The chain never knows who "won" — the backend decides
ranking off-chain and tells the chain which wallet to pay for each slot.

| Concern | Owner | Notes |
|---|---|---|
| Holding buy-ins + sponsorships (escrow) | **On-chain** | one pool token account per event |
| Enforcing timing (registration/sponsor cutoff/end) | **On-chain** | tx reverts if out of window |
| Prize pool math, fee split, payouts, refunds | **On-chain** | source of truth for all balances |
| Who a player is, usernames, game accounts | **Off-chain** | Mongo |
| Live scoring / ranking from game APIs | **Off-chain** | Mongo (snapshots) |
| Deciding winners + triggering payout | **Off-chain → signs on-chain** | driver key |
| Anti-cheat review | **Off-chain** | |

**Every on-chain write is signed by the `DRIVER` wallet** (the backend's hot wallet).
Some instructions additionally require the `creator`, `player`, or `sponsor` to sign —
in practice the backend co-signs on their behalf (server-custodied) or collects the
signature client-side. Treat the chain as the authority for funds; treat Mongo as a
fast, queryable **mirror + the home for everything the chain doesn't store.**

---

## 2. Constants & hard constraints (enforce these in the API layer too)

| Constant | Value | Meaning |
|---|---|---|
| `LEADERBOARD_ID_MAX_LEN` | **28** | `leaderboardId` is a string, max 28 chars, used as a PDA seed. Must be unique. |
| `MIN_LEADERBOARD_DURATION` | **3600 s** (1 h) | `endTimestamp - startTimestamp` ≥ this |
| `MAX_LEADERBOARD_DURATION` | **604800 s** (7 d) | and ≤ this |
| `MAX_PAYOUT_SLOTS` | **10** | `payoutSlotsBps.length` ∈ [1, 10] |
| `TOTAL_BPS` | **10000** | `payoutSlotsBps` must sum to exactly 10000 (100%) |
| `PLATFORM_FEE_BPS_MAX` | **3000** | `platformFeeBps` ≤ 3000 (30%) |
| `TREASURY` | fixed pubkey | fee + dust destination (hardcoded per cluster) |

Additional init rules the program enforces (mirror in API validation to fail fast
before spending a transaction):
- `startTimestamp > now`
- `0 ≤ sponsorCutoff < duration`
- `minParticipants > 0`, `minParticipants ≤ maxParticipants`, and
  **`minParticipants ≥ payoutSlotsBps.length`** (so every slot can be filled)

> **Amounts are in token base units** (raw `u64`), not display units. Apply the mint's
> `decimals`. e.g. USDC (6 dp): `$5 = 5_000_000`. BONK dev-mint (9 dp): `1 BONK = 1_000_000_000`.
> Store both the raw base-unit value and the mint's decimals in Mongo.

---

## 3. On-chain accounts (the data dictionary to mirror)

Field names below are the **SDK (camelCase)** names. Fetch with `safeFetchLeaderboard`,
`safeFetchParticipant`, `safeFetchSponsor`.

### 3.1 `Leaderboard` — PDA seeds `["LEADERBOARD", leaderboardId]`
| Field | Type | Meaning |
|---|---|---|
| `leaderboardId` | string(≤28) | unique id; also the PDA seed |
| `creator` | pubkey | organizer wallet |
| `mint` | pubkey | SPL token used for this event |
| `startTimestamp` | i64 | registration closes at this time |
| `endTimestamp` | i64 | competition ends; conclude allowed after |
| `sponsorCutoff` | i64 | **seconds before end** when sponsorship closes (deposit allowed while `now < endTimestamp - sponsorCutoff`) |
| `buyInAmount` | u64 | gross buy-in (0 = free event) |
| `buyInNet` | u64 | cached net after fee |
| `platformFeeBps` | u16 | fee in bps (e.g. 2000 = 20%) |
| `minParticipants` | u16 | conclude requires ≥ this |
| `maxParticipants` | u16 | join blocked at this |
| `payoutSlotsBps` | u16[] | payout split per rank; sums to 10000 |
| `state` | enum | `Draft`=0, `Open`=1, `Concluded`=2, `Cancelled`=3 |
| `prizePool` | u64 | net funds available to winners (drives payout math) |
| `pendingFees` | u64 | fees held in the pool until conclude |
| `participantCount` | u16 | current joined players |
| `sponsorCount` | u16 | distinct sponsors |
| `paidSlots` | u16 | how many prize slots have been paid (payout cursor) |
| `refundedPlayerCount` | u16 | refunds processed (cancel path) |
| `refundedSponsorCount` | u16 | refunds processed (cancel path) |
| `concludedAt` | i64 | unix ts of conclude (0 until concluded) |

### 3.2 `Participant` — PDA seeds `["PARTICIPANT", leaderboard, player]`
| Field | Type | Meaning |
|---|---|---|
| `leaderboard` | pubkey | parent |
| `player` | pubkey | player wallet |
| `grossContribution` | u64 | what they paid (buy-in) |
| `netContribution` | u64 | net added to pool |
| `joinedAt` | i64 | unix ts (non-zero once joined; `0` sentinel = not joined) |

> Closed (account removed) when the player **leaves** or is **refunded**.

### 3.3 `Sponsor` — PDA seeds `["SPONSOR", leaderboard, sponsor]`
| Field | Type | Meaning |
|---|---|---|
| `leaderboard` | pubkey | parent |
| `sponsor` | pubkey | sponsor wallet |
| `grossContribution` | u64 | total gross deposited (sums across deposits) |
| `netContribution` | u64 | total net added to pool |
| `lastDepositAt` | i64 | unix ts of last deposit |

> **Multiple sponsors supported.** One sponsor depositing twice **sums** onto the same
> account and `sponsorCount` stays the same (counts distinct sponsors, not deposits).

### 3.4 Pool token account
The escrow is the **associated token account of the leaderboard PDA** for `mint`
(`findAssociatedTokenPda({ mint, owner: leaderboardPda })`). Invariant:
`poolBalance == prizePool + pendingFees` (+ any external donations, which sweep to
treasury at close). Never move funds by hand — only the program can.

---

## 4. Instruction reference

All are driver-gated. "Also signs" = additional required signer. Preconditions are
enforced on-chain (listed so you don't waste transactions). SDK builder names in `code`.

| # | SDK builder | Also signs | State req | Key preconditions | Effect |
|---|---|---|---|---|---|
| 1 | `initializeLeaderboard(args)` | creator (only if mint **not** whitelisted → pays 0.001 SOL fee) | — | see §2 rules | creates Leaderboard (Draft) + pool ATA |
| 2 | `publishLeaderboard` | creator | Draft | — | → Open (registration/sponsorship open) |
| 3 | `joinLeaderboard` | player | Open | `now < start`, `participantCount < max`, not already joined | player pays `buyInAmount` → pool; creates Participant |
| 4 | `leaveLeaderboard` | — (player is ref) | Open | `now < start` | refunds full gross to player; closes Participant |
| 5 | `depositSponsorship({amount})` | sponsor | Open | `amount > 0`, `now < end - sponsorCutoff` | sponsor pays `amount` → pool; upserts Sponsor |
| 6 | `cancelLeaderboard` | creator (pre-start only) | Open | creator pre-start **OR** driver when `participantCount < min` after start | → Cancelled |
| 7 | `refundLeaderboardPlayer` | — | Cancelled | participant exists | refunds full gross; closes Participant |
| 8 | `refundLeaderboardSponsor` | — | Cancelled | sponsor exists | refunds full gross; closes Sponsor |
| 9 | `concludeLeaderboard` | — (+treasury acct) | Open | `now ≥ end`, `participantCount ≥ min` | sweeps `pendingFees` → treasury; → Concluded |
| 10 | `sendPrizeLeaderboard({slotIndex})` | — (+winner, participant) | Concluded | **`slotIndex == paidSlots`** (strict order), winner is enrolled | pays slot share to winner; `paidSlots++` |
| 11 | `closeLeaderboard` | — (+treasury acct) | Concluded **or** Cancelled | Concluded: `paidSlots == slots`; Cancelled: all refunds done | sweeps dust → treasury; closes pool + Leaderboard |

**`initializeLeaderboard` args:** `leaderboardId, startTimestamp, endTimestamp,
sponsorCutoff, buyInAmount, minParticipants, maxParticipants, payoutSlotsBps, platformFeeBps`.

**Account auto-resolution:** the SDK derives the Leaderboard PDA, pool ATA, Participant/
Sponsor PDAs, and ATAs automatically from `leaderboardId` / `mint` / `player|sponsor|winner`.
For `sendPrizeLeaderboard` you must pass `participant` = `findParticipantPda({leaderboard, player: winner})`.

---

## 5. Lifecycle & timing

```
            initialize            publish
   (none) ───────────▶ Draft ───────────▶ Open
                                            │
   join / leave (until start)               │
   depositSponsorship (until sponsorCutoff) │
                                            │
             ┌──────────────────────────────┼───────────────────────────┐
             │ now ≥ end AND count ≥ min     │  creator pre-start, OR     │
             ▼                               ▼  driver when count < min   │
        conclude ─▶ Concluded          cancel ─▶ Cancelled                │
             │                               │                            │
   sendPrize × slots (in order 0,1,2…)  refundPlayer × N                  │
             │                          refundSponsor × N                 │
             ▼                               ▼                            │
          close (all slots paid)         close (all refunds done)         │
             └───────────────▶ (account closed) ◀──────────────────────────┘
```

**Timeline gates** (all on-chain):
```
publish        start            sponsorCutoff        end            conclude        close
  │── join/leave ──┤
  │──────── sponsor deposits ───┤
                                            (competition runs)     fees→treasury   dust→treasury
```
- Registration (join/leave): `now < startTimestamp`
- Sponsorship: `now < endTimestamp - sponsorCutoff`
- Conclude: `now ≥ endTimestamp` **and** `participantCount ≥ minParticipants`
- If under-min at end → cannot conclude → **must cancel + refund**.

---

## 6. Money math (implement identically off-chain for previews)

For any inflow (buy-in or sponsorship) of `gross`:
```
fee  = floor(gross * platformFeeBps / 10000)
net  = gross - fee
prizePool   += net
pendingFees += fee
poolBalance += gross           // gross == net + fee, always
```
At **conclude**: `pendingFees → TREASURY`, `pendingFees = 0`.

At **payout**, for slot `i` (paid strictly in order `0..slots-1`):
```
share_i = floor(prizePool * payoutSlotsBps[i] / 10000)   // prizePool is FIXED at conclude
```
- `prizePool` is **not** decremented per payout — every share is computed against the
  same concluded `prizePool`. Track progress via `paidSlots`, not by subtracting.
- Because `payoutSlotsBps` sums to 10000, `Σ share_i ≤ prizePool`; **rounding dust**
  (a few base units) stays in the pool and is swept to `TREASURY` at close.

On **cancel**: every player and sponsor is refunded their **full gross** (fee unwound),
platform keeps **nothing**.

---

## 7. Suggested MongoDB models

These **mirror** on-chain state (for fast reads/UX) and hold everything the chain
doesn't. Treat on-chain as source of truth for money fields; reconcile (see §10).

### `leaderboards`
```jsonc
{
  "_id": ObjectId,
  "leaderboardId": "cs2-wk-2026-07-25",     // ≤28 chars, unique, == PDA seed
  "leaderboardPda": "…",                     // derived, cache it
  "poolAta": "…",
  "game": "CS2",                             // off-chain metadata
  "title": "CS2 Saturday Showdown",
  "creator": "…pubkey",
  "mint": "…pubkey",
  "mintDecimals": 6,

  // economics (base units)
  "buyInAmount": "5000000",                  // store as string/Decimal128 (u64!)
  "platformFeeBps": 2000,
  "payoutSlotsBps": [5000, 3000, 2000],
  "minParticipants": 3,
  "maxParticipants": 10000,

  // timing (unix seconds)
  "startTimestamp": 1769300000,
  "endTimestamp":   1769314400,
  "sponsorCutoff":  3600,

  // mirrored running state
  "state": "Open",                           // Draft|Open|Concluded|Cancelled
  "prizePool": "0",
  "pendingFees": "0",
  "participantCount": 0,
  "sponsorCount": 0,
  "paidSlots": 0,
  "refundedPlayerCount": 0,
  "refundedSponsorCount": 0,
  "concludedAt": null,

  // off-chain orchestration
  "scoreMetric": "kills",                    // how ranking is computed
  "onchainTxns": { "initialize": "sig", "publish": "sig", "conclude": "sig", "close": "sig" },
  "lastSyncedSlot": 478445847,
  "createdAt": ISODate, "updatedAt": ISODate
}
```
Indexes: unique `leaderboardId`; `{ state, endTimestamp }` (workers scan due events);
`{ game, startTimestamp }`.

### `participants`
```jsonc
{
  "leaderboardId": "cs2-wk-2026-07-25",
  "player": "…pubkey",
  "userId": ObjectId,                        // your user
  "gameHandle": "…",
  "grossContribution": "5000000",
  "netContribution": "4000000",
  "joinedAt": 1769299000,
  "status": "active",                        // active|left|refunded
  "joinTxn": "sig", "leaveTxn": null, "refundTxn": null,
  "createdAt": ISODate, "updatedAt": ISODate
}
```
Indexes: unique `{ leaderboardId, player }`; `{ userId }`.

### `sponsors`
```jsonc
{
  "leaderboardId": "…", "sponsor": "…pubkey",
  "grossContribution": "25000000", "netContribution": "20000000",
  "lastDepositAt": 1769305000,
  "deposits": [ { "amount": "25000000", "txn": "sig", "at": 1769305000 } ],
  "status": "active",                        // active|refunded
  "refundTxn": null
}
```
Indexes: unique `{ leaderboardId, sponsor }`.

### `prize_slots` (payout plan + execution)
```jsonc
{
  "leaderboardId": "…",
  "slotIndex": 0,                            // 0-based, paid in order
  "bps": 5000,
  "winnerPlayer": "…pubkey",                 // decided by ranking AFTER end
  "amountBaseUnits": "…",                    // floor(prizePool*bps/10000)
  "status": "pending",                       // pending|paid|failed
  "payoutTxn": null, "paidAt": null
}
```
Indexes: unique `{ leaderboardId, slotIndex }`.

### `score_snapshots` (live standings + the frozen final)
```jsonc
{
  "leaderboardId": "…",
  "capturedAt": ISODate,
  "final": false,                            // true = frozen at end, drives payout
  "ranking": [ { "player": "…", "userId": ObjectId, "score": 42, "rank": 1 } ]
}
```
Indexes: `{ leaderboardId, final }`, `{ leaderboardId, capturedAt }`.

### `onchain_jobs` (idempotent worker queue — the safety net)
```jsonc
{
  "kind": "sendPrize",                       // any instruction
  "leaderboardId": "…",
  "args": { "slotIndex": 0, "winner": "…" },
  "status": "pending",                       // pending|submitted|confirmed|failed
  "attempts": 0,
  "lastError": null,
  "txn": null,
  "idempotencyKey": "cs2-…:sendPrize:slot0", // unique — dedupes retries
  "createdAt": ISODate
}
```
Indexes: unique `idempotencyKey`; `{ status, kind }`.

> **u64 amounts** overflow JS `number`. Store as **string** or `Decimal128`, and do all
> arithmetic with `BigInt`/`bn.js`. Never `parseInt` a base-unit amount.

---

## 8. Suggested API surface

All state-changing endpoints enqueue an `onchain_jobs` doc and return `202` with a job
id; a worker submits the transaction and confirms it, then updates the mirror. Reads
serve from Mongo (fast) and can be reconciled against chain on demand.

**Organizer**
- `POST /leaderboards` → validate §2, enqueue `initialize` (+ `publish` if desired)
- `POST /leaderboards/:id/publish`
- `POST /leaderboards/:id/cancel`
- `POST /leaderboards/:id/conclude` (worker also auto-triggers when due — see §9)
- `POST /leaderboards/:id/payout` (enqueues all `prize_slots` in order)
- `POST /leaderboards/:id/close`

**Player**
- `POST /leaderboards/:id/join` (body: player wallet; server co-signs/collects sig)
- `POST /leaderboards/:id/leave`
- `GET  /leaderboards/:id/standings` (from `score_snapshots`)
- `GET  /leaderboards/:id/me` (participant status + payout)

**Sponsor**
- `POST /leaderboards/:id/sponsor` (body: amount base units)
- `POST /leaderboards/:id/sponsor/refund` (cancel path)

**Read**
- `GET /leaderboards?state=Open&game=CS2`
- `GET /leaderboards/:id` (mirror + `poolBalance` if you want live chain read)

---

## 9. Worker flow (end-to-end)

**Scheduler** scans `leaderboards` by `{ state, startTimestamp, endTimestamp }`:

1. **Create** → `initialize` (Draft). Persist PDAs + txn.
2. **Publish** → `publish` (Open). Open join/sponsor endpoints.
3. **Registration window** (`now < start`): process `join` / `leave` / `depositSponsorship`
   jobs. Reject client-side once `now ≥ start` (chain will also reject:
   `RegistrationClosed`) or `now ≥ end - sponsorCutoff` for sponsors (`SponsorshipClosed`).
4. **Active window** (`start ≤ now < end`): poll game APIs, write `score_snapshots`
   (live). No on-chain writes.
5. **End** (`now ≥ end`):
   - If `participantCount < minParticipants` → **cancel path** (step 8).
   - Else: **freeze** the final `score_snapshots` (`final: true`) → anti-cheat review →
     organizer approves ranking → build `prize_slots` (winner per slot, amounts).
6. **Conclude** → `conclude` (Concluded). Fees swept to treasury.
7. **Payout** → for `slotIndex = 0,1,2,…` in order, `sendPrize`. Each job is gated on
   the previous confirming (chain requires `slotIndex == paidSlots`). Then **close**
   once `paidSlots == payoutSlotsBps.length`.
8. **Cancel path** → `cancel` → for each participant `refundLeaderboardPlayer`, each
   sponsor `refundLeaderboardSponsor` → `close` once
   `refundedPlayerCount == participantCount && refundedSponsorCount == sponsorCount`.

**Fallback unlock** (product spec): if payout is stuck > 4h post-end, alert ops. There's
no on-chain auto-unlock — funds stay safely escrowed until the driver pays or cancels.

---

## 10. Idempotency & error handling (critical)

**Payout is index-ordered and idempotent on-chain** — lean on it instead of trusting
your own state:
- `sendPrize` **must** be called with `slotIndex == paidSlots`. Retrying a slot that
  already landed fails with **`WinnerAlreadyPaid`** ("Winner already paid for this slot").
  Calling out of order fails with **`SlotIndexOutOfOrder`** ("Slot index out of order").
  → On retry, **read `paidSlots` from chain** and resume from there.
- **Duplicate refunds** fail with Anchor **`AccountNotInitialized` (error `3012`)** —
  *not* a custom message — because the Participant/Sponsor PDA is closed on first refund.
  → Treat `3012` on `refundLeaderboardPlayer`/`refundLeaderboardSponsor` as
  **"already refunded, success"**, not a hard error.
- `joinLeaderboard` twice → **`PlayerAlreadyJoined`** ("Player already joined").

**Match these error strings/behaviors in the worker** (don't reword them; they're the
contract). Other useful ones: `LeaderboardNotOpen`, `RegistrationClosed`,
`SponsorshipClosed`, `LeaderboardNotEnded`, `BelowMinParticipants`,
`ParticipantLimitReached`, `LeaderboardNotConcluded`, `LeaderboardNotCancelled`,
`PayoutsNotComplete`, `RefundsNotComplete`, `Unauthorized`.

**Every on-chain job carries an `idempotencyKey`** (e.g. `${id}:sendPrize:slot${i}`).
Because the chain itself rejects duplicates, a job that "fails" as already-applied should
be marked **confirmed** after verifying chain state, not retried forever.

---

## 11. Staying in sync (reconciliation)

The mirror can drift (missed webhook, crash mid-confirm). Two mechanisms:
1. **After every confirmed tx**, re-fetch the affected accounts (`safeFetchLeaderboard` /
   `safeFetchParticipant` / `safeFetchSponsor`) and overwrite the mirror's money/state
   fields + `lastSyncedSlot`. On-chain wins.
2. **Periodic sweep** for events in `Open`/`Concluded`/`Cancelled`: refetch the
   Leaderboard account and reconcile `state`, `prizePool`, `pendingFees`, counts,
   `paidSlots`, `refunded*Count`. Treat any mismatch as "chain is right".

For a live `poolBalance`, read the pool ATA directly. Devnet/public RPC rate-limits hard —
**use a dedicated RPC** (Helius/Triton), batch reads, and add retry/backoff (429s are
common). Prefer `confirmed` commitment for orchestration; account reads may briefly lag a
just-confirmed write, so poll-with-retry after writing.

---

## 12. Security & operational notes

- **The `DRIVER` wallet is the trust anchor.** It signs all writes and decides winners.
  Protect it (HSM / server-side custody, tight access). A compromised driver can
  misallocate prizes among *enrolled* participants and drive lifecycle — but **cannot**
  send funds to arbitrary wallets (payouts only to enrolled participants' ATAs; fees/dust
  only to the hardcoded `TREASURY`).
- **Winners are chosen off-chain.** The chain only verifies a payout target is an enrolled
  participant. The backend must ensure the ranking → `prize_slots` mapping is correct and
  assigns **distinct** winners per slot (the chain does not enforce distinctness).
- **`TREASURY` is fixed in the program** per cluster — verify the mainnet treasury pubkey
  before launch; you cannot redirect fees at runtime.
- On-chain is the **only** source of truth for balances. Never let the backend "believe"
  a payout/refund happened without a confirmed signature + a follow-up account read.
