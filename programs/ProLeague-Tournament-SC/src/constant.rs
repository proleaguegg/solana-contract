use anchor_lang::{prelude::*, solana_program::pubkey};

#[constant]
pub const TOURNAMENT_TAG: &[u8] = b"TOURNAMENT_STATE";

#[constant]
pub const VAULT_TAG: &[u8] = b"VAULT";

#[cfg(feature = "prod")]
const IS_PROD: bool = true;
#[cfg(not(feature = "prod"))]
const IS_PROD: bool = false;

#[constant]
pub const DRIVER: Pubkey = if IS_PROD {
    pubkey!("proL2SQUmHzNFRonxZBkSLkbAbpYhfX2z11XiUfkL4V")
} else {
    pubkey!("3W67tweAWfSFnv6W9ATPRBskBXcFMY7anVy1uyt2Hi65")
};

// Function to return the production mint vector
pub fn prod_mint_func() -> Vec<Pubkey> {
    vec![
        pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), // USD Mint Token
        pubkey!("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"), // Bonk Mint Token
    ]
}

// Function to return the development mint vector
pub fn dev_mint_func() -> Vec<Pubkey> {
    vec![
        pubkey!("2jYyeN8DfzWvJaHZNUGYwP77Qavt2eJVYbUX9f3VW1CQ"), // Dev-net Dev Coin
        pubkey!("8j7eMMBwJRjuCKXBp7KyhJ3Kk3wRKgQshJcbx9rifPDB"), // Dev-net BONK
    ]
}

// Function to check if a given mint is valid
pub fn is_valid_mint(mint: &Pubkey) -> bool {
    let currency_mint: Vec<Pubkey> = if IS_PROD {
        prod_mint_func()
    } else {
        dev_mint_func()
    };
    currency_mint.contains(mint)
}
