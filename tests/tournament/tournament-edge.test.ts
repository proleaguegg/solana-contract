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
  findAssociatedTokenPda,
  fetchToken,
  transferTokens,
} from '@metaplex-foundation/mpl-toolbox';

import { tournamentProgram } from '../plugin.test';
import {
  initialize,
  publishTournament,
  joinTournament,
  leaveTournament,
  announceTournament,
  sponsorTournament,
  pauseTournament,
  addWinner,
  sendPrize,
  closeTournament,
  destroyTournament,
  findTournamentPda,
  safeFetchTournament,
  findGlobalPda,
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
import {
  createKeypairFromSecret,
  createTokenAccount,
  sendConfirmBuilder,
} from '../helpers/helper';
import { randomStringGenerator } from '../helpers/randomString';

dotenv.config();

// ---------------------------------------------------------------------------
// Fast guard / edge coverage for the bracket tournament, complementing the
// full 8-player happy path in ProLeague-Tournament-SC.test.ts.
//
// Balance-safe: every tournament created here is torn down in the after-hook
// via destroy_tournament (driver-only, works from any lifecycle state) so the
// driver reclaims account rent and the creator gets any escrowed tokens back.
//
// Most cases use joiningFees = 0 so no SPL tokens move at all. The two fee
// accounting cases use a deliberately tiny buy-in and are refunded by leaving.
// ---------------------------------------------------------------------------

const TOTAL_BPS = 10_000;
const FEE_BPS = 2000; // 20%, the rate we plan to ship
const FEE_BPS_MAX = 3000; // PLATFORM_FEE_BPS_MAX in constant.rs
const COMMIT = 'confirmed' as const;
const DEV_TREASURY = publicKey('9wep76Bp7V9heNCdtBkoWq5KzxskTnGiQj1niqwcxofj');

// tiny buy-in for the accounting cases (mint is 9-decimals in dev)
const SMALL_FEE = 1_000_000; // 0.001 token

const feeOf = (gross: number, bps: number) =>
  Math.floor((gross * bps) / TOTAL_BPS);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

describe('Tournament — edge cases', function () {
  this.timeout(2_000_000);

  let umi: Umi;
  let mint: PublicKey;
  let global: Pda;
  let driver: KeypairSigner;
  let creator: KeypairSigner;
  let sponsor: KeypairSigner;

  // every tournament id created here, torn down in after()
  const created: string[] = [];

  const send = (b: TransactionBuilder, action: string) =>
    sendConfirmBuilder(umi, driver, b, action, COMMIT);

  /**
   * Devnet reads lag writes even at `confirmed`, so every post-write assertion
   * polls until the account reflects what we just did (or gives up and lets the
   * assertion report the stale value).
   */
  async function pollT(
    pda: Pda,
    ok: (a: any) => boolean = (a) => !!a,
    tries = 15,
    delay = 1500
  ): Promise<any> {
    let last: any = null;
    for (let i = 0; i < tries; i++) {
      try {
        last = await safeFetchTournament(umi, pda);
        if (last && ok(last)) return last;
      } catch {
        /* transient */
      }
      await sleep(delay);
    }
    return last;
  }

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

  function initArgs(overrides: Partial<any> = {}) {
    return {
      tournamentId: randomStringGenerator.getRandomString(),
      joiningFees: 0,
      totalPlayers: 4,
      winningRounds: 2,
      platformFeeBps: FEE_BPS,
      ...overrides,
    };
  }

  /** initialize and remember the id for teardown */
  async function initTournament(overrides: Partial<any> = {}) {
    const a = initArgs(overrides);
    umi.use(keypairIdentity(driver));
    await send(
      initialize(umi, {
        driver,
        creator,
        creatorInfo: creator.publicKey,
        global,
        mint,
        ...a,
      }),
      `initialize ${a.tournamentId}`
    );
    created.push(a.tournamentId);
    return {
      ...a,
      pda: findTournamentPda(umi, { tournamentId: a.tournamentId }),
    };
  }

  async function publish(
    t: { tournamentId: string; pda: Pda },
    roundPrizes: number[],
    signer: KeypairSigner = creator,
    joiningFees?: number
  ) {
    umi.use(keypairIdentity(signer));
    const b = publishTournament(umi, {
      creator: signer,
      tournament: t.pda,
      roundPrizes,
      joiningFees: joiningFees === undefined ? null : joiningFees,
      mint,
    });
    return sendConfirmBuilder(
      umi,
      signer,
      b,
      `publish ${t.tournamentId}`,
      COMMIT
    );
  }

  after(async function () {
    // reclaim rent + any escrow for everything this suite created
    umi.use(keypairIdentity(driver));
    for (const tournamentId of created) {
      const pda = findTournamentPda(umi, { tournamentId });
      const acc = await safeFetchTournament(umi, pda);
      if (!acc) continue;
      try {
        await send(
          destroyTournament(umi, {
            tournament: pda,
            creator: creator.publicKey,
            creatorTokenAccount: findAssociatedTokenPda(umi, {
              mint,
              owner: creator.publicKey,
            }),
            driver,
            mint,
            bump: pda[1],
            tournamentId,
          }),
          `teardown ${tournamentId}`
        );
      } catch (e: any) {
        console.log(`teardown failed for ${tournamentId}: ${e?.message}`);
      }
    }
  });

  // ---- initialize validation ------------------------------------------------

  it('rejects a platform fee above the 30% cap', async function () {
    await expectTxError(
      () => initTournament({ platformFeeBps: FEE_BPS_MAX + 1 }),
      ['InvalidFee', 'Platform fee exceeds maximum allowed', '0x1794']
    );
  });

  it('accepts a platform fee exactly at the cap', async function () {
    const t = await initTournament({ platformFeeBps: FEE_BPS_MAX });
    const acc = await pollT(t.pda);
    assert.equal(acc!.platformFeeBps, FEE_BPS_MAX);
  });

  it('rejects a player count that is not a power of two', async function () {
    await expectTxError(
      () => initTournament({ totalPlayers: 6 }),
      ['InvalidPlayerCount', 'power of two', '0x1797']
    );
  });

  it('rejects a player count below 2', async function () {
    await expectTxError(
      () => initTournament({ totalPlayers: 1 }),
      ['InvalidPlayerCount', 'power of two', '0x1797']
    );
  });

  it('stores the fee rate and starts with zero pending fees', async function () {
    const t = await initTournament();
    const acc = await pollT(t.pda);
    assert.equal(acc!.platformFeeBps, FEE_BPS, 'fee bps persisted');
    assert.equal(Number(acc!.pendingFees), 0, 'pending fees start at zero');
    assert.equal(acc!.creator, creator.publicKey, 'creator recorded');
  });

  // ---- publish authorisation / lifecycle ------------------------------------

  it('refuses a publish signed by anyone other than the creator', async function () {
    const t = await initTournament();
    await expectTxError(
      () => publish(t, [0, 0], sponsor),
      ['WrongCreator', 'Wrong Creator', '0x177f', 'constraint']
    );
  });

  it('refuses a second publish', async function () {
    const t = await initTournament();
    await publish(t, [0, 0]);
    await expectTxError(
      () => publish(t, [0, 0]),
      ['TournamentPublished', 'Tournament is published', '0x1790']
    );
  });

  it('refuses to change the entry fee once a player has joined', async function () {
    // free tournament, one player joins, then a publish that tries to set a fee
    const t = await initTournament();
    const player = generateSigner(umi);
    umi.use(keypairIdentity(driver));
    await send(
      joinTournament(umi, {
        driver,
        playerInfo: player.publicKey,
        tournament: t.pda,
        mint,
      }),
      'join before publish'
    );
    await expectTxError(
      () => publish(t, [0, 0], creator, SMALL_FEE),
      ['PlayerAlreadyJoined', 'Player Already joined', '0x1788']
    );
  });

  // ---- announce lifecycle ---------------------------------------------------

  it('refuses to announce a tournament that is not published', async function () {
    const t = await initTournament();
    umi.use(keypairIdentity(driver));
    await expectTxError(
      () =>
        send(
          announceTournament(umi, { driver, tournament: t.pda }),
          'announce before publish'
        ),
      ['TournamentNotPublished', 'Tournament is not published', '0x1796']
    );
  });

  it('allows announce once published', async function () {
    const t = await initTournament();
    await publish(t, [0, 0]);
    umi.use(keypairIdentity(driver));
    await send(
      announceTournament(umi, { driver, tournament: t.pda }),
      'announce after publish'
    );
    const acc = await pollT(t.pda, (a) => a.isAnnounced);
    assert.isTrue(acc!.isAnnounced);
  });

  // ---- sponsorship window ---------------------------------------------------

  it('refuses a sponsorship once the tournament is paused for cancellation', async function () {
    const t = await initTournament();
    umi.use(keypairIdentity(driver));
    await sendConfirmBuilder(
      umi,
      driver,
      pauseTournament(umi, { driver, tournament: t.pda, creator }),
      'pause',
      COMMIT
    );
    umi.use(keypairIdentity(sponsor));
    await expectTxError(
      () =>
        sendConfirmBuilder(
          umi,
          sponsor,
          sponsorTournament(umi, {
            sponsor,
            tournament: t.pda,
            mint,
            sponsorAmount: SMALL_FEE,
          }),
          'sponsor while paused',
          COMMIT
        ),
      ['SponsorshipClosed', 'sponsorship window is closed', '0x1798']
    );
  });

  it('refuses joins, payouts and close once paused for cancellation', async function () {
    // Cancellation must unwind through the refund path only. While paused, no
    // new money may enter and none may leave except as refunds.
    const t = await initTournament();
    await publish(t, [0, 0]);

    const player = generateSigner(umi);
    umi.use(keypairIdentity(driver));
    await send(
      joinTournament(umi, {
        driver,
        playerInfo: player.publicKey,
        tournament: t.pda,
        mint,
      }),
      'join before pause'
    );
    await send(
      addWinner(umi, {
        tournament: t.pda,
        driver,
        winner: player.publicKey,
        roundIndex: 0,
      }),
      'record winner'
    );

    await sendConfirmBuilder(
      umi,
      driver,
      pauseTournament(umi, { driver, tournament: t.pda, creator }),
      'pause',
      COMMIT
    );

    const paused = ['TournamentIsPaused', 'paused for cancellation', '0x1799'];

    // no new entries into a dying tournament
    const late = generateSigner(umi);
    umi.use(keypairIdentity(driver));
    await expectTxError(
      () =>
        send(
          joinTournament(umi, {
            driver,
            playerInfo: late.publicKey,
            tournament: t.pda,
            mint,
          }),
          'join while paused'
        ),
      paused
    );

    // no prize payouts draining escrow owed back as refunds
    await expectTxError(
      () =>
        send(
          sendPrize(umi, {
            tournament: t.pda,
            winner: player.publicKey,
            driver,
            mint,
            roundIndex: 0,
          }),
          'send prize while paused'
        ),
      paused
    );

    // no sweeping to treasury/creator instead of refunding
    await expectTxError(
      () =>
        send(
          closeTournament(umi, {
            tournament: t.pda,
            creatorTokenAccount: findAssociatedTokenPda(umi, {
              mint,
              owner: creator.publicKey,
            }),
            treasury: DEV_TREASURY,
            driver,
            mint,
          }),
          'close while paused'
        ),
      paused
    );
  });

  // ---- prize payout authorisation -------------------------------------------

  it('refuses send_prize from a signer that is not the driver', async function () {
    const t = await initTournament();
    await publish(t, [0, 0]);
    const player = generateSigner(umi);
    umi.use(keypairIdentity(driver));
    await send(
      joinTournament(umi, {
        driver,
        playerInfo: player.publicKey,
        tournament: t.pda,
        mint,
      }),
      'join'
    );
    await send(
      addWinner(umi, {
        tournament: t.pda,
        driver,
        winner: player.publicKey,
        roundIndex: 0,
      }),
      'add winner'
    );
    // creator is not the DRIVER — the account constraint must reject it
    umi.use(keypairIdentity(creator));
    await expectTxError(
      () =>
        sendConfirmBuilder(
          umi,
          creator,
          sendPrize(umi, {
            tournament: t.pda,
            winner: player.publicKey,
            driver: creator,
            mint,
            roundIndex: 0,
          }),
          'send prize as non-driver',
          COMMIT
        ),
      ['constraint', '0x7d3', '2003', 'raw constraint']
    );
  });

  // ---- close gate -----------------------------------------------------------

  it('refuses to close while a recorded winner is still owed a prize', async function () {
    // free entry, but a real prize on round 0 funded by the creator at publish
    const t = await initTournament();
    await createTokenAccount(umi, mint, driver, creator.publicKey);
    await publish(t, [SMALL_FEE, 0]);

    const player = generateSigner(umi);
    umi.use(keypairIdentity(driver));
    await send(
      joinTournament(umi, {
        driver,
        playerInfo: player.publicKey,
        tournament: t.pda,
        mint,
      }),
      'free join'
    );
    await send(
      addWinner(umi, {
        tournament: t.pda,
        driver,
        winner: player.publicKey,
        roundIndex: 0,
      }),
      'record round-0 winner'
    );

    // round 0 now holds one entry that is neither claimed nor advanced —
    // the close gate must refuse rather than sweep the prize away
    await expectTxError(
      () =>
        send(
          closeTournament(umi, {
            tournament: t.pda,
            creatorTokenAccount: findAssociatedTokenPda(umi, {
              mint,
              owner: creator.publicKey,
            }),
            treasury: DEV_TREASURY,
            driver,
            mint,
          }),
          'close with unpaid winner'
        ),
      ['PrizeNotClaimed', 'Prize not Claimed', '0x178d']
    );
  });

  it('rejects a close pointed at the wrong treasury', async function () {
    const t = await initTournament();
    await publish(t, [0, 0]);
    umi.use(keypairIdentity(driver));
    await expectTxError(
      () =>
        send(
          closeTournament(umi, {
            tournament: t.pda,
            creatorTokenAccount: findAssociatedTokenPda(umi, {
              mint,
              owner: creator.publicKey,
            }),
            treasury: sponsor.publicKey, // not the TREASURY constant
            driver,
            mint,
          }),
          'close with wrong treasury'
        ),
      ['InvalidTreasury', 'does not match program treasury', '0x1795']
    );
  });

  // ---- fee accounting -------------------------------------------------------

  it('does not fee entry fees — pendingFees is unchanged by join and leave', async function () {
    // The platform fee is now a cut of the prize pool, fixed at publish.
    // Entry money must flow into escrow whole and never move pendingFees.
    const t = await initTournament({ joiningFees: SMALL_FEE });
    await createTokenAccount(umi, mint, driver, creator.publicKey);
    await publish(t, [SMALL_FEE, 0]);

    const published = await pollT(t.pda, (a) => a.isPublished);
    const feeAtPublish = Number(published!.pendingFees);
    assert.equal(
      feeAtPublish,
      feeOf(SMALL_FEE, FEE_BPS),
      'fee is floor(pool x bps) fixed at publish'
    );

    const player = sponsor; // already holds TOKEN_MINT
    umi.use(keypairIdentity(driver));
    await sendConfirmBuilder(
      umi,
      driver,
      joinTournament(umi, {
        driver,
        player,
        playerInfo: player.publicKey,
        playerTokenAccount: findAssociatedTokenPda(umi, {
          mint,
          owner: player.publicKey,
        }),
        tournament: t.pda,
        mint,
      }),
      'paid join',
      COMMIT
    );

    const afterJoin = await pollT(t.pda, (a) => a.players.length === 1);
    assert.equal(
      Number(afterJoin!.pendingFees),
      feeAtPublish,
      'join must not change pendingFees'
    );

    await send(
      leaveTournament(umi, {
        driver,
        player: player.publicKey,
        tournament: t.pda,
        mint,
      }),
      'leave'
    );

    const afterLeave = await pollT(t.pda, (a) => a.players.length === 0);
    assert.equal(
      Number(afterLeave!.pendingFees),
      feeAtPublish,
      'leave must not change pendingFees either'
    );
  });

  it('does not fee sponsorships', async function () {
    const t = await initTournament();
    umi.use(keypairIdentity(sponsor));
    await sendConfirmBuilder(
      umi,
      sponsor,
      sponsorTournament(umi, {
        sponsor,
        tournament: t.pda,
        mint,
        sponsorAmount: SMALL_FEE,
      }),
      'sponsor',
      COMMIT
    );
    const acc = await pollT(
      t.pda,
      (a) => Number(a.sponsorAmount) === SMALL_FEE
    );
    assert.equal(
      Number(acc!.pendingFees),
      0,
      'sponsorship funds the pool; fee is taken on the pool at publish, not here'
    );
  });

  it('charges the fee on the WEIGHTED pool, not the plain sum of roundPrizes', async function () {
    // roundPrizes[2] pays 2 players, so sum() != pool for ladders deeper than 2.
    const t = await initTournament({ totalPlayers: 8, winningRounds: 3 });
    await createTokenAccount(umi, mint, driver, creator.publicKey);
    const prizes = [4 * SMALL_FEE, 2 * SMALL_FEE, SMALL_FEE]; // pool = 4+2+(1x2) = 8
    const weighted = 4 * SMALL_FEE + 2 * SMALL_FEE + 2 * SMALL_FEE;
    const naive = prizes.reduce((a, b) => a + b, 0); // would be 7 x SMALL_FEE
    assert.notEqual(weighted, naive, 'test ladder must expose the difference');

    await publish(t, prizes);
    const acc = await pollT(t.pda, (a) => a.isPublished);
    assert.equal(
      Number(acc!.pendingFees),
      feeOf(weighted, FEE_BPS),
      'fee must derive from the weighted pool'
    );
  });

  it('rejects an entry fee with no prize pool', async function () {
    const t = await initTournament({ joiningFees: SMALL_FEE });
    await expectTxError(
      () => publish(t, [0, 0]),
      ['PrizePoolRequired', 'must award a prize pool', '0x179a']
    );
  });

  it('refuses to publish once a player has joined', async function () {
    // Entry money can still leave via leave_tournament, so it must never be
    // counted as funding for the pool. Publish must come first.
    const t = await initTournament();
    const player = generateSigner(umi);
    umi.use(keypairIdentity(driver));
    await send(
      joinTournament(umi, {
        driver,
        playerInfo: player.publicKey,
        tournament: t.pda,
        mint,
      }),
      'join before publish'
    );
    await expectTxError(
      () => publish(t, [0, 0]),
      ['PlayerAlreadyJoined', 'Player Already joined', '0x1788']
    );
  });

  it('refuses prize rows the bracket does not have', async function () {
    // 4 players => 2 rounds. A 4-row ladder would inflate the fee base and the
    // funding requirement for prizes that can never be paid.
    const t = await initTournament({ totalPlayers: 4 });
    await expectTxError(
      () => publish(t, [SMALL_FEE, SMALL_FEE, SMALL_FEE, SMALL_FEE]),
      ['InvalidRound', 'does not exist', '0x1770']
    );
  });

  it('allows a free tournament with no prize pool', async function () {
    const t = await initTournament({ joiningFees: 0 });
    await publish(t, [0, 0]);
    const acc = await pollT(t.pda, (a) => a.isPublished);
    assert.equal(Number(acc!.pendingFees), 0, 'no pool means no fee');
  });
});
