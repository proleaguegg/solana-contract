use anchor_lang::{prelude::*, solana_program::pubkey};

#[constant]
pub const TOURNAMENT_TAG: &[u8] = b"TOURNAMENT_STATE";

#[constant]
pub const VAULT_TAG: &[u8] = b"VAULT";

#[constant]
pub const DRIVER: Pubkey = pubkey!("proL2SQUmHzNFRonxZBkSLkbAbpYhfX2z11XiUfkL4V");

#[constant]
pub const CURRENCY_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// #[constant]
// pub const DRIVER: Pubkey = pubkey!("3W67tweAWfSFnv6W9ATPRBskBXcFMY7anVy1uyt2Hi65");

// #[constant]
// pub const CURRENCY_MINT: Pubkey = pubkey!("2jYyeN8DfzWvJaHZNUGYwP77Qavt2eJVYbUX9f3VW1CQ");
