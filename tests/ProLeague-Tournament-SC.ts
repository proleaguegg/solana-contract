import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { Tournament } from "../target/types/tournament";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import base58 from "bs58";

let tournamentNumber = 5;

describe("ProLeague-Tournament-SC", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const base58FromSecret =
    "4xTsFhSNLYnV4TRY7KepF9zB6ZVNHAAGu3pmfwzwbgaKowocsDzQKEyyrrhTmNKs9GuToUGmYCLNpFmCEUPeA4Jt";

  const driver = Keypair.fromSecretKey(base58.decode(base58FromSecret));
  const creator = Keypair.generate();
  const user = Keypair.generate();

  const program = anchor.workspace.Tournament as Program<Tournament>;

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
  });

  it("Is initialized!", async () => {
    console.log(creator.publicKey);

    if (!program.provider.publicKey) return;

    const tournamentId = new anchor.BN(tournamentNumber);
    const tournamentIdBuffer = Buffer.alloc(8);
    tournamentIdBuffer.writeBigUint64LE(BigInt(tournamentNumber));

    const [tournament] = PublicKey.findProgramAddressSync(
      [Buffer.from("TOURNAMENT_STATE"), tournamentIdBuffer],
      program.programId
    );

    // Add your test here.
    const tx = await program.methods
      .initialize({
        creator: new PublicKey("wL14GpAYbo8AkMHZdBeoJUtFkEiQxgfaWMiXbtpAgWQ"),
        entryFees: new anchor.BN("2000000"),
        tournamentId,
      })
      .accounts({
        tournament,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();
    console.log("Your transaction signature", tx);
  });

  it("joining", async () => {
    if (!program.provider.publicKey) return;

    const teamId = new anchor.BN(1);

    const tournamentIdBuffer = Buffer.alloc(8);
    tournamentIdBuffer.writeBigUint64LE(BigInt(tournamentNumber));

    const [tournament] = PublicKey.findProgramAddressSync(
      [Buffer.from("TOURNAMENT_STATE"), tournamentIdBuffer],
      program.programId
    );

    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("VAULT"), tournament.toBuffer()],
      program.programId
    );

    const tx = await program.methods
      .joining({
        teamId,
      })
      .accounts({
        creator: user.publicKey,
        vault,
        tournament,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();
    console.log("Your transaction signature", tx);
  });

  it("fund", async () => {
    if (!program.provider.publicKey) return;

    const amount = new anchor.BN("2000000");

    const tournamentIdBuffer = Buffer.alloc(8);
    tournamentIdBuffer.writeBigUint64LE(BigInt(tournamentNumber));

    const [tournament] = PublicKey.findProgramAddressSync(
      [Buffer.from("TOURNAMENT_STATE"), tournamentIdBuffer],
      program.programId
    );

    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("VAULT"), tournament.toBuffer()],
      program.programId
    );

    const tx = await program.methods
      .funds({
        amount,
      })
      .accounts({
        creator: user.publicKey,
        vault,
        tournament,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();
    console.log("Your transaction signature", tx);
  });
});
