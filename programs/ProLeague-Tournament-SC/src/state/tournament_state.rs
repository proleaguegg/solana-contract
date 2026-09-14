use anchor_lang::prelude::*;

use super::Round;

// Represents a tournament with multiple rounds and associated data.
#[account]
pub struct Tournament {
    pub bump: u8,
    pub creator: Pubkey,
    pub joining_fees: u64,
    pub total_players: u16,
    pub total_rounds: u16,
    pub is_published: bool,
    pub tournament_id: String,
    pub players: Vec<Pubkey>,
    pub rounds: Vec<Round>,
    pub sponsor: Pubkey,
    pub sponsor_amount: u64,
    pub is_sponsored: bool,
    pub is_paused: bool,
    pub mint: Pubkey,
    pub is_announced: bool,
    pub platform_fee_bps: u16, // creator-set at initialize, capped at PLATFORM_FEE_BPS_MAX
    pub pending_fees: u64, // fee portion already skimmed from entries/sponsor money, owed to TREASURY at close
    // pub tournament_closed: bool,
    // pub is_closed: bool,
}

impl Tournament {
    /// The expected size of the `GuildKit` struct in bytes.
    pub const LEN: usize = 8 // discriminator
    + 1 // bump
    + 32 // creator pubkey
    + 32 // sponsor pubkey
    + 8 // joining_fees
    + 8 // sponsor_amount
    + 2 // total_players
    + 2 // total_rounds
    + 1 // is_published
    + 1 // is_announced
    + 1 // is_sponsored
    + 1 // is_paused
    + 4 // tournament_id (length)
    + 28 // Default string size for tournament_id (adjustable)
    + 32 // mint pubkey
    + 2 // platform_fee_bps
    + 8; // pending_fees
    /// Sets default values for a GuildKit.
    pub fn set_defaults(&mut self) {
        self.creator = Pubkey::default();
        self.sponsor = Pubkey::default();
        self.bump = 0;
        self.tournament_id = String::from("default");
        self.joining_fees = 0;
        self.sponsor_amount = 0;
        self.total_players = 0;
        self.total_rounds = 0;
        self.is_published = false;
        self.is_paused = false;
        self.is_sponsored = false;
        // self.tournament_closed = false;
        self.players = Vec::new();
        self.rounds = Vec::new();
        self.is_announced = false;
        self.platform_fee_bps = 0;
        self.pending_fees = 0;
        // self.is_closed = false;
    }
    pub fn calculate_size(total_players: u16, total_rounds: u16) -> usize {
        let mut size = Self::LEN;

        // Add size for each player's pubkey
        size += (total_players as usize) * 32; // Each pubkey is 32 bytes

        // Add size for each round
        for round_index in 0..total_rounds as usize {
            let entries = 2u32.pow(round_index as u32) as usize; // Number of possible winners per round
            let map_entry_size = 8 + 4 + 1 + 1; // Approx size for each map entry: 8 bytes for key, 4 bytes for value struct, and additional overhead
            let hashmap_overhead = 16; // Generic overhead for hash map metadata
            size += hashmap_overhead + (entries * map_entry_size);
        }

        size
    }
}
