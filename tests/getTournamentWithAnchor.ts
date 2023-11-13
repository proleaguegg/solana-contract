import { getDependencies } from "./getDependencies";
import * as web3 from "@solana/web3.js";

const fn = async () => {
  const { config, payer, proleagueProgram } = getDependencies();

  let deployments: any = {};

  console.log("Program", proleagueProgram.programId.toString());
  console.log("RPC", proleagueProgram.provider.connection.rpcEndpoint);

//   const projectKey = deployments.project
//     ? new web3.PublicKey(deployments.project)
//     : web3.Keypair.generate().publicKey;

//   const [project] = web3.PublicKey.findProgramAddressSync(
//     [Buffer.from("project", "utf8"), projectKey.toBuffer()],
//     proleagueProgram.programId
//   );

//   const authority = new web3.PublicKey(
//     "BnkNn8MTVgiGjYQRtJsFCfqXvYMd3o2WsaiBfh8dxSpn" // bonk
//     // "CHFCCs3FKD7vnZXqSomjXLMPZLBi5dwpbwnkK5WvFpXW" // kronikz
//   );

//   const accounts = {
//     key: projectKey,
//     project,
//     owner: payer.publicKey,
//     // newOwner: payer.publicKey,
//     newOwner: authority,
//     systemProgram: web3.SystemProgram.programId,
//   };

//   Object.entries(accounts).forEach(([key, val]) => {
//     console.log(`${key}: ${val.toString()}`);
//   });

//   if (deployments.project) {
//     const txId = await proleagueProgram.methods
//       .updateProject({
//         escrow: authority,
//         stakingProgram: config.stakingProgram,
//       })
//       .accounts(accounts)
//       .rpc();
//     console.log("======= Project Updated =======");
//     console.log(`Transaction Signature: ${txId}`);
//   } else {
//     console.log("NEW");
//     const txId = await proleagueProgram.methods
//       .initializeProject({
//         escrow: authority,
//         stakingProgram: config.stakingProgram,
//       })
//       .accounts(accounts)
//       .rpc();
//     console.log("======= Project Initialized =======");
//     console.log(`Transaction Signature: ${txId}`);
//   }

//   setDeployments({
//     program: proleagueProgram.programId.toString(),
//     project: projectKey.toString(),
//   });
};

fn();
// fn(process.argv[2]);
