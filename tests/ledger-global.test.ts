import dotenv from "dotenv";
import {
  signerIdentity,
  publicKey,
  Umi,
  Pda,
  PublicKey,
  Signer,
  Transaction,
} from "@metaplex-foundation/umi";
import { publicKey as publicKeySerializer } from "@metaplex-foundation/umi/serializers";

import { web3JsRpc } from "@metaplex-foundation/umi-rpc-web3js";
import { fromWeb3JsTransaction, toWeb3JsTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { createUmi as BaseCreateUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { tournamentProgram } from "./plugin.test";
import {
  findGlobalPda,
  safeFetchGlobal,
  initGlobal,
  updateGlobal,
  UpdateGlobalArgs,
} from "../js";
import {
  ledgerPubkey,
  solanaRpc,
} from "./helpers/contant";
import {
  sendConfirmBuilder,
} from "./helpers/helper";
import { LedgerWallet } from "@honeycomb-protocol/identity-ledger";
dotenv.config();

// Describe the Tournament Test Suite
describe("GlobalLedger", async function () {
  // Constant
  let umi: Umi;
  let authority: Signer;
  let global: Pda;
  let list: PublicKey[] = [
    publicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), //  USDC Mainnet
    publicKey("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"), // Bonk Mainnet
  ];
  let updateArgs: UpdateGlobalArgs = {
    __kind: "Remove",
    fields: [publicKey("8j7eMMBwJRjuCKXBp7KyhJ3Kk3wRKgQshJcbx9rifPDB")],
  };

  this.beforeAll(async () => {
    if (!ledgerPubkey?.length) {
      throw new Error("No ledger Pubkey provided");
    }
    if (!solanaRpc.length) {
      throw new Error("No RPC provided");
    }

    // Initializing values
    umi = BaseCreateUmi(solanaRpc, "finalized")
      .use(tournamentProgram())
      .use(web3JsRpc(solanaRpc));
    global = findGlobalPda(umi);
    console.log("Global: " + JSON.stringify(global));
    const wallet = await LedgerWallet.new(`usb://ledger/${ledgerPubkey}`);
    console.log("W: " + wallet.publicKey);
    authority = {
      publicKey: wallet.publicKey.toBase58() as PublicKey,
      signMessage: wallet.signMessage,
      signTransaction: async (tx) => {
        return fromWeb3JsTransaction(await wallet.signTransaction(toWeb3JsTransaction(tx)))
      },
      signAllTransactions: async (txns) => {
        let signedTxns: Transaction[] = [];
        for (let tx of txns) {
          signedTxns.push(fromWeb3JsTransaction(await wallet.signTransaction(toWeb3JsTransaction(tx))))
        }
        return signedTxns;
      },
    };
    console.log("Auth: " + authority.publicKey);
  });

  it.skip("Ledger Init Global", async function () {
    console.log("Ledger Init Global");
    umi.use(signerIdentity(authority, true));

    const programId = umi.programs.getPublicKey(
      "tournament",
      "matchNmUczmPKteQb9BJ8gRgafaQpDh2oDZJGuLsHfR"
    );
    console.log("Program: " + programId);

    const programData = umi.eddsa.findPda(
      publicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
      [publicKeySerializer().serialize(programId)]
    );
    console.log("Program Data: " + programData);
    const sdkFunc = initGlobal(umi, {
      global,
      list,
      program: programId,
      programData,
    });
    console.log({ programData, programId, authority: authority.publicKey })
    const sdkFuncTx = await sendConfirmBuilder(
      umi,
      authority,
      sdkFunc,
      "Init Golbal",
      "processed"
    );
  });

  it.skip("Update Global", async function () {
    umi.use(signerIdentity(authority, true));

    const programId = umi.programs.getPublicKey(
      "tournament",
      "matchNmUczmPKteQb9BJ8gRgafaQpDh2oDZJGuLsHfR"
    );

    const programData = umi.eddsa.findPda(
      publicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
      [publicKeySerializer().serialize(programId)]
    );

    const sdkFunc = updateGlobal(umi, {
      global,
      args: updateArgs,
      program: programId,
      programData,
    });
    const sdkFuncTx = await sendConfirmBuilder(
      umi,
      authority,
      sdkFunc,
      "Update Golbal",
      "processed"
    );
    return sdkFuncTx;
  });

  it("Ledger Fetch Global", async function () {
    const globalObj = await safeFetchGlobal(umi, global);
    console.dir(globalObj, { depth: null });
    return globalObj;
  });
});
