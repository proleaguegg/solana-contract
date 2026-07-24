use anchor_lang::prelude::*;

#[account]
pub struct Participant {
    pub bump: u8,
    pub leaderboard: Pubkey,
    pub player: Pubkey,
    pub gross_contribution: u64,
    pub net_contribution: u64,
    pub joined_at: i64,
}

impl Participant {
    // 8 + 1 + 32 + 32 + 8 + 8 + 8
    pub const LEN: usize = 8 + 1 + 32 + 32 + 8 + 8 + 8;
}
