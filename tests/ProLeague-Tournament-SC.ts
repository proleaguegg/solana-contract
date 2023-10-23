import * as anchor from "@project-serum/anchor";
// import driverKeyPair from "../keyPairDriver.json";
import { Tournament, IDL } from "../target/types/tournament";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram, Connection } from "@solana/web3.js";
import base58 from "bs58";
import { describe, it } from "mocha";

describe("ProLeague-Tournament-SC", () => {
  const connection = new Connection(
    "https://devnet.helius-rpc.com/?api-key=7050a011-776f-432b-8b0e-a4e490ec6c9f"
  );
  const programId = "FLx2dcA4c4ZYhamknXRTgWYPg8NCr4Bt8Ut8oiUKcG5T";

  const base58FromSecret =
    "4Htb9vQjavu5PkRAKVfAqesADuVFAUBLYiLpfhWgBiorrDxjtFo1ytskPdxNDmXbB4wzf6ueumkJLxMtsMXgy286Q2xqPtodqye9SZEw5XS9gd5qnaNSRPMkETLKBHJtx6dtaSoPSPfBaWB34ZCjRyyd7tbjKHovd9dFRKgPNb1zPRK3Gj89GqHpkzYBWXnNkJSdmH3AKDwTpP3oxMgaeErcqUuh37GjBLWTB7k5NmUuzsdR7vEjrDNquQuMhi6ujCkAXHhW9ibc2udt6JFwhAEVpqKEMWtM3R8njfWxM7J2Ttp84gK4jAQ8GPj7mbrJYSm5EudSu5TejVj476V21nkxqLev7d8NQN6oEEoS66sQ46YnHCNMmViAmDJQjzd7RWRnKxEfbfPaJRr9u4cjX4zZACqRitjTRvVNULPwbt6M2Uda";
  const mintToken = new PublicKey(
    "EyNmZzNfYDB4GGhopqaUHLWCTtZkXKNYfcXN2oBxzkwi"
  );

  const driver = Keypair.fromSecretKey(
    new Uint8Array([
      78, 78, 141, 11, 167, 244, 85, 212, 213, 103, 139, 78, 171, 108, 197, 239,
      218, 106, 127, 30, 56, 34, 62, 21, 155, 160, 114, 9, 133, 14, 200, 252,
      37, 43, 1, 88, 216, 235, 8, 96, 79, 229, 37, 2, 25, 7, 252, 145, 175, 155,
      136, 157, 135, 213, 188, 211, 81, 251, 74, 161, 27, 2, 82, 90,
    ])
  );

  // const mintToken = Keypair.fromSecretKey(base58.decode(base58MintToken));
  const creator = Keypair.generate();
  //   const user = Keypair.generate();
  const driverWallet = new anchor.Wallet(
    Keypair.fromSecretKey(
      new Uint8Array([
        78, 78, 141, 11, 167, 244, 85, 212, 213, 103, 139, 78, 171, 108, 197,
        239, 218, 106, 127, 30, 56, 34, 62, 21, 155, 160, 114, 9, 133, 14, 200,
        252, 37, 43, 1, 88, 216, 235, 8, 96, 79, 229, 37, 2, 25, 7, 252, 145,
        175, 155, 136, 157, 135, 213, 188, 211, 81, 251, 74, 161, 27, 2, 82, 90,
      ])
    )
  );

  const provider = new anchor.AnchorProvider(connection, driverWallet, {
    commitment: "processed",
  });

  const program = new anchor.Program<any>(
    IDL,
    new PublicKey(programId),
    provider
  );

  const tournamentNumber = 5;

  it("Airdrop", async () => {
    const tx = await program.provider.connection.requestAirdrop(
      creator.publicKey,
      100000000
    );
    const driverTx = await program.provider.connection.requestAirdrop(
      creator.publicKey,
      100000000
    );
    // const usertx = await program.provider.connection.requestAirdrop(
    //   user.publicKey,
    //   100000000
    // );
 
    await program.provider.connection.confirmTransaction(tx);
    await program.provider.connection.confirmTransaction(driverTx);
    // await program.provider.connection.confirmTransaction(usertx);
    console.log("airdrop success");
  });

  it("Is initialized!", async () => {
    if (!program.provider.publicKey) return;

    const tournamentId = new anchor.BN(tournamentNumber);
    const tournamentIdBuffer = Buffer.alloc(8);
    tournamentIdBuffer.writeBigUint64LE(BigInt(tournamentNumber));

    const [tournament] = PublicKey.findProgramAddressSync(
      [Buffer.from("TOURNAMENT_STATE"), tournamentIdBuffer],
      program.programId
    );

    const tournamentTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      creator,
      mintToken,
      tournament
    );
    const creatorTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      creator,
      mintToken,
      creator.publicKey
    );

    const tx = await program.methods
      .initialize({
        creator: creator.publicKey,
        tournamentId,
        joiningFees: new anchor.BN(2000000),
        totalPlayers: 4,
        totalRounds: 2,
        matchConcluded: false,
        roundPrizes: [new anchor.BN(50000), new anchor.BN(100000)],
      })
      .accounts({
        creator: creator.publicKey,
        tournament,
        tournamentTokenAccount: tournamentTokenAccount.address,
        creatorTokenAccount: creatorTokenAccount.address,
        mint: mintToken,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    console.log("Transaction Signature for Initialization", tx);
  });

  // ... [Other provided test cases] ...

  it.skip("addWinner", async () => {
    const tournamentIdBuffer = Buffer.alloc(8);
    tournamentIdBuffer.writeBigUint64LE(BigInt(tournamentNumber));

    const [tournament] = PublicKey.findProgramAddressSync(
      [Buffer.from("TOURNAMENT_STATE"), tournamentIdBuffer],
      program.programId
    );

    const tx = await program.methods
      .addWinner({
        winner: driver.publicKey,
        roundIndex: 1,
      })
      .accounts({
        tournament,
        driver: driver.publicKey,
      })
      .signers([driver])
      .rpc();

    console.log("Transaction Signature for adding Winner", tx);
  });

  it.skip("markWinnerWonNextRound", async () => {
    const tournamentIdBuffer = Buffer.alloc(8);
    tournamentIdBuffer.writeBigUint64LE(BigInt(tournamentNumber));

    const [tournament] = PublicKey.findProgramAddressSync(
      [Buffer.from("TOURNAMENT_STATE"), tournamentIdBuffer],
      program.programId
    );

    const tx = await program.methods
      .markWinnerWonNextRound({
        winner: driver.publicKey,
        roundIndex: 1,
      })
      .accounts({
        tournament,
        driver: driver.publicKey,
      })
      .signers([driver])
      .rpc();

    console.log("Transaction Signature for marking winner for next round", tx);
  });

  it.skip("concludeMatch", async () => {
    const tournamentIdBuffer = Buffer.alloc(8);
    tournamentIdBuffer.writeBigUint64LE(BigInt(tournamentNumber));

    const [tournament] = PublicKey.findProgramAddressSync(
      [Buffer.from("TOURNAMENT_STATE"), tournamentIdBuffer],
      program.programId
    );

    const tx = await program.methods
      .concludeMatch()
      .accounts({
        tournament,
        creator: creator.publicKey,
      })
      .signers([creator])
      .rpc();

    console.log("Transaction Signature for concluding match", tx);
  });

  it.skip("claimPrize", async () => {
    const tournamentIdBuffer = Buffer.alloc(8);
    tournamentIdBuffer.writeBigUint64LE(BigInt(tournamentNumber));

    const [tournament] = PublicKey.findProgramAddressSync(
      [Buffer.from("TOURNAMENT_STATE"), tournamentIdBuffer],
      program.programId
    );

    const tournamentTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      creator,
      mintToken,
      tournament
    );

    const tx = await program.methods
      .claimPrize({
        roundIndex: 1,
      })
      .accounts({
        tournament,
        winner: driver.publicKey,
        tournamentTokenAccount: tournamentTokenAccount.address,
        mint: mintToken,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([driver])
      .rpc();

    console.log("Transaction Signature for claiming prize", tx);
  });
});
