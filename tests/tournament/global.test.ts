import dotenv from 'dotenv';
import {
  keypairIdentity,
  createSignerFromKeypair,
  publicKey,
  Umi,
  Pda,
  PublicKey,
  KeypairSigner,
} from '@metaplex-foundation/umi';
import { publicKey as publicKeySerializer } from '@metaplex-foundation/umi/serializers';

import { web3JsRpc } from '@metaplex-foundation/umi-rpc-web3js';
import { createUmi as BaseCreateUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { tournamentProgram } from '../plugin.test';
import {
  safeFetchTournament,
  findTournamentPda,
  initialize,
  findGlobalPda,
  safeFetchGlobal,
  initGlobal,
  updateGlobal,
  UpdateGlobalArgs,
} from '../../js';
import {
  clusterUrl,
  creatorAccount,
  driverAccount,
  solanaRpc,
  solanaUrl,
  tokenMint,
  tourId,
} from '../helpers/contant';
import { createKeypairFromSecret, sendConfirmBuilder } from '../helpers/helper';
import { randomStringGenerator } from '../helpers/randomString';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
dotenv.config();

// Describe the Tournament Test Suite
describe('Global', async function () {
  // Constant
  let umi: Umi;
  let tournamentId: string;
  let tournament: Pda;
  let mint: PublicKey;
  let creator: KeypairSigner;
  let driver: KeypairSigner;
  let joiningFees: number = 0;
  let totalPlayers: number = 128;
  const platformFeeBps: number = 2000; // 20%, matches the Leaderboard product's rate
  const roundPrizes: number[] = [
    40 * LAMPORTS_PER_SOL,
    30 * LAMPORTS_PER_SOL,
    20 * LAMPORTS_PER_SOL,
    10 * LAMPORTS_PER_SOL,
  ];
  let global: Pda;
  let list: PublicKey[] = [
    publicKey('2jYyeN8DfzWvJaHZNUGYwP77Qavt2eJVYbUX9f3VW1CQ'), // Dev-net Dev Coin
    publicKey('8j7eMMBwJRjuCKXBp7KyhJ3Kk3wRKgQshJcbx9rifPDB'), // Dev-net BONK
  ];
  let updateArgs: UpdateGlobalArgs = {
    __kind: 'Add',
    fields: [publicKey('8j7eMMBwJRjuCKXBp7KyhJ3Kk3wRKgQshJcbx9rifPDB')],
  };

  this.beforeAll((done) => {
    if (!tokenMint) {
      return done('No Mint provided');
    } else {
      mint = publicKey(tokenMint);
    }
    if (!driverAccount) {
      return done('No Driver provided');
    }
    if (!creatorAccount) {
      return done('No Creator provided');
    }
    if (!solanaRpc.length) {
      return done('No RPC provided');
    }
    if (!clusterUrl.length) {
      return done('No Cluster URL provided');
    }
    if (!solanaUrl.length) {
      return done('No Solana URL provided');
    }
    if (tourId) {
      tournamentId = tourId;
    } else {
      tournamentId = randomStringGenerator.getRandomString();
      console.log('Random String assigned to Tournament ID =>', tournamentId);
    }

    // Initializing values
    umi = BaseCreateUmi(solanaRpc, 'finalized')
      .use(tournamentProgram())
      .use(web3JsRpc(solanaRpc));
    tournament = findTournamentPda(umi, { tournamentId });
    global = findGlobalPda(umi);
    creator = createSignerFromKeypair(
      umi,
      umi.eddsa.createKeypairFromSecretKey(
        createKeypairFromSecret(creatorAccount)
      )
    );
    driver = createSignerFromKeypair(
      umi,
      umi.eddsa.createKeypairFromSecretKey(
        createKeypairFromSecret(driverAccount)
      )
    );

    done();
  });

  it.skip('Init Global', async function () {
    umi.use(keypairIdentity(driver));

    const programId = umi.programs.getPublicKey(
      'tournament',
      'matchNmUczmPKteQb9BJ8gRgafaQpDh2oDZJGuLsHfR'
    );

    const programData = umi.eddsa.findPda(
      publicKey('BPFLoaderUpgradeab1e11111111111111111111111'),
      [publicKeySerializer().serialize(programId)]
    );

    const sdkFunc = initGlobal(umi, {
      global,
      list,
      program: programId,
      programData,
    });
    const sdkFuncTx = await sendConfirmBuilder(
      umi,
      driver,
      sdkFunc,
      'Init Golbal',
      'finalized'
    );
  });

  it.skip('Update Global', async function () {
    umi.use(keypairIdentity(driver));

    const programId = umi.programs.getPublicKey(
      'tournament',
      'matchNmUczmPKteQb9BJ8gRgafaQpDh2oDZJGuLsHfR'
    );

    const programData = umi.eddsa.findPda(
      publicKey('BPFLoaderUpgradeab1e11111111111111111111111'),
      [publicKeySerializer().serialize(programId)]
    );

    const sdkFunc = updateGlobal(umi, {
      global,
      args: updateArgs,
      program: programId,
      programData,
    });
    const sdkFuncTx = await sendConfirmBuilder(
      umi,
      driver,
      sdkFunc,
      'Update Golbal',
      'finalized'
    );
    return sdkFuncTx;
  });

  it.skip('Fetch Global', async function () {
    const globalObj = await safeFetchGlobal(umi, global);
    console.dir(globalObj, { depth: null });
    return globalObj;
  });

  it('Initialize Tournament', async function () {
    umi.use(keypairIdentity(driver));
    const sdkFunc = initialize(umi, {
      driver: driver,
      creatorInfo: creator.publicKey,
      tournamentId,
      joiningFees,
      totalPlayers,
      winningRounds: roundPrizes.length,
      platformFeeBps,
      mint,
      global,
      creator,
    });

    const sdkFuncTx = await sendConfirmBuilder(
      umi,
      driver,
      sdkFunc,
      'Initialization',
      'finalized'
    );
    return sdkFuncTx;
  });

  it('Initial Fetch Tournament', async function () {
    const tournamentObj = await safeFetchTournament(umi, tournament);
    console.dir(tournamentObj, { depth: null });
    return tournamentObj;
  });
});
