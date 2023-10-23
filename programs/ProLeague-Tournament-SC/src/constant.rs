use anchor_lang::prelude::*;

#[constant]
pub const TOURNAMENT_TAG: &[u8] = b"TOURNAMENT_STATE";

#[constant]
pub const VAULT_TAG: &[u8] = b"VAULT";

#[constant]
pub const DRIVER: Pubkey = Pubkey::new_from_array([
    37, 43, 1, 88, 216, 235, 8, 96, 79, 229, 37, 2, 25, 7, 252, 145, 175, 155, 136, 157, 135, 213,
    188, 211, 81, 251, 74, 161, 27, 2, 82, 90,
]); // base32 // 3W67tweAWfSFnv6W9ATPRBskBXcFMY7anVy1uyt2Hi65 => base64

#[constant]
pub const CURRENCY_MINT: Pubkey = Pubkey::new_from_array([
    207, 153, 17, 169, 82, 205, 35, 181, 229, 191, 7, 176, 221, 180, 104, 76, 157, 208, 54, 246, 3,
    245, 109, 127, 129, 229, 186, 82, 114, 69, 50, 9,
]); // base32 // EyNmZzNfYDB4GGhopqaUHLWCTtZkXKNYfcXN2oBxzkwi => base58
