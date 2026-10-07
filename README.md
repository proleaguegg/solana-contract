# ProLeague Tournament Program

On-chain tournament and leaderboard settlement for competitive gaming, built on Solana. Entry fees and sponsorships sit in program-owned escrow, prizes pay out through the program, and the platform fee is computed on-chain.

| | |
|---|---|
| **Release** | 2.1.1 |
| **Program ID** | `matchNmUczmPKteQb9BJ8gRgafaQpDh2oDZJGuLsHfR` |
| **Framework** | Anchor 0.29.0 (Rust), `solana-program` 1.17.4 |
| **Size** | ~3,700 lines of Rust, 31 instructions |
| **Audit** | Not independently audited |
| **Devnet** | Runs this release; used by the live ProLeague app |
| **Mainnet** | Deployed; runs an earlier 2024 build. Upgrade to this release pending |

## Crypto World's Fair

ProLeague is competing in Colosseum's Crypto World's Fair hackathon, which runs through October 12, 2026. This repository is the on-chain component of that submission. It is published so reviewers can read the code behind the product: Colosseum judges, and the security reviewers on the CertiK, Adevar Labs and Superteam Earn side tracks. If you are reviewing, start at [Review guide](#review-guide).

- Colosseum project: https://colosseum.com/arena/projects/proleague.gg
- Live app (devnet): https://app.proleague.gg
- Site: https://proleague.gg

## What it does

- **Bracket tournaments.** A creator publishes a tournament with per-round prizes. Players join, an operator reports winners round by round, and the program pays each winner from escrow.
- **Leaderboards.** Time-boxed competitions (1 hour to 7 days) that settle into up to 10 payout slots.
- **Sponsorship.** A brand can fund a tournament or leaderboard. Sponsor funds are held in the same escrow and are refundable if the event is cancelled.
- **Refunds and cancellation.** A tournament can be paused, after which joining fees and sponsor funds are refunded and the event is cancelled. Refunds return the full amount.
- **Platform fee.** Computed on-chain. See [Fee model](#fee-model).

## How a tournament settles

```
creator ── initialize / publish ──▶  Tournament PDA
players ── join (entry fee) ──────▶    └─ escrow token account (owned by the PDA)
sponsors ── sponsor ──────────────▶

operator ── add_winner ──▶ send_prize ──▶ winner wallets      (once per round)
operator ── close_tournament ──▶ treasury (fee)  +  creator (remainder)
```

Lifecycle: `initialize → sponsor? → publish → join / leave → announce → add_winner → mark_winner_won_next_round → send_prize → close`.
Cancellation: `pause → refund_joining_fees + refund_sponsor → refund_creator_and_cancel_tournament`.

## Trust model

**What the program enforces on-chain**

- A prize is paid **at most once per round and winner**. `send_prize` sets the winner's `claimed` flag before the token transfer and returns `AlreadyClaimed` on a second attempt.
- A winner who advanced cannot be paid an earlier round's prize (`WonNextRound`).
- No prize can be paid while a tournament is paused, so escrow owed back to players cannot be drained mid-cancellation.
- Every tournament token instruction except the operator-only `destroy_tournament` is pinned to the mint recorded at `initialize`; any other mint fails with `InvalidMint` (2.1.1). The escrow token account must be owned by the tournament PDA, and transfers are signed with the PDA's seeds.
- Leaderboard escrow must be the leaderboard's associated token account, and every leaderboard token instruction is bound to the leaderboard's mint.
- The platform fee is capped at 30% (`PLATFORM_FEE_BPS_MAX`), `close_tournament` and the leaderboard sweeps pay fees only to the hardcoded treasury, and release builds compile with `overflow-checks = true`.

**What the program trusts**

- A single **operator ("driver") key** reports winners and triggers payouts. It is a compile-time constant in `constant.rs`, selected by the `prod` Cargo feature. Rotating it requires a program upgrade.
- The program does **not** verify match outcomes. Winners are reported by the operator, so result integrity depends on that key and on the off-chain system behind it.
- `send_prize` only pays a wallet the operator recorded as a winner from the enrolled players. The operator also holds recovery instructions that can move escrow on its own authority: `transpose_tournament_player` / `transpose_tournament_creator` replace a player's or the creator's wallet, and `destroy_tournament` sweeps a tournament's whole escrow (including any booked fee) to a creator account it is given and closes it. A compromised operator key could use these to redirect funds.
- The program upgrade authority is a single key per cluster.

## Fee model

**Tournaments (2.1.0+).** The fee follows prize value, not entry fees, so a free or sponsored tournament still funds the platform in proportion to what it pays out.

```
pool = Σ roundPrizes[i] × payees(i)        payees = 1, 1, 2, 4, 8, …
fee  = floor(pool × platformFeeBps / 10,000)
```

- The fee is fixed at publish and charged **on top**: the creator funds `pool + fee` and winners receive the full advertised prize. At 700 bps, a 10,000 prize pool requires 10,700 in escrow.
- Entry fees and sponsorships are **not** fee'd. Entry fees go to the creator at close. A sponsorship made before publish counts toward funding `pool + fee`; one made after publish goes to the creator at close. Both return whole on a refund.
- `pending_fees` is paid to the treasury at `close_tournament`.
- The fee math is checked arithmetic with unit tests in `src/utils/helper.rs`.

**Leaderboards.** Each buy-in and sponsorship is split on arrival into prize pool and `pending_fees` at `platform_fee_bps`. Fees are swept to the treasury at `conclude_leaderboard`; a cancelled leaderboard refunds the full amount, fee included. Payout slots are paid in strict order, and rounding dust goes to the treasury at close.

## Review guide

Suggested reading order, by where value moves:

| File | Lines | Why |
|---|---|---|
| `instructions/prize_instructions.rs` | 107 | `send_prize`: the payout path and its once-only guard |
| `instructions/tournament_instructions.rs` | 528 | `publish` (pool, fee, funding) and `close` (fee sweep, remainder) |
| `utils/helper.rs` | 227 | Weighted pool and fee math, with unit tests |
| `instructions/join_tournament.rs` | 182 | Entry, leave, and fee unwinding |
| `instructions/cancel_tournament.rs`, `destroy_tournament.rs` | 297, 116 | Refund and cancellation paths |
| `instructions/winner_instructions.rs`, `transpose_tournament.rs` | 112, 90 | Winner reporting, `won_next_round`, operator recovery |
| `instructions/leaderboard_*.rs` | ~1,100 | Leaderboard lifecycle, sponsorship, conclude, payout slots |
| `constant.rs`, `errors.rs`, `state/` | 88, 174, ~280 | Caps, keys, error codes, account layouts |

All paths are under `programs/ProLeague-Tournament-SC/src/`.

**Build and test**

```bash
anchor build                       # devnet operator and treasury keys (default)
anchor build -- --features prod    # mainnet operator and treasury keys
cargo test                         # fee-math unit tests
yarn install && yarn build         # regenerate the TypeScript client from the IDL
yarn test:tournamentAll            # integration suites (ts-mocha)
yarn test:leaderboardAll
yarn test:global
```

Integration suites live in `tests/` and run against devnet. They read wallets and settings from a `.env` file (see `tests/helpers/contant.ts`); their setup helpers are in `tests/helpers`.

## Known limitations

- **Not audited.** This is the version we are submitting for review.
- **Single operator key**, compile-time, rotatable only by upgrade, with recovery powers over escrow (see [Trust model](#trust-model)).
- **Winner reporting is trusted input**; the program does not verify match results.
- **Mainnet runs an earlier build** than this repository; the upgrade is pending.
- Built on Anchor 0.29 and `solana-program` 1.17, an older toolchain. `init_if_needed` is enabled and used for recipient token accounts and leaderboard participant/sponsor accounts.

## SDK

`js/` holds the generated TypeScript client, published as [`@tanv33/pro-league`](https://www.npmjs.com/package/@tanv33/pro-league). Usage and examples are in [SDK.md](SDK.md).

## Security

Please report vulnerabilities privately to justin@proleague.gg, not in a public issue. Include the instruction, the account layout involved, and a reproduction if you have one.

## Team

Built by the ProLeague team. Program, backend, SDK and frontend engineering: Tanveer Khan ([@tanv33](https://x.com/tanv33)). Co-founder and CEO: ezbucko.

## License

Proprietary. Copyright (c) 2023-2026 ProLeague. All rights reserved.

Reviewers may view, build, run and test the code for evaluation, auditing and security research, including on local validators and test networks. Any other use, copying, redistribution or production deployment needs written permission. See [LICENSE](LICENSE).
