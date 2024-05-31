import {
  percentAmount,
  generateSigner,
  signerIdentity,
  createSignerFromKeypair,
  Umi,
  KeypairSigner,
} from "@metaplex-foundation/umi";
import base58 from "bs58";
import {
  TokenStandard,
  createAndMint,
  mplTokenMetadata,
} from "@metaplex-foundation/mpl-token-metadata";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { solanaRpc } from "./contant";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
// Bonk
const metadata = {
  name: "Bonk",
  symbol: "BONK",
  uri: "https://bonkcoin.com/static/media/bonkog_200.e87b5d92088ca7a75178.png",
};
// Ponke
// const metadata = {
//   name: "Ponke",
//   symbol: "PONKE",
//   uri: "https://statics.solscan.io/cdn/imgs/s60?ref=68747470733a2f2f676174657761792e697279732e78797a2f59424d445642766e66674f31675843536d6d63387030525168633639575765385f6b4f6b6f543877376e45",
// };

const createAndMintFunc = async (umi: Umi, mint: KeypairSigner) =>
  createAndMint(umi, {
    mint,
    authority: umi.identity,
    name: metadata.name,
    symbol: metadata.symbol,
    uri: metadata.uri,
    sellerFeeBasisPoints: percentAmount(0),
    decimals: 9,
    amount: 1000000000 * LAMPORTS_PER_SOL,
    tokenOwner: umi.identity.publicKey,
    tokenStandard: TokenStandard.Fungible,
  }).sendAndConfirm(umi, {
    send: {
      preflightCommitment: "processed",
    },
    confirm: {
      commitment: "processed",
    },
  });

// This anonymous function will invoke all the others functions
(async () => {
  try {
    const umi = createUmi(solanaRpc, "confirmed"); //Replace with your QuickNode RPC Endpoint
    umi.use(mplTokenMetadata());

    const secret = process.env.DRIVER_ACCOUNT ?? "";
    if (!secret) {
      console.log("Err: No account found");
      return;
    }

    const driver = umi.eddsa.createKeypairFromSecretKey(
      new Uint8Array(base58.decode(secret))
    );
    const driverSigner = createSignerFromKeypair(umi, driver);

    umi.use(signerIdentity(driverSigner));

    const mint = generateSigner(umi);
    console.log({ mint });

    const res = await createAndMintFunc(umi, mint);
    console.log("res =>", res);

    console.log("Spl-Token created using Metaplex");
    return;
  } catch (error) {
    console.log("Error in creating Spl-Token =>", error);
  }
})();
