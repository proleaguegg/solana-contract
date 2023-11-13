use {anchor_lang::prelude::*, std::collections::HashMap};

// Represents a single round in the tournament.
#[derive(AnchorSerialize, AnchorDeserialize, Default, Clone, Debug)]
pub struct Round {
    pub reverse_index: u8, // Made this public for potential external access.
    pub winning_price: u64,
    pub winners_and_collected_status: HashMap<u32, RoundWinners>,
}

impl Round {
    // Checks if a new winner can be added to this round.
    pub fn can_add_winner(&self) -> bool {
        self.winners_and_collected_status.len() < (2u32.pow(self.reverse_index as u32)) as usize
    }

    // Checks if a given winner already exists in the winners_and_collected_status.
    pub fn winner_exists(&self, winner_index: &u32) -> bool {
        self.winners_and_collected_status.contains_key(winner_index)
    }
}

// Represents the status of a winner for a round.
#[derive(AnchorSerialize, AnchorDeserialize, Default, Debug, Clone)]
pub struct RoundWinners {
    pub won_next_round: bool, // To check if he/she win the next round so can't claimed.
    pub claimed: bool,        // Made this public for potential external access.
}
