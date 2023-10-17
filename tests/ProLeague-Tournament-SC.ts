import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { Tournament } from "../target/types/tournament";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import base58 from "bs58";

describe("ProLeague-Tournament-SC", () => {
    anchor.setProvider(anchor.AnchorProvider.env());
    const base58FromSecret = "3W67tweAWfSFnv6W9ATPRBskBXcFMY7anVy1uyt2Hi65";
    const base58MintToken = "EyNmZzNfYDB4GGhopqaUHLWCTtZkXKNYfcXN2oBxzkwi";

    const driver = Keypair.fromSecretKey(base58.decode(base58FromSecret));
    const mintToken = Keypair.fromSecretKey(base58.decode(base58MintToken));
    const creator = Keypair.generate();
    const user = Keypair.generate();

    const program = anchor.workspace.Tournament as Program<Tournament>;

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
        const usertx = await program.provider.connection.requestAirdrop(
            user.publicKey,
            100000000
        );

        await program.provider.connection.confirmTransaction(tx);
        await program.provider.connection.confirmTransaction(driverTx);
        await program.provider.connection.confirmTransaction(usertx);
        console.log("airdrop success")
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

        const tx = await program.methods
            .initialize({
              creator: creator.publicKey,
              tournamentId,
              joiningFees: new anchor.BN(2000000),
              totalPlayers: 4,
              totalRounds: 2,
              matchConcluded: false,
              roundPrizes: [
                new anchor.BN(50000),
                new anchor.BN(100000),
            ]})
            .accounts({
                creator: creator.publicKey,
                tournament,
                systemProgram: SystemProgram.programId,
            })
            .signers([creator])
            .rpc();

        console.log("Transaction Signature for Initialization", tx);
    });

    // ... [Other provided test cases] ...

    it("addWinner", async () => {
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

    it("markWinnerWonNextRound", async () => {
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

    it("concludeMatch", async () => {
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

    it("claimPrize", async () => {
        const tournamentIdBuffer = Buffer.alloc(8);
        tournamentIdBuffer.writeBigUint64LE(BigInt(tournamentNumber));

        const [tournament] = PublicKey.findProgramAddressSync(
            [Buffer.from("TOURNAMENT_STATE"), tournamentIdBuffer],
            program.programId
        );

        const tx = await program.methods
            .claimPrize({
                roundIndex: 1,
            })
            .accounts({
                tournament,
                winner: driver.publicKey,
                tournamentTokenAccount: tournament/* Assume this account exists */,
                winnerTokenAccount:driver.publicKey /* Assume this account exists */,
                mint: mintToken,/* Mint address from the constants */,
                associatedTokenProgram: /* Associated Token Program Address */,
                tokenProgram: /* Token Program Address */,
                systemProgram: SystemProgram.programId,
            })
            .signers([driver])
            .rpc();

        console.log("Transaction Signature for claiming prize", tx);
    });
});
