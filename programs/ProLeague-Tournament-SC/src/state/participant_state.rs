use anchor_lang::prelude::*;

#[account]
pub struct Participant {
    pub bump: u8,
    pub leaderboard: Pubkey,
    pub player: Pubkey,
    pub gross_contribution: u64,
    pub net_contribution: u64,
    pub joined_at: i64,
    // Set by send_prize_leaderboard so one wallet can't be paid more than one slot.
    pub prize_paid: bool,
}

impl Participant {
    // 8 + 1 + 32 + 32 + 8 + 8 + 8 + 1
    pub const LEN: usize = 8 + 1 + 32 + 32 + 8 + 8 + 8 + 1;
}
