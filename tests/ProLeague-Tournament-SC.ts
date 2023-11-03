import base58 from "bs58";
import dotenv from "dotenv";
import {
  publicKey,
  sol,
  createNoopSigner,
  createBigInt,
  keypairIdentity,
  createSignerFromKeypair,
} from "@metaplex-foundation/umi";
import { web3JsRpc } from "@metaplex-foundation/umi-rpc-web3js";
import { createUmi as BaseCreateUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { tournamentProgram } from "./plugin";
import {
  addWinner,
  claimPrize,
  concludeMatch,
  findTournamentPda,
  initialize,
  markWinnerWonNextRound,
} from "../js";

dotenv.config();

// Tournament Test
describe("ProLeague-Tournament-SC", async () => {
  const deventRpc =
    "https://devnet.helius-rpc.com/?api-key=7050a011-776f-432b-8b0e-a4e490ec6c9f";
  // Connection with the network
  const umi = BaseCreateUmi(deventRpc)
    .use(tournamentProgram())
    .use(web3JsRpc(deventRpc));
  const tournamentId = Math.ceil(Math.random() * 100) + 1;
  const tournament = findTournamentPda(umi, {
    tournamentId: tournamentId,
  })
  // Environment variables
  const mintToken = publicKey(process.env.MINT_TOKEN || "");
  const programId = publicKey(process.env.PROGRAM_ID || "");

  // Accounts
  const creator = umi.eddsa.createKeypairFromSecretKey(
    new Uint8Array(base58.decode(process.env.CREATOR_ACCOUNT || ""))
  );
  const creatorSigner = createSignerFromKeypair(umi, creator);

  const driver = umi.eddsa.createKeypairFromSecretKey(
    new Uint8Array(base58.decode(process.env.DRIVER_ACCOUNT || ""))
  );
  const driverSigner = createSignerFromKeypair(umi, driver);
  // console.log("umi=>",umi,"mintToken=>",mintToken,"programId=>",programId,"driver=>",driver,"creator=>",creator);

  // Get the Balance of the existing and new created accounts
  it.skip("GetBalance", async (done) => {
    const creatorBalance = await umi.rpc.getBalance(creator.publicKey);
    const driverBalance = await umi.rpc.getBalance(driver.publicKey);

    console.log({ driverBalance }, { creatorBalance });
    console.log("Get Balance success");
    done();
  });

  // Airdrop for sol
  it.skip("Airdrop", async (done) => {
    const amount = sol(1.5);
    const creatorTx = await umi.rpc.airdrop(creator.publicKey, amount);
    const driverTx = await umi.rpc.airdrop(driver.publicKey, amount);

    console.log({ creatorTx }, { driverTx });
    console.log("airdrop success");
    done();
  });

  // Initialize Tournament
  it("Is initialized!", async (done) => {
    try {
    
      umi.use(keypairIdentity(creatorSigner));


      const tx = await initialize(
        umi,
        {
          creator: creatorSigner,
          tournament
        },
        {
          creator: creator.publicKey,
          tournamentId,
          joiningFees: createBigInt(0),
          totalPlayers: 4,
          totalRounds: 2,
          matchConcluded: false,
          roundPrizes: [createBigInt(50000), createBigInt(100000)],
        }
      ).sendAndConfirm(umi, {
        send: {
          preflightCommitment: "processed",
        },
        confirm: {
          commitment: "processed",
        },
      });
      console.log(
        "Transaction Signature for Initialization",
        JSON.stringify(tx)
      );
      done();
    } catch (error) {
      console.log("Initialize Error", error);
    }
  });

  it.skip("addWinner", async (done) => {
    const tx = addWinner(umi, {
      tournament,
      driver: createNoopSigner(driver.publicKey),
      winner: driver.publicKey,
      roundIndex: 1,
    });
    console.log("Transaction Signature for adding Winner", tx);
    done();
  });

  it.skip("markWinnerWonNextRound", async (done) => {
    const tx = markWinnerWonNextRound(umi, {
      tournament,
      driver: createNoopSigner(driver.publicKey),
      winner: driver.publicKey,
      roundIndex: 1,
    });
    console.log("Transaction Signature for marking winner for next round", tx);
    done();
  });

  it.skip("concludeMatch", async (done) => {
    const tx = concludeMatch(umi, {
      tournament,
      creator: createNoopSigner(creator.publicKey),
    });

    console.log("Transaction Signature for concluding match", tx);
    done();
  });

  it.skip("claimPrize", async (done) => {



    const tx = claimPrize(umi, {
      roundIndex: 1,
      tournament,
      winner: createNoopSigner(driver.publicKey),
    });

    console.log("Transaction Signature for claiming prize", tx);
    done();
  });
});
