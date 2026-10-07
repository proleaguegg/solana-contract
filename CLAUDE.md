# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This repo contains a Solana/Anchor smart contract and a matching auto-generated TypeScript client that is published to npm as `@tanv33/pro-league`.

- `programs/ProLeague-Tournament-SC/` — Anchor 0.29.0 program (Rust). Program ID: `matchNmUczmPKteQb9BJ8gRgafaQpDh2oDZJGuLsHfR`. Declared in `src/lib.rs` under the `tournament` module.
- `js/generated/` — **generated** TypeScript client (do not hand-edit). Produced by `kinobi.ts` from `target/idl/tournament.json`. Re-exported from `js/index.ts` and imported by tests as `../js`.
- `kinobi.ts` — Kinobi pipeline: reads the Anchor IDL, rewrites `HashMap` types, declares PDA seeds (`TOURNAMENT_STATE` + tournament_id; `GLOBAL` + program id), and sets ATA defaults for tournament / player / creator / winner token accounts.
- `tests/` — `ts-mocha` integration tests that run against the cluster configured in `Anchor.toml` (public devnet RPC by default).
- `tests/plugin.test.ts` — Umi plugin that registers `createTournamentProgram()` and `mplToolbox`; every test file imports this.
- `tests/helpers/contant.ts` — reads env vars (note the typo — the filename is `contant.ts`, not `constant.ts`).
- `scripts/publish.js` + `.github/workflows/publish-sdk.yml` — publishes `dist/` to npm on push to `main` using `NPM_AUTH_TOKEN`.

## Common commands

Anchor / Rust:
- `anchor build` — compiles the program and writes IDL to `target/idl/tournament.json`. **Must run before `yarn generate:clients`.**
- `anchor deploy` — deploys using the wallet in `Anchor.toml` (`key.json`) to the configured cluster.
- `anchor test` — runs `yarn ts-mocha tests/**/*.ts` per `Anchor.toml [scripts]`.
- Build with the prod driver key: `anchor build -- --features prod` (toggles the `DRIVER` pubkey in `constant.rs`).

TypeScript client:
- `yarn generate:clients` — regenerates `js/generated/` from the current IDL (runs `kinobi.ts`).
- `yarn compile` — `tsc` using `tsconfig.json` (rootDir `js`, outDir `dist`).
- `yarn build` — `generate:clients` then `compile`. Run this after any program change before running tests or publishing.
- `yarn lint` / `yarn lint:fix` — Prettier check / write.
- `yarn publish` — runs `scripts/publish.js` which `npm publish`es from `dist/`.

Tests (each requires the env vars below and a funded wallet):
- `yarn test` — the main 8-player flow in `tests/ProLeague-Tournament-SC.test.ts`.
- `yarn 128-test` — large-bracket variant.
- `yarn test:global` — `Global` PDA init / whitelist update.
- `yarn test:ledgerGlobal` — same flow signed by a Ledger hardware wallet (requires `LEDGER_PUBKEY`).
- Run a single test: `yarn ts-mocha --bail --timeout 2000000 tests/<file>.test.ts --grep "<describe or it name>"`.

Token helpers (one-offs, not part of the suite):
- `yarn createToken`, `yarn metaToken`, `yarn transferToken`, `yarn generateSplToken`, `yarn getTournament`.

## Required environment

Tests and helpers load `.env` via `dotenv`. Variables consumed (`tests/helpers/contant.ts`):

`SOLANA_RPC`, `SOLANA_URL`, `CLUSTER_URL`, `TOKEN_MINT`, `TOURNAMENT_ID`, `CREATOR_ACCOUNT`, `DRIVER_ACCOUNT`, `SPONSOR_ACCOUNT`, `PRIORITY_RATE` (default 2500), `COMPUTE_UNIT_LIMIT` (default 450_000), `LEDGER_PUBKEY`.

`CREATOR_ACCOUNT`, `DRIVER_ACCOUNT`, `SPONSOR_ACCOUNT` are base58-encoded secret keys consumed by `createKeypairFromSecret` in `tests/helpers/helper.ts`.

The cluster in `Anchor.toml` points at the public devnet RPC (`api.devnet.solana.com`); override with the commented `localnet` line or via env when testing locally. Keypair files (`key.json`, `account.json`, `*-keypair.json`) are gitignored and must never be committed. Note: `newCreator.json`, `tokenMintLocal.json` and `winnerAccount.txt` are tracked legacy test files that contain secret keys of throwaway test wallets — do not add more like them.

## Architecture notes worth knowing up front

**Mint pinning (2.1.1).** Every tournament instruction that moves tokens constrains `mint` with `address = tournament.mint` (error `InvalidMint`, 6044); leaderboard instructions use `has_one = mint`. Any new token-moving instruction must do the same — a caller-supplied mint was a fund-drain bug.

**Docs.** `README.md` is the repository overview for reviewers; `SDK.md` is the client guide and is what `scripts/publish.js` ships as the npm README.

**Two on-chain accounts.** `Tournament` (seeds: `TOURNAMENT_STATE` + `tournament_id`) and `Global` (seeds: `GLOBAL` + program id). `Global.whitelist_mint` is an admin-managed `Vec<Pubkey>` — if a tournament's mint is **not** in the whitelist, the creator must sign and pay `NON_WHITELISTED_CREATION_FEE` (0.001 SOL) to the driver at `initialize` time (see `tournament_instructions.rs`).

**Driver-gated entrypoints.** Most instructions require the hardcoded `DRIVER` signer from `constant.rs`. The value differs by cargo feature: `prod` → `proL2SQU...`, default → `5dr5siu8...` (rotated in 2.1.1; the old `3W67tweA...` key is compromised and must not be reused). `init_global` / `update_global` are additionally gated by `utils::assert_program_authority`, which verifies the signer is the program's BPF upgrade authority — so those can only be called by whoever deployed the program.

**Round/bracket model.** `total_rounds = log2(total_players)`. Each `Round` holds a `HashMap<u32, RoundWinners>` keyed by player index, and `reverse_index` bounds its capacity at `2^reverse_index` entries. `RoundWinners { won_next_round, claimed }` is how prize-claim eligibility is tracked — a winner who advanced cannot claim that round's prize. `Tournament::calculate_size` sizes the account up-front for the full bracket (including HashMap overhead per round), and `reallocate_tournament` / `utils::reallocate_bytes` handles resizing when state grows.

**Lifecycle states** (flags on `Tournament`): `is_published`, `is_sponsored`, `is_paused`, `is_announced`. Instructions cluster around these transitions — `initialize` → optional `sponsor_tournament` → `publish_tournament` → `join_tournament`/`leave_tournament` (leaving blocked once `is_announced`) → `announce_tournament` → `add_winner` per round → `mark_winner_won_next_round` → `send_prize` → `close_tournament`. Cancellation path: `pause_tournament` → `refund_joining_fees` + `refund_sponsor` → `refund_creator_and_cancel_tournament` → `destroy_tournament`.

**Leaderboards — a second, independent system.** Alongside the bracket `Tournament`, the program hosts a time-boxed *leaderboard* prize-pool system (see `LEADERBOARD.md` for the product spec). It has three PDAs, all in `state/`: `Leaderboard` (seeds `LEADERBOARD` + `leaderboard_id`, a ≤28-char string), `Participant` (seeds `PARTICIPANT` + leaderboard + player), and `Sponsor` (seeds `SPONSOR` + leaderboard + sponsor). Rust lives in `instructions/leaderboard_*.rs`; constants/errors are the `LEADERBOARD_*`/`*_BPS` block in `constant.rs` and the separate `LeaderboardError` enum in `errors.rs`. It **reuses the tournament `Global`** for the mint whitelist (same non-whitelisted-mint creation fee at `initialize_leaderboard`).

Key differences from the bracket tournament:
- **Money model.** All funds (buy-ins + sponsorships) sit in one leaderboard-owned ATA. Each inflow splits into `prize_pool` (net) and `pending_fees` (`platform_fee_bps`, ≤30%); `payout_slots_bps` must sum to `TOTAL_BPS` (10000). `pending_fees` sweeps to `TREASURY` at `conclude_leaderboard`; residual dust sweeps to `TREASURY` at `close_leaderboard`.
- **`TREASURY`** is a hardcoded pubkey per cluster in `constant.rs` (prod `GdKWapos…`, dev `9wep76Bp…`); all fees and dust can only go there.
- **State machine** is the `LeaderboardState` enum (`Draft → Open → Concluded | Cancelled`), not the boolean flags used by `Tournament`. Happy path: `initialize_leaderboard` → `publish_leaderboard` → `join_leaderboard`/`leave_leaderboard` + `deposit_sponsorship` (until `sponsor_cutoff`) → `conclude_leaderboard` (after `end_timestamp`, min-participants met) → `send_prize_leaderboard` per slot (must be called in strict `slot_index` order, gated by `paid_slots`) → `close_leaderboard`. Cancel path: `cancel_leaderboard` (creator pre-start, or driver when under-min after start) → `refund_leaderboard_player`/`refund_leaderboard_sponsor` per account → `close_leaderboard`.
- **Prize payout is index-ordered and idempotent.** `send_prize_leaderboard` requires `slot_index == paid_slots`; re-paying a lower index errors `WinnerAlreadyPaid`. Off-chain workers string-match specific error messages (see the "idempotency markers" comment in `errors.rs`) — don't reword those `#[msg]` strings. **Refund idempotency works differently:** `refund_leaderboard_player`/`refund_leaderboard_sponsor` close the `Participant`/`Sponsor` PDA on success, so a duplicate refund fails with Anchor's `AccountNotInitialized` (error `3012`), *not* a custom message — workers treat 3012 on those two instructions as "already refunded".
- **Leaderboard tests live in `tests/leaderboard/`** (separate from the tournament/global suites): `leaderboard.test.ts` (init-validation + cancel/refund/close, plus a `RUN_LONG=1`-gated conclude/payout path that waits out the ≥1h window), `leaderboard-paid.test.ts` (real buy-ins with an `after`-hook that sweeps player funds back to the driver so no balance is lost), and `leaderboard-edge.test.ts` (fast state/auth/capacity guards + sponsor accounting). Run via `yarn test:leaderboard` / `test:leaderboardPaid` / `test:leaderboardEdge` / `test:leaderboardAll`. They run against the devnet program at `matchNmU…` and need the same `.env` as the tournament suite; sponsor tests require `SPONSOR_ACCOUNT` (and `CREATOR_ACCOUNT`) to hold a little `TOKEN_MINT`. Because the program enforces `MIN_LEADERBOARD_DURATION` (1h) with a future start, only the cancel path is exercised by default — the conclude path is the `RUN_LONG` block.

**Kinobi IDL patching.** `kinobi.ts` rewrites Anchor `HashMap<K,V>` type fields into Kinobi `hashMap` nodes, and injects PDA defaults + ATA defaults into generated instructions. If you add a new account, seed, or HashMap field in Rust, re-run `yarn generate:clients` — the generated TS will silently drift from the Rust otherwise. If you add new instruction accounts that follow the tournament/player/creator/winner ATA pattern, add them to the `SetInstructionAccountDefaultValuesVisitor` list in `kinobi.ts` so callers don't need to compute the ATA.

**Do not edit `js/generated/` by hand.** It is overwritten by `yarn generate:clients`. Fix issues in `kinobi.ts` or the Rust source instead.
