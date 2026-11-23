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
  Signer,
  TransactionBuilder,
  publicKeyBytes,
} from '@metaplex-foundation/umi';
import { createUmi as BaseCreateUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { web3JsRpc } from '@metaplex-foundation/umi-rpc-web3js';
import {
  findAssociatedTokenPda,
  fetchToken,
  transferTokens,
  createMintWithAssociatedToken,
  createAssociatedToken,
  createToken,
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
  markWinnerWonNextRound,
  unmarkWinnerWonNextRound,
  removeWinner,
  refundCreatorAndCancelTournament,
  findTournamentPda,
  safeFetchTournament,
  findGlobalPda,
  TOURNAMENT_PROGRAM_ID,
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
  loadProgramAuthority,
  sendConfirmBuilder,
} from '../helpers/helper';
import { randomStringGenerator } from '../helpers/randomString';

dotenv.config();

// ---------------------------------------------------------------------------
// Fast guard / edge coverage for the bracket tournament, complementing the
// full 8-player happy path in ProLeague-Tournament-SC.test.ts.
//
// Balance-safe: every tournament created here is torn down in the after-hook
// via destroy_tournament (upgrade-authority only, works from any lifecycle
// state), signed by the upgrade authority (loadProgramAuthority: the
// devnet authority key file, or the driver on a local validator). The driver
// still pays and reclaims account rent and the creator gets any escrowed tokens back.
//
// Most cases use joiningFees = 0 so no SPL tokens move at all. The two fee
// accounting cases use a deliberately tiny buy-in and are refunded by leaving.
// ---------------------------------------------------------------------------

const TOTAL_BPS = 10_000;
const FEE_BPS = 2000; // 20%, the rate we plan to ship
const FEE_BPS_MAX = 3000; // PLATFORM_FEE_BPS_MAX in constant.rs
const COMMIT = 'confirmed' as const;
// Balance checks read the processed bank: a 'confirmed' read straight after a
// confirmed send can still return the previous state on solana-test-validator.
const READ = { commitment: 'processed' as const };
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
  let authority: Signer; // program upgrade authority (destroy_tournament)
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
    authority = loadProgramAuthority(umi, driver);
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
        treasury: publicKey('9wep76Bp7V9heNCdtBkoWq5KzxskTnGiQj1niqwcxofj'), // dev TREASURY (creation fee)
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
            authority,
            programData: umi.eddsa.findPda(
              publicKey('BPFLoaderUpgradeab1e11111111111111111111111'),
              [publicKeyBytes(TOURNAMENT_PROGRAM_ID)]
            ),
            program: TOURNAMENT_PROGRAM_ID,
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
            driver,
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
      announceTournament(umi, { driver, tournament: t.pda }),
      'announce'
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
      announceTournament(umi, { driver, tournament: t.pda }),
      'announce'
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
      announceTournament(umi, { driver, tournament: t.pda }),
      'announce'
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

  it('refuses to close an unpublished tournament holding sponsor money', async function () {
    // An unpublished tournament has no rounds, so close would sweep the
    // sponsorship to the creator. It must go back via the cancel path.
    const t = await initTournament();
    umi.use(keypairIdentity(sponsor));
    await sendConfirmBuilder(
      umi,
      sponsor,
      sponsorTournament(umi, {
        driver,
        sponsor,
        tournament: t.pda,
        mint,
        sponsorAmount: SMALL_FEE,
      }),
      'sponsor unpublished',
      COMMIT
    );
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
            treasury: DEV_TREASURY,
            driver,
            mint,
          }),
          'close unpublished sponsored'
        ),
      ['SponsorAmountNotRefunded', 'Sponsor Amount is not refunded', '0x1785']
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
        driver,
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

  it('refuses a sponsorship paid in a mint other than the tournament mint', async function () {
    // The attack this guards: sponsor in a worthless mint, then after a pause
    // refund_sponsor pays the same sponsorAmount out in the REAL mint.
    const t = await initTournament();
    const fakeMint = generateSigner(umi);
    umi.use(keypairIdentity(driver));
    await sendConfirmBuilder(
      umi,
      driver,
      createMintWithAssociatedToken(umi, {
        mint: fakeMint,
        owner: sponsor.publicKey,
        amount: SMALL_FEE,
        decimals: 9,
      }).add(
        // a tournament-owned account in the fake mint, so the tx gets past
        // account loading and is rejected by the mint constraint itself
        createAssociatedToken(umi, {
          mint: fakeMint.publicKey,
          owner: t.pda[0],
        })
      ),
      'fake mint + accounts',
      COMMIT
    );
    umi.use(keypairIdentity(sponsor));
    await expectTxError(
      () =>
        sendConfirmBuilder(
          umi,
          sponsor,
          sponsorTournament(umi, {
            driver,
            sponsor,
            tournament: t.pda,
            mint: fakeMint.publicKey,
            sponsorAmount: SMALL_FEE,
          }),
          'sponsor in fake mint',
          COMMIT
        ),
      ['InvalidMint', 'Mint does not match tournament mint', '0x179c']
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

  it('refuses a join before the tournament is published', async function () {
    // A pre-publish player would block publish_tournament, which requires an
    // empty roster, so joins only open once the prize pool is funded.
    const t = await initTournament();
    const player = generateSigner(umi);
    umi.use(keypairIdentity(driver));
    await expectTxError(
      () =>
        send(
          joinTournament(umi, {
            driver,
            playerInfo: player.publicKey,
            tournament: t.pda,
            mint,
          }),
          'join before publish'
        ),
      ['TournamentNotPublished', '0x1796']
    );
  });

  it('refuses a join once the bracket is announced', async function () {
    // leave_tournament is blocked after announce, so a late player could
    // never get their entry back out.
    const t = await initTournament();
    await publish(t, [0, 0]);
    umi.use(keypairIdentity(driver));
    await send(
      announceTournament(umi, { driver, tournament: t.pda }),
      'announce'
    );
    await pollT(t.pda, (a) => a.isAnnounced);
    const player = generateSigner(umi);
    await expectTxError(
      () =>
        send(
          joinTournament(umi, {
            driver,
            playerInfo: player.publicKey,
            tournament: t.pda,
            mint,
          }),
          'join after announce'
        ),
      ['BracketsIsAnnounced', '0x1793']
    );
  });

  it('refuses a sponsorship the driver did not co-sign', async function () {
    // One sponsorship per tournament: without the driver gate anyone could
    // squat the slot for 1 base unit and lock out the real sponsor.
    const t = await initTournament();
    const notDriver = generateSigner(umi);
    umi.use(keypairIdentity(sponsor));
    await expectTxError(
      () =>
        sendConfirmBuilder(
          umi,
          sponsor,
          sponsorTournament(umi, {
            driver: notDriver,
            sponsor,
            tournament: t.pda,
            mint,
            sponsorAmount: 1,
          }),
          'sponsor without driver',
          COMMIT
        ),
      ['ConstraintRaw', 'A raw constraint was violated', '0x7d3']
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

  // ===========================================================================
  // 4.0.0 — regressions for the Adevar pre-audit findings
  // ===========================================================================
  describe('audit fixes (4.0.0)', function () {
    const joinFree = async (t: { pda: Pda }, n: number) => {
      const players = Array.from({ length: n }, () => generateSigner(umi));
      umi.use(keypairIdentity(driver));
      for (const p of players) {
        await send(
          joinTournament(umi, {
            driver,
            playerInfo: p.publicKey,
            tournament: t.pda,
            mint,
          }),
          'join'
        );
      }
      return players;
    };
    const announce = (t: { pda: Pda }) =>
      send(announceTournament(umi, { driver, tournament: t.pda }), 'announce');
    const addW = (t: { pda: Pda }, p: KeypairSigner, roundIndex: number) =>
      send(
        addWinner(umi, {
          tournament: t.pda,
          driver,
          winner: p.publicKey,
          roundIndex,
        }),
        `add winner r${roundIndex}`
      );
    const pay = (t: { pda: Pda }, p: KeypairSigner, roundIndex: number) =>
      send(
        sendPrize(umi, {
          tournament: t.pda,
          winner: p.publicKey,
          driver,
          mint,
          roundIndex,
        }),
        `send prize r${roundIndex}`
      );
    const mark = (t: { pda: Pda }, p: KeypairSigner, roundIndex: number) =>
      send(
        markWinnerWonNextRound(umi, {
          tournament: t.pda,
          driver,
          winner: p.publicKey,
          roundIndex,
        }),
        `mark r${roundIndex}`
      );
    const unmark = (t: { pda: Pda }, p: KeypairSigner, roundIndex: number) =>
      send(
        unmarkWinnerWonNextRound(umi, {
          tournament: t.pda,
          driver,
          winner: p.publicKey,
          roundIndex,
        }),
        `unmark r${roundIndex}`
      );
    const remove = (t: { pda: Pda }, p: KeypairSigner, roundIndex: number) =>
      send(
        removeWinner(umi, {
          tournament: t.pda,
          driver,
          winner: p.publicKey,
          roundIndex,
        }),
        `remove winner r${roundIndex}`
      );
    const sponsorBuilder = (t: { pda: Pda }, amount: number) => {
      umi.use(keypairIdentity(sponsor));
      return sendConfirmBuilder(
        umi,
        sponsor,
        sponsorTournament(umi, {
          driver,
          sponsor,
          tournament: t.pda,
          mint,
          sponsorAmount: amount,
        }),
        'sponsor',
        COMMIT
      );
    };
    const closeIx = (t: { pda: Pda }) =>
      closeTournament(umi, {
        tournament: t.pda,
        creatorTokenAccount: findAssociatedTokenPda(umi, {
          mint,
          owner: creator.publicKey,
        }),
        treasury: DEV_TREASURY,
        driver,
        mint,
      });
    const tokenBalance = async (owner: PublicKey) => {
      const acc = await fetchToken(
        umi,
        findAssociatedTokenPda(umi, { mint, owner }),
        READ
      ).catch(() => null);
      return acc ? Number(acc.amount) : 0;
    };

    // ---- M-01: the champion is always paid ---------------------------------

    it('M-01: refuses to mark the champion as advancing out of the final', async function () {
      const t = await initTournament();
      await publish(t, [0, 0]);
      const [a] = await joinFree(t, 4);
      await announce(t);
      await addW(t, a, 0);
      await expectTxError(
        () => mark(t, a, 0),
        ['CannotAdvanceFromFinal', 'cannot advance', '0x17a0']
      );
    });

    it('M-01: refuses to mark a paid winner as advancing', async function () {
      const t = await initTournament();
      await publish(t, [0, 0]);
      const [a, b] = await joinFree(t, 4);
      await announce(t);
      await addW(t, a, 1);
      await addW(t, b, 1);
      await pay(t, b, 1);
      await expectTxError(
        () => mark(t, b, 1),
        ['AlreadyClaimed', 'already been claimed', '0x1776']
      );
    });

    it('M-01: caps advancing winners at half the round, re-marking is a no-op', async function () {
      const t = await initTournament();
      await publish(t, [0, 0]);
      const [a, b] = await joinFree(t, 4);
      await announce(t);
      await addW(t, a, 1);
      await addW(t, b, 1);
      await mark(t, a, 1);
      await mark(t, a, 1); // retry of an already-advanced winner succeeds
      await expectTxError(
        () => mark(t, b, 1),
        ['AdvanceLimitReached', 'advancing winners', '0x179f']
      );
    });

    // ---- corrections: undo a wrong result without a double payout ----------

    it('corrects a wrong promotion: remove from the next round, unmark, promote the right player', async function () {
      const t = await initTournament();
      await publish(t, [0, 0]);
      const [a, b] = await joinFree(t, 4);
      await announce(t);
      await addW(t, a, 1);
      await addW(t, b, 1);
      await mark(t, a, 1); // wrong player promoted
      await addW(t, a, 0); // and recorded in the final
      await expectTxError(
        () => unmark(t, a, 1),
        ['WinnerInNextRound', 'next round', '0x17aa']
      );
      await remove(t, a, 0);
      await remove(t, a, 0); // retry of a removal is a no-op
      await unmark(t, a, 1);
      await unmark(t, a, 1); // retry of an unmark is a no-op
      await mark(t, b, 1); // the advancing seat is free again
      await addW(t, b, 0);
      await pay(t, b, 0);
      await pay(t, a, 1);
    });

    it('refuses to remove a paid or advancing winner, or to unmark one recorded in the next round', async function () {
      const t = await initTournament();
      await publish(t, [0, 0]);
      const [a, b] = await joinFree(t, 4);
      await announce(t);
      await addW(t, a, 1);
      await addW(t, b, 1);
      await mark(t, a, 1);
      await addW(t, a, 0);
      await pay(t, a, 0);
      await expectTxError(
        () => remove(t, a, 1),
        ['WinnerAdvanced', 'unmark them first', '0x17ab']
      );
      await expectTxError(
        () => remove(t, a, 0),
        ['AlreadyClaimed', 'already been claimed', '0x1776']
      );
      await expectTxError(
        () => unmark(t, a, 1),
        ['WinnerInNextRound', 'next round', '0x17aa']
      );
      await pay(t, b, 1);
      await expectTxError(
        () => remove(t, b, 1),
        ['AlreadyClaimed', 'already been claimed', '0x1776']
      );
    });

    // ---- M-02: never pay more seats than publish funded -------------------

    it('M-02: refuses a second prize in a round that funds one seat', async function () {
      const t = await initTournament();
      await createTokenAccount(umi, mint, driver, creator.publicKey);
      await publish(t, [SMALL_FEE, SMALL_FEE]); // round 1 funds 1 seat
      const [a, b] = await joinFree(t, 4);
      await announce(t);
      await addW(t, a, 1);
      await addW(t, b, 1);
      await pay(t, b, 1);
      await expectTxError(
        () => pay(t, a, 1),
        ['PrizeSeatsFull', 'already paid', '0x179d']
      );
      // a retry of the paid seat still reports AlreadyClaimed first
      await expectTxError(
        () => pay(t, b, 1),
        ['AlreadyClaimed', 'already been claimed', '0x1776']
      );
    });

    it('M-01/M-02: a correctly settled bracket closes with the exact fee', async function () {
      const t = await initTournament();
      await createTokenAccount(umi, mint, driver, creator.publicKey);
      await createTokenAccount(umi, mint, driver, DEV_TREASURY);
      await publish(t, [2 * SMALL_FEE, SMALL_FEE]); // pool = 2 + 1 = 3
      const published = await pollT(t.pda, (x) => x.isPublished);
      const fee = Number(published!.pendingFees);
      assert.equal(fee, feeOf(3 * SMALL_FEE, FEE_BPS));

      const [champ, runnerUp] = await joinFree(t, 4);
      await announce(t);
      await addW(t, champ, 1);
      await addW(t, runnerUp, 1);
      await addW(t, champ, 0);
      await mark(t, champ, 1);
      await pay(t, champ, 0);
      await pay(t, runnerUp, 1);
      assert.equal(await tokenBalance(champ.publicKey), 2 * SMALL_FEE);
      assert.equal(await tokenBalance(runnerUp.publicKey), SMALL_FEE);

      const treasuryBefore = await tokenBalance(DEV_TREASURY);
      umi.use(keypairIdentity(driver));
      await send(closeIx(t), 'close settled bracket');
      assert.equal(
        (await tokenBalance(DEV_TREASURY)) - treasuryBefore,
        fee,
        'treasury receives exactly pendingFees'
      );
      assert.isNull(
        await safeFetchTournament(umi, t.pda, READ),
        'account closed'
      );
    });

    // ---- M-03: escrow must be the tournament's ATA -------------------------

    it('M-03: rejects a tournament-owned token account that is not its ATA', async function () {
      const t = await initTournament();
      const rogue = generateSigner(umi);
      umi.use(keypairIdentity(driver));
      await send(
        createToken(umi, { token: rogue, mint, owner: t.pda[0] }),
        'non-ATA tournament token account'
      );
      umi.use(keypairIdentity(sponsor));
      await expectTxError(
        () =>
          sendConfirmBuilder(
            umi,
            sponsor,
            sponsorTournament(umi, {
              driver,
              sponsor,
              tournament: t.pda,
              tournamentTokenAccount: rogue.publicKey,
              mint,
              sponsorAmount: SMALL_FEE,
            }),
            'sponsor into non-ATA escrow',
            COMMIT
          ),
        ['ConstraintAssociated', 'associated constraint', '0x7d9']
      );
    });

    // ---- M-04: results only after the roster is locked ---------------------

    it('M-04: refuses to record a winner before announce', async function () {
      const t = await initTournament();
      await publish(t, [0, 0]);
      const [a] = await joinFree(t, 1);
      await expectTxError(
        () => addW(t, a, 0),
        ['TournamentNotAnnounced', 'not announced', '0x17a9']
      );
    });

    // ---- M-05: no cancellation or sponsorship once a prize is out ----------

    it('M-05: refuses pause and sponsorship after a prize is paid', async function () {
      const t = await initTournament();
      await createTokenAccount(umi, mint, driver, creator.publicKey);
      await publish(t, [SMALL_FEE, 0]);
      const [a] = await joinFree(t, 2);
      await announce(t);
      await addW(t, a, 0);
      await pay(t, a, 0);
      umi.use(keypairIdentity(driver));
      await expectTxError(
        () =>
          send(
            pauseTournament(umi, { driver, tournament: t.pda, creator }),
            'pause after prize'
          ),
        ['PrizeAlreadyPaid', 'no longer be cancelled', '0x17a1']
      );
      await expectTxError(
        () => sponsorBuilder(t, SMALL_FEE),
        ['PrizeAlreadyPaid', 'no longer be cancelled', '0x17a1']
      );
    });

    // ---- M-06: sponsor money must fund prizes --------------------------------

    it('M-06: refuses to publish a sponsored tournament with no prize pool', async function () {
      const t = await initTournament();
      await sponsorBuilder(t, SMALL_FEE);
      await expectTxError(
        () => publish(t, [0, 0]),
        ['SponsoredPrizePoolRequired', 'sponsored tournament', '0x17a2']
      );
    });

    it('M-06: refuses to sponsor a published tournament with no prizes', async function () {
      const t = await initTournament();
      await publish(t, [0, 0]);
      await expectTxError(
        () => sponsorBuilder(t, SMALL_FEE),
        ['SponsoredPrizePoolRequired', 'sponsored tournament', '0x17a2']
      );
    });

    it('refuses a zero sponsorship', async function () {
      const t = await initTournament();
      await expectTxError(
        () => sponsorBuilder(t, 0),
        ['InvalidSponsorAmount', 'greater than zero', '0x17a6']
      );
    });

    // ---- L-01: recovery never closes an escrow that still holds tokens -----

    it('L-01: destroy refuses a funded escrow without the creator token account', async function () {
      const t = await initTournament();
      await sponsorBuilder(t, SMALL_FEE);
      umi.use(keypairIdentity(driver));
      await expectTxError(
        () =>
          send(
            destroyTournament(umi, {
              tournament: t.pda,
              creator: creator.publicKey,
              authority,
              programData: umi.eddsa.findPda(
                publicKey('BPFLoaderUpgradeab1e11111111111111111111111'),
                [publicKeyBytes(TOURNAMENT_PROGRAM_ID)]
              ),
              program: TOURNAMENT_PROGRAM_ID,
              mint,
              bump: t.pda[1],
              tournamentId: t.tournamentId,
            }),
            'destroy without creator account'
          ),
        ['CreatorTokenAccountRequired', 'escrow holds tokens', '0x17a7']
      );
      // teardown passes the creator account and returns the sponsorship
    });

    // ---- L-02: id length -----------------------------------------------------

    it('L-02: rejects a tournament id over 28 bytes', async function () {
      umi.use(keypairIdentity(driver));
      await expectTxError(
        () =>
          send(
            initialize(umi, {
              treasury: DEV_TREASURY,
              driver,
              creator,
              creatorInfo: creator.publicKey,
              global,
              mint,
              ...initArgs({ tournamentId: 'x'.repeat(29) }),
            }),
            '29-byte id'
          ),
        ['TournamentIdTooLong', 'id is too long', '0x17a5']
      );
    });

    // ---- L-03: announce needs enough players for every prize round ---------

    it('L-03: refuses to announce with fewer players than a prize round seats', async function () {
      const t = await initTournament();
      await createTokenAccount(umi, mint, driver, creator.publicKey);
      await publish(t, [0, SMALL_FEE]); // round 1 seats 2 players
      await joinFree(t, 1);
      await expectTxError(
        () => announce(t),
        ['InsufficientPlayers', 'Not enough players', '0x17a4']
      );
      await joinFree(t, 1);
      await announce(t);
    });

    // ---- L-05: driver writable when it is not the fee payer ------------------

    it('L-05: cancels with the creator paying fees and the driver receiving rent', async function () {
      const t = await initTournament();
      await createTokenAccount(umi, mint, driver, creator.publicKey);
      umi.use(keypairIdentity(creator));
      await sendConfirmBuilder(
        umi,
        creator,
        pauseTournament(umi, { driver, tournament: t.pda, creator }),
        'pause (creator pays)',
        COMMIT
      );
      const driverBefore = await umi.rpc.getBalance(driver.publicKey, READ);
      await sendConfirmBuilder(
        umi,
        creator,
        refundCreatorAndCancelTournament(umi, {
          tournament: t.pda,
          creatorTokenAccount: findAssociatedTokenPda(umi, {
            mint,
            owner: creator.publicKey,
          }),
          driver,
          mint,
        }),
        'cancel (creator pays)',
        COMMIT
      );
      const driverAfter = await umi.rpc.getBalance(driver.publicKey, READ);
      assert.isTrue(
        driverAfter.basisPoints > driverBefore.basisPoints,
        'driver receives the closed tournament rent'
      );
      assert.isNull(await safeFetchTournament(umi, t.pda, READ));
      umi.use(keypairIdentity(driver));
    });

    // ---- L-06: a pre-created escrow ATA does not block initialize ----------

    it('L-06: initializes over an escrow ATA someone created first', async function () {
      const tournamentId = randomStringGenerator.getRandomString();
      const pda = findTournamentPda(umi, { tournamentId });
      umi.use(keypairIdentity(sponsor));
      await sendConfirmBuilder(
        umi,
        sponsor,
        createAssociatedToken(umi, { mint, owner: pda[0] }),
        'griefer pre-creates escrow ATA',
        COMMIT
      );
      await initTournament({ tournamentId });
      assert.isNotNull(await pollT(pda));
    });

    // ---- creation fee: 0.1 SOL to the treasury for non-whitelisted mints ---

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
      const tournamentId = randomStringGenerator.getRandomString();
      const pda = findTournamentPda(umi, { tournamentId });
      const before = await umi.rpc.getBalance(DEV_TREASURY, READ);
      await send(
        initialize(umi, {
          treasury: DEV_TREASURY,
          driver,
          creator,
          creatorInfo: creator.publicKey,
          global,
          mint: otherMint.publicKey,
          ...initArgs({ tournamentId }),
        }),
        'initialize with non-whitelisted mint'
      );
      const after = await umi.rpc.getBalance(DEV_TREASURY, READ);
      assert.equal(
        Number(after.basisPoints - before.basisPoints),
        100_000_000,
        'treasury receives exactly 0.1 SOL'
      );
      // unpublished and unsponsored, so close cleans it up
      await send(
        closeTournament(umi, {
          tournament: pda,
          creatorTokenAccount: findAssociatedTokenPda(umi, {
            mint: otherMint.publicKey,
            owner: creator.publicKey,
          }),
          treasury: DEV_TREASURY,
          driver,
          mint: otherMint.publicKey,
        }),
        'close non-whitelisted tournament'
      );
    });

    it('rejects a creation fee sent anywhere but the treasury', async function () {
      umi.use(keypairIdentity(driver));
      await expectTxError(
        () =>
          send(
            initialize(umi, {
              treasury: driver.publicKey,
              driver,
              creator,
              creatorInfo: creator.publicKey,
              global,
              mint,
              ...initArgs(),
            }),
            'initialize with wrong treasury'
          ),
        ['InvalidTreasury', 'does not match program treasury', '0x1795']
      );
    });
  });
});
