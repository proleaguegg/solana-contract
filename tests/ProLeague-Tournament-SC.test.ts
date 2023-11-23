import base58 from "bs58";
import dotenv from "dotenv";
import {
  sol,
  keypairIdentity,
  createSignerFromKeypair,
  publicKey,
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
dotenv.config();

// Tournament Test
describe("ProLeague-Tournament-SC", async function () {
  const deventRpc =
    "https://devnet.helius-rpc.com/?api-key=7050a011-776f-432b-8b0e-a4e490ec6c9f";
  // Connection with the network
  const umi = BaseCreateUmi(deventRpc)
    .use(tournamentProgram())
    .use(web3JsRpc(deventRpc));
  const tournamentId = 851; // Math.ceil(Math.random() * 100) + 1; // 33;
  const tournament = findTournamentPda(umi, {
    tournamentId: tournamentId,
  });

  // Constant
  const mintToken = publicKey(process.env.TOKEN_MINT || "");

  // Accounts
  // Creator
  const creator = umi.eddsa.createKeypairFromSecretKey(
    new Uint8Array(base58.decode(process.env.CREATOR_ACCOUNT || ""))
  );
  const creatorSigner = createSignerFromKeypair(umi, creator);

  // Driver
  const driver = umi.eddsa.createKeypairFromSecretKey(
    new Uint8Array(base58.decode(process.env.DRIVER_ACCOUNT || ""))
  );
  const driverSigner = createSignerFromKeypair(umi, driver);

  // Player
  // const player = umi.eddsa.generateKeypair();
  // const playerSigner = createSignerFromKeypair(umi, player);
  // console.dir(player, { depth: null });
  const player = umi.eddsa.createKeypairFromSecretKey(
    new Uint8Array(
      // [
      //   237, 231, 241, 255, 155, 17, 215, 233, 127, 197, 64, 176, 127, 76, 70,
      //   233, 113, 5, 12, 19, 175, 210, 163, 59, 91, 132, 40, 156, 76, 91, 220,
      //   59, 51, 221, 164, 201, 70, 126, 182, 135, 65, 108, 182, 86, 87, 245,
      //   191, 28, 232, 158, 8, 199, 215, 12, 113, 216, 153, 193, 13, 40, 208, 32,
      //   25, 187,
      // ] // player
      // [
      //   128, 114, 56, 7, 150, 144, 243, 27, 162, 62, 246, 85, 247, 88, 234, 123,
      //   76, 14, 211, 9, 245, 75, 98, 75, 189, 145, 109, 74, 81, 250, 28, 247,
      //   119, 185, 107, 77, 79, 75, 36, 79, 200, 241, 218, 137, 100, 235, 198,
      //   75, 139, 51, 192, 23, 197, 117, 187, 136, 27, 45, 43, 8, 34, 241, 130,
      //   246,
      // ] // winner
      [
        203, 37, 240, 101, 141, 161, 78, 237, 148, 240, 216, 73, 68, 153, 186,
        112, 188, 86, 157, 158, 191, 126, 159, 101, 24, 189, 44, 35, 45, 34,
        204, 54, 155, 157, 15, 131, 195, 122, 248, 212, 132, 170, 142, 220, 91,
        141, 13, 0, 177, 203, 187, 108, 1, 182, 43, 66, 243, 76, 239, 53, 205,
        140, 68, 25,
      ] // new player
    )
  );
  const playerSigner = createSignerFromKeypair(umi, player);
  // console.log(player);
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
  // console.log("umi=>",umi,"mintToken=>",mintToken,"programId=>",programId,"driver=>",driver,"creator=>",creator);

  // Fetch tournament // Pass
  it("Fetch Tournament", async function () {
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
  it.skip("Initialize Tournament", async function () {
    umi.use(keypairIdentity(creatorSigner));

    const tx = await initialize(umi, {
      creator: creatorSigner,
      tournamentId,
      joiningFees: 8 * 10 ** 9,
      totalPlayers: 8,
      tournamentConcluded: false,
      roundPrizes: [60 * 10 ** 9, 10 * 10 ** 9, 5 * 10 ** 9],
    }).sendAndConfirm(umi, {
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
      `\n    https://solscan.io/tx/${base58.encode(
        tx.signature
      )}?cluster=devnet`
    );
  });

  // Join Tournament // Pass
  it.skip("Join Tournament", async function () {
    umi.use(keypairIdentity(driverSigner));

    try {
      const createAssociatedTokenPlayer = await createAssociatedToken(umi, {
        mint: mintToken,
        owner: player.publicKey,
        payer: driverSigner,
      }).sendAndConfirm(umi, {
        send: {
          preflightCommitment: "processed",
        },
        confirm: {
          commitment: "processed",
        },
      });
      console.log({ createAssociatedTokenPlayer });
    } catch (error) {
      console.log("Already account created =>", error);
    }
    const playerTokenAccount = findAssociatedTokenPda(umi, {
      mint: mintToken,
      owner: player.publicKey,
    });
    console.log({ playerTokenAccount });
    const driverTokenAccount = findAssociatedTokenPda(umi, {
      mint: mintToken,
      owner: driver.publicKey,
    });
    console.log({ driverTokenAccount });

    const transferTokenToPlayer = await transferTokens(umi, {
      source: driverTokenAccount,
      destination: playerTokenAccount,
      amount: 12 * 10 ** 9,
      // authority: driverSigner,
      // mint: mintToken,
      // owner: player.publicKey,
    }).sendAndConfirm(umi, {
      send: {
        preflightCommitment: "processed",
      },
      confirm: {
        commitment: "processed",
      },
    });
    console.dir(transferTokenToPlayer, { depth: null });

    const tx = await joinTournament(umi, {
      player: player.publicKey,
      driver: driverSigner,
      playerTokenAccount,
      tournament,
    }).sendAndConfirm(umi, {
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
      `Transaction Signature for Initialization Success!🎉`,
      `\n    https://solscan.io/tx/${base58.encode(
        tx.signature
      )}?cluster=devnet`
    );
  });

  // Add Winner in the round // Pass
  it.skip("addWinner", async () => {
    umi.use(keypairIdentity(driverSigner));
    const tx = await addWinner(umi, {
      tournament,
      driver: driverSigner,
      winner: player.publicKey,
      roundIndex: 1,
    }).sendAndConfirm(umi, {
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
      `\n    https://solscan.io/tx/${base58.encode(
        tx.signature
      )}?cluster=devnet`
    );
  });

  // Marking winner for next round // Pass
  it.skip("markWinnerWonNextRound", async () => {
    umi.use(keypairIdentity(driverSigner));

    const tx = await markWinnerWonNextRound(umi, {
      tournament,
      driver: driverSigner,
      winner: winner.publicKey,
      roundIndex: 1,
    }).sendAndConfirm(umi, {
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
      `\n    https://solscan.io/tx/${base58.encode(
        tx.signature
      )}?cluster=devnet`
    );
  });

  // Close Tournament // Pass
  it.skip("concludeTournament", async () => {
    umi.use(keypairIdentity(creatorSigner));
    const tx = await concludeTournament(umi, {
      tournament,
      driver: creatorSigner,
    }).sendAndConfirm(umi, {
      send: {
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
      `\n    https://solscan.io/tx/${base58.encode(
        tx.signature
      )}?cluster=devnet`
    );
  });

  // Claim Price // Pass
  it.skip("sendPrize", async () => {
    umi.use(keypairIdentity(driverSigner));
    const tx = await sendPrize(umi, {
      roundIndex: 1,
      tournament,
      winner: winner.publicKey,
      driver: driverSigner,
    }).sendAndConfirm(umi, {
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
      `\n    https://solscan.io/tx/${base58.encode(
        tx.signature
      )}?cluster=devnet`
    );
  });
});

// winners
// '2RCSUMgmmNLHDh9DrfDSk9CKrbC1jQJgpG27rFf6gdG1'
// 'HSRJepPdabi1E6mpJArThwNeC18LfgBGgpdEmy3UeywW'
