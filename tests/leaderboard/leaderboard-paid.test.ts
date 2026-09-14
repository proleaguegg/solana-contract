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
  createAssociatedToken,
  transferTokens,
  closeToken,
} from '@metaplex-foundation/mpl-toolbox';

import { tournamentProgram } from '../plugin.test';
import {
  initializeLeaderboard,
  publishLeaderboard,
  joinLeaderboard,
  cancelLeaderboard,
  refundLeaderboardPlayer,
  closeLeaderboard,
  findLeaderboardPda,
  safeFetchLeaderboard,
  findParticipantPda,
  findGlobalPda,
  LeaderboardState,
} from '../../js';
import {
  clusterUrl,
  creatorAccount,
  driverAccount,
  solanaRpc,
  solanaUrl,
  tokenMint,
} from '../helpers/contant';
import { createKeypairFromSecret, sendConfirmBuilder } from '../helpers/helper';
import { randomStringGenerator } from '../helpers/randomString';

dotenv.config();

// ---------------------------------------------------------------------------
// PAID leaderboard test — exercises REAL buy-ins (players pay the mint).
//
// Balance safety: the driver funds ephemeral players, and an `after` hook
// ALWAYS sweeps every player's remaining tokens back to the driver and closes
// their ATA (rent -> driver). Players never hold SOL (driver is fee payer), so
// nothing is stranded. Net token change on the driver is ~0; only tx fees cost.
//
// Configurable via env: PAID_BUYIN (default 1000), PAID_PLAYERS (default 3).
// Requires the same env as the main suite; DRIVER must hold TOKEN_MINT.
// ---------------------------------------------------------------------------

const TOTAL_BPS = 10_000;
const FEE_BPS = 2000; // 20%
const COMMIT = 'confirmed' as const;
const BUYIN = BigInt(process.env.PAID_BUYIN || '1000');
const NUM_PLAYERS = Number(process.env.PAID_PLAYERS || '3');

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
      /* transient RPC error — retry */
    }
    await sleep(delay);
  }
  return last;
}

describe('Leaderboard — paid buy-ins', function () {
  this.timeout(2_000_000);

  let umi: Umi;
  let mint: PublicKey;
  let global: Pda;
  let driver: KeypairSigner;
  let creator: KeypairSigner;

  let leaderboardId: string;
  let leaderboard: Pda;
  let poolAta: Pda;
  let driverAta: Pda;
  let driverStart: bigint | undefined;
  const players: KeypairSigner[] = [];

  const feePer = (BUYIN * BigInt(FEE_BPS)) / BigInt(TOTAL_BPS);
  const netPer = BUYIN - feePer;

  const playerAta = (p: PublicKey) =>
    findAssociatedTokenPda(umi, { mint, owner: p });
  const participantPda = (p: PublicKey) =>
    findParticipantPda(umi, { leaderboard: publicKey(leaderboard), player: p });

  before(function (done) {
    for (const [k, v] of [
      ['TOKEN_MINT', tokenMint],
      ['DRIVER_ACCOUNT', driverAccount],
      ['CREATOR_ACCOUNT', creatorAccount],
      ['SOLANA_RPC', solanaRpc],
      ['SOLANA_URL', solanaUrl],
      ['CLUSTER_URL', clusterUrl],
    ] as const) {
      if (!v || !String(v).length) return done(new Error(`Missing env: ${k}`));
    }
    if (NUM_PLAYERS < 2) return done(new Error('PAID_PLAYERS must be >= 2'));

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
    umi.use(keypairIdentity(driver));

    leaderboardId = randomStringGenerator.getRandomString();
    leaderboard = findLeaderboardPda(umi, { leaderboardId });
    poolAta = findAssociatedTokenPda(umi, {
      mint,
      owner: publicKey(leaderboard),
    });
    driverAta = findAssociatedTokenPda(umi, { mint, owner: driver.publicKey });
    for (let i = 0; i < NUM_PLAYERS; i++) players.push(generateSigner(umi));
    done();
  });

  // ---- balance-safety net: always sweep player funds back to the driver -----
  after(async function () {
    this.timeout(600_000);
    console.log('\n[recovery] sweeping any player balances back to driver…');
    for (const p of players) {
      try {
        const ata = playerAta(p.publicKey);
        const tok = await safeFetchToken(umi, ata);
        if (!tok) continue; // ATA never created / already closed
        if (tok.amount > 0n) {
          await sendConfirmBuilder(
            umi,
            driver,
            transferTokens(umi, {
              source: ata,
              destination: driverAta,
              authority: p,
              amount: tok.amount,
            }),
            `recover-transfer-${p.publicKey}`,
            COMMIT
          );
        }
        await sendConfirmBuilder(
          umi,
          driver,
          closeToken(umi, {
            account: ata,
            destination: driver.publicKey,
            owner: p,
          }),
          `recover-close-${p.publicKey}`,
          COMMIT
        );
      } catch (e: any) {
        console.log(
          `[recovery] player ${
            p.publicKey
          } sweep failed (manual check may be needed): ${String(e).slice(
            0,
            160
          )}`
        );
      }
    }
    // Final balance can lag on devnet — poll until the sweep settles.
    const drv = await poll(
      () => safeFetchToken(umi, driverAta),
      (v) => driverStart == null || v?.amount === driverStart
    );
    const end = drv?.amount ?? 0n;
    console.log(
      `[recovery] done. driver ${mint} balance now: ${end}` +
        (driverStart != null
          ? ` (start ${driverStart}, delta ${
              end - driverStart
            } — tokens conserved; only SOL fees spent)`
          : '')
    );
    if (driverStart != null) {
      assert.equal(end, driverStart, 'driver token balance must be conserved');
    }
  });

  it("driver funds each player's ATA with the buy-in", async function () {
    const start = await safeFetchToken(umi, driverAta);
    assert.isNotNull(start, 'driver must hold TOKEN_MINT');
    assert.isTrue(
      (start!.amount ?? 0n) >= BUYIN * BigInt(NUM_PLAYERS),
      'driver needs enough TOKEN_MINT to fund all players'
    );
    driverStart = start!.amount; // captured for the conservation check in after()
    console.log(
      `[funding] driver start balance: ${
        start!.amount
      } (funding ${NUM_PLAYERS} × ${BUYIN})`
    );

    for (const p of players) {
      await sendConfirmBuilder(
        umi,
        driver,
        createAssociatedToken(umi, {
          mint,
          owner: p.publicKey,
          payer: driver,
        }),
        `create-ata-${p.publicKey}`,
        COMMIT
      );
      await sendConfirmBuilder(
        umi,
        driver,
        transferTokens(umi, {
          source: driverAta,
          destination: playerAta(p.publicKey),
          authority: driver,
          amount: BUYIN,
        }),
        `fund-${p.publicKey}`,
        COMMIT
      );
      const bal = await poll(
        () => safeFetchToken(umi, playerAta(p.publicKey)),
        (v) => (v?.amount ?? 0n) === BUYIN
      );
      assert.equal(bal!.amount, BUYIN);
    }
  });

  it('initializes a PAID leaderboard', async function () {
    const startTs = nowSec() + 1200; // 20 min out
    await sendConfirmBuilder(
      umi,
      driver,
      initializeLeaderboard(umi, {
        driver,
        creator,
        creatorInfo: creator.publicKey,
        global,
        mint,
        leaderboardId,
        startTimestamp: startTs,
        endTimestamp: startTs + 3600,
        sponsorCutoff: 600,
        buyInAmount: BUYIN,
        minParticipants: 2,
        maxParticipants: 10,
        payoutSlotsBps: [6000, 4000],
        platformFeeBps: FEE_BPS,
      }),
      'init-paid',
      COMMIT
    );
    const lb = await poll(
      () => safeFetchLeaderboard(umi, leaderboard),
      (v) => v != null
    );
    assert.equal(lb!.buyInAmount, BUYIN);
    assert.equal(lb!.state, LeaderboardState.Draft);
  });

  it('publishes it (Draft -> Open)', async function () {
    await sendConfirmBuilder(
      umi,
      driver,
      publishLeaderboard(umi, { driver, creator, leaderboard }),
      'publish-paid',
      COMMIT
    );
    const lb = await poll(
      () => safeFetchLeaderboard(umi, leaderboard),
      (v) => v?.state === LeaderboardState.Open
    );
    assert.equal(lb!.state, LeaderboardState.Open);
  });

  it('all players pay the buy-in and join', async function () {
    for (const p of players) {
      await sendConfirmBuilder(
        umi,
        driver,
        joinLeaderboard(umi, { driver, player: p, leaderboard, mint }),
        `join-${p.publicKey}`,
        COMMIT
      );
    }
    const lb = await poll(
      () => safeFetchLeaderboard(umi, leaderboard),
      (v) => v?.participantCount === NUM_PLAYERS
    );
    assert.equal(lb!.participantCount, NUM_PLAYERS);
    assert.equal(lb!.prizePool, netPer * BigInt(NUM_PLAYERS));
    assert.equal(lb!.pendingFees, feePer * BigInt(NUM_PLAYERS));

    // each player's ATA is now empty; pool holds every buy-in
    for (const p of players) {
      const t = await safeFetchToken(umi, playerAta(p.publicKey));
      assert.equal(t!.amount, 0n, 'player ATA should be drained after join');
    }
    const pool = await poll(
      () => safeFetchToken(umi, poolAta),
      (v) => v?.amount === BUYIN * BigInt(NUM_PLAYERS)
    );
    assert.equal(pool!.amount, BUYIN * BigInt(NUM_PLAYERS));
  });

  it('creator cancels before start', async function () {
    await sendConfirmBuilder(
      umi,
      driver,
      cancelLeaderboard(umi, { driver, creator, leaderboard }),
      'cancel-paid',
      COMMIT
    );
    const lb = await poll(
      () => safeFetchLeaderboard(umi, leaderboard),
      (v) => v?.state === LeaderboardState.Cancelled
    );
    assert.equal(lb!.state, LeaderboardState.Cancelled);
  });

  it('refunds every player their full buy-in', async function () {
    let i = 0;
    for (const p of players) {
      await sendConfirmBuilder(
        umi,
        driver,
        refundLeaderboardPlayer(umi, {
          driver,
          player: p.publicKey,
          leaderboard,
          mint,
        }),
        `refund-${p.publicKey}`,
        COMMIT
      );
      i++;
      const lb = await poll(
        () => safeFetchLeaderboard(umi, leaderboard),
        (v) => v?.refundedPlayerCount === i
      );
      assert.equal(lb!.refundedPlayerCount, i);
      const t = await poll(
        () => safeFetchToken(umi, playerAta(p.publicKey)),
        (v) => v?.amount === BUYIN
      );
      assert.equal(t!.amount, BUYIN, 'player should get full gross back');
    }
    const lb = await safeFetchLeaderboard(umi, leaderboard);
    assert.equal(lb!.refundedPlayerCount, lb!.participantCount);
    assert.equal(lb!.prizePool, 0n);
    assert.equal(lb!.pendingFees, 0n);
  });

  it('closes the cancelled leaderboard', async function () {
    // dev treasury (constant.rs) — needed to sweep residual dust (0 here)
    const DEV_TREASURY = publicKey(
      '9wep76Bp7V9heNCdtBkoWq5KzxskTnGiQj1niqwcxofj'
    );
    await sendConfirmBuilder(
      umi,
      driver,
      closeLeaderboard(umi, {
        driver,
        treasury: DEV_TREASURY,
        leaderboard,
        mint,
      }),
      'close-paid',
      COMMIT
    );
    const lb = await poll(
      () => safeFetchLeaderboard(umi, leaderboard),
      (v) => v == null
    );
    assert.isNull(lb, 'leaderboard should be closed');
    // players still hold their refunded buy-ins here; the `after` hook sweeps
    // them back to the driver so no balance is lost.
  });
});
