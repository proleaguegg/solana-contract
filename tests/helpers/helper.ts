import * as web3 from '@solana/web3.js';
import base58 from 'bs58';
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
} from '@metaplex-foundation/umi';
import fs from 'fs';
import {
  setComputeUnitLimit,
  setComputeUnitPrice,
  createAssociatedToken,
} from '@metaplex-foundation/mpl-toolbox';
import { string } from '@metaplex-foundation/umi/serializers';
import {
  clusterUrl,
  computeUnitLimit,
  priorityRate,
  solanaRpc,
  solanaUrl,
} from './contant';
import { LedgerWallet } from '@honeycomb-protocol/identity-ledger';
import { Honeycomb, walletIdentity } from '@honeycomb-protocol/hive-control';

export function appendToJsonFile(filePath, newData) {
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // File does not exist, so create it with initial array containing newData
        console.log('File not found. Creating new file.');
        let initialData = [newData]; // Assuming we start with an array
        fs.writeFile(
          filePath,
          JSON.stringify(initialData, null, 4),
          'utf8',
          (err) => {
            if (err) {
              console.error('An error occurred while creating the file:', err);
            } else {
              console.log('File created and data added successfully.');
            }
          }
        );
      } else {
        console.error('An error occurred while reading the file:', err);
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
      fs.writeFile(filePath, updatedJsonData, 'utf8', (err) => {
        if (err) {
          console.error('An error occurred while writing to the file:', err);
        } else {
          console.log('Data appended successfully.');
        }
      });
      return updatedJsonData;
    } catch (parseError) {
      console.error('An error occurred while parsing JSON data:', parseError);
    }
  });
}

export function findTempTournamentPda(
  context: Pick<Context, 'eddsa' | 'programs'>,
  seeds: {
    /** Random Tournament id */
    tournamentId: string;
  }
): Pda {
  const programId = context.programs.getPublicKey(
    'tournament',
    'matchNmUczmPKteQb9BJ8gRgafaQpDh2oDZJGuLsHfR'
  );
  return context.eddsa.findPda(programId, [
    string({ size: 'variable' }).serialize('TEMP_TOURNAMENT'),
    string({ size: 'variable' }).serialize('TOURNAMENT_STATE'),
    string({ size: 'variable' }).serialize(seeds.tournamentId),
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

/**
 * Devnet RPC endpoints drop a sizeable share of *concurrent* connections
 * (ETIMEDOUT surfacing as `fetch failed`). Only those transport-level failures
 * are worth retrying — a program error means the transaction genuinely failed.
 */
const isTransientRpcError = (e: any): boolean => {
  const blob = `${e?.message ?? ''} ${e?.cause?.code ?? ''} ${
    e?.cause?.message ?? ''
  }`.toLowerCase();
  return (
    blob.includes('fetch failed') ||
    blob.includes('etimedout') ||
    blob.includes('econnreset') ||
    blob.includes('socket hang up') ||
    blob.includes('429') ||
    blob.includes('too many requests')
  );
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const sendConfirmBuilder = async (
  umi: Umi,
  driverSigner: KeypairSigner | Signer,
  builder: TransactionBuilder,
  action: string,
  cmtment: Commitment = 'processed', // Default value for commitment
  computeUnit = computeUnitLimit
  // Default value for commitment
): Promise<{
  signature: TransactionSignature;
  result: RpcConfirmTransactionResult;
}> => {
  try {
    const getRecentBlockHashObj = await umi.rpc.getLatestBlockhash({
      commitment: 'processed',
    });
    // console.log({ getRecentBlockHashObj });
    const prepared = builder
      .setBlockhash(getRecentBlockHashObj)
      .prepend(priorityFeeIX(umi))
      .prepend(setComputeUnitsFunc(umi, computeUnit))
      .setFeePayer(driverSigner);

    // Same blockhash on every attempt => same signature => a retry that races a
    // landed transaction is de-duplicated by the cluster rather than repeated.
    let tx: any;
    let lastError: any;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        tx = await prepared.sendAndConfirm(umi, {
          send: {
            preflightCommitment: 'processed',
            // skipPreflight: true,
          },
          confirm: {
            commitment: cmtment,
            strategy: {
              type: 'blockhash',
              ...getRecentBlockHashObj,
            },
          },
        });
        break;
      } catch (e: any) {
        lastError = e;
        if (!isTransientRpcError(e) || attempt === 4) throw e;
        await wait(500 * attempt);
      }
    }
    if (!tx) throw lastError;
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
  cmtment: Commitment = 'processed', // Default value for commitment
  computeUnit = computeUnitLimit,
  concurrency = 3,
  attempts = 4
): Promise<
  {
    signature: TransactionSignature;
    result: RpcConfirmTransactionResult;
  }[]
> => {
  try {
    const getRecentBlockHashObj = await umi.rpc.getLatestBlockhash({
      commitment: 'confirmed',
    });

    const sendOne = async (builder: TransactionBuilder) => {
      // The blockhash is held fixed across retries on purpose: the retried
      // transaction then carries the SAME signature, so if an earlier attempt
      // actually landed the cluster de-duplicates it instead of executing twice.
      const prepared = builder
        .setBlockhash(getRecentBlockHashObj)
        .prepend(priorityFeeIX(umi))
        .prepend(setComputeUnitsFunc(umi, computeUnit))
        .setFeePayer(driverSigner);

      let lastError: any;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await prepared.sendAndConfirm(umi, {
            send: { preflightCommitment: 'processed' },
            confirm: {
              commitment: cmtment,
              strategy: { type: 'blockhash', ...getRecentBlockHashObj },
            },
          });
        } catch (e: any) {
          lastError = e;
          if (!isTransientRpcError(e) || attempt === attempts) throw e;
          await wait(500 * attempt);
        }
      }
      throw lastError;
    };

    // Bounded concurrency — firing every builder at once is what triggers the
    // endpoint's connection drops in the first place.
    const results: {
      signature: TransactionSignature;
      result: RpcConfirmTransactionResult;
    }[] = [];
    for (let i = 0; i < builders.length; i += concurrency) {
      const chunk = builders.slice(i, i + concurrency);
      results.push(...(await Promise.all(chunk.map(sendOne))));
    }
    return results;
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
      'Creating Token Account',
      'finalized'
    );
  } catch (error) {
    // console.log("Already account created =>", error);
  }
};

export const getHoneycomb = async (address: string): Promise<Honeycomb> => {
  try {
    const connection = new web3.Connection(solanaRpc, 'processed');
    const wallet = await LedgerWallet.new(`usb://ledger/${address}`);

    const adminHC = new Honeycomb(connection);
    console.log('Done initializing Honeycomb');

    adminHC.use(walletIdentity(wallet));

    return adminHC;
  } catch (error: any) {
    throw new Error(error);
  }
};
