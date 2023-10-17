import { createMint } from "@solana/spl-token";
import { clusterApiUrl, Connection, Keypair } from "@solana/web3.js";
import dotenv from "dotenv";

async () => {
  dotenv.config();

  const mintAuthority = Keypair.generate();
  const freezeAuthority = Keypair.generate();

  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const secret = JSON.parse(process.env.PRIVATE_KEY ?? "") as number[];
  const secretKey = Uint8Array.from(secret);
  const payer = Keypair.fromSecretKey(secretKey);

  const mint = await createMint(
    connection,
    payer,
    mintAuthority.publicKey,
    freezeAuthority.publicKey,
    9 // We are using 9 to match the CLI decimal default exactly
  );

  console.log(mint);
  console.log(mint.toBytes());
  console.log(mint.toBase58());
  // AQoKYV7tYpTrFZN6P5oUufbQKAUr9mNYGe1TTJC9wajM
};
// ();
