# ProLeague Leaderboards

Time-boxed esports leaderboards across major games. Players buy in (or join free), top performers win the prize pool, ProLeague keeps 20% of every dollar that flows in. Settlement is automatic, on-chain, in the event's configured SPL token.

**Token support.** Each event picks its own SPL token at creation — USDC is the default, but any whitelisted token works (USDT, BONK, partner tokens, in-game currencies, etc.). The whitelist is platform-controlled via a one-time admin instruction. New tokens can be added without redeploying the contract. Examples in this doc use USDC because it's the most legible.

---

## What it is

A leaderboard is one event. An organizer picks a game, a time window, and how the prize money should split. Players join during a registration period, compete during the active window, and the top finishers get paid the moment the organizer verifies the results.

**Games supported at launch.** CS2 (5v5 wins, deathmatch kills), Fortnite (wins), Parallel (wins), Off the Grid, League of Legends (wins), Gods Unchained (wins), Wild Card (wins).

**Two event formats.**
- **Free leaderboards** — no buy-in, prize pool comes from sponsors. Drives top-of-funnel.
- **Paid leaderboards** — $5 buy-in (configurable), 80% of every buy-in feeds the pool. The standard money-printing format.

**Time windows.** No minimum, recommended 1–4 hours, hard cap 7 days. A typical weekly cadence runs Saturday-evening Eastern time.

---

## Four roles

| Role | What they do |
|---|---|
| **Organizer** | Creates the event. Picks the game, time window, payout structure (e.g. 50/30/20). Reviews results before payout. |
| **Player** | Pays the buy-in (if paid event), competes during the window, gets paid in the event's configured token if they finish in a winning slot. |
| **Sponsor** | Top-funds the prize pool any time before the cutoff. Brands do this for visibility on featured events. |
| **ProLeague (platform)** | Runs the backend that polls game APIs, tracks scores, handles cheat review, and triggers payouts. Earns 20% of every dollar that enters the pool. |

---

## Lifecycle — a 4-hour event end-to-end

```
   T-2h           T=0           T=2h          T=3h          T=4h          T+1h
   create         start         (active)      sponsor       end           conclude
   leaderboard    of event                    cutoff        of event      + payout
   ───────────────┬─────────────┬─────────────┬─────────────┬─────────────┬───────►
                  │             │             │             │             │
                  │             │             │             │             │
   joins+sponsors │             │             │             │             │
   open here ─────┘             │             │             │             │
                                │             │             │             │
                joins close ────┘             │             │             │
                                              │             │             │
                                sponsors close (1h before end) ─┐
                                              │             │   │
                                              │             │   ▼
                                              │             │  no more deposits
                                              │             │
                                              │     game window ends ─────┐
                                              │             │             │
                                              │             │             ▼
                                              │             │       organizer reviews
                                              │             │       results, approves
                                              │             │             │
                                              │             │             ▼
                                              │             │       driver pays
                                              │             │       winners on-chain,
                                              │             │       leaderboard closes
```

**Plain-language version:**

1. **Create** (T−2h, or whenever). Organizer sets game, time, payout split, buy-in. Event is in *Draft*. No money flows yet.
2. **Publish** — flips event to *Open*. Players can join, sponsors can deposit.
3. **Joins close** at the start time. From this point, the player roster is locked.
4. **Active window**. Players compete in-game. Sponsors can still top up the pool until 1 hour before the end.
5. **Sponsor cutoff**. No more pool growth.
6. **End**. Game window closes. Backend snapshots final rankings.
7. **Verification**. Organizer reviews the snapshot in the dashboard, removes any flagged cheaters, approves results. (Typically takes minutes.)
8. **Conclude + payout**. Platform pays each winning slot in USDC, takes its 20% fee, closes the event.

---

## Money flow — per dollar that enters the pool

```
                Every $1 entering (buy-in OR sponsor deposit)
                                  │
                  ┌───────────────┴───────────────┐
                  ▼                               ▼
                $0.80                           $0.20
            (held in pool)                (held until conclude,
                  │                        then sweeps to ProLeague Treasury)
                  ▼
            Paid to winners
            per the event's
            payout config
```

The 20% fee is **held in escrow** during the event, not forwarded immediately. This matters: if the event cancels, ProLeague keeps **nothing** and every dollar refunds. The fee only converts to revenue when an event actually concludes.

---

## Unit economics — three scenarios

### Scenario A: paid weekly event, full attendance

```
   10,000 players  ×  $5 buy-in   =   $50,000 collected
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    ▼                                               ▼
            ProLeague: $10,000                            Prize Pool: $40,000
            (event revenue, recognized                    (split per payout config,
            at conclude)                                  e.g. $16K / $10K / $6K /
                                                          $4.8K / $3.2K for top-5)
```

Marginal cost: game-server time + a few cents in Solana network fees. **~$0.**

### Scenario B: free leaderboard, sponsor-funded

```
   0 players × $0           Sponsor deposits $25,000
   buy-in = $0                       │
   collected           ┌─────────────┴─────────────┐
                       ▼                           ▼
                  ProLeague:                  Prize Pool:
                  $5,000                      $20,000
                  (20% of sponsor)            (paid to top players)
```

Free events drive acquisition. Sponsor pays to put their name in front of players for 4 hours. ProLeague earns regardless.

### Scenario C: cancelled event (didn't fill)

```
   2,000 players × $5  =  $10,000 collected
   ──────────────────────────────────────────
   minimum threshold:    3,000 players
   actual:               2,000 → BELOW MIN
                                      │
                                      ▼
                            Event auto-cancels
                                      │
                                      ▼
                       Every player gets their $5 back.
                       Every sponsor gets their full deposit back.
                       ProLeague earns: $0.
```

This is the trust mechanic: **we earn only on events that ran**. There's no scenario where we keep money on an event we didn't deliver.

---

## State machine

```
                publish (organizer)
   ┌───────────────────────────────────┐
   │                                   ▼
   │                              ┌──────┐
   │                              │ Open │
   │                              └──┬───┘
   │                                 │
   ┌─────────┐                       │ time runs out + organizer concludes
   │  Draft  │                       │ (only if min participants met)
   └────┬────┘                       ▼
        │                       ┌───────────┐
        │                       │ Concluded │
        │                       └─────┬─────┘
        │                             │ all winners paid
        │                             ▼
        │                       ┌────────┐
        │                       │ Closed │
        │                       └────────┘
        │
        │      (organizer cancels before start, or
        │       too few joined at start time)
        │
        └─────────────► ┌───────────┐
                        │ Cancelled │
                        └─────┬─────┘
                              │ all refunds processed
                              ▼
                        ┌────────┐
                        │ Closed │
                        └────────┘
```

Four states. No backdoors. Once a state advances, it can't reverse.

---

## What's on-chain vs off-chain

This split is intentional. The chain handles **money and time**. The backend handles **scoring and players**.

| Concern | Where it lives | Why |
|---|---|---|
| Holding the prize pool | **On-chain** | Anyone can verify the money is real and untouchable |
| Enforcing the timing rules (joins close, sponsor cutoff) | **On-chain** | No "trust us, we'll lock it" — the contract refuses out-of-window operations |
| Paying winners | **On-chain** | Auto-settles in USDC, nobody can intercept |
| Computing scores from game APIs | **Off-chain** | Game APIs are HTTP, not blockchain — there's no oracle for "kills in CS2" |
| Ranking players, tracking who's #1 in real time | **Off-chain** | A live leaderboard updates 100s of times per minute, prohibitively expensive on-chain |
| Anti-cheat review | **Off-chain** | Requires human judgment + DB edits, which on-chain can't do well |

The chain doesn't know who won. It pays the wallet addresses the platform tells it to pay, AFTER the organizer has approved the rankings. The trust model is: **you trust the organizer to verify results honestly, and the chain to actually move the money.**

---

## Anti-cheat & verification

1. Backend polls game APIs every 30s during the active window.
2. Live leaderboard updates feed the dashboard so players see ranks in real time.
3. At end-of-window, backend freezes the rankings into a snapshot.
4. Snapshot goes into a verification UI shown to the organizer.
5. Organizer reviews — removes cheaters, flags suspicious accounts, approves.
6. Approval triggers the on-chain conclude + payout flow.

Time between window-end and payout: typically 30–60 minutes. Hard cap 4 hours (after which a fallback unlock mechanism activates — defensive, not normally used).

---

## Revenue streams

```
  ┌──────────────────────────────────────────────────────────────────┐
  │   Stream                  How it earns           Per-event scale │
  ├──────────────────────────────────────────────────────────────────┤
  │   1. Platform fee         20% of all $ in        $10K / 10K-     │
  │                           the pool                player event   │
  │                                                                  │
  │   2. USDC on-ramp         Players buy USDC       % of total      │
  │                           on the platform        buy-in volume   │
  │                                                                  │
  │   3. Cash-out fee         Winners withdraw       % of total      │
  │                           to bank                payouts         │
  └──────────────────────────────────────────────────────────────────┘
```

Plus high-margin upsells:

| Upsell | Price |
|---|---|
| Featured leaderboard placement | $100–$500 |
| Sponsor logo + CTA | $250–$2,000 |
| Custom scoring logic | $500+ |
| Anti-cheat review / audits | $250–$1,000 |
| White-label leaderboard page | $1,500+/month |

A single 10K-player paid event with a sponsor logo + featured slot can pull in **$10,000 + $1,500 + $500 = $12,000** in one weekend. Marginal cost still ~$0.

---

## Token flexibility — a fourth revenue lever

Every event picks its own SPL token. This isn't just a technical detail; it's a sales surface.

- **Default events run in USDC.** Stable, legible, the most familiar to players and sponsors.
- **Branded-token events.** A game studio or token project pays ProLeague to host a leaderboard denominated in their token (e.g. a BONK weekly, a partner-game token weekly). Drives volume to their token; they typically pay a premium fee for the placement.
- **In-game-currency leaderboards.** A studio uses ProLeague rails to run their own competitive economy in their own currency. White-label tier ($1,500+/month).
- **Stablecoin variants per region.** USDT in some markets, regional stablecoins in others — same contract, different mint.

Adding a new token is a single admin transaction (no redeploy), making this a true marketplace surface rather than a hardcoded integration.

---

## Why on-chain is the right substrate

- **Transparent escrow.** Players and sponsors can verify the prize pool exists before they deposit. No "trust the platform" leap.
- **Instant settlement.** Winners get paid the second the organizer approves results, in the configured SPL token. No 5-day bank wait, no payment-processor hold.
- **No chargebacks.** Once a buy-in lands, it's final. ProLeague's revenue is non-disputable.
- **Global Day 1.** Stablecoins like USDC work the same in every country. No banking integrations to build per market. Token flexibility means each region or partner can use the token that fits.
- **Audit trail.** Every event's full money flow is publicly inspectable forever. Sponsors love this.
- **Low cost.** Solana network fees: fractions of a cent per transaction. Negligible at any scale.

---

## Why this is hard for competitors to copy quickly

- **Multi-game scoring infrastructure** — polling, normalizing, and ranking across CS2, Fortnite, LoL, Riot, Epic, etc. is real backend work.
- **Anti-cheat workflow** — building a credible "we removed the cheaters before payout" loop takes time and trust.
- **Sponsor pipeline** — featured-event slots are a sales motion, not a feature.
- **On-chain settlement** — most esports platforms run on credit cards + payment processors, which means chargebacks, holds, and 5–7 day cycles. Ripping that out is a foundational rebuild for them, a Day-1 advantage for us.
- **First-mover** — being the first to ship multi-game competitive social leaderboards with on-chain payout creates a brand moat in a category that doesn't exist yet.

---

## The numbers, one more time

| Metric | Value |
|---|---|
| Take rate per dollar in | 20% |
| Marginal cost per event | ~$0 |
| Settlement time | minutes, not days |
| Geographic reach | global Day 1 |
| Refund liability if event cancels | $0 to ProLeague (all funds refunded) |
| Revenue recognition | at event conclude (deferred 0–4 hours from event end) |
| Cadence | weekly events at scale, daily at full launch |

**One weekly event at 10K paid players = $10,000 revenue. Run 10 such events per week across games and tiers, and you're at $100K/week with negligible variable cost.**

That's the model.
