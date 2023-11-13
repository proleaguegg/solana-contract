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
    pub tournament_concluded: bool,
    pub players: Vec<Pubkey>,
    pub rounds: Vec<Round>,
}

impl Tournament {
    /// The expected size of the `GuildKit` struct in bytes.
    pub const LEN: usize = 56 + 8;
    /// Sets default values for a GuildKit.
    pub fn set_defaults(&mut self) {
        self.creator = Pubkey::default();
        self.bump = 0;
        self.tournament_id = 0;
        self.joining_fees = 0;
        self.total_players = 0;
        self.total_rounds = 0;
        self.tournament_concluded = false;
        self.players = Vec::new();
        self.rounds = Vec::new();
    }
    pub fn calculate_size(total_players: u16, winning_rounds: usize) -> usize {
        let mut len = Self::LEN;
        let tp = total_players as usize;
        let tr = (total_players as f32).log2() as usize;
        len += tp * 32;
        len += tr * 32;
        len += 1;
        for i in 0..winning_rounds {
            len += 10 + (2u32.pow(i as u32) as usize * 5);
        }
        len
    }
}
