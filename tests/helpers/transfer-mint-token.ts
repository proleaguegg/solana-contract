import {
  createTransferInstruction,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import base58 from "bs58";
import dotenv from "dotenv";
dotenv.config();

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

// Transfer SOL to associated token account and use SyncNative to update wrapped SOL balance
const solTransferTransactionFunc = async (
  sourceAccount: PublicKey,
  destinationAccount: PublicKey,
  tokenOwner: PublicKey,
  transferAmount: Number | BigInt | any,
  signer: Keypair
) => {
  try {
    const tx = new Transaction();
    tx.add(
      createTransferInstruction(
        sourceAccount,
        destinationAccount,
        tokenOwner,
        LAMPORTS_PER_SOL * transferAmount
      )
    );
    const latestBlockHash = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latestBlockHash.blockhash;
    const signature = await sendAndConfirmTransaction(connection, tx, [signer]);
    console.log(
      "\x1b[32m", //Green Text
      `   Transaction Success!🎉`,
      `\n    https://explorer.solana.com/tx/${signature}?cluster=devnet`
    );
    return signature;
  } catch (error) {
    throw error;
  }
};

const getOrCreateAccountToHoldBalance = async (
  mint: PublicKey,
  payer: Keypair,
  owner: PublicKey
) => {
  try {
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      owner
    );

    return tokenAccount;
  } catch (error) {
    throw error;
  }
};

(async () => {
  try {
    const receiverPublicKey: PublicKey = new PublicKey(
      "4cs2geUpq927xWZ5fdTxFSwcB6bwL15eMSKs8p2cmAUq"
    ); //
    const tokenMint = new PublicKey(process.env.TOKEN_MINT || "");
    const driverKeyPair = Keypair.fromSecretKey(
      new Uint8Array(base58.decode(process.env.DRIVER_ACCOUNT || ""))
    );
    const mintOwnerAccount = Keypair.fromSecretKey(
      new Uint8Array(base58.decode(process.env.DRIVER_ACCOUNT || ""))
    );
    if (!mintOwnerAccount) {
      console.log("No Mint Owner Account provided");
      return;
    }

    const tokenAccountReceiver = await getOrCreateAccountToHoldBalance(
      tokenMint,
      driverKeyPair,
      receiverPublicKey
    );
    console.log("tokenAccountReceiver =>", tokenAccountReceiver);

    const tokenAccountDriver = await getOrCreateAccountToHoldBalance(
      tokenMint,
      driverKeyPair,
      driverKeyPair.publicKey
    );
    console.log("tokenAccountDriver =>", tokenAccountDriver);

    const transfer = await solTransferTransactionFunc(
      tokenAccountDriver.address,
      tokenAccountReceiver.address,
      mintOwnerAccount.publicKey,
      900,
      driverKeyPair
    );

    console.log("transfer =>", transfer);
    return;
  } catch (error) {
    console.log("Error in Transfer Mint Token => ", error);
  }
})();
