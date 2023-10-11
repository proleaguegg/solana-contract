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
declare_id!("4gyGnQe3EH4QsAgubFJJ6sE4hGb1Ck45CYrbbXrQ7zsj");

#[program]
mod tournament {

    use super::*;
    pub fn initialize(ctx: Context<Initialize>, args: ArgumentInitialize) -> Result<()> {
        instructions::initialize(ctx, args)
    }

    pub fn add_winner(ctx: Context<AddWinnerToRound>, args: AddWinnerToRoundArgs) -> Result<()> {
        instructions::add_winner(ctx, args)
    }

    pub fn conclude_match(ctx: Context<ConcludeMatch>) -> Result<()> {
        instructions::conclude_match(ctx)
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>, args: ClaimPrizeArgs) -> Result<()> {
        instructions::claim_prize(ctx, args)
    }
}
