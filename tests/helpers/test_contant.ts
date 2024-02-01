import dotenv from "dotenv";

dotenv.config();
export const tokenMint = process.env.TOKEN_MINT || "";
export const solanaRpc = process.env.SOLANA_RPC || "";
export const solanaUrl = process.env.SOLANA_URL || "";
export const clusterUrl = process.env.CLUSTER_URL || "";
