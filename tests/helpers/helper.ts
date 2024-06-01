import base58 from "bs58";
import {
  Commitment,
  Context,
  KeypairSigner,
  Pda,
  PublicKey,
  RpcConfirmTransactionResult,
  Signer,
  TransactionBuilder,
  TransactionSignature,
  Umi,
} from "@metaplex-foundation/umi";
import fs from "fs";
import {
  setComputeUnitLimit,
  setComputeUnitPrice,
  createAssociatedToken,
} from "@metaplex-foundation/mpl-toolbox";
import { string } from "@metaplex-foundation/umi/serializers";
import {
  clusterUrl,
  computeUnitLimit,
  priorityRate,
  solanaUrl,
} from "./contant";

export function appendToJsonFile(filePath, newData) {
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        // File does not exist, so create it with initial array containing newData
        console.log("File not found. Creating new file.");
        let initialData = [newData]; // Assuming we start with an array
        fs.writeFile(
          filePath,
          JSON.stringify(initialData, null, 4),
          "utf8",
          (err) => {
            if (err) {
              console.error("An error occurred while creating the file:", err);
            } else {
              console.log("File created and data added successfully.");
            }
          }
        );
      } else {
        console.error("An error occurred while reading the file:", err);
      }
      return;
    }

    try {
      // Parse the existing JSON data
      let jsonData = JSON.parse(data) || [];

      // Append new data to the JSON array
      // jsonData = [...jsonData, ...newData];
      jsonData = newData;

      // Convert the updated JSON object back to a string
      const updatedJsonData = JSON.stringify(jsonData, null, 4);

      // Write the updated JSON data back to the file
      fs.writeFile(filePath, updatedJsonData, "utf8", (err) => {
        if (err) {
          console.error("An error occurred while writing to the file:", err);
        } else {
          console.log("Data appended successfully.");
        }
      });
      return updatedJsonData;
    } catch (parseError) {
      console.error("An error occurred while parsing JSON data:", parseError);
    }
  });
}

export function findTempTournamentPda(
  context: Pick<Context, "eddsa" | "programs">,
  seeds: {
    /** Random Tournament id */
    tournamentId: string;
  }
): Pda {
  const programId = context.programs.getPublicKey(
    "tournament",
    "matchNmUczmPKteQb9BJ8gRgafaQpDh2oDZJGuLsHfR"
  );
  return context.eddsa.findPda(programId, [
    string({ size: "variable" }).serialize("TEMP_TOURNAMENT"),
    string({ size: "variable" }).serialize("TOURNAMENT_STATE"),
    string({ size: "variable" }).serialize(seeds.tournamentId),
  ]);
}

export const priorityFeeIX = (umiInstance: Context, rate = priorityRate) =>
  setComputeUnitPrice(umiInstance, {
    microLamports: rate, // computeUnits (Default(400_000 or 200_000)) * priorityFee (1000) / 100_000 / 1_000_000_000 => 0.000004 lamports
  });

export const setComputeUnitsFunc = (umiInstance: Context, limit = 250000) =>
  setComputeUnitLimit(umiInstance, {
    units: limit,
  });

export const sendConfirmBuilder = async (
  umi: Umi,
  driverSigner: KeypairSigner,
  builder: TransactionBuilder,
  action: string,
  cmtment: Commitment = "processed", // Default value for commitment
  computeUnit = computeUnitLimit
  // Default value for commitment
): Promise<{
  signature: TransactionSignature;
  result: RpcConfirmTransactionResult;
}> => {
  try {
    const getRecentBlockHashObj = await umi.rpc.getLatestBlockhash({
      commitment: "processed",
    });
    // console.log({ getRecentBlockHashObj });
    const tx = await builder
      .setBlockhash(getRecentBlockHashObj)
      .prepend(priorityFeeIX(umi))
      .prepend(setComputeUnitsFunc(umi, computeUnit))
      .setFeePayer(driverSigner)
      .sendAndConfirm(umi, {
        send: {
          preflightCommitment: "processed",
          // skipPreflight: true,
        },
        confirm: {
          commitment: cmtment,
          strategy: {
            type: "blockhash",
            ...getRecentBlockHashObj,
          },
        },
      });
    console.log(
      `Transaction Signature for ${action} Success!🎉 https://${solanaUrl}/tx/${base58.encode(
        tx.signature
      )}?cluster=${clusterUrl}`
    );
    return tx;
  } catch (error: any) {
    // console.log("sendConfirmBuilder error", error);
    throw new Error(error);
  }
};

export const sendConfirmBuilderArr = async (
  umi: Umi,
  driverSigner: KeypairSigner,
  builders: TransactionBuilder[],
  cmtment: Commitment = "processed", // Default value for commitment
  computeUnit = computeUnitLimit
): Promise<
  {
    signature: TransactionSignature;
    result: RpcConfirmTransactionResult;
  }[]
> => {
  try {
    const getRecentBlockHashObj = await umi.rpc.getLatestBlockhash({
      commitment: "confirmed",
    });
    // console.log({ getRecentBlockHashObj });

    const transactions = builders.map(async (builder) => {
      const tx = builder
        .setBlockhash(getRecentBlockHashObj)
        .prepend(priorityFeeIX(umi))
        .prepend(setComputeUnitsFunc(umi, computeUnit))
        .setFeePayer(driverSigner)
        .sendAndConfirm(umi, {
          send: {
            preflightCommitment: "processed",
            // skipPreflight: true,
          },
          confirm: {
            commitment: cmtment,
            strategy: {
              type: "blockhash",
              ...getRecentBlockHashObj,
            },
          },
        });
      return tx;
    });

    return Promise.all(transactions);
  } catch (error: any) {
    // console.log("sendConfirmBuilderArr error", error);
    throw new Error(error);
  }
};

// Utility function to create a Keypair from a secret key
export const createKeypairFromSecret = (secret) => {
  return new Uint8Array(base58.decode(secret));
};

export const createTokenAccount = async (
  umi: Umi,
  mint: PublicKey,
  driver: KeypairSigner,
  user: PublicKey
) => {
  try {
    const txFunc = createAssociatedToken(umi, {
      mint: mint,
      owner: user,
      payer: driver,
    });
    const tx = await sendConfirmBuilder(
      umi,
      driver,
      txFunc,
      "Creating Token Account",
      "finalized"
    );
  } catch (error) {
    // console.log("Already account created =>", error);
  }
};
