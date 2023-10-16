use anchor_lang::prelude::*;

#[constant]
pub const TOURNAMENT_TAG: &[u8] = b"TOURNAMENT_STATE";

#[constant]
pub const VAULT_TAG: &[u8] = b"VAULT";

#[constant]
pub const DRIVER: Pubkey = Pubkey::new_from_array([
    191, 248, 116, 64, 129, 152, 173, 146, 231, 16, 5, 235, 239, 115, 168, 199, 101, 224, 172, 158,
    72, 114, 111, 108, 99, 99, 170, 8, 7, 101, 234, 49,
]);

#[constant]
pub const CURRENCY_MINT: Pubkey = Pubkey::new_from_array([
    191, 248, 116, 64, 129, 152, 173, 146, 231, 16, 5, 235, 239, 115, 168, 199, 101, 224, 172, 158,
    72, 114, 111, 108, 99, 99, 170, 8, 7, 101, 234, 49,
]);
