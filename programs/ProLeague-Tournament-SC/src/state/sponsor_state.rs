use anchor_lang::prelude::*;

#[account]
pub struct Sponsor {
    pub bump: u8,
    pub leaderboard: Pubkey,
    pub sponsor: Pubkey,
    pub gross_contribution: u64,
    pub net_contribution: u64,
    pub last_deposit_at: i64,
}

impl Sponsor {
    // 8 + 1 + 32 + 32 + 8 + 8 + 8
    pub const LEN: usize = 8 + 1 + 32 + 32 + 8 + 8 + 8;
}
