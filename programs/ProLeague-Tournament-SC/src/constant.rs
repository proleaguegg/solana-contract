use anchor_lang::{prelude::*, solana_program::pubkey};

#[constant]
pub const TOURNAMENT_TAG: &[u8] = b"TOURNAMENT_STATE";

#[constant]
pub const VAULT_TAG: &[u8] = b"VAULT";

#[constant]
pub const GLOBAL_TAG: &[u8] = b"GLOBAL";
#[constant]
pub const NON_WHITELISTED_CREATION_FEE: u64 = (0.001 * 1_000_000_000 as f64) as u64;

#[cfg(feature = "prod")]
const IS_PROD: bool = true;
#[cfg(not(feature = "prod"))]
const IS_PROD: bool = false;

#[constant]
pub const DRIVER: Pubkey = if IS_PROD {
    pubkey!("proL2SQUmHzNFRonxZBkSLkbAbpYhfX2z11XiUfkL4V")
} else {
    pubkey!("5dr5siu8axeYbruGQHMCLGrD2Wd45yXRrSgk4fmvwDu4")
};

// ===== Leaderboard =====

#[constant]
pub const LEADERBOARD_TAG: &[u8] = b"LEADERBOARD";

#[constant]
pub const PARTICIPANT_TAG: &[u8] = b"PARTICIPANT";

#[constant]
pub const SPONSOR_TAG: &[u8] = b"SPONSOR";

#[constant]
pub const TOTAL_BPS: u16 = 10_000;

#[constant]
pub const MAX_PAYOUT_SLOTS: u16 = 10;

#[constant]
pub const PLATFORM_FEE_BPS_MAX: u16 = 3_000; // 30% hard cap

#[constant]
pub const MIN_LEADERBOARD_DURATION: i64 = 3_600; // 1h

#[constant]
pub const MAX_LEADERBOARD_DURATION: i64 = 604_800; // 7d

#[constant]
pub const LEADERBOARD_ID_MAX_LEN: u32 = 28;

// Platform treasury — fee/dust sweep destination. Dev key is set for devnet.
// Verify the prod key is the intended mainnet treasury before any mainnet deploy.
#[constant]
pub const TREASURY: Pubkey = if IS_PROD {
    pubkey!("GdKWaposZA1cH76NFLdQbherDjoHt4Tu3CJbm1U2tCPN")
} else {
    pubkey!("9wep76Bp7V9heNCdtBkoWq5KzxskTnGiQj1niqwcxofj")
};

// // Function to return the production mint vector
// pub fn prod_mint_func() -> Vec<Pubkey> {
//     vec![
//         pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), // USD Mint Token
//         pubkey!("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"), // Bonk Mint Token
//     ]
// }

// // Function to return the development mint vector
// pub fn dev_mint_func() -> Vec<Pubkey> {
//     vec![
//         pubkey!("2jYyeN8DfzWvJaHZNUGYwP77Qavt2eJVYbUX9f3VW1CQ"), // Dev-net Dev Coin
//         pubkey!("8j7eMMBwJRjuCKXBp7KyhJ3Kk3wRKgQshJcbx9rifPDB"), // Dev-net BONK
//     ]
// }

// // Function to check if a given mint is valid
// pub fn is_valid_mint(mint: &Pubkey) -> bool {
//     let currency_mint: Vec<Pubkey> = if IS_PROD {
//         prod_mint_func()
//     } else {
//         dev_mint_func()
//     };
//     currency_mint.contains(mint)
// }
