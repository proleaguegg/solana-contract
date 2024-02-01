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
#[constant]
pub const CURRENCY_MINT: Pubkey = if IS_PROD {
    pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
} else {
    pubkey!("2jYyeN8DfzWvJaHZNUGYwP77Qavt2eJVYbUX9f3VW1CQ")
};
