import {
  Program,
  AnchorProvider,
  setProvider,
  web3,
  Wallet,
} from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import key from "../key.json";
import { Tournament, IDL } from "../target/types/tournament";

const devnetConfig = {
  network: "devnet",
  endpoint:
    "https://devnet.helius-rpc.com/?api-key=7050a011-776f-432b-8b0e-a4e490ec6c9f",
  proleagueProgram: new PublicKey(
    "DRxkk1zSd1my8RP1HkD3D9gK43ReSHnCBcPjMg6mG7tR"
  ),
  stakingProgram: PublicKey.default,
};

export const getDependencies = () => {
  const config = devnetConfig;

  const wallet = new Wallet(web3.Keypair.fromSecretKey(Uint8Array.from(key)));
  const provider = new AnchorProvider(
    new web3.Connection(config.endpoint, "processed"),
    wallet,
    {
      preflightCommitment: "confirmed",
    }
  );
  setProvider(provider);

  return {
    config: {
      ...config,
    },
    provider,
    payer: wallet.payer,
    proleagueProgram: new Program<Tournament>(
      IDL,
      config.proleagueProgram,
      provider
    ),
  };
};
