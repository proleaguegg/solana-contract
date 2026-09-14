import dotenv from 'dotenv';
import { randomStringGenerator } from './randomString';

dotenv.config();
export const solanaRpc = process.env.SOLANA_RPC || '';
export const solanaUrl = process.env.SOLANA_URL || '';
export const clusterUrl = process.env.CLUSTER_URL || '';
export const tokenMint = process.env.TOKEN_MINT;
export const tourId = process.env.TOURNAMENT_ID;
export const creatorAccount = process.env.CREATOR_ACCOUNT;
export const driverAccount = process.env.DRIVER_ACCOUNT;
export const sponsorAccount = process.env.SPONSOR_ACCOUNT;
export const priorityRate = Number(process.env.PRIORITY_RATE) || 2500;
export const computeUnitLimit =
  Number(process.env.COMPUTE_UNIT_LIMIT) || 450_000; // computeUnitLimit = 200_000
export const ledgerPubkey = process.env.LEDGER_PUBKEY;
