import dotenv from 'dotenv';
import { assert } from 'chai';
import {
  keypairIdentity,
  createSignerFromKeypair,
  generateSigner,
  publicKey,
  Umi,
  Pda,
  PublicKey,
  KeypairSigner,
} from '@metaplex-foundation/umi';
import { createUmi as BaseCreateUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { web3JsRpc } from '@metaplex-foundation/umi-rpc-web3js';
import {
  findAssociatedTokenPda,
  safeFetchToken,
} from '@metaplex-foundation/mpl-toolbox';

import { tournamentProgram } from '../plugin.test';
import {
  initializeLeaderboard,
  publishLeaderboard,
  joinLeaderboard,
  leaveLeaderboard,
  depositSponsorship,
  cancelLeaderboard,
  refundLeaderboardPlayer,
  refundLeaderboardSponsor,
  concludeLeaderboard,
  sendPrizeLeaderboard,
  closeLeaderboard,
  findLeaderboardPda,
  safeFetchLeaderboard,
  findParticipantPda,
  safeFetchParticipant,
  findSponsorPda,
  safeFetchSponsor,
  findGlobalPda,
  LeaderboardState,
} from '../../js';
import {
  clusterUrl,
  creatorAccount,
  driverAccount,
  solanaRpc,
  solanaUrl,
  sponsorAccount,
  tokenMint,
} from '../helpers/contant';
import { createKeypairFromSecret, sendConfirmBuilder } from '../helpers/helper';
import { randomStringGenerator } from '../helpers/randomString';

dotenv.config();

// ---------------------------------------------------------------------------
// NOTE ON RUNTIME:
//   The program enforces MIN_LEADERBOARD_DURATION = 3600s and start_timestamp
//   must be in the future. So the conclude/payout happy-path can only be
//   exercised after a full >=1h window elapses. That block is gated behind
//   RUN_LONG=1 (it actually sleeps ~1h). Everything else (init validation +
//   the cancel/refund/close path) runs pre-start in a few minutes.
//
//   Requires the same env as the tournament suite (SOLANA_RPC, DRIVER_ACCOUNT,
//   CREATOR_ACCOUNT, SPONSOR_ACCOUNT, TOKEN_MINT, SOLANA_URL, CLUSTER_URL).
//   SPONSOR_ACCOUNT must hold some TOKEN_MINT balance to fund the pool.
// ---------------------------------------------------------------------------

const DEV_TREASURY = publicKey('9wep76Bp7V9heNCdtBkoWq5KzxskTnGiQj1niqwcxofj');
const TOTAL_BPS = 10_000;
const COMMIT = 'confirmed' as const;

/** Assert a builder send rejects, and that the error text matches a marker. */
async function expectTxError(
  fn: () => Promise<any>,
  markers: string[]
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch (e: any) {
    threw = true;
    const blob = [
      e?.message,
      e?.toString?.(),
      (() => {
        try {
          return JSON.stringify(e, Object.getOwnPropertyNames(e ?? {}));
        } catch {
          return '';
        }
      })(),
      JSON.stringify(e?.logs ?? e?.cause?.logs ?? []),
    ]
      .join(' ')
      .toLowerCase();
    const hit = markers.some((m) => blob.includes(m.toLowerCase()));
    assert.isTrue(
      hit,
      `tx failed but not with expected marker(s) [${markers.join(
        ', '
      )}]. Got: ${blob.slice(0, 600)}`
    );
  }
  assert.isTrue(threw, 'expected the transaction to fail, but it succeeded');
}

const nowSec = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll a fetch until `ok(value)` holds — absorbs devnet read-after-write lag and
 * transient Helius 429s. Returns the last value seen (may fail `ok` on timeout).
 */
async function poll<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  tries = 12,
  delay = 1500
): Promise<T> {
  let last = undefined as unknown as T;
  for (let i = 0; i < tries; i++) {
    try {
      last = await fn();
      if (ok(last)) return last;
    } catch {
      /* transient RPC error — retry */
    }
    await sleep(delay);
  }
  return last;
}

describe('Leaderboard', function () {
  this.timeout(2_000_000);

  let umi: Umi;
  let mint: PublicKey;
  let global: Pda;
  let driver: KeypairSigner;
  let creator: KeypairSigner;
  let sponsor: KeypairSigner;

  before(function (done) {
    for (const [k, v] of [
      ['TOKEN_MINT', tokenMint],
      ['DRIVER_ACCOUNT', driverAccount],
      ['CREATOR_ACCOUNT', creatorAccount],
      ['SPONSOR_ACCOUNT', sponsorAccount],
      ['SOLANA_RPC', solanaRpc],
      ['SOLANA_URL', solanaUrl],
      ['CLUSTER_URL', clusterUrl],
    ] as const) {
      if (!v || !String(v).length) return done(new Error(`Missing env: ${k}`));
    }

    umi = BaseCreateUmi(solanaRpc, COMMIT)
      .use(tournamentProgram())
      .use(web3JsRpc(solanaRpc));

    mint = publicKey(tokenMint!);
    global = findGlobalPda(umi);
    driver = createSignerFromKeypair(
      umi,
      umi.eddsa.createKeypairFromSecretKey(
        createKeypairFromSecret(driverAccount)
      )
    );
    creator = createSignerFromKeypair(
      umi,
      umi.eddsa.createKeypairFromSecretKey(
        createKeypairFromSecret(creatorAccount)
      )
    );
    sponsor = createSignerFromKeypair(
      umi,
      umi.eddsa.createKeypairFromSecretKey(
        createKeypairFromSecret(sponsorAccount)
      )
    );
    umi.use(keypairIdentity(driver));
    done();
  });

  // A baseline set of valid args; individual validation tests override one field.
  function baseArgs(overrides: Partial<any> = {}) {
    const start = nowSec() + 1200; // 20 min out
    const end = start + 3600; // min duration
    return {
      leaderboardId: randomStringGenerator.getRandomString(),
      startTimestamp: start,
      endTimestamp: end,
      sponsorCutoff: 600,
      buyInAmount: 0,
      minParticipants: 2,
      maxParticipants: 10,
      payoutSlotsBps: [6000, 4000],
      platformFeeBps: 2000,
      ...overrides,
    };
  }

  function initIx(args: any) {
    return initializeLeaderboard(umi, {
      driver,
      creator,
      creatorInfo: creator.publicKey,
      global,
      mint,
      ...args,
    });
  }

  // =========================================================================
  // 1. initialize_leaderboard validation
  // =========================================================================
  describe('initialize validation', function () {
    it('rejects payout bps that do not sum to 10000', async function () {
      await expectTxError(
        () =>
          sendConfirmBuilder(
            umi,
            driver,
            initIx(baseArgs({ payoutSlotsBps: [6000, 3000] })),
            'bad-sum',
            COMMIT
          ),
        ['Payout bps must sum to 10000', 'PayoutSumMismatch']
      );
    });

    it('rejects a leaderboard id longer than 28 chars', async function () {
      await expectTxError(
        () =>
          sendConfirmBuilder(
            umi,
            driver,
            initIx(baseArgs({ leaderboardId: 'x'.repeat(30) })),
            'long-id',
            COMMIT
          ),
        ['Leaderboard id too long', 'LeaderboardIdTooLong']
      );
    });

    it('rejects a start timestamp in the past', async function () {
      const start = nowSec() - 100;
      await expectTxError(
        () =>
          sendConfirmBuilder(
            umi,
            driver,
            initIx(
              baseArgs({ startTimestamp: start, endTimestamp: start + 3600 })
            ),
            'past-start',
            COMMIT
          ),
        ['Start time must be in the future', 'StartTimeInPast']
      );
    });

    it('rejects a duration under 1 hour', async function () {
      const start = nowSec() + 1200;
      await expectTxError(
        () =>
          sendConfirmBuilder(
            umi,
            driver,
            initIx(
              baseArgs({ startTimestamp: start, endTimestamp: start + 100 })
            ),
            'short-window',
            COMMIT
          ),
        ['Invalid time window', 'InvalidTimeWindow']
      );
    });

    it('rejects a platform fee above 30%', async function () {
      await expectTxError(
        () =>
          sendConfirmBuilder(
            umi,
            driver,
            initIx(baseArgs({ platformFeeBps: 3001 })),
            'fee-too-high',
            COMMIT
          ),
        ['Platform fee out of range', 'InvalidFee']
      );
    });

    it('rejects min_participants = 0', async function () {
      await expectTxError(
        () =>
          sendConfirmBuilder(
            umi,
            driver,
            initIx(baseArgs({ minParticipants: 0 })),
            'min-zero',
            COMMIT
          ),
        ['min_participants', 'InvalidMinMaxParticipants']
      );
    });

    it('rejects more than MAX_PAYOUT_SLOTS (10) payout slots', async function () {
      const eleven = Array(11).fill(0);
      eleven[0] = TOTAL_BPS;
      await expectTxError(
        () =>
          sendConfirmBuilder(
            umi,
            driver,
            initIx(baseArgs({ payoutSlotsBps: eleven, minParticipants: 11 })),
            'too-many-slots',
            COMMIT
          ),
        ['Too many payout slots', 'PayoutSlotsTooMany']
      );
    });

    it('rejects a sponsor_cutoff >= duration', async function () {
      await expectTxError(
        () =>
          sendConfirmBuilder(
            umi,
            driver,
            initIx(baseArgs({ sponsorCutoff: 3600 })),
            'bad-cutoff',
            COMMIT
          ),
        ['Sponsor cutoff is invalid', 'SponsorCutoffInvalid']
      );
    });
  });

  // =========================================================================
  // 2. happy setup + cancel/refund/close (free leaderboard, pre-start)
  // =========================================================================
  describe('cancel & refund path', function () {
    let leaderboardId: string;
    let leaderboard: Pda;
    let poolAta: Pda;
    let playerA: KeypairSigner;
    let playerB: KeypairSigner;
    const depositGross = 1000n;
    const feeBps = 2000; // 20%
    const expectedFee = (depositGross * BigInt(feeBps)) / BigInt(TOTAL_BPS);
    const expectedNet = depositGross - expectedFee;

    before(function () {
      leaderboardId = randomStringGenerator.getRandomString();
      leaderboard = findLeaderboardPda(umi, { leaderboardId });
      poolAta = findAssociatedTokenPda(umi, {
        mint,
        owner: publicKey(leaderboard),
      });
      playerA = generateSigner(umi);
      playerB = generateSigner(umi);
    });

    it('initializes a free leaderboard in Draft', async function () {
      await sendConfirmBuilder(
        umi,
        driver,
        initIx(
          baseArgs({
            leaderboardId,
            platformFeeBps: feeBps,
            payoutSlotsBps: [6000, 4000],
          })
        ),
        'init',
        COMMIT
      );
      const lb = await poll(
        () => safeFetchLeaderboard(umi, leaderboard),
        (v) => v != null
      );
      assert.isNotNull(lb);
      assert.equal(lb!.state, LeaderboardState.Draft);
      assert.equal(lb!.buyInAmount, 0n);
      assert.equal(lb!.creator, creator.publicKey);
    });

    it('publishes it (Draft -> Open)', async function () {
      await sendConfirmBuilder(
        umi,
        driver,
        publishLeaderboard(umi, { driver, creator, leaderboard }),
        'publish',
        COMMIT
      );
      const lb = await poll(
        () => safeFetchLeaderboard(umi, leaderboard),
        (v) => v?.state === LeaderboardState.Open
      );
      assert.equal(lb!.state, LeaderboardState.Open);
    });

    it('rejects publishing again', async function () {
      await expectTxError(
        () =>
          sendConfirmBuilder(
            umi,
            driver,
            publishLeaderboard(umi, { driver, creator, leaderboard }),
            'double-publish',
            COMMIT
          ),
        ['already published', 'LeaderboardAlreadyPublished']
      );
    });

    it('joins player A and player B', async function () {
      await sendConfirmBuilder(
        umi,
        driver,
        joinLeaderboard(umi, { driver, player: playerA, leaderboard, mint }),
        'joinA',
        COMMIT
      );
      await sendConfirmBuilder(
        umi,
        driver,
        joinLeaderboard(umi, { driver, player: playerB, leaderboard, mint }),
        'joinB',
        COMMIT
      );
      const lb = await poll(
        () => safeFetchLeaderboard(umi, leaderboard),
        (v) => v?.participantCount === 2
      );
      assert.equal(lb!.participantCount, 2);
      const pa = await poll(
        () =>
          safeFetchParticipant(
            umi,
            findParticipantPda(umi, {
              leaderboard: publicKey(leaderboard),
              player: playerA.publicKey,
            })
          ),
        (v) => v != null
      );
      assert.isNotNull(pa);
      assert.equal(pa!.player, playerA.publicKey);
    });

    it('rejects player A joining twice', async function () {
      await expectTxError(
        () =>
          sendConfirmBuilder(
            umi,
            driver,
            joinLeaderboard(umi, {
              driver,
              player: playerA,
              leaderboard,
              mint,
            }),
            'rejoinA',
            COMMIT
          ),
        ['already joined', 'PlayerAlreadyJoined']
      );
    });

    it('lets player B leave (count back to 1)', async function () {
      await sendConfirmBuilder(
        umi,
        driver,
        leaveLeaderboard(umi, {
          driver,
          player: playerB.publicKey,
          leaderboard,
          mint,
        }),
        'leaveB',
        COMMIT
      );
      const lb = await poll(
        () => safeFetchLeaderboard(umi, leaderboard),
        (v) => v?.participantCount === 1
      );
      assert.equal(lb!.participantCount, 1);
      const pb = await poll(
        () =>
          safeFetchParticipant(
            umi,
            findParticipantPda(umi, {
              leaderboard: publicKey(leaderboard),
              player: playerB.publicKey,
            })
          ),
        (v) => v == null
      );
      assert.isNull(pb, 'player B participant should be closed');
    });

    it('accepts a sponsor deposit (pool + pending fees credited)', async function () {
      await sendConfirmBuilder(
        umi,
        driver,
        depositSponsorship(umi, {
          driver,
          sponsor,
          leaderboard,
          mint,
          amount: depositGross,
        }),
        'deposit',
        COMMIT
      );
      const lb = await poll(
        () => safeFetchLeaderboard(umi, leaderboard),
        (v) => v?.sponsorCount === 1
      );
      assert.equal(lb!.sponsorCount, 1);
      assert.equal(lb!.prizePool, expectedNet);
      assert.equal(lb!.pendingFees, expectedFee);

      const pool = await poll(
        () => safeFetchToken(umi, poolAta),
        (v) => v != null && v.amount === depositGross
      );
      assert.isNotNull(pool);
      assert.equal(pool!.amount, depositGross);
    });

    it('lets the creator cancel before start', async function () {
      await sendConfirmBuilder(
        umi,
        driver,
        cancelLeaderboard(umi, { driver, creator, leaderboard }),
        'cancel',
        COMMIT
      );
      const lb = await poll(
        () => safeFetchLeaderboard(umi, leaderboard),
        (v) => v?.state === LeaderboardState.Cancelled
      );
      assert.equal(lb!.state, LeaderboardState.Cancelled);
    });

    it('refunds the sponsor the full gross amount', async function () {
      const before = await safeFetchToken(
        umi,
        findAssociatedTokenPda(umi, { mint, owner: sponsor.publicKey })
      );
      await sendConfirmBuilder(
        umi,
        driver,
        refundLeaderboardSponsor(umi, {
          driver,
          sponsor: sponsor.publicKey,
          leaderboard,
          mint,
        }),
        'refund-sponsor',
        COMMIT
      );
      const lb = await poll(
        () => safeFetchLeaderboard(umi, leaderboard),
        (v) => v?.refundedSponsorCount === 1
      );
      assert.equal(lb!.refundedSponsorCount, 1);
      assert.equal(lb!.pendingFees, 0n);

      const after = await poll(
        () =>
          safeFetchToken(
            umi,
            findAssociatedTokenPda(umi, { mint, owner: sponsor.publicKey })
          ),
        (v) => (v?.amount ?? 0n) - (before?.amount ?? 0n) === depositGross
      );
      assert.equal(
        (after?.amount ?? 0n) - (before?.amount ?? 0n),
        depositGross,
        'sponsor should get the full gross back on cancel'
      );
      const sp = await poll(
        () =>
          safeFetchSponsor(
            umi,
            findSponsorPda(umi, {
              leaderboard: publicKey(leaderboard),
              sponsor: sponsor.publicKey,
            })
          ),
        (v) => v == null
      );
      assert.isNull(sp, 'sponsor account should be closed after refund');
    });

    it('errors 3012 on a duplicate sponsor refund (closed PDA)', async function () {
      await expectTxError(
        () =>
          sendConfirmBuilder(
            umi,
            driver,
            refundLeaderboardSponsor(umi, {
              driver,
              sponsor: sponsor.publicKey,
              leaderboard,
              mint,
            }),
            'double-refund-sponsor',
            COMMIT
          ),
        ['3012', 'already initialized', 'AccountNotInitialized']
      );
    });

    it('refunds player A (closes participant)', async function () {
      await sendConfirmBuilder(
        umi,
        driver,
        refundLeaderboardPlayer(umi, {
          driver,
          player: playerA.publicKey,
          leaderboard,
          mint,
        }),
        'refund-player',
        COMMIT
      );
      const lb = await poll(
        () => safeFetchLeaderboard(umi, leaderboard),
        (v) => v?.refundedPlayerCount === 1
      );
      assert.equal(lb!.refundedPlayerCount, 1);
      assert.equal(lb!.refundedPlayerCount, lb!.participantCount);
    });

    it('closes the leaderboard once all refunds are done', async function () {
      await sendConfirmBuilder(
        umi,
        driver,
        closeLeaderboard(umi, {
          driver,
          treasury: DEV_TREASURY,
          leaderboard,
          mint,
        }),
        'close',
        COMMIT
      );
      const lb = await poll(
        () => safeFetchLeaderboard(umi, leaderboard),
        (v) => v == null
      );
      assert.isNull(lb, 'leaderboard account should be closed');
      const pool = await poll(
        () => safeFetchToken(umi, poolAta),
        (v) => v == null
      );
      assert.isNull(pool, 'pool ATA should be closed');
    });
  });

  // =========================================================================
  // 3. conclude + payout happy path — GATED (needs a full >=1h window)
  //    Run with:  RUN_LONG=1 yarn test:leaderboard
  // =========================================================================
  const longDescribe = process.env.RUN_LONG === '1' ? describe : describe.skip;
  longDescribe('conclude & payout path (long, ~1h)', function () {
    let leaderboardId: string;
    let leaderboard: Pda;
    let playerA: KeypairSigner;
    let playerB: KeypairSigner;
    let endTs: number;

    before(function () {
      leaderboardId = randomStringGenerator.getRandomString();
      leaderboard = findLeaderboardPda(umi, { leaderboardId });
      playerA = generateSigner(umi);
      playerB = generateSigner(umi);
    });

    it('init + publish + join(2) + sponsor before the short start', async function () {
      const start = nowSec() + 150; // 2.5 min to get everyone in
      endTs = start + 3600;
      await sendConfirmBuilder(
        umi,
        driver,
        initIx(
          baseArgs({
            leaderboardId,
            startTimestamp: start,
            endTimestamp: endTs,
            payoutSlotsBps: [6000, 4000],
            minParticipants: 2,
          })
        ),
        'init-long',
        COMMIT
      );
      await sendConfirmBuilder(
        umi,
        driver,
        publishLeaderboard(umi, { driver, creator, leaderboard }),
        'publish-long',
        COMMIT
      );
      for (const p of [playerA, playerB]) {
        await sendConfirmBuilder(
          umi,
          driver,
          joinLeaderboard(umi, { driver, player: p, leaderboard, mint }),
          'join-long',
          COMMIT
        );
      }
      await sendConfirmBuilder(
        umi,
        driver,
        depositSponsorship(umi, {
          driver,
          sponsor,
          leaderboard,
          mint,
          amount: 1000n,
        }),
        'deposit-long',
        COMMIT
      );
    });

    it('waits for the window to end, then concludes', async function () {
      // The window is >= 1h; allow up to ~75 min for this single test.
      this.timeout(4_500_000);
      while (nowSec() < endTs + 5) {
        await new Promise((r) => setTimeout(r, 15_000));
        console.log(`  waiting for end… ${endTs - nowSec()}s left`);
      }
      await sendConfirmBuilder(
        umi,
        driver,
        concludeLeaderboard(umi, {
          driver,
          leaderboard,
          mint,
          treasury: DEV_TREASURY,
        }),
        'conclude',
        COMMIT
      );
      const lb = await poll(
        () => safeFetchLeaderboard(umi, leaderboard),
        (v) => v?.state === LeaderboardState.Concluded
      );
      assert.equal(lb!.state, LeaderboardState.Concluded);
      assert.equal(lb!.pendingFees, 0n);
    });

    it('pays slots strictly in order and rejects out-of-order / re-pay', async function () {
      const participantOf = (p: KeypairSigner) =>
        findParticipantPda(umi, {
          leaderboard: publicKey(leaderboard),
          player: p.publicKey,
        });

      // paying slot 1 before slot 0 must fail
      await expectTxError(
        () =>
          sendConfirmBuilder(
            umi,
            driver,
            sendPrizeLeaderboard(umi, {
              driver,
              winner: playerB.publicKey,
              participant: participantOf(playerB),
              leaderboard,
              mint,
              slotIndex: 1,
            }),
            'slot1-early',
            COMMIT
          ),
        ['Slot index out of order', 'SlotIndexOutOfOrder']
      );

      // slot 0
      await sendConfirmBuilder(
        umi,
        driver,
        sendPrizeLeaderboard(umi, {
          driver,
          winner: playerA.publicKey,
          participant: participantOf(playerA),
          leaderboard,
          mint,
          slotIndex: 0,
        }),
        'slot0',
        COMMIT
      );
      let lb = await poll(
        () => safeFetchLeaderboard(umi, leaderboard),
        (v) => v?.paidSlots === 1
      );
      assert.equal(lb!.paidSlots, 1);

      // re-paying slot 0 must fail
      await expectTxError(
        () =>
          sendConfirmBuilder(
            umi,
            driver,
            sendPrizeLeaderboard(umi, {
              driver,
              winner: playerA.publicKey,
              participant: participantOf(playerA),
              leaderboard,
              mint,
              slotIndex: 0,
            }),
            'slot0-again',
            COMMIT
          ),
        ['already paid', 'WinnerAlreadyPaid']
      );

      // slot 1
      await sendConfirmBuilder(
        umi,
        driver,
        sendPrizeLeaderboard(umi, {
          driver,
          winner: playerB.publicKey,
          participant: participantOf(playerB),
          leaderboard,
          mint,
          slotIndex: 1,
        }),
        'slot1',
        COMMIT
      );
      lb = await poll(
        () => safeFetchLeaderboard(umi, leaderboard),
        (v) => v?.paidSlots === 2
      );
      assert.equal(lb!.paidSlots, 2);
    });

    it('closes the concluded leaderboard', async function () {
      await sendConfirmBuilder(
        umi,
        driver,
        closeLeaderboard(umi, {
          driver,
          treasury: DEV_TREASURY,
          leaderboard,
          mint,
        }),
        'close-long',
        COMMIT
      );
      const lb = await poll(
        () => safeFetchLeaderboard(umi, leaderboard),
        (v) => v == null
      );
      assert.isNull(lb);
    });
  });
});
