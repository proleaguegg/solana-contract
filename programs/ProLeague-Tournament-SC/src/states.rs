use anchor_lang::prelude::*;
// use std::collections::HashMap;

// Represents a tournament with multiple rounds and associated data.
#[account]
pub struct Tournament {
    pub creator: Pubkey,
    pub escrow_balance: u64,
    pub tournament_id: u64,
    pub joining_fees: u64,
    pub total_players: u32,
    pub total_rounds: u32,
    pub match_concluded: bool,
    pub rounds: Vec<Round>,
}

// Represents a single round in the tournament.
#[derive(AnchorSerialize, AnchorDeserialize, Default, Clone)]
pub struct Round {
    pub reverse_index: u8, // Made this public for potential external access.
    pub winning_price: u64,
    pub winners_and_collected_status: HashMap<Pubkey, RoundWinners>,
}

impl Round {
    // Checks if a new winner can be added to this round.
    pub fn can_add_winner(&self) -> bool {
        self.winners_and_collected_status.len() < (2u32.pow(self.reverse_index as u32)) as usize
    }

    // Checks if a given winner already exists in the winners_and_collected_status.
    pub fn winner_exists(&self, winner: &Pubkey) -> bool {
        self.winners_and_collected_status.contains_key(winner)
    }

    // Checks if a given winner can claim their prize.
    pub fn can_claim_prize(&self, tournament: &Tournament, winner: &Pubkey) -> bool {
        // Check if the match has concluded
        if tournament.match_concluded {
            // Retrieve the status of the provided winner
            if let Some(winner_status) = self.winners_and_collected_status.get(winner) {
                // Determine if they can claim the prize based on their status
                return !winner_status.won_next_round && !winner_status.claimed;
            }
        }
        false
    }

    // Marks the prize as claimed for a given winner if they exist.
    pub fn mark_prize_as_claimed(&mut self, winner: &Pubkey) {
        if self.winners_and_collected_status.contains_key(winner) {
            if let Some(winner_status) = self.winners_and_collected_status.get_mut(winner) {
                winner_status.claimed = true;
            }
        }
    }
}

// Represents the status of a winner for a round.
#[derive(AnchorSerialize, AnchorDeserialize, Default, Clone)]
pub struct RoundWinners {
    pub won_next_round: bool, // To check if he/she win the next round so can't claimed.
    pub claimed: bool,        // Made this public for potential external access.
}
