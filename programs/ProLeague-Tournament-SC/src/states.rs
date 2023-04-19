use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct Tournament {
    pub creator: Pubkey,
    pub entry_fees: u64,
    pub tournament_id: u64,
    pub participations: Vec<Participations>,
    pub prizes: Vec<Prize>,
    pub is_closed: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Default,Clone)]
pub struct Prize {
    pub winner: Option<Pubkey>,
    pub amount: u64,
    pub claimed: bool,
    pub position: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Default,Clone)]
pub struct Participations {
    pub team_id: u64,
}
