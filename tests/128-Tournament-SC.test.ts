import base58 from "bs58";
import dotenv from "dotenv";
import {
  sol,
  keypairIdentity,
  createSignerFromKeypair,
  publicKey,
  createNoopSigner,
} from "@metaplex-foundation/umi";
import { web3JsRpc } from "@metaplex-foundation/umi-rpc-web3js";
import { createUmi as BaseCreateUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { tournamentProgram } from "./plugin.test";
import {
  addWinner,
  sendPrize,
  concludeTournament,
  fetchTournament,
  findTournamentPda,
  initialize,
  joinTournament,
  markWinnerWonNextRound,
  safeFetchTournament,
  publishTournament,
  sponsorTournament,
  pauseTournament,
  refundJoiningFees,
  refundSponsor,
  refundCreatorAndCloseTournament,
} from "../js";
import { writeFile } from "fs";
import {
  publicKey as publicKeySerializer,
  string,
} from "@metaplex-foundation/umi/serializers";
import {
  findAssociatedTokenPda,
  transferTokens,
  createAssociatedToken,
} from "@metaplex-foundation/mpl-toolbox";
import { randomStringGenerator } from "./helpers/randomString";
import { clusterUrl, solanaRpc, solanaUrl } from "./helpers/test_contant";
dotenv.config();

// Tournament Test
describe("ProLeague-Tournament-SC", async function () {
  // Connection with the network
  // console.log({ solanaRpc });
  const umi = BaseCreateUmi(solanaRpc)
    .use(tournamentProgram())
    .use(web3JsRpc(solanaRpc));
  const tournamentId = randomStringGenerator.getRandomString(); // "65ccb08ecc6beb1f5441c1c8"; "OZyRgKs1BI"; "Vc8EHbXgVA";
  const tournament = findTournamentPda(umi, {
    tournamentId,
  });

  // Constant
  const tokenMint = publicKey(process.env.TOKEN_MINT || "");

  // Accounts
  // Creator
  const creator = umi.eddsa.createKeypairFromSecretKey(
    new Uint8Array(base58.decode(process.env.CREATOR_ACCOUNT || ""))
  );
  console.log({ creator: creator.publicKey });
  const creatorSigner = createSignerFromKeypair(umi, creator);
  // Sponsor Account
  const sponsor = umi.eddsa.createKeypairFromSecretKey(
    new Uint8Array(
      [
        237, 231, 241, 255, 155, 17, 215, 233, 127, 197, 64, 176, 127, 76, 70,
        233, 113, 5, 12, 19, 175, 210, 163, 59, 91, 132, 40, 156, 76, 91, 220,
        59, 51, 221, 164, 201, 70, 126, 182, 135, 65, 108, 182, 86, 87, 245,
        191, 28, 232, 158, 8, 199, 215, 12, 113, 216, 153, 193, 13, 40, 208, 32,
        25, 187,
      ] // player
      // [
      //   128, 114, 56, 7, 150, 144, 243, 27, 162, 62, 246, 85, 247, 88, 234, 123,
      //   76, 14, 211, 9, 245, 75, 98, 75, 189, 145, 109, 74, 81, 250, 28, 247,
      //   119, 185, 107, 77, 79, 75, 36, 79, 200, 241, 218, 137, 100, 235, 198,
      //   75, 139, 51, 192, 23, 197, 117, 187, 136, 27, 45, 43, 8, 34, 241, 130,
      //   246,
      // ] // winner
    )
  );
  const sponsorSigner = createSignerFromKeypair(umi, sponsor);

  // Driver
  const driver = umi.eddsa.createKeypairFromSecretKey(
    new Uint8Array(base58.decode(process.env.DRIVER_ACCOUNT || ""))
  );
  const driverSigner = createSignerFromKeypair(umi, driver);

  // Player
  const player = umi.eddsa.generateKeypair();
  // const playerSigner = createSignerFromKeypair(umi, player);
  // console.dir(player, { depth: null });
  // const player = umi.eddsa.createKeypairFromSecretKey(
  //   new Uint8Array(
  //     // [
  //     //   237, 231, 241, 255, 155, 17, 215, 233, 127, 197, 64, 176, 127, 76, 70,
  //     //   233, 113, 5, 12, 19, 175, 210, 163, 59, 91, 132, 40, 156, 76, 91, 220,
  //     //   59, 51, 221, 164, 201, 70, 126, 182, 135, 65, 108, 182, 86, 87, 245,
  //     //   191, 28, 232, 158, 8, 199, 215, 12, 113, 216, 153, 193, 13, 40, 208, 32,
  //     //   25, 187,
  //     // ] // player
  //     // [
  //     //   128, 114, 56, 7, 150, 144, 243, 27, 162, 62, 246, 85, 247, 88, 234, 123,
  //     //   76, 14, 211, 9, 245, 75, 98, 75, 189, 145, 109, 74, 81, 250, 28, 247,
  //     //   119, 185, 107, 77, 79, 75, 36, 79, 200, 241, 218, 137, 100, 235, 198,
  //     //   75, 139, 51, 192, 23, 197, 117, 187, 136, 27, 45, 43, 8, 34, 241, 130,
  //     //   246,
  //     // ] // winner
  //     [
  //       203, 37, 240, 101, 141, 161, 78, 237, 148, 240, 216, 73, 68, 153, 186,
  //       112, 188, 86, 157, 158, 191, 126, 159, 101, 24, 189, 44, 35, 45, 34,
  //       204, 54, 155, 157, 15, 131, 195, 122, 248, 212, 132, 170, 142, 220, 91,
  //       141, 13, 0, 177, 203, 187, 108, 1, 182, 43, 66, 243, 76, 239, 53, 205,
  //       140, 68, 25,
  //     ] // new player
  //   )
  // );
  const playerSigner = createSignerFromKeypair(umi, player);
  console.log({ player: player.publicKey });
  // Winner
  // const winner = umi.eddsa.generateKeypair();
  // writeFile(
  //   "./winnerAccount.txt",
  //   JSON.stringify(winner),
  //   "utf-8",
  //   function (err) {
  //     if (err) {
  //       return console.log("An error occured while writing to the file:", err);
  //     }
  //     console.log("Winner Data written to the file successfully.");
  //   }
  // );
  const winner = umi.eddsa.createKeypairFromSecretKey(
    new Uint8Array(
      // [
      //   237, 231, 241, 255, 155, 17, 215, 233, 127, 197, 64, 176, 127, 76, 70,
      //   233, 113, 5, 12, 19, 175, 210, 163, 59, 91, 132, 40, 156, 76, 91, 220,
      //   59, 51, 221, 164, 201, 70, 126, 182, 135, 65, 108, 182, 86, 87, 245,
      //   191, 28, 232, 158, 8, 199, 215, 12, 113, 216, 153, 193, 13, 40, 208, 32,
      //   25, 187,
      // ] // player
      [
        128, 114, 56, 7, 150, 144, 243, 27, 162, 62, 246, 85, 247, 88, 234, 123,
        76, 14, 211, 9, 245, 75, 98, 75, 189, 145, 109, 74, 81, 250, 28, 247,
        119, 185, 107, 77, 79, 75, 36, 79, 200, 241, 218, 137, 100, 235, 198,
        75, 139, 51, 192, 23, 197, 117, 187, 136, 27, 45, 43, 8, 34, 241, 130,
        246,
      ] // winner
    )
  );
  const winnerSigner = createSignerFromKeypair(umi, winner);
  // console.log("umi=>",umi,"tokenMint=>",tokenMint,"programId=>",programId,"driver=>",driver,"creator=>",creator);

  // Fetch tournament // Pass
  it.skip("Fetch Tournament", async function () {
    const tournamentObj = await safeFetchTournament(umi, tournament);

    console.dir(tournamentObj, { depth: null });
    console.log("Fetch Tournament");
  });

  // Get Balance
  it.skip("GetBalance", async function () {
    const creatorBalance = await umi.rpc.getBalance(creator.publicKey);
    const driverBalance = await umi.rpc.getBalance(driver.publicKey);

    console.log({ driverBalance }, { creatorBalance });
    console.log("Get Balance success");
  });

  // Airdrop for sol
  it.skip("Airdrop", async function () {
    const amount = sol(1.5);
    const creatorTx = await umi.rpc.airdrop(creator.publicKey, amount);
    const driverTx = await umi.rpc.airdrop(driver.publicKey, amount);

    console.log({ creatorTx }, { driverTx });
    console.log("airdrop success");
  });

  // Initialize Tournament  // Pass
  it("Initialize Tournament", async function () {
    umi.use(keypairIdentity(driverSigner));

    const tx = await initialize(umi, {
      driver: driverSigner,
      creator: creatorSigner.publicKey,
      tournamentId,
      joiningFees: 0, // 8 * 10 ** 9,
      totalPlayers: 128,
      winningRounds: [20 * 10 ** 9, 10 * 10 ** 9, 5 * 10 ** 9].length,
    })
      .setFeePayer(driverSigner)
      .sendAndConfirm(umi, {
        send: {
          preflightCommitment: "processed",
        },
        confirm: {
          commitment: "processed",
        },
      });
    console.log(
      "\x1b[32m", //Green Text
      `Transaction Signature for Initialization Success!🎉`,
      `\n    https://${solanaUrl}/tx/${base58.encode(
        tx.signature
      )}?cluster=${clusterUrl}`
    );
  });

  // Publish Tournament // Pass
  it.skip("Publish Tournament", async function () {
    umi.use(keypairIdentity(creatorSigner));

    const tx = await publishTournament(umi, {
      creator: creatorSigner,
      tournament,
      joiningFees: 0,
      roundPrizes: [20 * 10 ** 9, 10 * 10 ** 9, 5 * 10 ** 9],
    })
      .setFeePayer(driverSigner)
      .sendAndConfirm(umi, {
        send: {
          preflightCommitment: "processed",
        },
        confirm: {
          commitment: "processed",
        },
      });
    console.log(
      "\x1b[32m", //Green Text
      `Transaction Signature for Publish Tournament Success!🎉`,
      `\n    https://${solanaUrl}/tx/${base58.encode(
        tx.signature
      )}?cluster=${clusterUrl}`
    );
  });

  // Sponsor Tournament // Pass
  it.skip("Sponsor Tournament", async function () {
    umi.use(keypairIdentity(sponsorSigner));
    const driverTokenAccount = findAssociatedTokenPda(umi, {
      mint: tokenMint,
      owner: driver.publicKey,
    });
    const sponsorTokenAccount = findAssociatedTokenPda(umi, {
      mint: tokenMint,
      owner: sponsor.publicKey,
    });
    const transferTokenToPlayer = await transferTokens(umi, {
      source: driverTokenAccount,
      destination: sponsorTokenAccount,
      amount: 5 * 10 ** 9,
      authority: driverSigner,
      // authority: driverSigner,
      // mint: tokenMint,
      // owner: player.publicKey,
    })
      .setFeePayer(driverSigner)
      .sendAndConfirm(umi, {
        send: {
          preflightCommitment: "processed",
        },
        confirm: {
          commitment: "processed",
        },
      });

    console.log(
      "\x1b[32m", //Green Text
      `Transaction Signature for Transfering Token Success!🎉`,
      `\n    https://${solanaUrl}/tx/${base58.encode(
        transferTokenToPlayer.signature
      )}?cluster=${clusterUrl}`
    );

    // const sponsorTokenAccount = findAssociatedTokenPda(umi, {
    //   mint: tokenMint,
    //   owner: sponsor.publicKey,
    // });
    // console.log({ sponsorTokenAccount });

    const tx = await sponsorTournament(umi, {
      sponsor: sponsorSigner,
      sponsorAmount: 5 * 10 ** 9,
      tournament,
      sponsorTokenAccount,
    })
      .setFeePayer(driverSigner)
      .sendAndConfirm(umi, {
        send: {
          preflightCommitment: "processed",
        },
        confirm: {
          commitment: "processed",
        },
      });
    console.log(
      "\x1b[32m", //Green Text
      `Transaction Signature for Sponsor Tournament Success!🎉`,
      `\n    https://${solanaUrl}/tx/${base58.encode(
        tx.signature
      )}?cluster=${clusterUrl}`
    );
  });

  // Join Tournament // Pass
  it.skip("Join Tournament", async function () {
    // const player = umi.eddsa.generateKeypair();
    const players = [
      // "7aaTnhtwGg9APJQweriaiqkV5BSFDLJ6PLgrbLxzkpyX",
      // "HvTin23sNwCEi6PDs8BMmPNaCLFmMdFPVrttJrVFSuMj",
      // "BHANE8mP84NLaXqewZAB8rPCywKc8sBKDQ952iD1rfzB",
      "8zA55jrHrHyQUfro1WfwhyxXqDPQBRuX42xaBK8DagUq",
    ];
    const ids = [
      "65cc8fdd180fb14b43044c18",
      "65b8eaac8b07e4d540244110",
      "6543891b00b6aa2d2a2804b8",
      "6567400bcbb7c08c59aa2277",
    ];
    for (let i = 0; i < players.length; i++) {
      umi.use(keypairIdentity(driverSigner));
      const player = publicKey(players[i]);
      // const playerSigner = createSignerFromKeypair(umi, player);
      console.log({ player: player });

      // try {
      //   const createAssociatedTokenPlayer = await createAssociatedToken(umi, {
      //     mint: tokenMint,
      //     owner: player,
      //     payer: driverSigner,
      //   })
      //     .setFeePayer(driverSigner)
      //     .sendAndConfirm(umi, {
      //       send: {
      //         preflightCommitment: "processed",
      //       },
      //       confirm: {
      //         commitment: "processed",
      //       },
      //     });
      //   console.log({ createAssociatedTokenPlayer });
      // } catch (error) {
      //   console.log("Already account created =>", error);
      // }
      const playerTokenAccount = findAssociatedTokenPda(umi, {
        mint: tokenMint,
        owner: player,
      });
      console.log({ playerTokenAccount });
      const driverTokenAccount = findAssociatedTokenPda(umi, {
        mint: tokenMint,
        owner: driver.publicKey,
      });
      console.log({ driverTokenAccount });

      // const transferTokenToPlayer = await transferTokens(umi, {
      //   source: driverTokenAccount,
      //   destination: playerTokenAccount,
      //   amount: 6 * 10 ** 9,
      //   authority: driverSigner,
      //   // mint: tokenMint,
      //   // owner: player.publicKey,
      // })
      //   .setFeePayer(driverSigner)
      //   .sendAndConfirm(umi, {
      //     send: {
      //       preflightCommitment: "processed",
      //     },
      //     confirm: {
      //       commitment: "processed",
      //     },
      //   });

      // console.log(
      //   "\x1b[32m", //Green Text
      //   `Transaction Signature for Transfering Token Success!🎉`,
      //   `\n    https://${solanaUrl}/tx/${base58.encode(
      //     transferTokenToPlayer.signature
      //   )}?cluster=${clusterUrl}`
      // );
      // setTimeout(async () => {
      const tx = await joinTournament(umi, {
        // player: playerSigner,
        playerInfo: player,
        driver: driverSigner,
        // playerTokenAccount,
        tournament,
      })
        .setFeePayer(driverSigner)
        .sendAndConfirm(umi, {
          send: {
            preflightCommitment: "processed",
          },
          confirm: {
            commitment: "processed",
          },
        });
      // console.log("Transaction Signature for Initialization", tx);
      console.log(
        "\x1b[32m", //Green Text
        `Transaction Signature for Join Tournament Success!🎉`,
        `\n    https://${solanaUrl}/tx/${base58.encode(
          tx.signature
        )}?cluster=${clusterUrl}`
      );
      // }, 2000);
    }
  });

  // Add Winner in the round // Pass
  it.skip("addWinner", async () => {
    const players = [
      "EkcxLSN9Udad5K5khcXrLAHdZgsALqP2r4RGjXKb6LzK",
      "GTfvruXVPkLAVh4Re8JUEZ481wjMk6LBcmmfLMDY1JWp",
      "3iqxzKcZdTijd5Vq2WANcXCMLprDxjNMuiFMcLov7aVP",
      "5ruDcUTr197mZZJSrEsk9a7sqmQ6iEYKGPuTsptoHw5G",
    ];
    for (let i = 0; i < players.length; i++) {
      umi.use(keypairIdentity(driverSigner));
      const tx = await addWinner(umi, {
        tournament,
        driver: driverSigner,
        winner: publicKey(players[i]),
        roundIndex: 0,
      })
        .setFeePayer(driverSigner)
        .sendAndConfirm(umi, {
          send: {
            preflightCommitment: "processed",
          },
          confirm: {
            commitment: "processed",
          },
        });
      // console.log("Transaction Signature for adding Winner", tx);
      console.log(
        "\x1b[32m", //Green Text
        `Transaction Signature for adding Winner Success!🎉`,
        `\n    https://${solanaUrl}/tx/${base58.encode(
          tx.signature
        )}?cluster=${clusterUrl}`
      );
    }
  });

  // Marking winner for next round // Pass
  it.skip("markWinnerWonNextRound", async () => {
    const players = [
      "EkcxLSN9Udad5K5khcXrLAHdZgsALqP2r4RGjXKb6LzK",
      // "GTfvruXVPkLAVh4Re8JUEZ481wjMk6LBcmmfLMDY1JWp",
      // "3iqxzKcZdTijd5Vq2WANcXCMLprDxjNMuiFMcLov7aVP",
      // "5ruDcUTr197mZZJSrEsk9a7sqmQ6iEYKGPuTsptoHw5G",
    ];
    for (let i = 0; i < players.length; i++) {
      umi.use(keypairIdentity(driverSigner));

      const tx = await markWinnerWonNextRound(umi, {
        tournament,
        driver: driverSigner,
        winner: publicKey(players[i]),
        roundIndex: 1,
      })
        .setFeePayer(driverSigner)
        .sendAndConfirm(umi, {
          send: {
            preflightCommitment: "processed",
          },
          confirm: {
            commitment: "processed",
          },
        });
      // console.log(
      //   "Transaction Signature for marking winner for next round",
      //   tx
      // );
      console.log(
        "\x1b[32m", //Green Text
        `Transaction Signature for marking winner for next round Success!🎉`,
        `\n    https://${solanaUrl}/tx/${base58.encode(
          tx.signature
        )}?cluster=${clusterUrl}`
      );
    }
  });

  // Close Tournament // Pass
  it.skip("concludeTournament", async () => {
    const creatorTokenAccount = findAssociatedTokenPda(umi, {
      mint: tokenMint,
      owner: creatorSigner.publicKey,
    });
    umi.use(keypairIdentity(driverSigner));
    const tx = await concludeTournament(umi, {
      tournament,
      creatorTokenAccount,
      driver: driverSigner,
    })
      .setFeePayer(driverSigner)
      .sendAndConfirm(umi, {
        send: {
          // skipPreflight:true,
          preflightCommitment: "processed",
        },
        confirm: {
          commitment: "processed",
        },
      });
    // console.log("Transaction Signature for concluding match", tx);
    console.log(
      "\x1b[32m", //Green Text
      `Transaction Signature for concluding match Success!🎉`,
      `\n    https://${solanaUrl}/tx/${base58.encode(
        tx.signature
      )}?cluster=${clusterUrl}`
    );
  });

  // Claim Price // Pass
  it.skip("sendPrize", async () => {
    const players = [
      "EkcxLSN9Udad5K5khcXrLAHdZgsALqP2r4RGjXKb6LzK",
      // "GTfvruXVPkLAVh4Re8JUEZ481wjMk6LBcmmfLMDY1JWp",
      // "3iqxzKcZdTijd5Vq2WANcXCMLprDxjNMuiFMcLov7aVP",
      // "5ruDcUTr197mZZJSrEsk9a7sqmQ6iEYKGPuTsptoHw5G",
    ];
    for (let i = 0; i < players.length; i++) {
      umi.use(keypairIdentity(driverSigner));
      const tx = await sendPrize(umi, {
        roundIndex: 0,
        tournament,
        winner: publicKey(players[i]),
        driver: driverSigner,
      })
        .setFeePayer(driverSigner)
        .sendAndConfirm(umi, {
          send: {
            preflightCommitment: "processed",
          },
          confirm: {
            commitment: "processed",
          },
        });
      // console.log("Transaction Signature for claiming prize", tx);
      console.log(
        "\x1b[32m", //Green Text
        `Transaction Signature for claiming prize Success!🎉`,
        `\n    https://${solanaUrl}/tx/${base58.encode(
          tx.signature
        )}?cluster=${clusterUrl}`
      );
    }
  });

  // Pause Tournament // Pass
  it.skip("pauseTournament", async () => {
    umi.use(keypairIdentity(driverSigner));
    const tx = await pauseTournament(umi, {
      creator: creatorSigner,
      driver: driverSigner,
      tournament,
    })
      .setFeePayer(driverSigner)
      .sendAndConfirm(umi, {
        send: {
          preflightCommitment: "processed",
        },
        confirm: {
          commitment: "processed",
        },
      });
    console.log(
      "\x1b[32m", //Green Text
      `Transaction Signature for pause tournament Success!🎉`,
      `\n    https://${solanaUrl}/tx/${base58.encode(
        tx.signature
      )}?cluster=${clusterUrl}`
    );
  });

  // Refund Joining Fess
  it.skip("refundJoiningFees", async () => {
    umi.use(keypairIdentity(driverSigner));
    const tx = await refundJoiningFees(umi, {
      driver: driverSigner,
      player: player.publicKey,
      tournament,
    })
      .setFeePayer(driverSigner)
      .sendAndConfirm(umi, {
        send: {
          preflightCommitment: "processed",
        },
        confirm: {
          commitment: "processed",
        },
      });
    console.log(
      "\x1b[32m", //Green Text
      `Transaction Signature for Refund Joining Fees Success!🎉`,
      `\n    https://${solanaUrl}/tx/${base58.encode(
        tx.signature
      )}?cluster=${clusterUrl}`
    );
  });

  // Refund Sponsor
  it.skip("refundSponsor", async () => {
    const sponsorTokenAccount = findAssociatedTokenPda(umi, {
      mint: tokenMint,
      owner: sponsor.publicKey,
    });
    console.log({ sponsorTokenAccount });

    umi.use(keypairIdentity(driverSigner));
    const tx = await refundSponsor(umi, {
      driver: driverSigner,
      sponsor: sponsor.publicKey,
      sponsorTokenAccount,
      tournament,
    })
      .setFeePayer(driverSigner)
      .sendAndConfirm(umi, {
        send: {
          preflightCommitment: "processed",
        },
        confirm: {
          commitment: "processed",
        },
      });
    console.log(
      "\x1b[32m", //Green Text
      `Transaction Signature for Refund Sponsor Success!🎉`,
      `\n    https://${solanaUrl}/tx/${base58.encode(
        tx.signature
      )}?cluster=${clusterUrl}`
    );
  });

  // Refund Creator & Close Tournament
  it.skip("refundCreatorAndCloseTournament", async () => {
    const creatorTokenAccount = findAssociatedTokenPda(umi, {
      mint: tokenMint,
      owner: creator.publicKey,
    });
    console.log({ creatorTokenAccount });

    umi.use(keypairIdentity(driverSigner));
    const tx = await refundCreatorAndCloseTournament(umi, {
      creatorTokenAccount,
      driver: driverSigner,
      tournament,
    })
      .setFeePayer(driverSigner)
      .sendAndConfirm(umi, {
        send: {
          preflightCommitment: "processed",
        },
        confirm: {
          commitment: "processed",
        },
      });
    console.log(
      "\x1b[32m", //Green Text
      `Transaction Signature for Refund Creator And Close Tournament Success!🎉`,
      `\n    https://${solanaUrl}/tx/${base58.encode(
        tx.signature
      )}?cluster=${clusterUrl}`
    );
  });
});

// winners
// '2RCSUMgmmNLHDh9DrfDSk9CKrbC1jQJgpG27rFf6gdG1'
// 'HSRJepPdabi1E6mpJArThwNeC18LfgBGgpdEmy3UeywW'
