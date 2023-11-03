use anchor_lang::prelude::*;

use super::Round;

// Represents a tournament with multiple rounds and associated data.
#[account]
pub struct Tournament {
    pub bump: u8,
    pub creator: Pubkey,
    pub tournament_id: u64,
    pub joining_fees: u64,
    pub total_players: u16,
    pub total_rounds: u16,
    pub match_concluded: bool,
    pub rounds: Vec<Round>,
}

impl Tournament {
    /// The expected size of the `GuildKit` struct in bytes.
    pub const LEN: usize = 96 + 8;
    /// Sets default values for a GuildKit.
    pub fn set_defaults(&mut self) {
        self.creator = Pubkey::default();
        self.bump = 0;
        self.tournament_id = 0;
        self.joining_fees = 0;
        self.total_players = 0;
        self.total_rounds = 0;
        self.match_concluded = false;
        self.rounds = Vec::new();
    }
}
