use anchor_lang::prelude::*;
// use std::collections::HashMap;

// pub mod accountsInfo;
// pub mod arguments;
pub mod constant;
pub mod errors;
pub mod instructions;
pub mod state;

// use crate::{accountsInfo::*, arguments::*, errors::*, state::*};
use instructions::*;

// This is your program's public key and it will update
// automatically when you build the project.
declare_id!("FLx2dcA4c4ZYhamknXRTgWYPg8NCr4Bt8Ut8oiUKcG5T");

#[program]
mod tournament {

    use super::*;
    pub fn initialize(ctx: Context<Initialize>, args: ArgumentInitialize) -> Result<()> {
        instructions::initialize(ctx, args)
    }

    pub fn add_winner(ctx: Context<AddWinnerToRound>, args: AddWinnerToRoundArgs) -> Result<()> {
        instructions::add_winner(ctx, args)
    }

    pub fn mark_winner_won_next_round(ctx: Context<MarkWinnerWonNextRound>, args: MarkWinnerWonNextRoundArgs) -> Result<()> {
        instructions::mark_winner_won_next_round(ctx, args)
    }

    pub fn conclude_match(ctx: Context<ConcludeMatch>) -> Result<()> {
        instructions::conclude_match(ctx)
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>, args: ClaimPrizeArgs) -> Result<()> {
        instructions::claim_prize(ctx, args)
    }
}
