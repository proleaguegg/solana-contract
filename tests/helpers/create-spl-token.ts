import { createMint } from "@solana/spl-token";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import base58 from "bs58";
import dotenv from "dotenv";
import { solanaRpc } from "./test_contant";
dotenv.config();

const connection = new Connection(solanaRpc, "confirmed");
const createNewTokenMint = async (
  payer: Keypair,
  mintAuthority: Keypair,
  freezeAuthority: Keypair
) => {
  try {
    const mint = await createMint(
      connection,
      payer,
      mintAuthority.publicKey,
      freezeAuthority.publicKey,
      9 // We are using 9 to match the CLI decimal default exactly
    );

    // console.log(mint);
    // console.log(mint.toBytes());
    // console.log(mint.toBase58());
    return {
      mint: mint,
      mintToBase58: mint.toBase58(),
    };
  } catch (error) {
    throw error;
  }
};

const getOrCreateAccountToHoldBalance = async (
  mint: PublicKey,
  payer: Keypair
) => {
  try {
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      payer.publicKey
    );

    return tokenAccount;
  } catch (error) {
    throw error;
  }
};

const trnasferTokens = async (
  payer: Keypair,
  mint: PublicKey,
  mintAuthority: Keypair,
  tokenAccount
) => {
  try {
    const transfer = await mintTo(
      connection,
      payer,
      mint,
      tokenAccount.address,
      mintAuthority,
      1000 * LAMPORTS_PER_SOL // because decimals for the mint are set to 9
    );
    console.log(
      "\x1b[32m", //Green Text
      `   Transaction Success!🎉`,
      `\n    https://explorer.solana.com/tx/${transfer}?cluster=devnet`
    );
    return { transfer };
  } catch (error) {
    throw Error(error);
  }
};

// This anonymous function will invoke all the others functions
(async () => {
  try {
    // Get The Payer from the env
    const secret = process.env.DRIVER_ACCOUNT ?? "";
    if (!secret) {
      console.log("Err: No account found");
      return;
    }
    const secretKey = Uint8Array.from(base58.decode(secret));
    const payer = Keypair.fromSecretKey(secretKey);

    const mintAuthority = payer;
    const freezeAuthority = payer;
    // const mintAuthority = Keypair.generate();
    // const freezeAuthority = Keypair.generate();

    const mintAddressFromEnv = process.env.TOKEN_MINT;
    let mint: PublicKey;
    if (mintAddressFromEnv && mintAddressFromEnv.length > 0) {
      mint = new PublicKey(mintAddressFromEnv);
    } else {
      // Create Mint Token
      const mintTokenDetails = await createNewTokenMint(
        payer,
        mintAuthority,
        freezeAuthority
      );
      console.log("mintTokenDetails =>", mintTokenDetails);
      mint = mintTokenDetails.mint;
    }

    const tokenAccount = await getOrCreateAccountToHoldBalance(mint, payer);
    console.log("createOrGetAccount =>", tokenAccount);

    const transfer = await trnasferTokens(
      payer,
      mint,
      mintAuthority,
      tokenAccount
    );
    console.log("transfer =>", transfer);

    // const solTransferTransactionF = await solTransferTransactionFunc();

    console.log("create-spl-token run successfully");
    return;
  } catch (error) {
    console.log("Error in create-spl-token =>", error);
  }
})();
