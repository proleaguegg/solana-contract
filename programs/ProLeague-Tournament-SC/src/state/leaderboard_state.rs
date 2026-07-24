use anchor_lang::prelude::*;

use crate::constant::{LEADERBOARD_ID_MAX_LEN, MAX_PAYOUT_SLOTS};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum LeaderboardState {
    Draft,
    Open,
    Concluded,
    Cancelled,
}

impl Default for LeaderboardState {
    fn default() -> Self {
        LeaderboardState::Draft
    }
}

#[account]
pub struct Leaderboard {
    pub bump: u8,
    pub leaderboard_id: String,
    pub creator: Pubkey,
    pub mint: Pubkey,

    // timing (unix seconds)
    pub start_timestamp: i64,
    pub end_timestamp: i64,
    pub sponsor_cutoff: i64, // seconds before end_timestamp where sponsorship closes

    // economics
    pub buy_in_amount: u64, // gross
    pub buy_in_net: u64,    // cached net after platform fee
    pub platform_fee_bps: u16,

    // capacity
    pub min_participants: u16,
    pub max_participants: u16,
    pub payout_slots_bps: Vec<u16>,

    // running state
    pub state: LeaderboardState,
    pub prize_pool: u64,    // net portion held in pool ATA, drives payout math
    pub pending_fees: u64,  // 20% portion held in pool ATA until conclude
    pub participant_count: u16,
    pub sponsor_count: u16,
    pub paid_slots: u16,
    pub refunded_player_count: u16,
    pub refunded_sponsor_count: u16,
    pub concluded_at: i64,
}

impl Leaderboard {
    // 8  discriminator
    // 1  bump
    // 4 + ID_MAX_LEN  leaderboard_id
    // 32 creator
    // 32 mint
    // 8  start_timestamp
    // 8  end_timestamp
    // 8  sponsor_cutoff
    // 8  buy_in_amount
    // 8  buy_in_net
    // 2  platform_fee_bps
    // 2  min_participants
    // 2  max_participants
    // 4 + (MAX_PAYOUT_SLOTS * 2)  payout_slots_bps
    // 1  state
    // 8  prize_pool
    // 8  pending_fees
    // 2  participant_count
    // 2  sponsor_count
    // 2  paid_slots
    // 2  refunded_player_count
    // 2  refunded_sponsor_count
    // 8  concluded_at
    pub const LEN: usize = 8
        + 1
        + 4 + LEADERBOARD_ID_MAX_LEN as usize
        + 32
        + 32
        + 8
        + 8
        + 8
        + 8
        + 8
        + 2
        + 2
        + 2
        + 4 + (MAX_PAYOUT_SLOTS as usize * 2)
        + 1
        + 8
        + 8
        + 2
        + 2
        + 2
        + 2
        + 2
        + 8;
}
