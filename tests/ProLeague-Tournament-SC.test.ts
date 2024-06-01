import base58 from "bs58";
import dotenv from "dotenv";
import {
  keypairIdentity,
  createSignerFromKeypair,
  publicKey,
  Umi,
  Pda,
  PublicKey,
  KeypairSigner,
  TransactionBuilder,
} from "@metaplex-foundation/umi";
import { web3JsRpc } from "@metaplex-foundation/umi-rpc-web3js";
import { createUmi as BaseCreateUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { tournamentProgram } from "./plugin.test";
import {
  addWinner,
  sendPrize,
  closeTournament,
  safeFetchTournament,
  findTournamentPda,
  initialize,
  joinTournament,
  markWinnerWonNextRound,
  publishTournament,
  sponsorTournament,
  pauseTournament,
  refundJoiningFees,
  refundSponsor,
  refundCreatorAndCancelTournament,
  leaveTournament,
  findGlobalPda,
} from "../js";
import {
  findAssociatedTokenPda,
  transferTokens,
  createAssociatedToken,
} from "@metaplex-foundation/mpl-toolbox";
import {
  clusterUrl,
  creatorAccount,
  driverAccount,
  solanaRpc,
  solanaUrl,
  sponsorAccount,
  tokenMint,
  tourId,
} from "./helpers/contant";
import {
  createKeypairFromSecret,
  createTokenAccount,
  sendConfirmBuilder,
  sendConfirmBuilderArr,
} from "./helpers/helper";
import { randomStringGenerator } from "./helpers/randomString";
import { writeFileSync } from "fs";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
dotenv.config();

// Describe the Tournament Test Suite
describe("ProLeague-Tournament-SC", async function () {
  // Pre - Check
  let isSponsored: boolean = true;
  // Constant
  let umi: Umi;
  let tournamentId: string;
  let tournament: Pda;
  let mint: PublicKey;
  let creator: KeypairSigner;
  let driver: KeypairSigner;
  let sponsor: KeypairSigner;
  let joiningFees: number = 10 * LAMPORTS_PER_SOL;
  // let joiningFees: number = 0;
  let totalPlayers: number = 8;
  const roundPrizes: number[] = [
    40 * LAMPORTS_PER_SOL,
    30 * LAMPORTS_PER_SOL,
    // 20 * LAMPORTS_PER_SOL,
    // 10 * LAMPORTS_PER_SOL,
  ];
  let sponsorAmount: number = 20 * LAMPORTS_PER_SOL;
  const players: KeypairSigner[] = [];
  let global: Pda;

  this.beforeAll((done) => {
    if (!tokenMint) {
      return done("No Mint provided");
    } else {
      mint = publicKey(tokenMint);
    }
    if (!driverAccount) {
      return done("No Driver provided");
    }
    if (!creatorAccount) {
      return done("No Creator provided");
    }
    if (!solanaRpc.length) {
      return done("No RPC provided");
    }
    if (!clusterUrl.length) {
      return done("No Cluster URL provided");
    }
    if (!solanaUrl.length) {
      return done("No Solana URL provided");
    }
    if (tourId) {
      tournamentId = tourId;
    } else {
      tournamentId = randomStringGenerator.getRandomString();
      console.log("Random String assigned to Tournament ID =>", tournamentId);
    }

    // Initializing values
    umi = BaseCreateUmi(solanaRpc, "finalized")
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

    if (isSponsored) {
      if (sponsorAccount) {
        sponsor = createSignerFromKeypair(
          umi,
          umi.eddsa.createKeypairFromSecretKey(
            createKeypairFromSecret(sponsorAccount)
          )
        );
      } else {
        return done("No Sponsor provided");
      }
    }
    // Looping to create Players Account with Signer
    for (let i = 0; i < totalPlayers; i++) {
      const player: KeypairSigner = createSignerFromKeypair(
        umi,
        umi.eddsa.generateKeypair()
      );
      players.push(player);
    }
    writeFileSync(
      `./test-result/${tournamentId}-palyers.json`,
      JSON.stringify(players),
      "utf8"
    );
    done();
  });

  it("Initialize Tournament", async function () {
    umi.use(keypairIdentity(driver));
    const sdkFunc = initialize(umi, {
      driver: driver,
      creatorInfo: creator.publicKey,
      tournamentId,
      joiningFees,
      totalPlayers,
      winningRounds: roundPrizes.length,
      mint,
      global,
      creator,
    });

    const sdkFuncTx = await sendConfirmBuilder(
      umi,
      driver,
      sdkFunc,
      "Initialization",
      "finalized"
    );
    return sdkFuncTx;
  });

  it("Initial Fetch Tournament", async function () {
    const tournamentObj = await safeFetchTournament(umi, tournament);
    console.dir(tournamentObj, { depth: null });
    return tournamentObj;
  });

  it("Sponsor Tournament", async function () {
    umi.use(keypairIdentity(driver));
    if (isSponsored) {
      const driverTokenAccount = findAssociatedTokenPda(umi, {
        mint,
        owner: driver.publicKey,
      });
      const sponsorTokenAccount = findAssociatedTokenPda(umi, {
        mint,
        owner: sponsor.publicKey,
      });

      const checkOrCreateDriverTokenAccount = await createTokenAccount(
        umi,
        mint,
        driver,
        driver.publicKey
      );
      const checkOrCreateSponsorTokenAccount = await createTokenAccount(
        umi,
        mint,
        driver,
        sponsor.publicKey
      );

      const transFunc = transferTokens(umi, {
        source: driverTokenAccount,
        destination: sponsorTokenAccount,
        amount: sponsorAmount,
        authority: driver,
      });

      const transFuncTx = await sendConfirmBuilder(
        umi,
        driver,
        transFunc,
        "Transferring Token Sponsor",
        "finalized"
      );

      const sdkFunc = sponsorTournament(umi, {
        sponsor,
        sponsorAmount,
        tournament,
        sponsorTokenAccount,
        mint,
      });

      const sdkFuncTx = await sendConfirmBuilder(
        umi,
        driver,
        sdkFunc,
        "Sponsor Tournament"
      );
      return sdkFuncTx;
    }
    return true;
  });

  it("Publish Tournament", async function () {
    umi.use(keypairIdentity(creator));
    const checkOrCreateDriverTokenAccount = await createTokenAccount(
      umi,
      mint,
      driver,
      creator.publicKey
    );

    const sdkFunc = publishTournament(umi, {
      creator,
      tournament,
      joiningFees,
      roundPrizes,
      mint,
    });

    const sdkFuncTx = await sendConfirmBuilder(
      umi,
      driver,
      sdkFunc,
      "Publish Tournament",
      "finalized"
    );
    return sdkFuncTx;
  });

  it("Leave Tournament", async function () {
    const driverTokenAccount = findAssociatedTokenPda(umi, {
      mint,
      owner: driver.publicKey,
    });
    const LeaveTournamentBuilder: TransactionBuilder[] = [];
    const tempPlayers: KeypairSigner[] = [];
    const totalTempPlayers: number = 2;
    for (let i = 0; i < totalTempPlayers; i++) {
      const player: KeypairSigner = createSignerFromKeypair(
        umi,
        umi.eddsa.generateKeypair()
      );
      tempPlayers.push(player);
    }
    umi.use(keypairIdentity(driver));

    if (joiningFees) {
      const JoinTournamentBuilder: TransactionBuilder[] = [];
      for (let i = 0; i < totalTempPlayers; i++) {
        const player = tempPlayers[i];
        const playerTokenAccount = findAssociatedTokenPda(umi, {
          mint,
          owner: player.publicKey,
        });
        let txBuilder = new TransactionBuilder();
        txBuilder = txBuilder.prepend(
          createAssociatedToken(umi, {
            payer: driver,
            owner: player.publicKey,
            mint,
            ata: playerTokenAccount,
          })
        );

        txBuilder = txBuilder.add(
          transferTokens(umi, {
            source: driverTokenAccount,
            destination: playerTokenAccount,
            amount: joiningFees,
            authority: driver,
          })
        );
        txBuilder = txBuilder.add(
          joinTournament(umi, {
            playerInfo: player.publicKey,
            driver: driver,
            tournament,
            mint,
            player: player,
            playerTokenAccount,
          })
        );

        JoinTournamentBuilder.push(txBuilder);
      }
      const JoinTournamentBuilderTx = await sendConfirmBuilderArr(
        umi,
        driver,
        JoinTournamentBuilder
      );
      JoinTournamentBuilderTx.map((t) => {
        console.log(
          `Transaction for Joining Player Success 🎉: https://${solanaUrl}/tx/${base58.encode(
            t.signature
          )}?cluster=${clusterUrl}`
        );
      });
    } else {
      const joinPlayersTransactionBuilder: TransactionBuilder[] = [];
      for (let i = 0; i < totalTempPlayers; i++) {
        joinPlayersTransactionBuilder.push(
          joinTournament(umi, {
            playerInfo: tempPlayers[i].publicKey,
            driver: driver,
            tournament,
            mint,
          })
        );
      }
      const sdkFuncTx = await sendConfirmBuilderArr(
        umi,
        driver,
        joinPlayersTransactionBuilder
      );
      sdkFuncTx.map((t) => {
        console.log(
          `Transaction for Joining Player without fees Success 🎉: https://${solanaUrl}/tx/${base58.encode(
            t.signature
          )}?cluster=${clusterUrl}`
        );
      });
    }

    // Now Remove Players after joining
    for (let i = 0; i < totalTempPlayers; i++) {
      LeaveTournamentBuilder.push(
        leaveTournament(umi, {
          player: tempPlayers[i].publicKey,
          driver,
          tournament,
          mint,
        })
      );
    }

    const sdkFuncTx = await sendConfirmBuilderArr(
      umi,
      driver,
      LeaveTournamentBuilder
    );
    sdkFuncTx.map((t) => {
      console.log(
        `Transaction for Leave Tournament Success 🎉: https://${solanaUrl}/tx/${base58.encode(
          t.signature
        )}?cluster=${clusterUrl}`
      );
    });
    return sdkFuncTx;
  });

  it("Join Tournament", async function () {
    const driverTokenAccount = findAssociatedTokenPda(umi, {
      mint,
      owner: driver.publicKey,
    });
    umi.use(keypairIdentity(driver));
    if (joiningFees) {
      const JoinTournamentBuilder: TransactionBuilder[] = [];
      for (let i = 0; i < totalPlayers; i++) {
        const player = players[i];
        const playerTokenAccount = findAssociatedTokenPda(umi, {
          mint,
          owner: player.publicKey,
        });
        let txBuilder = new TransactionBuilder();
        txBuilder = txBuilder.prepend(
          createAssociatedToken(umi, {
            payer: driver,
            owner: player.publicKey,
            mint,
            ata: playerTokenAccount,
          })
        );

        txBuilder = txBuilder.add(
          transferTokens(umi, {
            source: driverTokenAccount,
            destination: playerTokenAccount,
            amount: joiningFees,
            authority: driver,
          })
        );
        txBuilder = txBuilder.add(
          joinTournament(umi, {
            playerInfo: player.publicKey,
            driver: driver,
            tournament,
            mint,
            player: player,
            playerTokenAccount,
          })
        );

        JoinTournamentBuilder.push(txBuilder);
      }
      const JoinTournamentBuilderTx = await sendConfirmBuilderArr(
        umi,
        driver,
        JoinTournamentBuilder
      );
      JoinTournamentBuilderTx.map((t) => {
        console.log(
          `Transaction for Joining Player Success 🎉: https://${solanaUrl}/tx/${base58.encode(
            t.signature
          )}?cluster=${clusterUrl}`
        );
      });
      return JoinTournamentBuilderTx;
    } else {
      const joinPlayersTransactionBuilder: TransactionBuilder[] = [];
      for (let i = 0; i < totalPlayers; i++) {
        joinPlayersTransactionBuilder.push(
          joinTournament(umi, {
            playerInfo: players[i].publicKey,
            driver: driver,
            tournament,
            mint,
          })
        );
      }
      const sdkFuncTx = await sendConfirmBuilderArr(
        umi,
        driver,
        joinPlayersTransactionBuilder
      );
      sdkFuncTx.map((t) => {
        console.log(
          `Transaction for Joining Player without fees Success 🎉: https://${solanaUrl}/tx/${base58.encode(
            t.signature
          )}?cluster=${clusterUrl}`
        );
      });
      return sdkFuncTx;
    }
  });

  it("Add Winner", async function () {
    let tempPlayers = [...players].slice(0, totalPlayers / 2);
    let round = Math.log2(totalPlayers);
    let roundIndex = round - 1;
    umi.use(keypairIdentity(driver));
    for (let j = 0; j < round; j++) {
      const addPlayersTransactionBuilder: TransactionBuilder[] = [];
      // Add winner Transaction to Arr
      for (let i = 0; i < tempPlayers.length; i++) {
        addPlayersTransactionBuilder.push(
          addWinner(umi, {
            tournament,
            driver: driver,
            winner: tempPlayers[i].publicKey,
            roundIndex,
          })
        );
      }
      const sdkFuncTx = await sendConfirmBuilderArr(
        umi,
        driver,
        addPlayersTransactionBuilder
      );
      sdkFuncTx.map((t) => {
        console.log(
          `Transaction for AddWinner Round Success 🎉: https://${solanaUrl}/tx/${base58.encode(
            t.signature
          )}?cluster=${clusterUrl}`
        );
      });
      console.log({ roundIndex });
      roundIndex = roundIndex - 1;
      tempPlayers = tempPlayers.slice(0, tempPlayers.length / 2);
    }
    return true;
  });

  it("Mark Winner Won Next Round", async function () {
    let tempPlayers = [...players].slice(0, players.length / 4);
    let round = Math.log2(totalPlayers);
    let roundIndex = round - 1;
    umi.use(keypairIdentity(driver));
    for (let j = 1; j < round; j++) {
      const addPlayersTransactionBuilder: TransactionBuilder[] = [];
      // Promot Winner Transaction to Arr
      for (let i = 0; i < tempPlayers.length; i++) {
        addPlayersTransactionBuilder.push(
          markWinnerWonNextRound(umi, {
            tournament,
            driver,
            winner: tempPlayers[i].publicKey,
            roundIndex,
          })
        );
      }
      const sdkFuncTx = await sendConfirmBuilderArr(
        umi,
        driver,
        addPlayersTransactionBuilder
      );
      sdkFuncTx.map((t) => {
        console.log(
          `Transaction for Mark Winner Won last Round Success 🎉: https://${solanaUrl}/tx/${base58.encode(
            t.signature
          )}?cluster=${clusterUrl}`
        );
      });
      console.log({ roundIndex });
      roundIndex = roundIndex - 1;
      tempPlayers = tempPlayers.slice(0, tempPlayers.length / 2);
    }
    return true;
  });

  it("Send Prize", async function () {
    const winners: KeypairSigner[] = [
      ...players.slice(0, Math.pow(2, roundPrizes.length)),
    ];
    const rewards: number[] = [...roundPrizes];
    const PrizePlayersTransactionBuilder: TransactionBuilder[] = [];
    umi.use(keypairIdentity(driver));

    let winnerThisRound = 1;
    let roundIndex = 0;

    while (rewards.length) {
      const reward = rewards.shift();
      if (reward === undefined) break;

      for (let i = 0; i < winnerThisRound; i++) {
        const winner = winners.shift();
        if (winner) {
          PrizePlayersTransactionBuilder.push(
            sendPrize(umi, {
              roundIndex,
              tournament,
              winner: winner.publicKey,
              driver: driver,
              mint,
              // winnerTokenAccount: findAssociatedTokenPda(umi, {
              //   mint,
              //   owner: winner.publicKey,
              // }),
            })
          );
        }
      }

      roundIndex++;
      if (roundIndex > 1) {
        winnerThisRound *= 2;
      }
    }

    const sdkFuncTx = await sendConfirmBuilderArr(
      umi,
      driver,
      PrizePlayersTransactionBuilder
    );
    sdkFuncTx.map((t) => {
      console.log(
        `Transaction for claiming prize Success 🎉: https://${solanaUrl}/tx/${base58.encode(
          t.signature
        )}?cluster=${clusterUrl}`
      );
    });
    return sdkFuncTx;
  });

  it("Fetch Tournament", async function () {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    const tournamentObj = await safeFetchTournament(umi, tournament);
    console.dir(tournamentObj, { depth: null });
    return tournamentObj;
  });

  it("Close Tournament", async function () {
    const creatorTokenAccount = findAssociatedTokenPda(umi, {
      mint,
      owner: creator.publicKey,
    });
    umi.use(keypairIdentity(driver));
    const sdkFunc = closeTournament(umi, {
      tournament,
      creatorTokenAccount,
      driver: driver,
      mint,
    });

    const sdkFuncTx = await sendConfirmBuilder(
      umi,
      driver,
      sdkFunc,
      "concluding match"
    );
    return sdkFuncTx;
  });
});

// Cancel Tournament Test Suite
describe.skip("Cancel Tournament", async function () {
  // Pre - Check
  let isSponsored: boolean = true;
  // Constant
  let umi: Umi;
  let tournamentId: string;
  let tournament: Pda;
  let mint: PublicKey;
  let creator: KeypairSigner;
  let driver: KeypairSigner;
  let sponsor: KeypairSigner;
  let joiningFees: number = 10 * LAMPORTS_PER_SOL;
  // let joiningFees: number = 0;
  let totalPlayers: number = 128;
  const roundPrizes: number[] = [
    40 * LAMPORTS_PER_SOL,
    30 * LAMPORTS_PER_SOL,
    20 * LAMPORTS_PER_SOL,
    10 * LAMPORTS_PER_SOL,
  ];
  let sponsorAmount: number = 20 * LAMPORTS_PER_SOL;
  const players: KeypairSigner[] = [];
  let global: Pda;

  this.beforeAll((done) => {
    if (!tokenMint) {
      return done("No Mint provided");
    } else {
      mint = publicKey(tokenMint);
    }
    if (!driverAccount) {
      return done("No Driver provided");
    }
    if (!creatorAccount) {
      return done("No Creator provided");
    }
    if (!solanaRpc.length) {
      return done("No RPC provided");
    }
    if (!clusterUrl.length) {
      return done("No Cluster URL provided");
    }
    if (!solanaUrl.length) {
      return done("No Solana URL provided");
    }
    if (tourId) {
      tournamentId = tourId;
    } else {
      tournamentId = randomStringGenerator.getRandomString();
      console.log("Random String assigned to Tournament ID =>", tournamentId);
    }

    // Initializing values
    umi = BaseCreateUmi(solanaRpc, "finalized")
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

    if (isSponsored) {
      if (sponsorAccount) {
        sponsor = createSignerFromKeypair(
          umi,
          umi.eddsa.createKeypairFromSecretKey(
            createKeypairFromSecret(sponsorAccount)
          )
        );
      } else {
        return done("No Sponsor provided");
      }
    }
    // Looping to create Players Account with Signer
    for (let i = 0; i < totalPlayers; i++) {
      const player: KeypairSigner = createSignerFromKeypair(
        umi,
        umi.eddsa.generateKeypair()
      );
      players.push(player);
    }
    writeFileSync(
      `./test-result/${tournamentId}-palyers.json`,
      JSON.stringify(players),
      "utf8"
    );
    done();
  });

  it("Initialize Tournament", async function () {
    umi.use(keypairIdentity(driver));
    const sdkFunc = initialize(umi, {
      driver: driver,
      creatorInfo: creator.publicKey,
      tournamentId,
      joiningFees,
      totalPlayers,
      winningRounds: roundPrizes.length,
      mint,
      global,
    });

    const sdkFuncTx = await sendConfirmBuilder(
      umi,
      driver,
      sdkFunc,
      "Initialization",
      "finalized"
    );
  });

  it("Initial Fetch Tournament", async function () {
    const tournamentObj = await safeFetchTournament(umi, tournament);
    console.dir(tournamentObj, { depth: null });
    return tournamentObj;
  });

  it("Sponsor Tournament", async function () {
    umi.use(keypairIdentity(driver));
    if (isSponsored) {
      const driverTokenAccount = findAssociatedTokenPda(umi, {
        mint,
        owner: driver.publicKey,
      });
      const sponsorTokenAccount = findAssociatedTokenPda(umi, {
        mint,
        owner: sponsor.publicKey,
      });

      const checkOrCreateDriverTokenAccount = await createTokenAccount(
        umi,
        mint,
        driver,
        driver.publicKey
      );
      const checkOrCreateSponsorTokenAccount = await createTokenAccount(
        umi,
        mint,
        driver,
        sponsor.publicKey
      );

      const transFunc = transferTokens(umi, {
        source: driverTokenAccount,
        destination: sponsorTokenAccount,
        amount: sponsorAmount,
        authority: driver,
      });

      const transFuncTx = await sendConfirmBuilder(
        umi,
        driver,
        transFunc,
        "Transferring Token Sponsor",
        "finalized"
      );

      const sdkFunc = sponsorTournament(umi, {
        sponsor,
        sponsorAmount,
        tournament,
        sponsorTokenAccount,
        mint,
      });

      const sdkFuncTx = await sendConfirmBuilder(
        umi,
        driver,
        sdkFunc,
        "Sponsor Tournament"
      );
      return sdkFuncTx;
    }
    return true;
  });

  it("Publish Tournament", async function () {
    umi.use(keypairIdentity(creator));
    const checkOrCreateDriverTokenAccount = await createTokenAccount(
      umi,
      mint,
      driver,
      creator.publicKey
    );

    const sdkFunc = publishTournament(umi, {
      creator,
      tournament,
      joiningFees,
      roundPrizes,
      mint,
    });

    const sdkFuncTx = await sendConfirmBuilder(
      umi,
      driver,
      sdkFunc,
      "Publish Tournament",
      "finalized"
    );
    return sdkFuncTx;
  });

  it("Join Tournament", async function () {
    const driverTokenAccount = findAssociatedTokenPda(umi, {
      mint,
      owner: driver.publicKey,
    });
    umi.use(keypairIdentity(driver));
    if (joiningFees) {
      const JoinTournamentBuilder: TransactionBuilder[] = [];
      for (let i = 0; i < totalPlayers; i++) {
        const player = players[i];
        const playerTokenAccount = findAssociatedTokenPda(umi, {
          mint,
          owner: player.publicKey,
        });
        let txBuilder = new TransactionBuilder();
        txBuilder = txBuilder.prepend(
          createAssociatedToken(umi, {
            payer: driver,
            owner: player.publicKey,
            mint,
            ata: playerTokenAccount,
          })
        );

        txBuilder = txBuilder.add(
          transferTokens(umi, {
            source: driverTokenAccount,
            destination: playerTokenAccount,
            amount: joiningFees,
            authority: driver,
          })
        );
        txBuilder = txBuilder.add(
          joinTournament(umi, {
            playerInfo: player.publicKey,
            driver: driver,
            tournament,
            mint,
            player: player,
            playerTokenAccount,
          })
        );

        JoinTournamentBuilder.push(txBuilder);
      }
      const JoinTournamentBuilderTx = await sendConfirmBuilderArr(
        umi,
        driver,
        JoinTournamentBuilder
      );
      JoinTournamentBuilderTx.map((t) => {
        console.log(
          `Transaction for Joining Player Success 🎉: https://${solanaUrl}/tx/${base58.encode(
            t.signature
          )}?cluster=${clusterUrl}`
        );
      });
      return JoinTournamentBuilderTx;
    } else {
      const joinPlayersTransactionBuilder: TransactionBuilder[] = [];
      for (let i = 0; i < totalPlayers; i++) {
        joinPlayersTransactionBuilder.push(
          joinTournament(umi, {
            playerInfo: players[i].publicKey,
            driver: driver,
            tournament,
            mint,
          })
        );
      }
      const sdkFuncTx = await sendConfirmBuilderArr(
        umi,
        driver,
        joinPlayersTransactionBuilder
      );
      sdkFuncTx.map((t) => {
        console.log(
          `Transaction for Joining Player without fees Success 🎉: https://${solanaUrl}/tx/${base58.encode(
            t.signature
          )}?cluster=${clusterUrl}`
        );
      });
      return sdkFuncTx;
    }
  });

  it("Pause Tournament", async function () {
    umi.use(keypairIdentity(driver));

    const sdkFunc = pauseTournament(umi, {
      creator: creator,
      driver: driver,
      tournament,
    });

    const sdkFuncTx = await sendConfirmBuilder(
      umi,
      driver,
      sdkFunc,
      "Pause Tournament",
      "finalized"
    );
    return sdkFuncTx;
  });

  it("Refund Joining Fees", async function () {
    umi.use(keypairIdentity(driver));
    if (joiningFees) {
      const refundPlayersJoiningFees: TransactionBuilder[] = [];
      for (let i = 0; i < totalPlayers; i++) {
        refundPlayersJoiningFees.push(
          refundJoiningFees(umi, {
            driver,
            player: players[i].publicKey,
            tournament,
            mint,
          })
        );
      }
      const sdkFuncTx = await sendConfirmBuilderArr(
        umi,
        driver,
        refundPlayersJoiningFees
      );
      sdkFuncTx.map((t) => {
        console.log(
          `Transaction for Refund Joining Fees Success 🎉: https://${solanaUrl}/tx/${base58.encode(
            t.signature
          )}?cluster=${clusterUrl}`
        );
      });
      return sdkFuncTx;
    }
    return true;
  });

  it("Refund Sponsor", async function () {
    if (isSponsored) {
      const sponsorTokenAccount = findAssociatedTokenPda(umi, {
        mint,
        owner: sponsor.publicKey,
      });
      umi.use(keypairIdentity(driver));
      const sdkFunc = refundSponsor(umi, {
        driver: driver,
        sponsor: sponsor.publicKey,
        sponsorTokenAccount,
        tournament,
        mint,
      });

      const sdkFuncTx = await sendConfirmBuilder(
        umi,
        driver,
        sdkFunc,
        "Refund Sponsor",
        "finalized"
      );
      return sdkFuncTx;
    }
    return true;
  });

  it("Refund Creator & Cancel Tournament", async function () {
    const creatorTokenAccount = findAssociatedTokenPda(umi, {
      mint,
      owner: creator.publicKey,
    });
    umi.use(keypairIdentity(driver));
    const sdkFunc = refundCreatorAndCancelTournament(umi, {
      creatorTokenAccount,
      driver,
      tournament,
      mint,
    });
    const sdkFuncTx = await sendConfirmBuilder(
      umi,
      driver,
      sdkFunc,
      "Refund Creator And Close Tournament"
    );
    return sdkFuncTx;
  });
});
