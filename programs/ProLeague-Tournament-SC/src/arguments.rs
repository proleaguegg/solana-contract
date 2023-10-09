use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ArgumentInitialize {
    pub creator: Pubkey,
    pub escrow_balance: u64,
    pub tournament_id: u64,
    pub joining_fees: u64,
    pub total_players: u32,
    pub total_rounds: u32,
    pub match_concluded: bool,
}

// #[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
// pub struct ArgumentJoining {
//     pub team_id: u64,
// }

// #[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
// pub struct ArgumentFund {
//     pub amount: u64,
// }
