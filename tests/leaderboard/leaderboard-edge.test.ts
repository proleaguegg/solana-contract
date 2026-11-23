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
  TransactionBuilder,
} from '@metaplex-foundation/umi';
import { createUmi as BaseCreateUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { web3JsRpc } from '@metaplex-foundation/umi-rpc-web3js';
import {
  createAssociatedToken,
  createMintWithAssociatedToken,
} from '@metaplex-foundation/mpl-toolbox';

import { tournamentProgram } from '../plugin.test';
import {
  initializeLeaderboard,
  publishLeaderboard,
  joinLeaderboard,
  cancelLeaderboard,
  depositSponsorship,
  refundLeaderboardPlayer,
  refundLeaderboardSponsor,
  closeLeaderboard,
  findLeaderboardPda,
  safeFetchLeaderboard,
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
// Fast edge / guard coverage — no time-window waits. Complements the happy
// paths in leaderboard.test.ts (cancel/refund) and leaderboard-paid.test.ts.
//
// Balance-safe: every leaderboard that moves tokens is cancelled + refunded +
// closed; Draft-only cases are cancelled by the driver and closed in teardown
// (driver-only Draft cancel since 4.0.0, L-04).
//
// Sponsor tests use SPONSOR_ACCOUNT and (as a 2nd distinct sponsor)
// CREATOR_ACCOUNT — both must hold a little TOKEN_MINT.
// ---------------------------------------------------------------------------

const TOTAL_BPS = 10_000;
const FEE_BPS = 2000; // 20%
const COMMIT = 'confirmed' as const;
const DEV_TREASURY = publicKey('9wep76Bp7V9heNCdtBkoWq5KzxskTnGiQj1niqwcxofj');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

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
      /* transient */
    }
    await sleep(delay);
  }
  return last;
}

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
      `failed but not with expected marker(s) [${markers.join(
        ', '
      )}]. Got: ${blob.slice(0, 500)}`
    );
  }
  assert.isTrue(threw, 'expected the transaction to fail, but it succeeded');
}

describe('Leaderboard — edge cases', function () {
  this.timeout(2_000_000);

  let umi: Umi;
  let mint: PublicKey;
  let global: Pda;
  let driver: KeypairSigner;
  let creator: KeypairSigner;
  let sponsor: KeypairSigner;

  const send = (b: TransactionBuilder, action: string) =>
    sendConfirmBuilder(umi, driver, b, action, COMMIT);

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

  // ---- shared helpers -------------------------------------------------------
  function args(overrides: Partial<any> = {}) {
    const start = nowSec() + 1200; // 20 min out — everything here is pre-start
    return {
      leaderboardId: randomStringGenerator.getRandomString(),
      startTimestamp: start,
      endTimestamp: start + 3600,
      sponsorCutoff: 600,
      buyInAmount: 0,
      minParticipants: 2,
      maxParticipants: 10,
      payoutSlotsBps: [6000, 4000],
      platformFeeBps: FEE_BPS,
      ...overrides,
    };
  }

  async function initFree(overrides: Partial<any> = {}) {
    const a = args(overrides);
    const pda = findLeaderboardPda(umi, { leaderboardId: a.leaderboardId });
    await send(
      initializeLeaderboard(umi, {
        treasury: publicKey('9wep76Bp7V9heNCdtBkoWq5KzxskTnGiQj1niqwcxofj'), // dev TREASURY (creation fee)
        driver,
        creator,
        creatorInfo: creator.publicKey,
        global,
        mint,
        ...a,
      }),
      'init'
    );
    await poll(
      () => safeFetchLeaderboard(umi, pda),
      (v) => v != null
    );
    return pda;
  }

  async function publish(pda: Pda) {
    await send(
      publishLeaderboard(umi, { driver, creator, leaderboard: pda }),
      'publish'
    );
    await poll(
      () => safeFetchLeaderboard(umi, pda),
      (v) => v?.state === LeaderboardState.Open
    );
  }

  async function initOpen(overrides: Partial<any> = {}) {
    const pda = await initFree(overrides);
    await publish(pda);
    return pda;
  }

  // Best-effort teardown so no token/rent is lost. Idempotent-ish (errors swallowed).
  async function teardown(
    pda: Pda,
    players: KeypairSigner[] = [],
    sponsors: PublicKey[] = []
  ) {
    try {
      const lb = await safeFetchLeaderboard(umi, pda);
      if (!lb) return;
      if (
        lb.state === LeaderboardState.Open ||
        lb.state === LeaderboardState.Draft
      ) {
        await send(
          cancelLeaderboard(umi, { driver, creator, leaderboard: pda }),
          'td-cancel'
        );
      }
      for (const p of players) {
        try {
          await send(
            refundLeaderboardPlayer(umi, {
              driver,
              player: p.publicKey,
              leaderboard: pda,
              mint,
            }),
            'td-refund-player'
          );
        } catch {}
      }
      for (const s of sponsors) {
        try {
          await send(
            refundLeaderboardSponsor(umi, {
              driver,
              sponsor: s,
              leaderboard: pda,
              mint,
            }),
            'td-refund-sponsor'
          );
        } catch {}
      }
      try {
        await send(
          closeLeaderboard(umi, {
            driver,
            treasury: DEV_TREASURY,
            leaderboard: pda,
            mint,
          }),
          'td-close'
        );
      } catch {}
    } catch {}
  }

  // =========================================================================
  // state & authorization guards
  // =========================================================================
  describe('state & auth guards', function () {
    it('rejects join before publish (Draft)', async function () {
      const pda = await initFree();
      const player = generateSigner(umi);
      await expectTxError(
        () =>
          send(
            joinLeaderboard(umi, { driver, player, leaderboard: pda, mint }),
            'join-draft'
          ),
        ['not in Open state', 'LeaderboardNotOpen']
      );
      await teardown(pda);
    });

    it('lets the driver alone cancel and close a Draft (L-04)', async function () {
      const pda = await initFree();
      // no creator signature: a Draft holds no funds
      await send(
        cancelLeaderboard(umi, { driver, leaderboard: pda }),
        'cancel-draft'
      );
      await poll(
        () => safeFetchLeaderboard(umi, pda),
        (v) => v?.state === LeaderboardState.Cancelled
      );
      await send(
        closeLeaderboard(umi, {
          driver,
          treasury: DEV_TREASURY,
          leaderboard: pda,
          mint,
        }),
        'close-draft'
      );
      await poll(
        () => safeFetchLeaderboard(umi, pda),
        (v) => v == null
      );
    });

    it('rejects cancel by a non-creator', async function () {
      const pda = await initOpen();
      const notCreator = generateSigner(umi);
      await expectTxError(
        () =>
          send(
            cancelLeaderboard(umi, {
              driver,
              creator: notCreator,
              leaderboard: pda,
            }),
            'cancel-wrong'
          ),
        ['Unauthorized']
      );
      await teardown(pda);
    });

    it('rejects a double cancel', async function () {
      const pda = await initOpen();
      await send(
        cancelLeaderboard(umi, { driver, creator, leaderboard: pda }),
        'cancel-1'
      );
      await poll(
        () => safeFetchLeaderboard(umi, pda),
        (v) => v?.state === LeaderboardState.Cancelled
      );
      await expectTxError(
        () =>
          send(
            cancelLeaderboard(umi, { driver, creator, leaderboard: pda }),
            'cancel-2'
          ),
        ['already cancelled', 'LeaderboardAlreadyCancelled']
      );
      await teardown(pda);
    });

    it('rejects close while Open', async function () {
      const pda = await initOpen();
      await expectTxError(
        () =>
          send(
            closeLeaderboard(umi, {
              driver,
              treasury: DEV_TREASURY,
              leaderboard: pda,
              mint,
            }),
            'close-open'
          ),
        ['Unauthorized']
      );
      await teardown(pda);
    });

    it('rejects refunding a player while not cancelled', async function () {
      const pda = await initOpen();
      const player = generateSigner(umi);
      await send(
        joinLeaderboard(umi, { driver, player, leaderboard: pda, mint }),
        'join'
      );
      await expectTxError(
        () =>
          send(
            refundLeaderboardPlayer(umi, {
              driver,
              player: player.publicKey,
              leaderboard: pda,
              mint,
            }),
            'refund-open'
          ),
        ['not in Cancelled state', 'LeaderboardNotCancelled']
      );
      await teardown(pda, [player]);
    });

    it('rejects close before all refunds are complete', async function () {
      const pda = await initOpen();
      const player = generateSigner(umi);
      await send(
        joinLeaderboard(umi, { driver, player, leaderboard: pda, mint }),
        'join'
      );
      await send(
        cancelLeaderboard(umi, { driver, creator, leaderboard: pda }),
        'cancel'
      );
      await poll(
        () => safeFetchLeaderboard(umi, pda),
        (v) => v?.state === LeaderboardState.Cancelled
      );
      await expectTxError(
        () =>
          send(
            closeLeaderboard(umi, {
              driver,
              treasury: DEV_TREASURY,
              leaderboard: pda,
              mint,
            }),
            'close-early'
          ),
        ['Refunds not complete', 'RefundsNotComplete']
      );
      await teardown(pda, [player]); // completes the refund + closes
    });
  });

  // =========================================================================
  // capacity
  // =========================================================================
  describe('capacity', function () {
    it('rejects joining past max_participants', async function () {
      const pda = await initOpen({ minParticipants: 2, maxParticipants: 2 });
      const p1 = generateSigner(umi);
      const p2 = generateSigner(umi);
      const p3 = generateSigner(umi);
      await send(
        joinLeaderboard(umi, { driver, player: p1, leaderboard: pda, mint }),
        'join1'
      );
      await send(
        joinLeaderboard(umi, { driver, player: p2, leaderboard: pda, mint }),
        'join2'
      );
      await poll(
        () => safeFetchLeaderboard(umi, pda),
        (v) => v?.participantCount === 2
      );
      await expectTxError(
        () =>
          send(
            joinLeaderboard(umi, {
              driver,
              player: p3,
              leaderboard: pda,
              mint,
            }),
            'join3'
          ),
        ['Participant limit reached', 'ParticipantLimitReached']
      );
      await teardown(pda, [p1, p2]);
    });
  });

  // =========================================================================
  // sponsor accounting
  // =========================================================================
  describe('sponsor accounting', function () {
    const sponsorPda = (pda: Pda, s: PublicKey) =>
      findSponsorPda(umi, { leaderboard: publicKey(pda), sponsor: s });

    it('rejects a deposit of amount 0', async function () {
      const pda = await initOpen();
      await expectTxError(
        () =>
          send(
            depositSponsorship(umi, {
              driver,
              sponsor,
              leaderboard: pda,
              mint,
              amount: 0,
            }),
            'deposit-0'
          ),
        ['Arithmetic overflow', 'OverFlow']
      );
      await teardown(pda);
    });

    it('sums two deposits from the same sponsor (count stays 1)', async function () {
      const pda = await initOpen();
      await send(
        depositSponsorship(umi, {
          driver,
          sponsor,
          leaderboard: pda,
          mint,
          amount: 100,
        }),
        'deposit-a'
      );
      await send(
        depositSponsorship(umi, {
          driver,
          sponsor,
          leaderboard: pda,
          mint,
          amount: 50,
        }),
        'deposit-b'
      );
      const lb = await poll(
        () => safeFetchLeaderboard(umi, pda),
        (v) => v?.sponsorCount === 1 && v?.prizePool === 120n
      );
      assert.equal(lb!.sponsorCount, 1, 'one distinct sponsor');
      assert.equal(lb!.prizePool, 120n, 'net of 150 @20% = 120');
      assert.equal(lb!.pendingFees, 30n, 'fee of 150 @20% = 30');
      const sp = await safeFetchSponsor(
        umi,
        sponsorPda(pda, sponsor.publicKey)
      );
      assert.equal(sp!.grossContribution, 150n);
      assert.equal(sp!.netContribution, 120n);
      await teardown(pda, [], [sponsor.publicKey]);
    });

    it('counts two distinct sponsors (count = 2)', async function () {
      const pda = await initOpen();
      // sponsor #1 = SPONSOR_ACCOUNT, sponsor #2 = CREATOR_ACCOUNT (both hold the mint)
      await send(
        depositSponsorship(umi, {
          driver,
          sponsor,
          leaderboard: pda,
          mint,
          amount: 100,
        }),
        'deposit-s1'
      );
      await send(
        depositSponsorship(umi, {
          driver,
          sponsor: creator,
          leaderboard: pda,
          mint,
          amount: 100,
        }),
        'deposit-s2'
      );
      const lb = await poll(
        () => safeFetchLeaderboard(umi, pda),
        (v) => v?.sponsorCount === 2
      );
      assert.equal(lb!.sponsorCount, 2, 'two distinct sponsors');
      assert.equal(lb!.prizePool, 160n, '2 × net(80)');
      assert.equal(lb!.pendingFees, 40n, '2 × fee(20)');
      await teardown(pda, [], [sponsor.publicKey, creator.publicKey]);
    });
  });

  // ===========================================================================
  // 4.0.0 — regressions for the Adevar pre-audit findings
  // ===========================================================================
  describe('audit fixes (4.0.0)', function () {
    const initIx = (
      a: any,
      mintKey: PublicKey = mint,
      treasury: PublicKey = DEV_TREASURY
    ) =>
      initializeLeaderboard(umi, {
        treasury,
        driver,
        creator,
        creatorInfo: creator.publicKey,
        global,
        mint: mintKey,
        ...a,
      });

    it('L-06: initializes over a leaderboard escrow ATA someone created first', async function () {
      const a = args();
      const pda = findLeaderboardPda(umi, { leaderboardId: a.leaderboardId });
      umi.use(keypairIdentity(sponsor));
      await sendConfirmBuilder(
        umi,
        sponsor,
        createAssociatedToken(umi, { mint, owner: pda[0] }),
        'griefer pre-creates leaderboard ATA',
        COMMIT
      );
      umi.use(keypairIdentity(driver));
      await send(initIx(a), 'init over pre-created ATA');
      const lb = await poll(
        () => safeFetchLeaderboard(umi, pda),
        (v) => v != null
      );
      assert.equal(lb!.state, LeaderboardState.Draft);
      await teardown(pda);
    });

    it('refuses to publish once the start time has passed', async function () {
      const start = nowSec() + 8;
      const pda = await initFree({
        startTimestamp: start,
        endTimestamp: start + 3600,
      });
      await new Promise((r) => setTimeout(r, 15_000));
      await expectTxError(
        () =>
          send(
            publishLeaderboard(umi, { driver, creator, leaderboard: pda }),
            'publish after start'
          ),
        ['StartTimeInPast', 'Start time must be in the future']
      );
      await teardown(pda);
    });

    it('charges a non-whitelisted mint 0.1 SOL, paid to the treasury', async function () {
      const otherMint = generateSigner(umi);
      umi.use(keypairIdentity(driver));
      await send(
        createMintWithAssociatedToken(umi, {
          mint: otherMint,
          owner: creator.publicKey,
          amount: 0,
          decimals: 9,
        }),
        'non-whitelisted mint'
      );
      const a = args();
      const pda = findLeaderboardPda(umi, { leaderboardId: a.leaderboardId });
      const before = await umi.rpc.getBalance(DEV_TREASURY, {
        commitment: 'processed',
      });
      await send(initIx(a, otherMint.publicKey), 'init non-whitelisted');
      const after = await umi.rpc.getBalance(DEV_TREASURY, {
        commitment: 'processed',
      });
      assert.equal(
        Number(after.basisPoints - before.basisPoints),
        100_000_000,
        'treasury receives exactly 0.1 SOL'
      );
      // Draft: the driver alone cancels, then close reclaims rent
      await send(
        cancelLeaderboard(umi, { driver, leaderboard: pda }),
        'cancel'
      );
      await send(
        closeLeaderboard(umi, {
          driver,
          treasury: DEV_TREASURY,
          leaderboard: pda,
          mint: otherMint.publicKey,
        }),
        'close'
      );
    });

    it('rejects a creation fee sent anywhere but the treasury', async function () {
      await expectTxError(
        () => send(initIx(args(), mint, driver.publicKey), 'wrong treasury'),
        ['InvalidTreasury', 'Invalid treasury account']
      );
    });
  });
});
